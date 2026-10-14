/* Run: node tests/ui.test.js — content-script UI tests in jsdom.
 * Requires jsdom (npm i jsdom); skipped (exit 0) if unavailable. */
let JSDOM;
try { ({ JSDOM } = require("jsdom")); } catch (_) { console.log("SKIP ui tests (jsdom not installed)"); process.exit(0); }
const fs = require("fs"), path = require("path"), assert = require("assert");
const R = path.join(__dirname, "..");
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

const STATE = {
  folders: { A: { id: "A", name: "Alma", parentId: null, order: 0, color: 3, tags: [] }, B: { id: "B", name: "Sub", parentId: "A", order: 0, color: 0, tags: [] } },
  convs: { "grok:c1": { key: "grok:c1", provider: "grok", convId: "c1", folderId: "B", title: "Conv one", order: 0, tags: ["t1"] } },
  tags: { t1: { id: "t1", name: "Work", color: 1 } }
};
const localStore = {}; // shared across "page loads" (= storage.local)

function boot(url = "https://grok.com/c/c0") {
  const dom = new JSDOM(`<body><nav><a href="/c/c1">Conv one</a></nav><textarea id="composer"></textarea></body>`, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, sent = [];
  let onMsg = null;
  w.browser = {
    storage: { local: { get: async (k) => (k in localStore ? { [k]: structuredClone(localStore[k]) } : {}), set: async (o) => Object.assign(localStore, structuredClone(o)) } },
    runtime: {
      sendMessage: async (m) => { sent.push(m); return m.type === "gf:getState" ? { ok: true, state: structuredClone(STATE), mode: "sync" } : { ok: true, result: "tNew" }; },
      onMessage: { addListener: (f) => { onMsg = f; } }
    }
  };
  w.CSS = { escape: (s) => s };
  w.alert = w.prompt = w.confirm = () => null;
  const orig = w.Element.prototype.attachShadow; // open root so tests can reach it
  w.Element.prototype.attachShadow = function () { return orig.call(this, { mode: "open" }); };
  w.Element.prototype.setPointerCapture = w.Element.prototype.releasePointerCapture = function () {}; // not in jsdom
  // Simulate Grok's "type anywhere -> focus composer" handler.
  w.document.addEventListener("keydown", () => w.document.getElementById("composer").focus());
  w.eval("var GF = globalThis.GF = { titleDebounceMs: 30 };");
  for (const f of require(path.join(R, "manifest.json")).content_scripts[0].js)
    w.eval(fs.readFileSync(path.join(R, f), "utf8"));
  const root = () => w.document.getElementById("grok-folders-host").shadowRoot;
  const broadcast = () => onMsg({ type: "gf:stateChanged", state: structuredClone(STATE), mode: "sync" });
  const type = (el, ch) => {
    el.dispatchEvent(new w.KeyboardEvent("keydown", { key: ch, bubbles: true, composed: true }));
    el.value += ch; el.setSelectionRange(el.value.length, el.value.length);
    el.dispatchEvent(new w.Event("input", { bubbles: true, composed: true }));
  };
  return { w, sent, root, broadcast, type, panel: () => root().querySelector(".panel") };
}

(async () => {
  let p = boot(); await tick(20);
  const { w, root, type, broadcast, sent } = p;

  // 1) Search box keeps focus + text across keystrokes and state broadcasts; page handler not triggered.
  p.panel().classList.add("open");
  let s = root().querySelector("input[type=search]"); s.focus();
  for (const ch of "con") { type(root().activeElement, ch); broadcast(); await tick(); }
  s = root().querySelector("input[type=search]");
  assert.strictEqual(root().activeElement, s, "search keeps focus");
  assert.strictEqual(s.value, "con");
  assert.strictEqual(s.selectionStart, 3);
  assert.notStrictEqual(w.document.activeElement.id, "composer", "page handler must not steal focus");
  console.log("PASS search focus preserved, keystrokes isolated");

  // 2) Tag manager: new-tag and rename inputs keep focus; no writes until Enter.
  s.value = ""; s.dispatchEvent(new w.Event("input"));
  [...root().querySelectorAll("button")].find(b => b.textContent === "Tags").click();
  await tick();
  const before = sent.length;
  let inp = root().querySelector('[data-fk="tag-new"]'); inp.focus();
  for (const ch of "abc") { type(root().activeElement, ch); broadcast(); await tick(); }
  inp = root().querySelector('[data-fk="tag-new"]');
  assert.strictEqual(root().activeElement, inp); assert.strictEqual(inp.value, "abc");
  let ren = root().querySelector('[data-fk="tag-rename-t1"]'); ren.focus();
  for (const ch of "XY") { type(root().activeElement, ch); broadcast(); await tick(); }
  ren = root().querySelector('[data-fk="tag-rename-t1"]');
  assert.strictEqual(root().activeElement, ren, "rename keeps focus across live redraw");
  assert.strictEqual(ren.value, "WorkXY", "uncommitted rename text kept");
  assert.strictEqual(sent.length, before, "no storage writes while typing");
  ren.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await tick();
  assert.deepStrictEqual(sent.slice(before).map(m => [m.type, m.payload.name]), [["gf:updateTag", "WorkXY"]]);
  [...root().querySelectorAll(".dlg button")].find(b => b.textContent === "Close").click();
  console.log("PASS tag inputs keep focus; write only on Enter");

  // 3) Clicking a saved conversation uses Grok's own link (SPA), panel stays open.
  let navClicked = 0;
  w.document.querySelector("nav a").addEventListener("click", (e) => { e.preventDefault(); navClicked++; });
  const conv = root().querySelector("a.conv");
  const ev = new w.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  conv.dispatchEvent(ev);
  assert.ok(ev.defaultPrevented, "native full-page navigation prevented");
  assert.strictEqual(navClicked, 1, "page link clicked (SPA navigation)");
  assert.ok(p.panel().classList.contains("open"), "panel stays open");
  root().addEventListener("click", (e) => { if (e.ctrlKey) e.preventDefault(); }); // stand-in for the browser opening a tab
  const ctrl = new w.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
  conv.dispatchEvent(ctrl);
  assert.strictEqual(navClicked, 1, "ctrl-click left to the browser");
  console.log("PASS conversation click: SPA nav, panel stays open");

  // 4) Persist open + collapsed across full reload.
  // Close via toggle, collapse folder A, reopen via toggle (pointer click without movement).
  const sb = root();
  const tg = sb.querySelector(".toggle");
  const click = () => { tg.dispatchEvent(new w.MouseEvent("pointerdown", { button: 0, clientX: 70, clientY: 20 })); tg.dispatchEvent(new w.MouseEvent("pointerup", { button: 0, clientX: 70, clientY: 20 })); };
  click(); await tick(10);
  assert.ok(!p.panel().classList.contains("open"), "toggle closes");
  assert.strictEqual(localStore.uiState.open, false);
  sb.querySelector(".caret").click();
  click(); await tick(10);
  assert.ok(p.panel().classList.contains("open"));
  assert.deepStrictEqual(localStore.uiState, { open: true, collapsed: ["A"] });
  p = boot("https://grok.com/c/c1"); await tick(20);
  assert.ok(p.panel().classList.contains("open"), "panel reopened after reload");
  assert.strictEqual(p.root().querySelector(".tree").textContent.includes("Sub"), false, "collapsed folder restored");
  console.log("PASS UI state persisted across reload");

  // 5) Esc closes (and persists), re-mount after host removal.
  p.root().querySelector(".tree").dispatchEvent(new p.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
  assert.ok(!p.panel().classList.contains("open")); assert.strictEqual(localStore.uiState.open, false);
  const host = p.w.document.getElementById("grok-folders-host"); host.remove();
  await tick(10);
  assert.ok(host.isConnected, "host re-mounted");
  console.log("PASS Esc closes; re-mount works");
  console.log("All tests passed");
  process.exit(0);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
