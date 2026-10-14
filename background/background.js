/* Background event page: sole owner of storage. Content scripts use runtime messaging. */
var GF = globalThis.GF;
const S = GF.Storage, M = GF.MSG;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
let ready = S.load();

function descendants(st, id) {
  const out = [id];
  for (let i = 0; i < out.length; i++)
    for (const f of Object.values(st.folders)) if (f.parentId === out[i]) out.push(f.id);
  return out;
}

const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || String(a.name || a.title || "").localeCompare(String(b.name || b.title || ""));
const sortedFolders = (st, pid) => Object.values(st.folders).filter(f => f.parentId === pid).sort(byOrder);
const sortedConvs = (st, fid) => Object.values(st.convs).filter(c => c.folderId === fid).sort(byOrder);
const renumber = (list) => list.forEach((x, i) => { x.order = i; });
function placeAt(siblings, item, index) {
  const i = Math.max(0, Math.min(index, siblings.length));
  siblings.splice(i, 0, item); renumber(siblings);
}
function placeConv(st, { provider, convId, title, folderId, targetKey, position }) {
  if (!st.folders[folderId]) throw new Error("folder not found");
  const key = provider + ":" + convId;
  const prev = st.convs[key];
  const c = { key, provider, convId, folderId, title: String(title || (prev && prev.title) || "").slice(0, 80), order: 0 };
  delete st.convs[key];
  const sib = sortedConvs(st, folderId);
  let index = sib.length;
  if (targetKey && st.convs[targetKey] && st.convs[targetKey].folderId === folderId)
    index = sib.findIndex(x => x.key === targetKey) + (position === "after" ? 1 : 0);
  st.convs[key] = c;
  placeAt(sib, c, index);
  if (prev && prev.folderId !== folderId) renumber(sortedConvs(st, prev.folderId));
}

async function broadcast() {
  const tabs = await browser.tabs.query({ url: "https://grok.com/*" });
  for (const t of tabs) browser.tabs.sendMessage(t.id, { type: M.STATE_CHANGED, state: S.get(), mode: S.getMode() }).catch(() => {});
}

const handlers = {
  [M.GET_STATE]: async () => ({ state: S.get(), mode: S.getMode() }),
  [M.CREATE_FOLDER]: async (st, { name, parentId = null }) => {
    if (parentId && !st.folders[parentId]) throw new Error("parent not found");
    const order = Object.values(st.folders).filter(f => f.parentId === parentId).length;
    const id = uid(); st.folders[id] = { id, name: String(name).slice(0, 100), parentId, order };
    return id;
  },
  [M.RENAME_FOLDER]: async (st, { id, name }) => { st.folders[id].name = String(name).slice(0, 100); },
  [M.DELETE_FOLDER]: async (st, { id }) => {
    const ids = new Set(descendants(st, id));
    ids.forEach(i => delete st.folders[i]);
    for (const [k, c] of Object.entries(st.convs)) if (ids.has(c.folderId)) delete st.convs[k];
  },
  /* position: "inside" (append into targetId) | "before" | "after" (sibling of targetId) | "root" */
  [M.MOVE_FOLDER]: async (st, { id, targetId = null, position = "inside" }) => {
    const f = st.folders[id]; if (!f) throw new Error("folder not found");
    let parentId, index;
    if (position === "root" || !targetId) { parentId = null; index = Infinity; }
    else {
      const t = st.folders[targetId]; if (!t) throw new Error("target not found");
      if (targetId === id) return;
      parentId = position === "inside" ? targetId : t.parentId;
      if (parentId && descendants(st, id).includes(parentId)) throw new Error("cannot move into own subtree");
      const sib = sortedFolders(st, parentId).filter(x => x.id !== id);
      index = position === "inside" ? Infinity : sib.findIndex(x => x.id === targetId) + (position === "after" ? 1 : 0);
    }
    const old = f.parentId;
    f.parentId = parentId;
    placeAt(sortedFolders(st, parentId).filter(x => x.id !== id), f, index);
    if (old !== parentId) renumber(sortedFolders(st, old));
  },
  /* Add (new) or move (existing) conversation. Optional targetKey+position ("before"|"after") for reordering. */
  [M.ASSIGN_CONV]: async (st, p) => placeConv(st, p),
  [M.MOVE_CONV]: async (st, { key, folderId, targetKey, position }) => {
    const c = st.convs[key]; if (!c) throw new Error("conversation not found");
    return placeConv(st, { provider: c.provider, convId: c.convId, title: c.title, folderId, targetKey, position });
  },
  [M.UNASSIGN_CONV]: async (st, { key }) => { delete st.convs[key]; },
  [M.IMPORT]: async (st, { data, mode }) => importData(st, validateImport(data), mode)
};

/* ---- Import / export ---- */
function validateImport(d) {
  if (!d || d.app !== "grok-folders") throw new Error("Not a grok-folders export file");
  if (typeof d.schema !== "number" || d.schema > GF.SCHEMA_VERSION) throw new Error("Unsupported schema: " + d.schema);
  if (!Array.isArray(d.folders) || !Array.isArray(d.conversations)) throw new Error("folders/conversations must be arrays");
  const ids = new Set();
  const folders = d.folders.map((f, i) => {
    if (!f || typeof f.id !== "string" || !f.id || typeof f.name !== "string") throw new Error("Invalid folder #" + i);
    if (ids.has(f.id)) throw new Error("Duplicate folder id " + f.id);
    ids.add(f.id);
    return { id: f.id, name: f.name.slice(0, 100), parentId: typeof f.parentId === "string" ? f.parentId : null, order: Number.isFinite(f.order) ? f.order : i };
  });
  for (const f of folders) if (f.parentId && !ids.has(f.parentId)) f.parentId = null; // orphan -> root
  for (const f of folders) { // break cycles
    const seen = new Set([f.id]); let p = f.parentId;
    while (p) { if (seen.has(p)) { f.parentId = null; break; } seen.add(p); p = folders.find(x => x.id === p).parentId; }
  }
  const conversations = d.conversations.filter((c, i) => {
    if (!c || typeof c.convId !== "string" || !c.convId || typeof c.folderId !== "string") throw new Error("Invalid conversation #" + i);
    return ids.has(c.folderId);
  }).map(c => ({ provider: typeof c.provider === "string" && c.provider ? c.provider : "grok", convId: c.convId, folderId: c.folderId, title: String(c.title || "").slice(0, 80), order: Number.isFinite(c.order) ? c.order : Infinity }));
  return { folders, conversations };
}

/*
 * Idempotent import. Folders are processed parents-first:
 *  1. same id already exists      -> same folder (reuse, nothing changed)
 *  2. same name under same mapped parent -> reuse existing folder
 *  3. otherwise create it (keeps its id; ids are unique since rule 1 didn't match)
 * Conversations: add into the mapped folder if not present; existing ones are kept.
 * Importing the same export twice yields zero changes.
 */
function importData(st, { folders, conversations }, mode) {
  if (mode === "replace") { st.folders = {}; st.convs = {}; }
  else if (mode !== "merge") throw new Error("mode must be replace or merge");
  const byId = Object.fromEntries(folders.map(f => [f.id, f]));
  const depth = (f) => { let d = 0; while (f.parentId) { f = byId[f.parentId]; d++; } return d; };
  const ordered = [...folders].sort((x, y) => depth(x) - depth(y) || x.order - y.order);
  const norm = (n) => n.trim().toLowerCase();
  const remap = {};
  const res = { foldersAdded: 0, foldersSkipped: 0, conversationsAdded: 0, conversationsSkipped: 0 };
  for (const f of ordered) {
    const parentId = f.parentId ? remap[f.parentId] : null;
    if (st.folders[f.id]) { remap[f.id] = f.id; res.foldersSkipped++; continue; }
    const same = Object.values(st.folders).find(x => x.parentId === parentId && norm(x.name) === norm(f.name));
    if (same) { remap[f.id] = same.id; res.foldersSkipped++; continue; }
    const order = Object.values(st.folders).filter(x => x.parentId === parentId).length;
    st.folders[f.id] = { id: f.id, name: f.name, parentId, order };
    remap[f.id] = f.id; res.foldersAdded++;
  }
  for (const c of conversations) {
    const key = c.provider + ":" + c.convId;
    if (st.convs[key]) { res.conversationsSkipped++; continue; }
    const fid = remap[c.folderId];
    const order = Number.isFinite(c.order) ? c.order : sortedConvs(st, fid).length;
    st.convs[key] = { key, provider: c.provider, convId: c.convId, folderId: fid, title: c.title, order };
    res.conversationsAdded++;
  }
  for (const fid of new Set(Object.values(st.convs).map(c => c.folderId))) renumber(sortedConvs(st, fid));
  return res;
}


// Serialize all mutations: concurrent handlers would otherwise clone the same state
// and the last write would silently drop the other change.
let queue = Promise.resolve();
const serial = (fn) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };

browser.runtime.onMessage.addListener((msg) => {
  const h = handlers[msg && msg.type]; if (!h) return undefined;
  return serial(async () => {
    try {
      await ready;
    } catch (e) {
      ready = S.load(); // retry once; never write over data we failed to read
      try { await ready; } catch (e2) { return { ok: false, error: "Storage not loaded: " + e2.message }; }
    }
    try {
      if (msg.type === M.GET_STATE) return { ok: true, ...(await h()) };
      const st = structuredClone(S.get());
      const result = await h(st, msg.payload || {});
      await S.save(st); broadcast();
      return { ok: true, result };
    } catch (e) { return { ok: false, error: e.message }; }
  });
});

// Sync updates from other devices: reload cache and notify tabs (ignore our own writes).
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes.meta || !changes.meta.newValue) return;
  if (changes.meta.newValue.ts === S.getLastTs()) return;
  serial(() => { ready = S.load().then(broadcast); return ready; });
});
