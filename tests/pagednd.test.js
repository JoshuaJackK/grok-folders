/* Run: node tests/pagednd.test.js — dragging from each site's own sidebar onto the panel (jsdom; skipped if missing).
 * Markup is REPRESENTATIVE (guessed) for each site: draggable=false, nested spans, absolute/relative hrefs,
 * site handlers that preventDefault/stopPropagation. */
let JSDOM;
try { ({ JSDOM } = require("jsdom")); } catch (_) { console.log("SKIP page DnD tests (jsdom not installed)"); process.exit(0); }
const fs = require("fs"), path = require("path"), assert = require("assert");
const R = path.join(__dirname, "..");
const manifest = require(path.join(R, "manifest.json"));
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

class FakeDT {
  constructor(init = {}) { this.d = { ...init }; this.effectAllowed = "all"; this.dropEffect = "none"; }
  setData(t, v) { this.d[t] = v; } getData(t) { return this.d[t] || ""; } get types() { return Object.keys(this.d); }
}
const STATE = { tags: {}, convs: {}, folders: { F: { id: "F", name: "Topic", parentId: null, order: 0, color: 0, tags: [] } } };

function boot(url, body) {
  const dom = new JSDOM(`<body>${body}</body>`, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, sent = [], logs = [];
  w.browser = { storage: { local: { get: async () => ({}), set: async () => {} } },
    runtime: { sendMessage: async (m) => { sent.push(JSON.parse(JSON.stringify(m))); return m.type === "gf:getState" ? { ok: true, state: STATE, mode: "sync" } : { ok: true, result: {} }; }, onMessage: { addListener() {} } } };
  w.CSS = { escape: (s) => s };
  w.console.info = (...a) => logs.push(a.join(" "));
  w.Element.prototype.setPointerCapture = w.Element.prototype.releasePointerCapture = function () {};
  const orig = w.Element.prototype.attachShadow; w.Element.prototype.attachShadow = function () { return orig.call(this, { mode: "open" }); };
  w.eval("var GF = globalThis.GF = { titleDebounceMs: 10000 };");
  for (const f of manifest.content_scripts[0].js) w.eval(fs.readFileSync(path.join(R, f), "utf8"));
  const root = () => w.document.getElementById("grok-folders-host").shadowRoot;
  const assigns = () => sent.filter(m => m.type === "gf:assignConv").map(m => m.payload);
  const ev = (type, target, props = {}) => {
    const e = new w.MouseEvent(type, { bubbles: true, cancelable: true, composed: true, button: 0, ...props });
    if (props.dataTransfer) Object.defineProperty(e, "dataTransfer", { value: props.dataTransfer });
    target.dispatchEvent(e); return e;
  };
  const folderRow = () => root().querySelector(".folder");
  const dropOnFolder = (dt) => { ev("dragover", folderRow(), { dataTransfer: dt }); ev("drop", folderRow(), { dataTransfer: dt }); };
  return { w, sent, logs, root, assigns, ev, folderRow, dropOnFolder, open: () => root().querySelector(".panel").classList.add("open") };
}

(async () => {
  // --- ChatGPT: draggable=false, nested divs, site handler stops propagation at document level ---
  {
    const p = boot("https://chatgpt.com/", `<nav><ol><li><a draggable="false" href="/c/6710-aaa"><div class="truncate"><span>GPT Title</span></div></a></li>
      <li><a href="/g/g-x-mygpt/c/6710-bbb"><div class="truncate">Custom GPT chat</div></a></li></ol></nav>`);
    p.w.document.addEventListener("dragstart", (e) => e.stopPropagation(), true); // site handler
    await tick(10); p.open();
    const a = p.w.document.querySelector('a[href="/c/6710-aaa"]');
    assert.strictEqual(a.getAttribute("draggable"), "true", "draggable re-enabled");
    const dt = new FakeDT();
    p.ev("dragstart", a.querySelector("span"), { dataTransfer: dt });
    assert.deepStrictEqual(JSON.parse(dt.getData("application/x-gf-conv")), { provider: "chatgpt", convId: "6710-aaa", title: "GPT Title" });
    assert.strictEqual(dt.getData("text/uri-list"), "https://chatgpt.com/c/6710-aaa");
    p.dropOnFolder(dt); await tick();
    const dt2 = new FakeDT();
    p.ev("dragstart", p.w.document.querySelector('a[href^="/g/"] div'), { dataTransfer: dt2 });
    p.dropOnFolder(dt2); await tick();
    assert.deepStrictEqual(p.assigns().map(x => [x.provider, x.convId, x.title, x.folderId]),
      [["chatgpt", "6710-aaa", "GPT Title", "F"], ["chatgpt", "6710-bbb", "Custom GPT chat", "F"]]);
    assert.ok(p.logs.some(l => l.includes("[AI Folders] dragstart detected chatgpt:6710-aaa")));
    console.log("PASS chatgpt: draggable=false + site stopPropagation + /g/.../c/");
  }

  // --- Claude: site cancels native drag; pointer fallback; following click swallowed ---
  {
    const p = boot("https://claude.ai/new", `<nav><a href="/chat/0b1c-1111"><div><span class="truncate">Claude Title</span></div></a></nav>`);
    let siteClicks = 0;
    const a = p.w.document.querySelector("a");
    a.addEventListener("click", (e) => { siteClicks++; e.preventDefault(); });
    await tick(10); p.open();
    p.root().elementFromPoint = () => p.folderRow(); // jsdom has no layout
    const span = a.querySelector("span");
    p.ev("pointerdown", span, { clientX: 10, clientY: 10 });
    p.ev("pointermove", span, { clientX: 13, clientY: 11 });           // below threshold
    assert.strictEqual(p.root().querySelector(".ghost"), null);
    p.ev("pointermove", span, { clientX: 60, clientY: 40 });           // fallback starts
    assert.ok(p.root().querySelector(".ghost"), "ghost shown");
    assert.ok(p.folderRow().classList.contains("over"), "folder highlighted");
    p.ev("pointerup", span, { clientX: 300, clientY: 50 });
    p.ev("click", span);                                                // swallowed
    await tick();
    assert.strictEqual(siteClicks, 0, "site click/navigation suppressed after drag");
    assert.strictEqual(p.root().querySelector(".ghost"), null);
    assert.deepStrictEqual(p.assigns().map(x => [x.provider, x.convId, x.title]), [["claude", "0b1c-1111", "Claude Title"]]);
    assert.ok(p.logs.some(l => l.includes("pointer-drag fallback")));
    // A plain click (no movement) still reaches the site.
    p.ev("pointerdown", span, { clientX: 10, clientY: 10 }); p.ev("pointerup", span, { clientX: 10, clientY: 10 });
    await tick(350); p.ev("click", span);
    assert.strictEqual(siteClicks, 1);
    // Native drag starting -> pointercancel -> no fallback.
    p.ev("pointerdown", span, { clientX: 10, clientY: 10 });
    p.ev("dragstart", span, { dataTransfer: new FakeDT() });
    p.ev("pointercancel", span);
    p.ev("pointermove", span, { clientX: 90, clientY: 90 });
    assert.strictEqual(p.root().querySelector(".ghost"), null, "no fallback during native drag");
    // Panel closed -> no fallback.
    p.root().querySelector(".panel").classList.remove("open");
    p.ev("pointerdown", span, { clientX: 10, clientY: 10 }); p.ev("pointermove", span, { clientX: 90, clientY: 90 });
    assert.strictEqual(p.root().querySelector(".ghost"), null);
    // Cross-site URL dropped on Claude (uri-list, absolute ChatGPT GPT URL).
    p.open(); p.dropOnFolder(new FakeDT({ "text/uri-list": "https://chatgpt.com/g/g-1/c/xyz" })); await tick();
    assert.deepStrictEqual(p.assigns().at(-1).provider + ":" + p.assigns().at(-1).convId, "chatgpt:xyz");
    console.log("PASS claude: pointer fallback, click swallowed, native/closed guards, cross-site URL");
  }

  // --- Perplexity: on non-www host, absolute www links; x-moz-url drop with title ---
  {
    const p = boot("https://perplexity.ai/", `<div><a href="https://www.perplexity.ai/search/what-is-y-Zz9"><div class="line-clamp-1">What is Y</div></a></div>`);
    await tick(10); p.open();
    const dt = new FakeDT();
    p.ev("dragstart", p.w.document.querySelector(".line-clamp-1"), { dataTransfer: dt });
    p.dropOnFolder(dt); await tick();
    p.dropOnFolder(new FakeDT({ "text/x-moz-url": "https://www.perplexity.ai/search/other-Q1\nOther thread" })); await tick();
    p.dropOnFolder(new FakeDT({ "text/plain": "perplexity.ai is great" })); await tick(); // not a URL -> ignored
    assert.deepStrictEqual(p.assigns().map(x => [x.provider, x.convId, x.title]),
      [["perplexity", "what-is-y-Zz9", "What is Y"], ["perplexity", "other-Q1", "Other thread"]]);
    assert.ok(p.logs.some(l => l.includes("drop ignored")));
    console.log("PASS perplexity: www/non-www, x-moz-url title, junk ignored");
  }

  // --- Grok + Gemini still work (regression) ---
  for (const [url, body, exp] of [["https://grok.com/", `<a href="/c/g1"><span>Grok one</span></a>`, "grok:g1"], ["https://gemini.google.com/app", `<a href="/app/5f2a"><span>Gem</span></a>`, "gemini:5f2a"]]) {
    const p = boot(url, body); await tick(10); p.open();
    const dt = new FakeDT(); p.ev("dragstart", p.w.document.querySelector("span"), { dataTransfer: dt }); p.dropOnFolder(dt); await tick();
    assert.strictEqual(p.assigns().map(x => x.provider + ":" + x.convId)[0], exp);
  }
  console.log("PASS grok + gemini regression");

  // --- Drags inside our own panel are not treated as page links ---
  {
    STATE.convs["grok:g1"] = { key: "grok:g1", provider: "grok", convId: "g1", folderId: "F", title: "Grok one", order: 0, tags: [] };
    const p = boot("https://grok.com/", ``); await tick(10); p.open();
    const dt = new FakeDT();
    p.ev("dragstart", p.root().querySelector("a.conv"), { dataTransfer: dt });
    assert.strictEqual(dt.getData("application/x-gf-conv"), "", "own panel rows not annotated as page links");
    assert.strictEqual(dt.getData("application/x-gf-conv-key"), "grok:g1");
    delete STATE.convs["grok:g1"];
    console.log("PASS panel-internal drags untouched");
  }
  console.log("All tests passed");
  process.exit(0);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
