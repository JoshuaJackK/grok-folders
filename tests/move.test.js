/* Run: node tests/move.test.js — move/reorder + v1->v2 migration (mocked browser APIs). */
const fs = require("fs"), path = require("path"), assert = require("assert"), vm = require("vm");
const mk = () => { const d = {}; return { _d: d, get: async () => structuredClone(d), set: async (o) => { Object.assign(d, structuredClone(o)); }, remove: async (ks) => ks.forEach(k => delete d[k]) }; };
const T = [];
const sync = mk();
// Pre-existing v1 data (as written by v0.1.0–0.1.4): conv tuples without order.
Object.assign(sync._d, {
  meta: { v: 1, fc: 1, cc: 1, ts: 1 },
  f0: { A: ["Alma Mater", null, 0], B: ["Psiho", "A", 0], C: ["Seminar", "B", 0], D: ["Other", null, 1] },
  c0: { "grok:c1": ["C", "One"], "grok:c2": ["C", "Two"], "grok:c3": ["C", "Three"], "grok:c4": ["B", "Four"] }
});
globalThis.browser = { storage: { sync, local: mk(), onChanged: { addListener() {} } }, runtime: { onMessage: { addListener: f => T.push(f) } }, tabs: { query: async () => [] } };
console.info = () => {};
const root = path.join(__dirname, "..");
for (const f of ["shared/constants.js", "background/storage.js", "background/background.js"]) vm.runInThisContext(fs.readFileSync(path.join(root, f), "utf8"), { filename: f });
const M = GF.MSG;
const ok = async (type, payload) => { const r = await T[0]({ type, payload }); assert.ok(r.ok, r.error); return r.result; };
const fail = async (type, payload) => { const r = await T[0]({ type, payload }); assert.ok(!r.ok, "expected failure"); return r.error; };
const S = () => GF.Storage.get();
const kids = (pid) => Object.values(S().folders).filter(f => f.parentId === pid).sort((a, b) => a.order - b.order).map(f => f.id);
const convs = (fid) => Object.values(S().convs).filter(c => c.folderId === fid).sort((a, b) => a.order - b.order).map(c => c.convId);

(async () => {
  // Migration: existing data preserved, orders assigned in stored sequence.
  await ok(M.GET_STATE);
  assert.deepStrictEqual(Object.keys(S().folders).sort(), ["A", "B", "C", "D"]);
  assert.deepStrictEqual(convs("C"), ["c1", "c2", "c3"]);
  assert.deepStrictEqual(convs("B"), ["c4"]);
  assert.strictEqual(S().convs["grok:c2"].title, "Two");
  assert.strictEqual(sync._d.meta.v, 1, "load alone must not rewrite storage");
  await ok(M.RENAME_FOLDER, { id: "D", name: "Other" }); // any write persists v2
  assert.strictEqual(sync._d.meta.v, 2);
  assert.deepStrictEqual(sync._d.c0["grok:c2"], ["C", "Two", 1]);
  console.log("PASS v1->v2 migration preserves data");

  // Reorder conversations within a folder.
  await ok(M.MOVE_CONV, { key: "grok:c3", folderId: "C", targetKey: "grok:c1", position: "before" });
  assert.deepStrictEqual(convs("C"), ["c3", "c1", "c2"]);
  await ok(M.MOVE_CONV, { key: "grok:c3", folderId: "C", targetKey: "grok:c2", position: "after" });
  assert.deepStrictEqual(convs("C"), ["c1", "c2", "c3"]);
  // Move conversation between folders (append, and positioned).
  await ok(M.MOVE_CONV, { key: "grok:c1", folderId: "D" });
  assert.deepStrictEqual(convs("C"), ["c2", "c3"]); assert.deepStrictEqual(convs("D"), ["c1"]);
  await ok(M.MOVE_CONV, { key: "grok:c2", folderId: "B", targetKey: "grok:c4", position: "before" });
  assert.deepStrictEqual(convs("B"), ["c2", "c4"]); assert.deepStrictEqual(convs("C"), ["c3"]);
  // External add with position.
  await ok(M.ASSIGN_CONV, { provider: "grok", convId: "c9", title: "Nine", folderId: "B", targetKey: "grok:c4", position: "after" });
  assert.deepStrictEqual(convs("B"), ["c2", "c4", "c9"]);
  console.log("PASS conversation move/reorder");

  // Folder reorder / nesting / root / cycle guard.
  await ok(M.MOVE_FOLDER, { id: "D", targetId: "A", position: "before" });
  assert.deepStrictEqual(kids(null), ["D", "A"]);
  await ok(M.MOVE_FOLDER, { id: "D", targetId: "C", position: "inside" });
  assert.deepStrictEqual(kids("C"), ["D"]); assert.deepStrictEqual(kids(null), ["A"]);
  await ok(M.MOVE_FOLDER, { id: "D", targetId: "B", position: "after" });
  assert.deepStrictEqual(kids("A"), ["B", "D"]);
  assert.match(await fail(M.MOVE_FOLDER, { id: "A", targetId: "C", position: "inside" }), /subtree/);
  assert.match(await fail(M.MOVE_FOLDER, { id: "A", targetId: "B", position: "after" }), /subtree/);
  await ok(M.MOVE_FOLDER, { id: "C", position: "root" });
  assert.deepStrictEqual(kids(null), ["A", "C"]);
  assert.deepStrictEqual(convs("C"), ["c3"], "conversations follow their folder");
  console.log("PASS folder move/reorder/root/cycle guard");

  // Persisted state reloads identically.
  const before = JSON.stringify(S());
  await GF.Storage.load();
  assert.strictEqual(JSON.stringify(S()), before);
  console.log("PASS reload"); console.log("All tests passed");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
