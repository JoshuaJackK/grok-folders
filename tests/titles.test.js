/* Run: node tests/titles.test.js — automatic title refresh.
 * Part 1 (background, always): batch update, no write when unchanged, saved-only, truncation.
 * Part 2 (content, jsdom; skipped if jsdom missing): detection, debounce, placeholders, never auto-add. */
const fs = require("fs"), path = require("path"), assert = require("assert"), vm = require("vm");
const R = path.join(__dirname, "..");
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

async function backgroundPart() {
  const mk = () => { const d = {}; let writes = 0; return { _d: d, writes: () => writes, get: async () => structuredClone(d), set: async (o) => { writes++; Object.assign(d, structuredClone(o)); }, remove: async (ks) => ks.forEach(k => delete d[k]) }; };
  const sync = mk(), T = [];
  Object.assign(sync._d, { meta: { v: 3, fc: 1, cc: 1, tc: 0, ts: 1 }, f0: { A: ["A", null, 0] }, c0: { "grok:c1": ["A", "Old", 0], "grok:c2": ["A", "Same", 1] } });
  const ctx = { browser: { storage: { sync, local: mk(), onChanged: { addListener() {} } }, runtime: { onMessage: { addListener: f => T.push(f) } }, tabs: { query: async () => [] } }, console: { ...console, info() {} }, structuredClone, TextEncoder, Promise, Date, Math, JSON, Object, Array, Set, String, Number, Error };
  ctx.globalThis = ctx; vm.createContext(ctx);
  for (const f of ["shared/constants.js", "background/storage.js", "background/background.js"]) vm.runInContext(fs.readFileSync(path.join(R, f), "utf8"), ctx, { filename: f });
  const send = async (payload) => { const r = await T[0]({ type: "gf:updateTitles", payload }); assert.ok(r.ok, r.error); return r.result; };
  await T[0]({ type: "gf:getState" });
  const w0 = sync.writes();
  assert.strictEqual((await send({ provider: "grok", titles: { c2: "Same", c9: "Unsaved", c1: "   " } })).changed, 0);
  assert.strictEqual(sync.writes(), w0, "no write when nothing changed");
  const long = "x".repeat(120);
  assert.strictEqual((await send({ provider: "grok", titles: { c1: long, c2: "Same", c9: "Unsaved" } })).changed, 1);
  assert.ok(sync.writes() > w0, "one batch write");
  assert.strictEqual(JSON.stringify(sync._d.c0["grok:c1"]), JSON.stringify(["A", "x".repeat(80), 0]), "truncated to 80");
  assert.ok(!sync._d.c0["grok:c9"], "never auto-adds");
  console.log("PASS background: batch, no-op without write, saved-only, truncation");
}

async function contentPart() {
  let JSDOM; try { ({ JSDOM } = require("jsdom")); } catch (_) { console.log("SKIP content part (jsdom not installed)"); return; }
  const DEB = 40;
  const state = { folders: { A: { id: "A", name: "A", parentId: null, order: 0, color: 0, tags: [] } }, tags: {}, convs: {} };
  for (const [id, t] of [["c1", "Conv one"], ["c3", "Old title"], ["c4", "Current old"], ["c5", "Five"]]) state.convs["grok:" + id] = { key: "grok:" + id, provider: "grok", convId: id, folderId: "A", title: t, order: 0, tags: [] };
  const dom = new JSDOM(`<head><title>Current old - Grok</title></head><body><nav>
    <a href="/c/c1"><span>Conv one</span></a><a href="/c/c2"><span>Unsaved chat</span></a><a href="/c/c3"><span>Old title</span></a></nav></body>`,
    { url: "https://grok.com/c/c4", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window, sent = []; let onMsg;
  w.browser = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    runtime: {
      sendMessage: async (m) => {
        sent.push(m);
        if (m.type === "gf:updateTitles") { // emulate background + broadcast
          for (const [id, t] of Object.entries(m.payload.titles)) if (state.convs["grok:" + id]) state.convs["grok:" + id].title = t;
          setTimeout(() => onMsg({ type: "gf:stateChanged", state: structuredClone(state), mode: "sync" }), 1);
          return { ok: true, result: { changed: 1 } };
        }
        return { ok: true, state: structuredClone(state), mode: "sync" };
      },
      onMessage: { addListener: (f) => { onMsg = f; } }
    }
  };
  w.CSS = { escape: (s) => s };
  w.Element.prototype.setPointerCapture = w.Element.prototype.releasePointerCapture = function () {};
  w.eval(`var GF = globalThis.GF = { titleDebounceMs: ${DEB} };`);
  for (const f of require(path.join(R, "manifest.json")).content_scripts[0].js) w.eval(fs.readFileSync(path.join(R, f), "utf8"));
  const updates = () => sent.filter(m => m.type === "gf:updateTitles").map(m => JSON.parse(JSON.stringify(m)));
  const link = (id) => w.document.querySelector(`a[href="/c/${id}"] span`);

  await tick(DEB * 3);
  assert.strictEqual(updates().length, 0, "no write when titles unchanged");
  console.log("PASS no write when unchanged");

  // Rapid renames -> one debounced batch with the final title.
  link("c3").textContent = "New 1"; await tick(5);
  link("c3").textContent = "New 2"; await tick(5);
  link("c3").textContent = "Final title"; await tick(5);
  link("c2").textContent = "Unsaved renamed";
  assert.strictEqual(updates().length, 0, "debounced (nothing yet)");
  await tick(DEB * 3);
  assert.strictEqual(updates().length, 1, "exactly one batch");
  assert.deepStrictEqual(updates()[0].payload, { provider: "grok", titles: { c3: "Final title" } }, "saved-only, final title");
  await tick(DEB * 3);
  assert.strictEqual(updates().length, 1, "no repeat after state applied");
  console.log("PASS detection + debounce + never auto-add");

  // Stale tab: title renamed elsewhere (broadcast) while this page still shows the old one -> no overwrite.
  state.convs["grok:c3"].title = "Renamed on other device";
  onMsg({ type: "gf:stateChanged", state: structuredClone(state), mode: "sync" });
  w.document.body.appendChild(w.document.createElement("div")); // unrelated DOM churn
  await tick(DEB * 3);
  assert.strictEqual(updates().length, 1, "no ping-pong from stale tab");
  assert.strictEqual(state.convs["grok:c3"].title, "Renamed on other device");
  console.log("PASS stale tab does not overwrite synced rename");

  // Placeholders / empty are ignored.
  link("c1").textContent = "New chat"; await tick(DEB * 3);
  link("c1").textContent = "   "; await tick(DEB * 3);
  assert.strictEqual(updates().length, 1, "placeholder/empty ignored");
  assert.strictEqual(state.convs["grok:c1"].title, "Conv one");
  console.log("PASS placeholder ignore");

  // Open conversation (no history link): document.title; long title truncated; batch of several.
  w.document.title = "Brand new name - Grok";
  link("c1").textContent = "y".repeat(100);
  await tick(DEB * 3);
  assert.strictEqual(updates().length, 2);
  assert.deepStrictEqual(updates()[1].payload.titles, { c1: "y".repeat(80), c4: "Brand new name" });
  console.log("PASS current-conversation title + truncation + batching");

  // SPA navigation: stale document.title of previous chat must not be applied to the new one.
  w.history.pushState({}, "", "/c/c5");
  await tick(1300); // URL poll (1s) + debounce
  assert.strictEqual(updates().length, 2, "stale title after navigation ignored");
  w.document.title = "Five renamed - Grok";
  await tick(DEB * 3);
  assert.deepStrictEqual(updates()[2].payload.titles, { c5: "Five renamed" });
  console.log("PASS SPA navigation: stale title ignored, new title applied");
  w.close();
}

(async () => { await backgroundPart(); await contentPart(); console.log("All tests passed"); process.exit(0); })()
  .catch((e) => { console.error("FAIL", e); process.exit(1); });
