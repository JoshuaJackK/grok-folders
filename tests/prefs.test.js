/* Run: node tests/prefs.test.js — panel resize persistence, font prefs, collapse/expand all (jsdom; skipped if missing). */
let JSDOM;
try { ({ JSDOM } = require("jsdom")); } catch (_) { console.log("SKIP prefs tests (jsdom not installed)"); process.exit(0); }
const fs = require("fs"), path = require("path"), assert = require("assert");
const R = path.join(__dirname, "..");
const manifest = require(path.join(R, "manifest.json"));
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

const STATE = { tags: {}, convs: {}, folders: {
  A: { id: "A", name: "Alma", parentId: null, order: 0, color: 0, tags: [] },
  B: { id: "B", name: "Sub", parentId: "A", order: 0, color: 0, tags: [] },
  C: { id: "C", name: "Deep", parentId: "B", order: 0, color: 0, tags: [] },
  D: { id: "D", name: "Other", parentId: null, order: 1, color: 0, tags: [] } } };
const localStore = {}, syncStore = {};
const area = (store, listeners, name) => ({
  get: async (k) => (k == null ? structuredClone(store) : (k in store ? { [k]: structuredClone(store[k]) } : {})),
  set: async (o) => { Object.assign(store, structuredClone(o)); const ch = {}; for (const k in o) ch[k] = { newValue: o[k] }; listeners.forEach(f => f(ch, name)); }
});

function boot() {
  const dom = new JSDOM("<body></body>", { url: "https://grok.com/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, listeners = [];
  w.browser = {
    storage: { local: area(localStore, listeners, "local"), sync: area(syncStore, listeners, "sync"), onChanged: { addListener: (f) => listeners.push(f) } },
    runtime: { sendMessage: async (m) => (m.type === "gf:getState" ? { ok: true, state: structuredClone(STATE), mode: "sync" } : { ok: true, result: {} }), onMessage: { addListener() {} } }
  };
  w.CSS = { escape: (s) => s };
  w.Element.prototype.setPointerCapture = w.Element.prototype.releasePointerCapture = function () {};
  const orig = w.Element.prototype.attachShadow; w.Element.prototype.attachShadow = function () { return orig.call(this, { mode: "open" }); };
  w.eval("var GF = globalThis.GF = { titleDebounceMs: 10000 };");
  for (const f of manifest.content_scripts[0].js) w.eval(fs.readFileSync(path.join(R, f), "utf8"));
  const root = () => w.document.getElementById("grok-folders-host").shadowRoot;
  const panel = () => root().querySelector(".panel");
  const ev = (type, el, p = {}) => el.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...p }));
  const openPanel = async () => { const t = root().querySelector(".toggle"); ev("pointerdown", t, { clientX: 70, clientY: 20 }); ev("pointerup", t, { clientX: 70, clientY: 20 }); await tick(5); };
  const names = () => [...root().querySelectorAll(".folder .name")].map(n => n.textContent);
  const btn = (title) => [...root().querySelectorAll("button")].find(b => b.title === title);
  return { w, root, panel, ev, openPanel, names, btn, listeners };
}

(async () => {
  // jsdom viewport: 1024 x 768
  let p = boot(); await tick(10); await p.openPanel();
  assert.strictEqual(p.panel().style.width, "300px", "default width");
  assert.strictEqual(p.root().querySelectorAll(".rz").length, 3, "3 resize handles");

  // --- resize via bottom-right corner ---
  const br = p.root().querySelector(".rz-br");
  p.ev("pointerdown", br, { clientX: 100, clientY: 100 });
  p.ev("pointermove", br, { clientX: 180, clientY: 150 });
  p.ev("pointerup", br, { clientX: 180, clientY: 150 });
  await tick();
  assert.deepStrictEqual(localStore.uiSize, { w: 380, h: 450 }, "corner: width+height");
  assert.strictEqual(p.panel().style.width, "380px");
  assert.strictEqual(p.panel().style.height, "450px");
  // right edge only width; min clamp
  const r = p.root().querySelector(".rz-r");
  p.ev("pointerdown", r, { clientX: 100, clientY: 100 }); p.ev("pointermove", r, { clientX: -900, clientY: 400 }); p.ev("pointerup", r);
  await tick();
  assert.deepStrictEqual(localStore.uiSize, { w: 220, h: 450 }, "min width, height unchanged");
  // bottom edge: max clamp to viewport (768 - 8)
  const b = p.root().querySelector(".rz-b");
  p.ev("pointerdown", b, { clientX: 100, clientY: 100 }); p.ev("pointermove", b, { clientX: 500, clientY: 5000 }); p.ev("pointerup", b);
  await tick();
  assert.deepStrictEqual(localStore.uiSize, { w: 220, h: 760 }, "height clamped to viewport");
  assert.ok(parseInt(p.panel().style.height) <= 768 - 56, "rendered height fits below the button");
  // width clamp to max / viewport
  p.ev("pointerdown", r, { clientX: 0, clientY: 0 }); p.ev("pointermove", r, { clientX: 5000, clientY: 0 }); p.ev("pointerup", r);
  await tick();
  assert.strictEqual(localStore.uiSize.w, 800, "max width");
  console.log("PASS resize handles, min/max/viewport clamp, persisted");

  // persists across reload
  p.w.close(); p = boot(); await tick(10); await p.openPanel();
  assert.strictEqual(p.panel().style.width, "800px", "width restored after reload");
  // flip: button near right edge -> panel right-aligned and still inside viewport
  localStore.uiPos = { left: 980, top: 12 };
  p.w.close(); p = boot(); await tick(10); await p.openPanel();
  const left = parseInt(p.panel().style.left), width = parseInt(p.panel().style.width);
  assert.ok(left >= 4 && left + width <= 1024 - 4, `panel inside viewport (left=${left}, w=${width})`);
  delete localStore.uiPos;
  // dblclick resets
  p.ev("dblclick", p.root().querySelector(".rz-br")); await tick();
  assert.deepStrictEqual(localStore.uiSize, { w: 300, h: null });
  assert.strictEqual(p.panel().style.width, "300px"); assert.strictEqual(p.panel().style.height, "");
  console.log("PASS size restored on reload, flip placement, double-click reset");

  // --- font prefs ---
  p.btn("Settings (font)").click(); await tick();
  const range = p.root().querySelector('.dlg input[type=range]');
  range.value = "16"; range.dispatchEvent(new p.w.Event("input"));
  assert.strictEqual(p.panel().style.getPropertyValue("--gf-fs"), "16px", "live apply");
  range.dispatchEvent(new p.w.Event("change")); await tick();
  const fam = p.root().querySelector(".dlg select");
  fam.value = "serif"; fam.dispatchEvent(new p.w.Event("change")); await tick();
  assert.deepStrictEqual(syncStore.uiPrefs, { fs: 16, ff: "serif" }, "saved to storage.sync (tiny key)");
  assert.match(p.panel().style.getPropertyValue("--gf-ff"), /Georgia/);
  assert.ok(JSON.stringify(syncStore.uiPrefs).length < 40);
  p.w.close(); p = boot(); await tick(10);
  assert.strictEqual(p.panel().style.getPropertyValue("--gf-fs"), "16px", "font size restored");
  assert.match(p.panel().style.getPropertyValue("--gf-ff"), /Georgia/, "font family restored");
  // change from another tab/device (storage.onChanged) applies live; invalid values clamped
  await p.w.browser.storage.sync.set({ uiPrefs: { fs: 99, ff: "comic" } });
  assert.strictEqual(p.panel().style.getPropertyValue("--gf-fs"), "18px");
  assert.match(p.panel().style.getPropertyValue("--gf-ff"), /system-ui/);
  console.log("PASS font prefs: live, persisted (sync), restored, cross-tab, clamped");

  // --- collapse / expand all ---
  delete localStore.uiState;
  p.w.close(); p = boot(); await tick(10); await p.openPanel();
  assert.deepStrictEqual(p.names(), ["Alma", "Sub", "Deep", "Other"]);
  p.btn("Collapse all folders").click(); await tick();
  assert.deepStrictEqual(p.names(), ["Alma", "Other"]);
  assert.deepStrictEqual([...localStore.uiState.collapsed].sort(), ["A", "B", "C", "D"]);
  p.w.close(); p = boot(); await tick(10);
  assert.deepStrictEqual(p.names(), ["Alma", "Other"], "collapse-all persisted across reload");
  p.btn("Expand all folders").click(); await tick();
  assert.deepStrictEqual(p.names(), ["Alma", "Sub", "Deep", "Other"]);
  assert.deepStrictEqual(localStore.uiState.collapsed, []);
  console.log("PASS collapse all / expand all persisted");
  console.log("All tests passed");
  process.exit(0);
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
