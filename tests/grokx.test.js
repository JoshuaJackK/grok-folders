/* Run: node tests/grokx.test.js — Grok inside X: route scoping on the X SPA, query-string ids,
 * navigation, page drag, titles (jsdom; skipped if missing). Markup is REPRESENTATIVE (guessed). */
let JSDOM;
try { ({ JSDOM } = require("jsdom")); } catch (_) { console.log("SKIP grokx tests (jsdom not installed)"); process.exit(0); }
const fs = require("fs"), path = require("path"), assert = require("assert");
const R = path.join(__dirname, "..");
const manifest = require(path.join(R, "manifest.json"));
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
class FakeDT {
  constructor() { this.d = {}; this.effectAllowed = "all"; this.dropEffect = "none"; }
  setData(t, v) { this.d[t] = v; } getData(t) { return this.d[t] || ""; } get types() { return Object.keys(this.d); }
}

function boot(url, body, state) {
  const dom = new JSDOM(`<head><title>Home / X</title></head><body>${body}</body>`, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, sent = [];
  w.browser = { storage: { local: { get: async () => ({}), set: async () => {} } },
    runtime: { sendMessage: async (m) => { sent.push(JSON.parse(JSON.stringify(m))); return m.type === "gf:getState" ? { ok: true, state, mode: "sync" } : { ok: true, result: {} }; }, onMessage: { addListener() {} } } };
  w.CSS = { escape: (s) => s };
  w.console.info = () => {};
  w.Element.prototype.setPointerCapture = w.Element.prototype.releasePointerCapture = function () {};
  const orig = w.Element.prototype.attachShadow; w.Element.prototype.attachShadow = function () { return orig.call(this, { mode: "open" }); };
  w.eval("var GF = globalThis.GF = { titleDebounceMs: 20, routePollMs: 10 };");
  for (const f of manifest.content_scripts[0].js) w.eval(fs.readFileSync(path.join(R, f), "utf8"));
  const host = () => w.document.getElementById("grok-folders-host");
  const ev = (type, target, props = {}) => {
    const e = new w.MouseEvent(type, { bubbles: true, cancelable: true, composed: true, button: 0, ...props });
    if (props.dataTransfer) Object.defineProperty(e, "dataTransfer", { value: props.dataTransfer });
    target.dispatchEvent(e); return e;
  };
  return { w, sent, host, ev, root: () => host().shadowRoot };
}
const HISTORY = `<div data-testid="grokChatHistory">
  <a draggable="false" href="/i/grok?conversation=1111111111111111111"><div dir="ltr"><span>Rust lifetimes</span></div></a>
  <a href="/i/grok?conversation=2222222222222222222"><div dir="ltr"><span>Trip to Bled</span></div></a></div>`;

(async () => {
  assert.ok(manifest.content_scripts[0].matches.includes("https://x.com/*") && manifest.content_scripts[0].matches.includes("https://twitter.com/*"));
  assert.ok(manifest.content_scripts[0].js.includes("content/adapters/grokx.js"));
  assert.strictEqual(manifest.browser_specific_settings.gecko.id, "grok-folders@joshuajackk.github.io");

  // 1) Rest of X: no panel, no DOM changes; SPA navigation onto /i/grok mounts; leaving hides.
  {
    const p = boot("https://x.com/home", `<main><a draggable="false" href="/someone/status/1">tweet</a>${HISTORY.replace(/draggable="false" /, 'draggable="false" data-x="1" ')}</main>`,
      { folders: {}, convs: {}, tags: {} });
    await tick(40);
    assert.strictEqual(p.w.GF.pickAdapter(), null, "no adapter on /home");
    assert.ok(!p.host(), "no panel on /home");
    assert.strictEqual(p.w.document.querySelector('a[data-x]').getAttribute("draggable"), "false", "X DOM untouched off-route");
    assert.ok(!p.sent.length, "no messages off-route");
    p.w.history.pushState({}, "", "/i/grok");
    await tick(40);
    assert.ok(p.host(), "panel mounted after SPA navigation to /i/grok");
    assert.strictEqual(p.host().style.display, "");
    assert.strictEqual(p.w.document.querySelector('a[data-x]').getAttribute("draggable"), "true", "history link draggable on /i/grok");
    p.w.history.pushState({}, "", "/explore");
    await tick(40);
    assert.strictEqual(p.host().style.display, "none", "panel hidden off /i/grok");
    const dt = new FakeDT(); p.ev("dragstart", p.w.document.querySelector('a[data-x] span'), { dataTransfer: dt });
    assert.strictEqual(dt.getData("application/x-gf-conv"), "", "page drag inert off-route");
    p.w.history.back(); await tick(40);
    p.w.history.pushState({}, "", "/i/grok?conversation=555555"); await tick(40);
    assert.strictEqual(p.host().style.display, "", "shown again");
    assert.strictEqual(p.w.document.querySelectorAll("#grok-folders-host").length, 1, "mounted once");
    p.w.close();
    console.log("PASS X SPA route scoping (/home -> /i/grok -> /explore -> /i/grok)");
  }

  // 2) On /i/grok: drag from history, add current, click saved conversation -> site's own link.
  {
    const state = { tags: {}, folders: { F: { id: "F", name: "Topic", parentId: null, order: 0, color: 0, tags: [] } },
      convs: { "grokx:2222222222222222222": { key: "grokx:2222222222222222222", provider: "grokx", convId: "2222222222222222222", folderId: "F", title: "Old title", order: 0, tags: [] },
               "grok:abc": { key: "grok:abc", provider: "grok", convId: "abc", folderId: "F", title: "From grok.com", order: 1, tags: [] } } };
    const p = boot("https://x.com/i/grok?conversation=1111111111111111111", HISTORY.replace("Trip to Bled", "Trip to Bled 2026"), state);
    p.w.document.title = "Rust lifetimes / X";
    await tick(20);
    const a = p.w.GF.pickAdapter();
    assert.strictEqual(a.id, "grokx");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(a.currentConversation())), { provider: "grokx", convId: "1111111111111111111", title: "Rust lifetimes" });
    const link = p.w.document.querySelector('a[href*="1111111111111111111"]');
    assert.strictEqual(link.getAttribute("draggable"), "true");
    const dt = new FakeDT(); p.ev("dragstart", link.querySelector("span"), { dataTransfer: dt });
    assert.deepStrictEqual(JSON.parse(dt.getData("application/x-gf-conv")), { provider: "grokx", convId: "1111111111111111111", title: "Rust lifetimes" }); // numeric = legacy grokx
    assert.strictEqual(dt.getData("text/uri-list"), "https://x.com/i/grok?conversation=1111111111111111111");
    // grok.com and X ids are separate spaces
    assert.deepStrictEqual(JSON.parse(JSON.stringify(p.w.GF.parseAnyUrl("https://twitter.com/i/grok?conversation=424242"))), { provider: "grokx", convId: "424242" });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(p.w.GF.parseAnyUrl("https://grok.com/c/42"))), { provider: "grok", convId: "42" });
    assert.strictEqual(p.w.GF.parseAnyUrl("https://x.com/home?conversation=42"), null);
    // panel rows: badge + in-app navigation via the site's own link
    p.root().querySelector(".panel").classList.add("open");
    assert.deepStrictEqual([...p.root().querySelectorAll(".conv .badge")].map(b => b.textContent), ["GX", "Gk"]);
    let siteNav = 0;
    p.w.document.querySelector('a[href*="2222222222222222222"]').addEventListener("click", (e) => { e.preventDefault(); siteNav++; });
    const row = [...p.root().querySelectorAll("a.conv")][0];
    assert.strictEqual(row.getAttribute("href"), "https://x.com/i/grok?conversation=2222222222222222222");
    p.ev("click", row);
    assert.strictEqual(siteNav, 1, "navigate clicks X's own history link");
    // title watcher: saved X conversation renamed in history -> update for provider grokx only
    await tick(80);
    const upd = p.sent.filter(m => m.type === "gf:updateTitles");
    assert.ok(upd.length && upd.every(m => m.payload.provider === "grokx"));
    assert.strictEqual(upd.at(-1).payload.titles["2222222222222222222"], "Trip to Bled 2026");
    p.w.close();
    console.log("PASS /i/grok: page drag, ids, badges, site-link navigation, title sync");
  }
  // 3) Regression (v0.5.3 bug): UUID conversation ids. "+ Current chat" must add it, not alert.
  {
    const UUID = "124e3867-8ba5-476d-aa9a-0395edd41b65";
    const state = { tags: {}, folders: { F: { id: "F", name: "Topic", parentId: null, order: 0, color: 0, tags: [] } },
      convs: { ["grok:" + UUID]: { key: "grok:" + UUID, provider: "grok", convId: UUID, folderId: "F", title: "Old", order: 0, tags: [] } } };
    const p = boot("https://x.com/i/grok?conversation=" + UUID,
      `<div data-testid="grokChatHistory"><a href="/i/grok?conversation=${UUID}"><div dir="ltr"><span>UUID chat title</span></div></a>
       <a href="/i/grok?conversation=1990017815781278167"><span>Numeric chat</span></a></div>`, { ...state, convs: {} });
    const alerts = []; p.w.alert = (m) => alerts.push(m);
    await tick(20);
    const a = p.w.GF.pickAdapter();
    assert.deepStrictEqual(JSON.parse(JSON.stringify(a.currentConversation())), { provider: "grok", convId: UUID, title: "UUID chat title" });
    assert.deepStrictEqual(Object.fromEntries(a.collectTitles()), { [UUID]: "UUID chat title", "1990017815781278167": "Numeric chat" });
    p.root().querySelector(".panel").classList.add("open");
    p.ev("click", p.root().querySelector(".folder"));
    const btn = [...p.root().querySelectorAll("button")].find(b => b.textContent === "+ Current chat");
    btn.click(); await tick(10);
    assert.deepStrictEqual(alerts, [], "no 'Open a conversation first' alert");
    const asg = p.sent.filter(m => m.type === "gf:assignConv").map(m => m.payload);
    assert.deepStrictEqual(asg, [{ provider: "grok", convId: UUID, title: "UUID chat title", folderId: "F" }], "UUID chat on X is stored as grok:<uuid>");
    // page drag carries the UUID; grok.com UUID stays a separate key space
    const dt = new FakeDT(); p.ev("dragstart", p.w.document.querySelector("a span"), { dataTransfer: dt });
    assert.deepStrictEqual(JSON.parse(dt.getData("application/x-gf-conv")), { provider: "grok", convId: UUID, title: "UUID chat title" });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(p.w.GF.parseAnyUrl("https://grok.com/c/" + UUID))), { provider: "grok", convId: UUID });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(p.w.GF.parseAnyUrl("https://x.com/i/grok?conversation=" + UUID.toUpperCase()))), { provider: "grok", convId: UUID }, "same key from X and grok.com");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(p.w.GF.parseAnyUrl("https://x.com/i/grok?conversation=1990017815781278167"))), { provider: "grokx", convId: "1990017815781278167" });
    p.w.close();
    // title sync for a saved UUID conversation
    const q = boot("https://x.com/i/grok?conversation=" + UUID, `<a href="/i/grok?conversation=${UUID}"><span>Renamed UUID chat</span></a>`, state);
    await tick(80);
    const upd = q.sent.filter(m => m.type === "gf:updateTitles");
    assert.strictEqual(upd.at(-1).payload.provider, "grok", "title update from X history uses grok: key");
    assert.strictEqual(upd.at(-1).payload.titles[UUID], "Renamed UUID chat");
    q.w.close();
    console.log("PASS UUID conversation ids on X: stored as grok:<uuid> (add current, titles, drag, URL parsing)");
  }
  // 4) Opening saved chats: grok:<uuid> on X -> inside X (own link, else X URL); on grok.com -> grok.com;
  //    elsewhere -> new tab grok.com (unchanged). grokx numeric on grok.com -> new tab X.
  {
    const UUID = "124e3867-8ba5-476d-aa9a-0395edd41b65", NUM = "1990017815781278167";
    const st = { tags: {}, folders: { F: { id: "F", name: "Topic", parentId: null, order: 0, color: 0, tags: [] } }, convs: {
      ["grok:" + UUID]: { key: "grok:" + UUID, provider: "grok", convId: UUID, folderId: "F", title: "Shared chat", order: 0, tags: [] },
      ["grokx:" + NUM]: { key: "grokx:" + NUM, provider: "grokx", convId: NUM, folderId: "F", title: "Old X chat", order: 1, tags: [] } } };
    const rows = (p) => [...p.root().querySelectorAll("a.conv")];
    const opened = (p) => { const o = []; p.w.open = (u) => { o.push(u); return null; }; return o; };

    // X, with X's own history link present
    let p = boot("https://x.com/i/grok", `<a href="/i/grok?conversation=${UUID}"><span>Shared chat</span></a><a href="/i/grok?conversation=${NUM}"><span>Old X chat</span></a>`, st);
    let o = opened(p); await tick(20); p.root().querySelector(".panel").classList.add("open");
    assert.deepStrictEqual([...p.root().querySelectorAll(".conv .badge")].map(b => b.textContent), ["Gk", "GX"], "grok: chat badge is plain Grok");
    assert.strictEqual(rows(p)[0].getAttribute("href"), "https://x.com/i/grok?conversation=" + UUID, "grok: row links inside X");
    let nav = []; for (const a of p.w.document.querySelectorAll("a[href]")) a.addEventListener("click", (e) => { e.preventDefault(); nav.push(a.getAttribute("href")); });
    p.ev("click", rows(p)[0]); p.ev("click", rows(p)[1]);
    assert.deepStrictEqual(nav, ["/i/grok?conversation=" + UUID, "/i/grok?conversation=" + NUM], "opened via X's own history links");
    assert.deepStrictEqual(o, [], "no new tab on X");
    const xa = p.w.GF.pickAdapter();
    assert.ok(xa.handles("grok") && xa.handles("grokx") && !xa.handles("claude"));
    assert.strictEqual(xa.conversationUrl(UUID), "https://x.com/i/grok?conversation=" + UUID, "fallback navigation URL stays in X");
    p.w.close();

    // grok.com
    p = boot("https://grok.com/c/other", `<nav><a href="/c/${UUID}"><span>Shared chat</span></a></nav>`, st);
    o = opened(p); await tick(20); p.root().querySelector(".panel").classList.add("open");
    assert.strictEqual(rows(p)[0].getAttribute("href"), "https://grok.com/c/" + UUID);
    nav = []; p.w.document.querySelector(`a[href="/c/${UUID}"]`).addEventListener("click", (e) => { e.preventDefault(); nav.push("grok"); });
    p.ev("click", rows(p)[0]); p.ev("click", rows(p)[1]);
    assert.deepStrictEqual(nav, ["grok"], "grok.com in-app navigation as before");
    assert.deepStrictEqual(o, ["https://x.com/i/grok?conversation=" + NUM], "numeric X chat opens X in a new tab");
    // grok.com stores UUIDs lowercase too
    assert.strictEqual(p.w.GF.pickAdapter().idFromPath("/c/" + UUID.toUpperCase()), UUID);
    p.w.close();

    // another site (claude): unchanged, new tabs
    p = boot("https://claude.ai/chat/x", "", st);
    o = opened(p); await tick(20); p.root().querySelector(".panel").classList.add("open");
    p.ev("click", rows(p)[0]); p.ev("click", rows(p)[1]);
    assert.deepStrictEqual(o, ["https://grok.com/c/" + UUID, "https://x.com/i/grok?conversation=" + NUM]);
    p.w.close();
    console.log("PASS opening grok:<uuid> on X (in X) vs grok.com vs other sites");
  }
  console.log("All tests passed");
  process.exit(0);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
