/* Run: node tests/permissions.test.js — host-permission onboarding + content-script robustness. */
const fs = require("fs"), path = require("path"), assert = require("assert"), vm = require("vm");
const R = path.join(__dirname, "..");
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

function bg(granted) {
  const calls = { tabs: [], requests: [], badge: [] }, L = {};
  const ctx = {
    console, Promise, setTimeout,
    browser: {
      runtime: { onInstalled: { addListener: f => (L.installed = f) }, getURL: (p) => "moz-extension://x/" + p },
      tabs: { create: async (o) => { calls.tabs.push(o.url); } },
      action: { onClicked: { addListener: f => (L.click = f) }, setBadgeText: async (o) => calls.badge.push(o.text), setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
      permissions: {
        contains: async ({ origins }) => origins.every(o => granted.has(o)),
        request: (o) => { calls.requests.push(o.origins); o.origins.forEach(x => granted.add(x)); return Promise.resolve(true); },
        onAdded: { addListener() {} }, onRemoved: { addListener() {} }
      }
    }
  };
  ctx.globalThis = ctx; vm.createContext(ctx);
  for (const f of ["shared/constants.js", "background/permissions.js"]) vm.runInContext(fs.readFileSync(path.join(R, f), "utf8"), ctx, { filename: f });
  return { ctx, calls, L };
}

(async () => {
  const manifest = require(path.join(R, "manifest.json"));
  const consts = {}; vm.runInNewContext(fs.readFileSync(path.join(R, "shared/constants.js"), "utf8"), Object.assign(consts, { globalThis: consts }));
  assert.deepStrictEqual([...consts.GF.HOST_MATCHES], manifest.host_permissions, "HOST_MATCHES == manifest host_permissions");
  assert.deepStrictEqual(manifest.content_scripts[0].matches, manifest.host_permissions);
  assert.ok(manifest.background.scripts.includes("background/permissions.js"));
  assert.ok(manifest.action, "toolbar action present");
  assert.ok(fs.existsSync(path.join(R, "ui/permissions.html")));
  console.log("PASS manifest consistency");

  // Update with only grok granted (the 0.4.0 situation): page opens, badge "!".
  let b = bg(new Set(["https://grok.com/*"]));
  await tick(5);
  await b.L.installed({ reason: "update", previousVersion: "0.3.2" });
  await tick(5);
  assert.deepStrictEqual(b.calls.tabs, ["moz-extension://x/ui/permissions.html"]);
  assert.strictEqual(b.calls.badge.at(-1), "!");
  // Toolbar click requests synchronously (user gesture) all origins.
  b.L.click();
  assert.strictEqual(b.calls.requests.length, 1, "request called synchronously in click handler");
  assert.deepStrictEqual([...b.calls.requests[0]], manifest.host_permissions);
  await tick(5);
  assert.strictEqual(b.calls.badge.at(-1), "", "badge cleared after grant");
  // Once all granted, click opens the status page instead.
  b.L.click(); await tick(5);
  assert.strictEqual(b.calls.requests.length, 1);
  assert.strictEqual(b.calls.tabs.length, 2);
  console.log("PASS update with missing sites: page opens, action requests, badge");

  // 0.5.2 -> 0.5.3: all old sites granted, only x.com/twitter.com new -> badge "!" and page opens.
  b = bg(new Set(manifest.host_permissions.filter(o => !/x\.com|twitter\.com/.test(o)))); await tick(5);
  await b.L.installed({ reason: "update", previousVersion: "0.5.2" }); await tick(5);
  assert.strictEqual(b.calls.badge.at(-1), "!", "x.com missing -> badge");
  assert.deepStrictEqual(b.calls.tabs, ["moz-extension://x/ui/permissions.html"]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await b.ctx.GF.Perms.missing())), ["https://x.com/*", "https://twitter.com/*"]);
  console.log("PASS update adding x.com: badge + permissions page");

  // Everything granted: no page on update; browser_update reason ignored.
  b = bg(new Set(manifest.host_permissions)); await tick(5);
  await b.L.installed({ reason: "update" }); await b.L.installed({ reason: "browser_update" });
  assert.deepStrictEqual(b.calls.tabs, []);
  console.log("PASS no page when all granted");

  let JSDOM; try { ({ JSDOM } = require("jsdom")); } catch (_) { console.log("SKIP jsdom parts"); console.log("All tests passed"); return; }

  // Permissions page: status rows + grant button requests all origins in the click handler.
  {
    const granted = new Set(["https://grok.com/*"]), req = [];
    const dom = new JSDOM(fs.readFileSync(path.join(R, "ui/permissions.html"), "utf8").replace(/<script[^>]*><\/script>/g, ""), { runScripts: "outside-only" });
    const w = dom.window;
    w.browser = { permissions: { contains: async ({ origins }) => origins.every(o => granted.has(o)), request: (o) => { req.push(o.origins); o.origins.forEach(x => granted.add(x)); return Promise.resolve(true); }, onAdded: { addListener() {} }, onRemoved: { addListener() {} } } };
    for (const f of ["shared/constants.js", "ui/permissions.js"]) w.eval(fs.readFileSync(path.join(R, f), "utf8"));
    await w.GF.permissionsReady;
    const st = () => [...w.document.querySelectorAll("#sites td.ok, #sites td.no")].map(td => td.className);
    assert.deepStrictEqual(st(), ["ok", "no", "no", "no", "no", "no", "no", "no"]);
    assert.match(w.document.getElementById("grant").textContent, /7 site/);
    assert.ok([...w.document.querySelectorAll("#sites td")].some(td => td.textContent === "x.com"), "x.com listed");
    assert.ok(w.document.body.textContent.includes("Grok on X"), "x.com labelled Grok on X");
    w.document.getElementById("grant").click();
    assert.strictEqual(req.length, 1, "request in click handler");
    await tick(10);
    assert.deepStrictEqual(st(), ["ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok"]);
    assert.ok(w.document.getElementById("grant").disabled);
    console.log("PASS permissions page");
  }

  // Content script robustness: a broken adapter must not block others; panel mounts on each site.
  for (const url of ["https://chatgpt.com/c/1", "https://claude.ai/chat/1", "https://gemini.google.com/app/1", "https://www.perplexity.ai/search/x", "https://perplexity.ai/search/x", "https://x.com/i/grok?conversation=1", "https://twitter.com/i/grok"]) {
    const dom = new JSDOM("<body></body>", { url, runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window;
    w.browser = { storage: { local: { get: async () => ({}), set: async () => {} } }, runtime: { sendMessage: async () => ({ ok: true, state: { folders: {}, convs: {}, tags: {} }, mode: "sync" }), onMessage: { addListener() {} } } };
    w.CSS = { escape: (s) => s };
    w.console.warn = () => {}; // expected "adapter error" from the broken adapter
    w.eval("var GF = globalThis.GF = { titleDebounceMs: 20 };");
    const files = manifest.content_scripts[0].js;
    for (const f of files) {
      w.eval(fs.readFileSync(path.join(R, f), "utf8"));
      if (f.endsWith("base.js")) w.eval('GF.registerAdapter({ id: "broken", matches() { throw new Error("boom"); } });');
    }
    await tick(10);
    assert.ok(w.document.getElementById("grok-folders-host"), "panel mounted on " + url);
    w.close();
  }
  console.log("PASS panel mounts on every site despite a broken adapter");
  console.log("All tests passed");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
