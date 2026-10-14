/* Run: node tests/import.test.js  (mocked browser APIs, no deps) */
const fs = require("fs"), path = require("path"), assert = require("assert"), vm = require("vm");
const mk = () => { const d = {}; return { get: async () => structuredClone(d), set: async (o) => { Object.assign(d, structuredClone(o)); }, remove: async (ks) => ks.forEach(k => delete d[k]) }; };
const T = [];
globalThis.browser = { storage: { sync: mk(), local: mk(), onChanged: { addListener() {} } }, runtime: { onMessage: { addListener: f => T.push(f) } }, tabs: { query: async () => [] } };
console.info = () => {};
const root = path.join(__dirname, "..");
for (const f of ["shared/constants.js", "background/storage.js", "background/background.js"]) vm.runInThisContext(fs.readFileSync(path.join(root, f), "utf8"), { filename: f });
const M = GF.MSG, send = (type, payload) => T[0]({ type, payload });
const exportState = () => { const s = GF.Storage.get(); return { app: "grok-folders", schema: 1, exportedAt: "", folders: Object.values(s.folders).map(({ id, name, parentId, order }) => ({ id, name, parentId, order })), conversations: Object.values(s.convs).map(({ provider, convId, folderId, title }) => ({ provider, convId, folderId, title })) }; };
const counts = () => [Object.keys(GF.Storage.get().folders).length, Object.keys(GF.Storage.get().convs).length];

(async () => {
  const ok = async (t, p) => { const r = await send(t, p); assert.ok(r.ok, r.error); return r.result; };
  const a = await ok(M.CREATE_FOLDER, { name: "Alma Mater" });
  const b = await ok(M.CREATE_FOLDER, { name: "Psihoterapevtska", parentId: a });
  const c = await ok(M.CREATE_FOLDER, { name: "1. Uvod v psihologijo", parentId: b });
  const d = await ok(M.CREATE_FOLDER, { name: "Seminar", parentId: c });
  await ok(M.ASSIGN_CONV, { provider: "grok", convId: "c1", title: "Conv 1", folderId: d });
  await ok(M.ASSIGN_CONV, { provider: "grok", convId: "c2", title: "Conv 2", folderId: b });
  const exp = exportState(), before = JSON.stringify(GF.Storage.get());

  // 1) Idempotency: same export merged twice -> zero changes.
  for (let i = 0; i < 2; i++) {
    const r = await ok(M.IMPORT, { data: exp, mode: "merge" });
    assert.deepStrictEqual(r, { foldersAdded: 0, foldersSkipped: 4, conversationsAdded: 0, conversationsSkipped: 2 });
    assert.strictEqual(JSON.stringify(GF.Storage.get()), before);
  }
  console.log("PASS idempotent merge");

  // 2) Export from another device: different ids, same names + some new items.
  const other = { app: "grok-folders", schema: 1, folders: [
    { id: "X1", name: "Alma Mater", parentId: null, order: 0 },
    { id: "X2", name: "psihoterapevtska ", parentId: "X1", order: 0 },   // same name (case/space-insensitive)
    { id: "X3", name: "Novo", parentId: "X2", order: 1 },                // new under existing
    { id: "X4", name: "Seminar", parentId: null, order: 1 }              // same name, different parent -> new
  ], conversations: [
    { provider: "grok", convId: "c1", folderId: "X4", title: "Conv 1" }, // exists -> keep current folder
    { provider: "grok", convId: "c3", folderId: "X3", title: "Conv 3" }  // new -> into mapped folder
  ] };
  let r = await ok(M.IMPORT, { data: other, mode: "merge" });
  assert.deepStrictEqual(r, { foldersAdded: 2, foldersSkipped: 2, conversationsAdded: 1, conversationsSkipped: 1 });
  const st = GF.Storage.get();
  assert.strictEqual(st.folders.X3.parentId, b);
  assert.strictEqual(st.folders.X4.parentId, null);
  assert.strictEqual(st.convs["grok:c1"].folderId, d);
  assert.strictEqual(st.convs["grok:c3"].folderId, "X3");
  assert.deepStrictEqual(counts(), [6, 3]);
  const after = JSON.stringify(GF.Storage.get());
  r = await ok(M.IMPORT, { data: other, mode: "merge" });
  assert.strictEqual(r.foldersAdded + r.conversationsAdded, 0);
  assert.strictEqual(JSON.stringify(GF.Storage.get()), after);
  console.log("PASS merge from other device (+ repeat is no-op)");

  // 3) Replace restores exactly the export; persisted state reloads identically.
  await ok(M.IMPORT, { data: exp, mode: "replace" });
  assert.deepStrictEqual(counts(), [4, 2]);
  await GF.Storage.load();
  assert.deepStrictEqual(counts(), [4, 2]);
  console.log("PASS replace + reload");
  console.log("All tests passed");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
