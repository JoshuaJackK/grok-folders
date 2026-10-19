/* Run: node tests/adapters.test.js — per-provider adapters + multi-AI sidebar (jsdom; skipped if missing). */
let JSDOM;
try { ({ JSDOM } = require("jsdom")); } catch (_) { console.log("SKIP adapter tests (jsdom not installed)"); process.exit(0); }
const fs = require("fs"), path = require("path"), assert = require("assert");
const R = path.join(__dirname, "..");
const manifest = require(path.join(R, "manifest.json"));
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

const CASES = {
  grok: { url: "https://grok.com/c/g-cur", tab: "Current Grok chat - Grok", links: [["/c/g1", "Grok one"], ["/c/g2", "New chat"]],
    paths: { "/c/abc": "abc", "/c/abc?x=1": "abc", "/chat/abc": null }, urlFor: ["abc", "https://grok.com/c/abc"] },
  chatgpt: { url: "https://chatgpt.com/g/g-xyz-mygpt/c/6710-cur", tab: "Current GPT chat", links: [["/c/6710-a", "GPT one"], ["/g/g-xyz/c/6710-b", "GPT two"], ["/c/6710-c", "New chat"]],
    paths: { "/c/6710-a": "6710-a", "/g/g-abc/c/6710-b": "6710-b", "/gpts": null }, urlFor: ["6710-a", "https://chatgpt.com/c/6710-a"] },
  claude: { url: "https://claude.ai/chat/0b1c-cur", tab: "Current Claude chat - Claude", links: [["/chat/0b1c-a", "Claude one"], ["/chat/0b1c-b", "Untitled"], ["/project/p1", "Proj"]],
    paths: { "/chat/0b1c-a": "0b1c-a", "/new": null, "/share/x": null }, urlFor: ["0b1c-a", "https://claude.ai/chat/0b1c-a"] },
  gemini: { url: "https://gemini.google.com/u/1/app/5f2a-cur", tab: "Gemini", links: [["/app/5f2a-a", "Gemini one"], ["/u/1/app/5f2a-b", "Gemini two"], ["/app", "New chat"]],
    paths: { "/app/5f2a": "5f2a", "/u/2/app/5f2a": "5f2a", "/app": null, "/share/x": null }, urlFor: ["5f2a", "https://gemini.google.com/app/5f2a"] },
  perplexity: { url: "https://www.perplexity.ai/search/how-to-x-AbC123", tab: "How to X - Perplexity", links: [["/search/what-is-y-Zz9", "What is Y"], ["/library", "Library"]],
    paths: { "/search/how-to-x-AbC123": "how-to-x-AbC123", "/discover": null }, urlFor: ["s-1", "https://www.perplexity.ai/search/s-1"] },
  grokx: { url: "https://x.com/i/grok?conversation=1990017815781278167", tab: "(3) Current X chat / X",
    links: [["/i/grok?conversation=111111", "X one"], ["https://twitter.com/i/grok?conversation=333333", "Tw three"], ["/i/grok?conversation=222222", "Grok"],
      ["/i/grok?conversation=5d1f0a2e-0b7c-4c1e-9a55-2f6f7a1b9c00", "UUID chat"], ["/home", "Home"], ["/i/grok", "New chat"]],
    paths: { "/i/grok?conversation=123456": "123456", "/i/grok/?conversation=123456&x=1": "123456",
      "/i/grok?conversation=124e3867-8ba5-476d-aa9a-0395edd41b65": "124e3867-8ba5-476d-aa9a-0395edd41b65",
      "/i/grok?conversation=124E3867-8BA5-476D-AA9A-0395EDD41B65": "124e3867-8ba5-476d-aa9a-0395edd41b65", // canonical lowercase
      "/i/grok": null, "/i/grok?conversation=": null, "/i/grok?conversation=abc": null, "/i/grok?conversation=abc%20def%3Cx": null, "/i/grok?conversation=ab_cd/ef": null,
      "/home?conversation=123456": null, "/i/grokx?conversation=123456": null, "/c/123456": null },
    urlFor: ["124e3867-8ba5-476d-aa9a-0395edd41b65", "https://x.com/i/grok?conversation=124e3867-8ba5-476d-aa9a-0395edd41b65"], rt: "987654321" }
};
const EXPECT_TITLES = {
  grok: { g1: "Grok one", "g-cur": "Current Grok chat" },
  chatgpt: { "6710-a": "GPT one", "6710-b": "GPT two", "6710-cur": "Current GPT chat" },
  claude: { "0b1c-a": "Claude one", "0b1c-cur": "Current Claude chat" },
  gemini: { "5f2a-a": "Gemini one", "5f2a-b": "Gemini two" },            // tab "Gemini" = placeholder
  perplexity: { "what-is-y-Zz9": "What is Y", "how-to-x-AbC123": "How to X" },
  grokx: { 111111: "X one", 333333: "Tw three", "5d1f0a2e-0b7c-4c1e-9a55-2f6f7a1b9c00": "UUID chat", "1990017815781278167": "Current X chat" } // "Grok" = placeholder
};

function boot(c, state) {
  const links = c.links.map(([h, t]) => `<a href="${h}"><span>${t}</span></a>`).join("");
  const dom = new JSDOM(`<head><title>${c.tab}</title></head><body><nav>${links}</nav></body>`, { url: c.url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, sent = [], opened = [];
  w.browser = { storage: { local: { get: async () => ({}), set: async () => {} } },
    runtime: { sendMessage: async (m) => { sent.push(JSON.parse(JSON.stringify(m))); return m.type === "gf:getState" ? { ok: true, state, mode: "sync" } : { ok: true, result: {} }; }, onMessage: { addListener() {} } } };
  w.CSS = { escape: (s) => s };
  w.open = (u) => { opened.push(u); return null; };
  w.Element.prototype.setPointerCapture = w.Element.prototype.releasePointerCapture = function () {};
  const orig = w.Element.prototype.attachShadow; w.Element.prototype.attachShadow = function () { return orig.call(this, { mode: "open" }); };
  w.eval("var GF = globalThis.GF = { titleDebounceMs: 20 };");
  for (const f of manifest.content_scripts[0].js) w.eval(fs.readFileSync(path.join(R, f), "utf8"));
  return { w, sent, opened, root: () => w.document.getElementById("grok-folders-host").shadowRoot };
}

const emptyState = { folders: {}, convs: {}, tags: {} };

(async () => {
  // Manifest covers every adapter host.
  for (const id of Object.keys(CASES)) {
    const u = new URL(CASES[id].url);
    assert.ok(manifest.host_permissions.includes(`https://${u.hostname}/*`), "host permission for " + id);
    assert.ok(manifest.content_scripts[0].matches.includes(`https://${u.hostname}/*`), "content match for " + id);
  }
  assert.strictEqual(manifest.browser_specific_settings.gecko.id, "grok-folders@joshuajackk.github.io", "gecko id unchanged");

  for (const [id, c] of Object.entries(CASES)) {
    const { w, root } = boot(c, emptyState); await tick(10);
    const a = w.GF.pickAdapter();
    assert.strictEqual(a && a.id, id, "pickAdapter " + id);
    for (const [p, exp] of Object.entries(c.paths)) assert.strictEqual(a.idFromUrl(new URL(p, c.url)), exp, `${id} idFromPath ${p}`);
    assert.strictEqual(a.conversationUrl(c.urlFor[0]), c.urlFor[1]);
    assert.deepStrictEqual(Object.fromEntries(a.collectTitles()), EXPECT_TITLES[id], id + " collectTitles");
    const cur = a.currentConversation();
    assert.ok(cur && cur.convId, id + " currentConversation");
    assert.ok(root().querySelector(".toggle"), id + " sidebar mounted");
    // round trip: URL built by adapter is parsed back by GF.parseAnyUrl
    const rt = c.rt || "zz-1";
    assert.deepStrictEqual(JSON.parse(JSON.stringify(w.GF.parseAnyUrl(a.conversationUrl(rt)))), { provider: id, convId: rt });
    w.close();
    console.log("PASS adapter " + id);
  }

  // Multi-AI sidebar on claude.ai: badges, provider filter, cross-provider click opens new tab.
  const state = { tags: {}, folders: { F: { id: "F", name: "Topic", parentId: null, order: 0, color: 0, tags: [] } }, convs: {} };
  const add = (provider, convId, title, order) => { state.convs[provider + ":" + convId] = { key: provider + ":" + convId, provider, convId, folderId: "F", title, order, tags: [] }; };
  add("grok", "g1", "From Grok", 0); add("claude", "0b1c-a", "From Claude", 1); add("chatgpt", "6710-a", "From GPT", 2);
  const p = boot(CASES.claude, state); await tick(10);
  p.root().querySelector(".panel").classList.add("open");
  const badges = [...p.root().querySelectorAll(".conv .badge")].map(b => b.textContent);
  assert.deepStrictEqual(badges, ["Gk", "Cl", "GPT"]);
  let navClicked = 0;
  p.w.document.querySelector('a[href="/chat/0b1c-a"]').addEventListener("click", (e) => { e.preventDefault(); navClicked++; });
  const rows = () => [...p.root().querySelectorAll("a.conv")];
  const click = (el) => { const ev = new p.w.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }); el.dispatchEvent(ev); return ev; };
  assert.ok(click(rows()[0]).defaultPrevented);
  assert.deepStrictEqual(p.opened, ["https://grok.com/c/g1"], "other provider -> new tab");
  click(rows()[1]);
  assert.strictEqual(navClicked, 1, "same provider -> in-app navigation");
  assert.strictEqual(p.opened.length, 1);
  const pf = [...p.root().querySelectorAll("select")].find(s => s.title === "Filter by AI");
  pf.value = "chatgpt"; pf.dispatchEvent(new p.w.Event("change"));
  assert.deepStrictEqual([...p.root().querySelectorAll(".conv .name")].map(n => n.textContent), ["From GPT"]);
  pf.value = "gemini"; pf.dispatchEvent(new p.w.Event("change"));
  assert.ok(p.root().querySelector(".tree").textContent.includes("No matches"));
  console.log("PASS multi-AI sidebar: badges, cross-provider open, provider filter");

  // Title watcher on a provider only updates that provider's saved conversations.
  await tick(80);
  const upd = p.sent.filter(m => m.type === "gf:updateTitles");
  assert.ok(upd.every(m => m.payload.provider === "claude"));
  assert.ok(upd.every(m => !("g1" in m.payload.titles)));
  console.log("PASS title watcher scoped to provider");
  console.log("All tests passed");
  process.exit(0);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
