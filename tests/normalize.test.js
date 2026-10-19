/* Run: node tests/normalize.test.js — 0.5.5 key normalisation: grokx:<uuid> -> grok:<uuid> (X and grok.com share
 * UUID conversation ids). Key mapping, load-time migration + merge (sync chunks + local mirror), idempotency,
 * import normalisation, legacy assign from an old tab. No jsdom needed. */
const fs = require("fs"), path = require("path"), assert = require("assert"), vm = require("vm");
const R = path.join(__dirname, "..");
const U = "124e3867-8ba5-476d-aa9a-0395edd41b65";            // the user's chat
const U2 = "5d1f0a2e-0b7c-4c1e-9a55-2f6f7a1b9c00", U3 = "0f0e0d0c-0b0a-4999-8888-777766665555";
const mk = (init = {}) => { const d = structuredClone(init); let sets = 0, removes = 0;
  return { _d: d, sets: () => sets, removes: () => removes, get: async () => structuredClone(d), set: async (o) => { sets++; Object.assign(d, structuredClone(o)); }, remove: async (ks) => { removes++; [].concat(ks).forEach(k => delete d[k]); } }; };
function bg(sync, local) {
  const T = [];
  const ctx = { browser: { storage: { sync, local, onChanged: { addListener() {} } }, runtime: { onMessage: { addListener: f => T.push(f) } }, tabs: { query: async () => [] } },
    console: { ...console, info() {}, warn() {} }, structuredClone, TextEncoder, Promise, Date, Math, JSON, Object, Array, Set, Map, String, Number, Error, RegExp };
  ctx.globalThis = ctx; vm.createContext(ctx);
  for (const f of ["shared/constants.js", "background/storage.js", "background/background.js"]) vm.runInContext(fs.readFileSync(path.join(R, f), "utf8"), ctx, { filename: f });
  const call = async (type, payload) => { const r = await T[0]({ type, payload }); assert.ok(r.ok, r.error); return r; };
  return { ctx, call };
}
const plain = (x) => JSON.parse(JSON.stringify(x));

(async () => {
  // --- key mapping ---
  { const { ctx } = bg(mk(), mk()); const G = ctx.GF;
    const c = (p, id) => plain(G.canonConv(p, id));
    assert.deepStrictEqual(c("grokx", U), { provider: "grok", convId: U });
    assert.deepStrictEqual(c("grokx", U.toUpperCase()), { provider: "grok", convId: U }, "case-insensitive, lowercase");
    assert.deepStrictEqual(c("grok", U.toUpperCase()), { provider: "grok", convId: U }, "grok.com uppercase -> lowercase");
    assert.deepStrictEqual(c("grokx", "1990017815781278167"), { provider: "grokx", convId: "1990017815781278167" }, "numeric stays grokx");
    assert.deepStrictEqual(c("grokx", U + "0"), { provider: "grokx", convId: U + "0" }, "not 8-4-4-4-12 -> unchanged");
    assert.deepStrictEqual(c("claude", U.toUpperCase()), { provider: "claude", convId: U.toUpperCase() }, "other providers untouched");
    assert.strictEqual(G.canonKey("grokx:" + U), "grok:" + U);
    assert.strictEqual(G.canonKey("chatgpt:abc"), "chatgpt:abc");
    console.log("PASS key mapping"); }

  // --- load-time migration + merge, saved once to sync + local mirror; idempotent ---
  const seed = { meta: { v: 3, fc: 1, cc: 2, tc: 1, ts: 10 },
    f0: { A: ["A", null, 0], B: ["B", null, 1] }, t0: { t1: ["red", 1], t2: ["blue", 2] },
    c0: { ["grok:" + U]: ["A", "New chat", 0, ["t1"]], ["grokx:" + U]: ["A", "Bled trip plan", 2, ["t2"]], "chatgpt:x1": ["A", "GPT", 1] },
    c1: { ["grokx:" + U2.toUpperCase()]: ["B", "Upper X", 0], "grokx:1990017815781278167": ["B", "Numeric", 1],
          ["grok:" + U3]: ["A", "From grok.com", 3], ["grokx:" + U3]: ["B", "From X", 2] } };
  const sync = mk(seed), local = mk({ ...seed, mode: "sync" });
  let b = bg(sync, local);
  const st = (await b.call("gf:getState")).state;
  assert.deepStrictEqual(Object.keys(st.convs).sort(), ["chatgpt:x1", "grok:" + U3, "grok:" + U, "grok:" + U2, "grokx:1990017815781278167"].sort());
  const m = st.convs["grok:" + U];
  assert.deepStrictEqual(plain({ provider: m.provider, convId: m.convId, folderId: m.folderId, title: m.title, tags: m.tags }),
    { provider: "grok", convId: U, folderId: "A", title: "Bled trip plan", tags: ["t1", "t2"] }, "merged: one entry in A, real title wins over placeholder, tags unioned");
  assert.deepStrictEqual(plain(Object.values(st.convs).filter(c => c.folderId === "A").sort((x, y) => x.order - y.order).map(c => c.key)),
    ["grok:" + U, "chatgpt:x1", "grok:" + U3], "no duplicate in folder A, dense order");
  assert.strictEqual(st.convs["grok:" + U3].folderId, "A", "grok: entry's folder wins when they were in different folders");
  assert.strictEqual(st.convs["grok:" + U3].title, "From grok.com", "equal-quality titles: grok: entry kept");
  assert.strictEqual(st.convs["grok:" + U2].title, "Upper X");
  assert.strictEqual(st.convs["grokx:1990017815781278167"].provider, "grokx");
  const keysIn = (d) => Object.entries(d).filter(([k]) => /^c\d+$/.test(k)).flatMap(([, v]) => Object.keys(v)).sort();
  assert.deepStrictEqual(keysIn(sync._d), Object.keys(st.convs).sort(), "sync rewritten with normalised keys");
  assert.deepStrictEqual(keysIn(local._d), Object.keys(st.convs).sort(), "local mirror rewritten too");
  assert.strictEqual(sync._d.meta.cc, Object.keys(sync._d).filter(k => /^c\d+$/.test(k)).length, "no stale conv chunks");
  assert.strictEqual(sync.sets(), 1, "saved once (sync)"); assert.strictEqual(local.sets(), 1, "saved once (local)");
  assert.ok(sync._d.meta.ts > 10);
  // reload: nothing to normalise -> no write
  const s1 = sync.sets(), l1 = local.sets();
  b = bg(sync, local); await b.call("gf:getState");
  assert.strictEqual(sync.sets(), s1, "idempotent: no second write (sync)"); assert.strictEqual(local.sets(), l1, "idempotent (local)");
  console.log("PASS load migration: merge, single entry per folder, best title, one save, sync+local, idempotent");

  // --- old tab still sends grokx:<uuid>; title updates by old key; import normalises ---
  await b.call("gf:assignConv", { provider: "grokx", convId: U.toUpperCase(), title: "Bled trip plan", folderId: "B" });
  let s = (await b.call("gf:getState")).state;
  assert.ok(!Object.keys(s.convs).some(k => k.startsWith("grokx:") && k.includes("-")), "never stores grokx:<uuid>");
  assert.strictEqual(s.convs["grok:" + U].folderId, "B", "re-assign moved the single entry");
  assert.strictEqual((await b.call("gf:updateTitles", { provider: "grokx", titles: { [U]: "Renamed" } })).result.changed, 1);
  s = (await b.call("gf:getState")).state;
  assert.strictEqual(s.convs["grok:" + U].title, "Renamed");

  const exp = { app: "grok-folders", schema: 3, folders: [{ id: "A", name: "A", parentId: null }, { id: "N", name: "New", parentId: null }],
    conversations: [{ provider: "grokx", convId: U2, folderId: "N", title: "x" }, { provider: "grokx", convId: "ab0c0d0c-0b0a-4999-8888-777766665555", folderId: "N", title: "New chat" },
      { provider: "grok", convId: "AB0C0D0C-0B0A-4999-8888-777766665555", folderId: "N", title: "Imported real" }, { provider: "grokx", convId: "123456", folderId: "N", title: "num" }] };
  const r1 = (await b.call("gf:import", { data: exp, mode: "merge" })).result;
  s = (await b.call("gf:getState")).state;
  const imp = s.convs["grok:ab0c0d0c-0b0a-4999-8888-777766665555"];
  assert.ok(imp && imp.title === "Imported real", "import: duplicates in file collapse, best title");
  assert.ok(!s.convs["grokx:ab0c0d0c-0b0a-4999-8888-777766665555"] && !s.convs["grokx:" + U2]);
  assert.strictEqual(s.convs["grok:" + U2].folderId, "B", "existing entry keeps its folder on merge import");
  assert.ok(s.convs["grokx:123456"]);
  assert.strictEqual(r1.conversationsAdded, 2);
  const r2 = (await b.call("gf:import", { data: exp, mode: "merge" })).result;
  assert.strictEqual(r2.conversationsAdded + r2.updated + r2.foldersAdded, 0, "importing twice = zero changes");
  console.log("PASS old-tab assign/titles + JSON import normalisation (idempotent)");
  console.log("All tests passed");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
