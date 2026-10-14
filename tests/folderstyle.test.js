/* Run: node tests/folderstyle.test.js — per-folder name font/bold/italic (own row only).
 * Part 1 (always): codec, compact storage, backward compat, SET_STYLE, export/import merge idempotency.
 * Part 2 (jsdom; skipped if missing): rendering applies to the folder's own name only; picker. */
const fs = require("fs"), path = require("path"), assert = require("assert"), vm = require("vm");
const R = path.join(__dirname, "..");
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
const J = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

async function background() {
  const mk = () => { const d = {}; return { _d: d, get: async () => structuredClone(d), set: async (o) => { Object.assign(d, structuredClone(o)); }, remove: async (ks) => ks.forEach(k => delete d[k]) }; };
  const sync = mk(), T = [];
  // Data written by 0.5.0 (no style field).
  Object.assign(sync._d, { meta: { v: 3, fc: 1, cc: 1, tc: 1, ts: 1 },
    f0: { A: ["Alma", null, 0, 3], B: ["Sub", "A", 0], C: ["Tagged", null, 1, 0, ["t1"]] },
    c0: { "grok:c1": ["B", "One", 0] }, t0: { t1: ["Work", 1] } });
  const ctx = { browser: { storage: { sync, local: mk(), onChanged: { addListener() {} } }, runtime: { onMessage: { addListener: f => T.push(f) } }, tabs: { query: async () => [] } },
    console: { ...console, info() {} }, structuredClone, TextEncoder, Promise, Date, Math, JSON, Object, Array, Set, String, Number, Error };
  ctx.globalThis = ctx; vm.createContext(ctx);
  for (const f of ["shared/constants.js", "background/storage.js", "background/background.js"]) vm.runInContext(fs.readFileSync(path.join(R, f), "utf8"), ctx, { filename: f });
  const GF = ctx.GF;
  const ok = async (type, payload) => { const r = await T[0]({ type, payload }); assert.ok(r.ok, r.error); return J(r.result); };
  const S = () => GF.Storage.get();

  // codec
  assert.strictEqual(GF.encodeStyle({}), 0);
  assert.strictEqual(GF.encodeStyle({ font: "serif", bold: true }), 5 | 8);
  assert.deepStrictEqual(J(GF.decodeStyle(5 | 8 | 16)), { font: "serif", bold: true, italic: true, fontSize: null });
  assert.deepStrictEqual(J(GF.decodeStyle(7)), { font: null, bold: false, italic: false, fontSize: null }, "invalid font index -> default");
  assert.deepStrictEqual(J(GF.decodeStyle(999)), { font: null, bold: false, italic: false, fontSize: null });

  // old data loads unchanged; style defaults to 0; no schema bump
  await ok("gf:getState");
  assert.deepStrictEqual(Object.values(S().folders).map(f => f.style), [0, 0, 0]);
  assert.strictEqual(GF.SCHEMA_VERSION, 3, "optional trailing field, no schema bump");

  await ok("gf:setStyle", { id: "B", font: "mono", bold: true });
  assert.strictEqual(S().folders.B.style, 6 | 8);
  assert.deepStrictEqual(sync._d.f0.B, ["Sub", "A", 0, 0, [], 14], "style appended as trailing int");
  assert.deepStrictEqual(sync._d.f0.A, ["Alma", null, 0, 3], "unstyled folders unchanged (compact)");
  assert.deepStrictEqual(sync._d.f0.C, ["Tagged", null, 1, 0, ["t1"]]);
  assert.strictEqual(sync._d.meta.v, 3);
  // An old (0.5.0) reader only uses t[0..4] -> still valid for it.
  const t = sync._d.f0.B; assert.ok(typeof t[0] === "string" && t[1] === "A" && Array.isArray(t[4]));
  await ok("gf:setStyle", { id: "B", font: "comic", italic: true });
  assert.strictEqual(S().folders.B.style, 16, "unknown font -> default, italic kept");
  await ok("gf:setStyle", { id: "B" });
  assert.deepStrictEqual(sync._d.f0.B, ["Sub", "A", 0], "reset -> trailing defaults trimmed");
  await ok("gf:setStyle", { id: "A", font: "serif", italic: true });
  const before = JSON.stringify(S());
  await GF.Storage.load();
  assert.strictEqual(JSON.stringify(S()), before, "persists across reload");
  console.log("PASS codec, compact storage, backward compatible, SET_STYLE");

  // export (same shape as sidebar.exportJson) / import
  const exp = { app: "grok-folders", schema: 3, tags: [{ id: "t1", name: "Work", color: "#e5484d" }],
    folders: Object.values(S().folders).map(f => ({ id: f.id, name: f.name, parentId: f.parentId, order: f.order, color: GF.PALETTE[f.color] || null, tags: f.tags, ...GF.decodeStyle(f.style) })),
    conversations: Object.values(S().convs).map(c => ({ provider: c.provider, convId: c.convId, folderId: c.folderId, title: c.title, order: c.order, tags: c.tags })) };
  assert.deepStrictEqual(J(exp.folders.find(f => f.id === "A")), { id: "A", name: "Alma", parentId: null, order: 0, color: "#ffc53d", tags: [], font: "serif", bold: false, italic: true, fontSize: null });
  for (let i = 0; i < 2; i++) {
    const r = await ok("gf:import", { data: exp, mode: "merge" });
    assert.strictEqual(r.updated, 0); assert.strictEqual(r.foldersAdded, 0);
    assert.strictEqual(JSON.stringify(S()), before, "merge idempotent");
  }
  // other device: style set only where local has none; new folder keeps its style
  const other = { app: "grok-folders", schema: 3, folders: [
    { id: "X1", name: "Alma", parentId: null, font: "mono", bold: true },        // local A has style -> kept
    { id: "X2", name: "Sub", parentId: "X1", font: "rounded" },                  // local B none -> set
    { id: "X3", name: "Brand new", parentId: null, font: "humanist", italic: true, bold: "yes" } ], conversations: [] };
  let r = await ok("gf:import", { data: other, mode: "merge" });
  assert.strictEqual(r.updated, 1); assert.strictEqual(r.foldersAdded, 1);
  assert.deepStrictEqual(J(GF.decodeStyle(S().folders.A.style)), { font: "serif", bold: false, italic: true, fontSize: null });
  assert.deepStrictEqual(J(GF.decodeStyle(S().folders.B.style)), { font: "rounded", bold: false, italic: false, fontSize: null });
  assert.deepStrictEqual(J(GF.decodeStyle(S().folders.X3.style)), { font: "humanist", bold: false, italic: true, fontSize: null }, "non-boolean bold ignored");
  const after = JSON.stringify(S());
  r = await ok("gf:import", { data: other, mode: "merge" });
  assert.strictEqual(r.updated + r.foldersAdded, 0); assert.strictEqual(JSON.stringify(S()), after);
  // old export without style fields still imports
  r = await ok("gf:import", { data: { app: "grok-folders", schema: 1, folders: [{ id: "O", name: "Old", parentId: null }], conversations: [] }, mode: "merge" });
  assert.strictEqual(r.foldersAdded, 1); assert.strictEqual(S().folders.O.style, 0);
  console.log("PASS export/import: readable fields, merge only-if-none, idempotent, old exports");

  // --- font size (0.5.2) ---
  for (const v of [10, 17, 24]) assert.strictEqual(GF.decodeStyle(GF.encodeStyle({ fontSize: v })).fontSize, v);
  for (const v of [9, 25, 12.5, "14", null]) assert.strictEqual(GF.encodeStyle({ fontSize: v }), 0, "invalid size -> default " + v);
  assert.deepStrictEqual(J(GF.decodeStyle(GF.encodeStyle({ font: "mono", bold: true, italic: true, fontSize: 24 }))), { font: "mono", bold: true, italic: true, fontSize: 24 });
  assert.ok(GF.encodeStyle({ font: "mono", bold: true, italic: true, fontSize: 24 }) < 512);
  await ok("gf:setStyle", { id: "C", fontSize: 18 });
  assert.deepStrictEqual(sync._d.f0.C, ["Tagged", null, 1, 0, ["t1"], 0, 18], "size stored as separate trailing px value");
  assert.strictEqual(GF.decodeStyle(S().folders.C.style).fontSize, 18);
  // 0.5.1 reader compatibility: it accepts t[5] only if < 32 and ignores t[6] -> font/bold/italic intact.
  await ok("gf:setStyle", { id: "C", font: "serif", bold: true, fontSize: 18 });
  assert.deepStrictEqual(sync._d.f0.C, ["Tagged", null, 1, 0, ["t1"], 5 | 8, 18]);
  assert.ok(sync._d.f0.C[5] < 32, "t[5] stays in 0.5.1's accepted range");
  await ok("gf:setStyle", { id: "C", fontSize: 18 });
  // export/import with fontSize
  const exp2 = { app: "grok-folders", schema: 3, folders: Object.values(S().folders).map(f => ({ id: f.id, name: f.name, parentId: f.parentId, ...GF.decodeStyle(f.style) })), conversations: [] };
  assert.strictEqual(exp2.folders.find(f => f.id === "C").fontSize, 18, "readable fontSize in export");
  const snap = JSON.stringify(S());
  r = await ok("gf:import", { data: exp2, mode: "merge" });
  assert.strictEqual(r.updated, 0); assert.strictEqual(JSON.stringify(S()), snap, "idempotent with sizes");
  const other2 = { app: "grok-folders", schema: 3, folders: [
    { id: "Y1", name: "Alma", parentId: null, fontSize: 20 },        // A has font/italic but no size -> size added
    { id: "Y2", name: "Tagged", parentId: null, fontSize: 11 },      // C already has size 18 -> kept
    { id: "Y3", name: "Sized new", parentId: null, fontSize: 99 } ], conversations: [] };
  r = await ok("gf:import", { data: other2, mode: "merge" });
  assert.deepStrictEqual(J(GF.decodeStyle(S().folders.A.style)), { font: "serif", bold: false, italic: true, fontSize: 20 });
  assert.strictEqual(GF.decodeStyle(S().folders.C.style).fontSize, 18);
  assert.strictEqual(S().folders.Y3.style, 0, "invalid size ignored");
  assert.strictEqual(r.updated, 1);
  const snap2 = JSON.stringify(S());
  r = await ok("gf:import", { data: other2, mode: "merge" });
  assert.strictEqual(r.updated + r.foldersAdded, 0); assert.strictEqual(JSON.stringify(S()), snap2);
  console.log("PASS font size: codec, compact storage, export/import merge only-if-none, idempotent");
}

async function ui() {
  let JSDOM; try { ({ JSDOM } = require("jsdom")); } catch (_) { console.log("SKIP ui part (jsdom not installed)"); return; }
  const manifest = require(path.join(R, "manifest.json"));
  const state = { tags: {}, folders: {
    A: { id: "A", name: "Parent", parentId: null, order: 0, color: 0, tags: [], style: 5 | 8 },   // serif bold
    B: { id: "B", name: "Child", parentId: "A", order: 0, color: 0, tags: [], style: 0 },
    C: { id: "C", name: "Mono kid", parentId: "A", order: 1, color: 0, tags: [], style: 6 | 16 },  // mono italic
    D: { id: "D", name: "Big", parentId: "A", order: 2, color: 0, tags: [], style: (22 - 9) << 5 } }, // 22px
    convs: { "grok:c1": { key: "grok:c1", provider: "grok", convId: "c1", folderId: "A", title: "Conv", order: 0, tags: [] } } };
  const dom = new JSDOM("<body></body>", { url: "https://grok.com/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, sent = [];
  w.browser = { storage: { local: { get: async () => ({}), set: async () => {} } },
    runtime: { sendMessage: async (m) => { sent.push(J(m)); return m.type === "gf:getState" ? { ok: true, state, mode: "sync" } : { ok: true, result: {} }; }, onMessage: { addListener() {} } } };
  w.CSS = { escape: (s) => s };
  w.Element.prototype.setPointerCapture = w.Element.prototype.releasePointerCapture = function () {};
  const orig = w.Element.prototype.attachShadow; w.Element.prototype.attachShadow = function () { return orig.call(this, { mode: "open" }); };
  w.eval("var GF = globalThis.GF = { titleDebounceMs: 10000 };");
  for (const f of manifest.content_scripts[0].js) w.eval(fs.readFileSync(path.join(R, f), "utf8"));
  await tick(10);
  const root = w.document.getElementById("grok-folders-host").shadowRoot;
  const name = (n) => [...root.querySelectorAll(".folder .name")].find(x => x.textContent === n);
  assert.match(name("Parent").style.fontFamily, /Georgia/); assert.strictEqual(name("Parent").style.fontWeight, "700");
  // NOT inherited: child folder, conversation, and the wrapper/row elements carry no style
  assert.strictEqual(name("Child").style.fontFamily, ""); assert.strictEqual(name("Child").style.fontWeight, "");
  const conv = root.querySelector("a.conv .name");
  assert.strictEqual(conv.style.fontFamily, ""); assert.strictEqual(conv.style.fontWeight, "");
  assert.strictEqual(name("Parent").closest(".folder").style.fontFamily, "");
  assert.strictEqual(name("Parent").closest(".folder").parentElement.getAttribute("style"), null, "subtree wrapper unstyled");
  assert.match(name("Mono kid").style.fontFamily, /monospace/); assert.strictEqual(name("Mono kid").style.fontStyle, "italic");
  assert.strictEqual(name("Big").style.fontSize, "22px");
  assert.strictEqual(name("Big").closest(".folder").style.height, "", "row has no fixed height (grows with text)");
  assert.strictEqual(name("Child").style.fontSize, "", "size not inherited");
  assert.strictEqual(conv.style.fontSize, "");
  console.log("PASS rendering: own row only, no inheritance (font, bold, italic, size)");

  // picker: same popup as color; apply color + font
  name("Child").closest(".folder").querySelector(".ficon").click(); await tick();
  const dlg = root.querySelector(".dlg");
  assert.ok(dlg.querySelector(".swgrid") && dlg.querySelector("select"), "color + font in one popup");
  assert.deepStrictEqual([...dlg.querySelectorAll("select option")].map(o => o.textContent), ["Default", "System", "Sans", "Humanist", "Rounded", "Serif", "Mono"]);
  dlg.querySelectorAll(".swbtn")[2].click();
  const sel = dlg.querySelector("select"); sel.value = "rounded"; sel.dispatchEvent(new w.Event("change"));
  dlg.querySelector('input[type=checkbox]').click();                      // bold
  assert.strictEqual(dlg.querySelector(".prev .name").style.fontWeight, "700", "live preview");
  [...dlg.querySelectorAll("button")].find(b => b.textContent === "Apply").click(); await tick(5);
  const calls = sent.filter(m => m.type === "gf:setColor" || m.type === "gf:setStyle").map(m => [m.type, m.payload]);
  assert.deepStrictEqual(calls, [["gf:setColor", { id: "B", color: 2 }], ["gf:setStyle", { id: "B", font: "rounded", bold: true, italic: false, fontSize: null }]]);
  // size slider + Default button with live preview
  name("Mono kid").closest(".folder").querySelector(".ficon").click(); await tick();
  const d2 = root.querySelector(".dlg"), rng = d2.querySelector('input[type=range]');
  assert.strictEqual(+rng.min, 10); assert.strictEqual(+rng.max, 24);
  assert.ok(d2.textContent.includes("Default"));
  rng.value = "20"; rng.dispatchEvent(new w.Event("input"));
  assert.strictEqual(d2.querySelector(".prev .name").style.fontSize, "20px", "live preview size");
  [...d2.querySelectorAll("button")].find(b => b.textContent === "Apply").click(); await tick(5);
  assert.deepStrictEqual(sent.filter(m => m.type === "gf:setStyle").at(-1).payload, { id: "C", font: "mono", bold: false, italic: true, fontSize: 20 });
  name("Mono kid").closest(".folder").querySelector(".ficon").click(); await tick();
  const d3 = root.querySelector(".dlg");
  const r3 = d3.querySelector('input[type=range]'); r3.value = "15"; r3.dispatchEvent(new w.Event("input"));
  [...d3.querySelectorAll("button")].find(b => b.textContent === "Default").click();
  assert.strictEqual(d3.querySelector(".prev .name").style.fontSize, "");
  [...d3.querySelectorAll("button")].find(b => b.textContent === "Cancel").click(); await tick();
  const nSent = sent.length;
  // Cancel / unchanged -> no calls
  name("Parent").closest(".folder").querySelector(".ficon").click(); await tick();
  [...root.querySelectorAll(".dlg button")].find(b => b.textContent === "Apply").click(); await tick(5);
  assert.strictEqual(sent.length, nSent, "no write when unchanged");
  console.log("PASS picker: color + font + bold/italic in one popup, no-op when unchanged");
  w.close();
}

(async () => { await background(); await ui(); console.log("All tests passed"); process.exit(0); })()
  .catch((e) => { console.error("FAIL", e); process.exit(1); });
