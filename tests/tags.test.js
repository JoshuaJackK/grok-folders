/* Run: node tests/tags.test.js — v2->v3 migration, colors, tags CRUD, export/import with tags. */
const fs = require("fs"), path = require("path"), assert = require("assert"), vm = require("vm");
const mk = () => { const d = {}; return { _d: d, get: async () => structuredClone(d), set: async (o) => { Object.assign(d, structuredClone(o)); }, remove: async (ks) => ks.forEach(k => delete d[k]) }; };
const T = [];
const sync = mk();
// Pre-existing v2 data (v0.1.5–0.2.0).
Object.assign(sync._d, {
  meta: { v: 2, fc: 1, cc: 1, ts: 1 },
  f0: { A: ["Alma Mater", null, 0], B: ["Seminar", "A", 0] },
  c0: { "grok:c1": ["B", "One", 0], "grok:c2": ["B", "Two", 1], "grok:c3": ["A", "Three", 0] }
});
globalThis.browser = { storage: { sync, local: mk(), onChanged: { addListener() {} } }, runtime: { onMessage: { addListener: f => T.push(f) } }, tabs: { query: async () => [] } };
console.info = () => {};
const root = path.join(__dirname, "..");
for (const f of ["shared/constants.js", "background/storage.js", "background/background.js"]) vm.runInThisContext(fs.readFileSync(path.join(root, f), "utf8"), { filename: f });
const M = GF.MSG;
const ok = async (type, payload) => { const r = await T[0]({ type, payload }); assert.ok(r.ok, r.error); return r.result; };
const fail = async (type, payload) => { const r = await T[0]({ type, payload }); assert.ok(!r.ok, "expected failure"); return r.error; };
const S = () => GF.Storage.get();
const sub = (act, exp) => { for (const k of Object.keys(exp)) assert.strictEqual(act[k], exp[k], k + ": " + JSON.stringify(act)); };
// Same shape as sidebar.exportJson()
const exportState = () => { const s = S(); return { app: "grok-folders", schema: GF.SCHEMA_VERSION, exportedAt: "",
  tags: Object.values(s.tags).map(({ id, name, color }) => ({ id, name, color: GF.PALETTE[color] || null })),
  folders: Object.values(s.folders).map(({ id, name, parentId, order, color, tags }) => ({ id, name, parentId, order, color: GF.PALETTE[color] || null, tags })),
  conversations: Object.values(s.convs).map(({ provider, convId, folderId, title, order, tags }) => ({ provider, convId, folderId, title, order, tags })) }; };

(async () => {
  // --- migration v2 -> v3 ---
  await ok(M.GET_STATE);
  assert.deepStrictEqual(Object.keys(S().folders).sort(), ["A", "B"]);
  assert.deepStrictEqual(Object.keys(S().convs).sort(), ["grok:c1", "grok:c2", "grok:c3"]);
  assert.strictEqual(S().convs["grok:c2"].order, 1);
  assert.strictEqual(S().convs["grok:c2"].title, "Two");
  assert.deepStrictEqual(S().tags, {});
  assert.strictEqual(S().folders.A.color, 0);
  assert.strictEqual(sync._d.meta.v, 2, "load alone must not rewrite");
  await ok(M.SET_COLOR, { id: "A", color: 3 });
  assert.strictEqual(sync._d.meta.v, 3);
  assert.deepStrictEqual(sync._d.f0.B, ["Seminar", "A", 0], "defaults trimmed (compact)");
  assert.deepStrictEqual(sync._d.f0.A, ["Alma Mater", null, 0, 3]);
  assert.deepStrictEqual(sync._d.c0["grok:c2"], ["B", "Two", 1]);
  console.log("PASS v2->v3 migration preserves data, compact tuples");

  // --- colors ---
  await ok(M.SET_COLOR, { id: "B", color: "#0090FF" });
  assert.strictEqual(S().folders.B.color, 6);
  await ok(M.SET_COLOR, { id: "B", color: 99 });
  assert.strictEqual(S().folders.B.color, 0, "invalid color -> none");
  console.log("PASS folder colors");

  // --- tags CRUD ---
  const work = await ok(M.CREATE_TAG, { name: "Work", color: 1 });
  const exam = await ok(M.CREATE_TAG, { name: "Exam", color: 2 });
  assert.strictEqual(await ok(M.CREATE_TAG, { name: " work " }), work, "duplicate name returns existing");
  assert.match(await fail(M.CREATE_TAG, { name: "  " }), /required/);
  await ok(M.UPDATE_TAG, { id: exam, name: "Exams", color: 5 });
  sub(S().tags[exam], { name: "Exams", color: 5 });
  assert.match(await fail(M.UPDATE_TAG, { id: exam, name: "WORK" }), /exists/);
  await ok(M.SET_TAGS, { target: "conv", id: "grok:c1", tagIds: [work, exam, work, "bogus"] });
  assert.deepStrictEqual(S().convs["grok:c1"].tags, [work, exam]);
  await ok(M.SET_TAGS, { target: "folder", id: "A", tagIds: [work] });
  // tags survive moves
  await ok(M.MOVE_CONV, { key: "grok:c1", folderId: "A" });
  assert.deepStrictEqual(S().convs["grok:c1"].tags, [work, exam]);
  await ok(M.DELETE_TAG, { id: exam });
  assert.deepStrictEqual(S().convs["grok:c1"].tags, [work]);
  assert.ok(!S().tags[exam]);
  const before = JSON.stringify(S());
  await GF.Storage.load();
  assert.strictEqual(JSON.stringify(S()), before, "tags/colors persist across reload");
  console.log("PASS tags CRUD + persistence");

  // --- export/import idempotency with tags ---
  const exp = exportState();
  for (let i = 0; i < 2; i++) {
    const r = await ok(M.IMPORT, { data: exp, mode: "merge" });
    sub(r, { tagsAdded: 0, tagsSkipped: 1, foldersAdded: 0, conversationsAdded: 0, updated: 0 });
    assert.strictEqual(JSON.stringify(S()), before);
  }
  console.log("PASS merge idempotent (tags/colors)");

  // --- import from another device: tags matched by name, unioned, new ones created ---
  const other = { app: "grok-folders", schema: 3,
    tags: [{ id: "T1", name: "WORK", color: "#46a758" }, { id: "T2", name: "Later", color: "#8e4ec6" }],
    folders: [{ id: "X1", name: "Alma Mater", parentId: null, color: "#e5484d", tags: ["T2"] }, { id: "X2", name: "New", parentId: "X1", color: "#ffc53d", tags: ["T1"] }],
    conversations: [{ convId: "c2", folderId: "X1", title: "Two", tags: ["T2"] }, { convId: "c9", folderId: "X2", title: "Nine", tags: ["T1", "T2", "nope"] }] };
  let r = await ok(M.IMPORT, { data: other, mode: "merge" });
  sub(r, { tagsAdded: 1, tagsSkipped: 1, foldersAdded: 1, foldersSkipped: 1, conversationsAdded: 1, conversationsSkipped: 1, updated: 2 });
  const later = Object.values(S().tags).find(t => t.name === "Later").id;
  assert.strictEqual(Object.keys(S().tags).length, 2);
  assert.strictEqual(S().tags[work].color, 1, "existing tag color kept");
  assert.strictEqual(S().folders.A.color, 3, "existing folder color kept");
  assert.deepStrictEqual(S().folders.A.tags, [work, later]);
  assert.strictEqual(S().folders.X2.color, 3);
  assert.deepStrictEqual(S().folders.X2.tags, [work]);
  assert.deepStrictEqual(S().convs["grok:c2"].tags, [later]);
  assert.strictEqual(S().convs["grok:c2"].folderId, "B", "existing conv keeps folder");
  assert.deepStrictEqual(S().convs["grok:c9"].tags, [work, later]);
  const after = JSON.stringify(S());
  r = await ok(M.IMPORT, { data: other, mode: "merge" });
  sub(r, { tagsAdded: 0, foldersAdded: 0, conversationsAdded: 0, updated: 0 });
  assert.strictEqual(JSON.stringify(S()), after);
  console.log("PASS merge from other device + repeat is no-op");

  // --- old (v1, no tags/colors) export still importable ---
  r = await ok(M.IMPORT, { data: { app: "grok-folders", schema: 1, folders: [{ id: "O1", name: "Old", parentId: null, order: 0 }], conversations: [{ provider: "grok", convId: "c50", folderId: "O1", title: "Old conv" }] }, mode: "merge" });
  sub(r, { foldersAdded: 1, conversationsAdded: 1 });
  sub(S().folders.O1, { color: 0 }); assert.deepStrictEqual(S().folders.O1.tags, []);
  console.log("PASS old export importable");

  // --- replace includes tags ---
  await ok(M.IMPORT, { data: exp, mode: "replace" });
  assert.strictEqual(JSON.stringify(S()), before);
  console.log("PASS replace restores tags/colors exactly");
  console.log("All tests passed");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
