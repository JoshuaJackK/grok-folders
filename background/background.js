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
  const c = { key, provider, convId, folderId, title: String(title || (prev && prev.title) || "").slice(0, GF.TITLE_MAX), order: 0, tags: prev ? prev.tags || [] : [] };
  delete st.convs[key];
  const sib = sortedConvs(st, folderId);
  let index = sib.length;
  if (targetKey && st.convs[targetKey] && st.convs[targetKey].folderId === folderId)
    index = sib.findIndex(x => x.key === targetKey) + (position === "after" ? 1 : 0);
  st.convs[key] = c;
  placeAt(sib, c, index);
  if (prev && prev.folderId !== folderId) renumber(sortedConvs(st, prev.folderId));
}

const cleanTagName = (n) => { const s = String(n || "").trim().slice(0, 30); if (!s) throw new Error("Tag name required"); return s; };
const findTag = (st, name) => Object.values(st.tags || {}).find(t => t.name.toLowerCase() === name.trim().toLowerCase());

async function broadcast() {
  const tabs = await browser.tabs.query({ url: GF.HOST_MATCHES });
  for (const t of tabs) browser.tabs.sendMessage(t.id, { type: M.STATE_CHANGED, state: S.get(), mode: S.getMode() }).catch(() => {});
}

const handlers = {
  [M.GET_STATE]: async () => ({ state: S.get(), mode: S.getMode() }),
  [M.CREATE_FOLDER]: async (st, { name, parentId = null }) => {
    if (parentId && !st.folders[parentId]) throw new Error("parent not found");
    const order = Object.values(st.folders).filter(f => f.parentId === parentId).length;
    const id = uid(); st.folders[id] = { id, name: String(name).slice(0, 100), parentId, order, color: 0, tags: [], style: 0 };
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
  /* ---- colors & tags ---- */
  /* Folder name style (own row only): { id, font: key|null, bold, italic } */
  [M.SET_STYLE]: async (st, { id, font = null, bold = false, italic = false, fontSize = null }) => {
    const f = st.folders[id]; if (!f) throw new Error("folder not found");
    f.style = GF.encodeStyle({ font, bold, italic, fontSize });
  },
  [M.SET_COLOR]: async (st, { id, color }) => { const f = st.folders[id]; if (!f) throw new Error("folder not found"); f.color = GF.colorIndex(color); },
  [M.CREATE_TAG]: async (st, { name, color = 0 }) => {
    const n = cleanTagName(name);
    const dup = findTag(st, n); if (dup) return dup.id;
    st.tags = st.tags || {};
    const id = uid(); st.tags[id] = { id, name: n, color: GF.colorIndex(color) };
    return id;
  },
  [M.UPDATE_TAG]: async (st, { id, name, color }) => {
    const t = st.tags[id]; if (!t) throw new Error("tag not found");
    if (name !== undefined) {
      const n = cleanTagName(name), dup = findTag(st, n);
      if (dup && dup.id !== id) throw new Error(`Tag "${n}" already exists`);
      t.name = n;
    }
    if (color !== undefined) t.color = GF.colorIndex(color);
  },
  [M.DELETE_TAG]: async (st, { id }) => {
    delete st.tags[id];
    for (const x of [...Object.values(st.folders), ...Object.values(st.convs)]) if (x.tags) x.tags = x.tags.filter(t => t !== id);
  },
  /* target: "conv" (id = conv key) | "folder" (id = folder id); tagIds replaces the set. */
  [M.SET_TAGS]: async (st, { target, id, tagIds }) => {
    const obj = target === "folder" ? st.folders[id] : st.convs[id];
    if (!obj) throw new Error(target + " not found");
    obj.tags = [...new Set(tagIds)].filter(t => st.tags[t]);
  },
  /* Batch title refresh for saved conversations only. Returns { changed }; 0 => no write. */
  [M.UPDATE_TITLES]: async (st, { provider, titles }) => {
    let changed = 0;
    for (const [convId, raw] of Object.entries(titles || {})) {
      const c = st.convs[provider + ":" + convId];
      const t = String(raw || "").trim().slice(0, GF.TITLE_MAX);
      if (!c || !t || c.title === t) continue;
      c.title = t; changed++;
    }
    return { changed };
  },
  [M.IMPORT]: async (st, { data, mode }) => importData(st, validateImport(data), mode)
};

/* ---- Import / export ---- */
function validateImport(d) {
  if (!d || d.app !== "grok-folders") throw new Error("Not a grok-folders export file");
  if (typeof d.schema !== "number" || d.schema > GF.SCHEMA_VERSION) throw new Error("Unsupported schema: " + d.schema);
  if (!Array.isArray(d.folders) || !Array.isArray(d.conversations)) throw new Error("folders/conversations must be arrays");
  if (d.tags !== undefined && !Array.isArray(d.tags)) throw new Error("tags must be an array");
  const tagIds = new Set();
  const tags = (d.tags || []).filter((t, i) => {
    if (!t || typeof t.id !== "string" || typeof t.name !== "string" || !t.name.trim()) throw new Error("Invalid tag #" + i);
    if (tagIds.has(t.id)) return false;
    tagIds.add(t.id); return true;
  }).map(t => ({ id: t.id, name: t.name.trim().slice(0, 30), color: GF.colorIndex(t.color) }));
  const tagList = (a) => Array.isArray(a) ? [...new Set(a.filter(x => tagIds.has(x)))] : [];
  const ids = new Set();
  const folders = d.folders.map((f, i) => {
    if (!f || typeof f.id !== "string" || !f.id || typeof f.name !== "string") throw new Error("Invalid folder #" + i);
    if (ids.has(f.id)) throw new Error("Duplicate folder id " + f.id);
    ids.add(f.id);
    return { id: f.id, name: f.name.slice(0, 100), parentId: typeof f.parentId === "string" ? f.parentId : null, order: Number.isFinite(f.order) ? f.order : i, color: GF.colorIndex(f.color), tags: tagList(f.tags), style: GF.encodeStyle({ font: GF.FONTS[f.font] ? f.font : null, bold: f.bold === true, italic: f.italic === true, fontSize: GF.cleanFontSize(f.fontSize) }) };
  });
  for (const f of folders) if (f.parentId && !ids.has(f.parentId)) f.parentId = null; // orphan -> root
  for (const f of folders) { // break cycles
    const seen = new Set([f.id]); let p = f.parentId;
    while (p) { if (seen.has(p)) { f.parentId = null; break; } seen.add(p); p = folders.find(x => x.id === p).parentId; }
  }
  const conversations = d.conversations.filter((c, i) => {
    if (!c || typeof c.convId !== "string" || !c.convId || typeof c.folderId !== "string") throw new Error("Invalid conversation #" + i);
    return ids.has(c.folderId);
  }).map(c => ({ provider: typeof c.provider === "string" && c.provider ? c.provider : "grok", convId: c.convId, folderId: c.folderId, title: String(c.title || "").slice(0, GF.TITLE_MAX), order: Number.isFinite(c.order) ? c.order : Infinity, tags: tagList(c.tags) }));
  return { tags, folders, conversations };
}

/*
 * Idempotent import.
 * Tags: matched by name (case-insensitive) -> reuse; else created (file id kept unless it collides).
 * Folders (parents first): same id -> same folder; else same name under same mapped parent -> reuse;
 *   else create. Reused folders: tags are unioned, color only filled in if they had none.
 * Conversations: new ones added into the mapped folder; existing ones keep their folder, tags are unioned.
 * Importing the same export twice yields zero changes.
 */
function importData(st, { tags, folders, conversations }, mode) {
  if (mode === "replace") { st.folders = {}; st.convs = {}; st.tags = {}; }
  else if (mode !== "merge") throw new Error("mode must be replace or merge");
  st.tags = st.tags || {};
  const res = { tagsAdded: 0, tagsSkipped: 0, foldersAdded: 0, foldersSkipped: 0, conversationsAdded: 0, conversationsSkipped: 0, updated: 0 };
  const tagMap = {};
  for (const t of tags) {
    const ex = findTag(st, t.name);
    if (ex) { tagMap[t.id] = ex.id; res.tagsSkipped++; continue; }
    const id = st.tags[t.id] ? uid() : t.id;
    st.tags[id] = { id, name: t.name, color: t.color }; tagMap[t.id] = id; res.tagsAdded++;
  }
  const mapTags = (a) => a.map(x => tagMap[x]).filter(Boolean);
  const union = (obj, add) => {
    const cur = obj.tags || [], next = [...new Set([...cur, ...add])];
    if (next.length !== cur.length) { obj.tags = next; return true; }
    return false;
  };
  const byId = Object.fromEntries(folders.map(f => [f.id, f]));
  const depth = (f) => { let d = 0; while (f.parentId) { f = byId[f.parentId]; d++; } return d; };
  const ordered = [...folders].sort((x, y) => depth(x) - depth(y) || x.order - y.order);
  const norm = (n) => n.trim().toLowerCase();
  const remap = {};
  for (const f of ordered) {
    const parentId = f.parentId ? remap[f.parentId] : null;
    const ex = st.folders[f.id] || Object.values(st.folders).find(x => x.parentId === parentId && norm(x.name) === norm(f.name));
    if (ex) {
      remap[f.id] = ex.id; res.foldersSkipped++;
      let changed = union(ex, mapTags(f.tags));
      if (!ex.color && f.color) { ex.color = f.color; changed = true; }
      if (!ex.style && f.style) { ex.style = f.style; changed = true; }
      else if (f.style) { // per-field fill-in: size only if local has none
        const loc = GF.decodeStyle(ex.style), imp = GF.decodeStyle(f.style);
        if (!loc.fontSize && imp.fontSize) { ex.style = GF.encodeStyle({ ...loc, fontSize: imp.fontSize }); changed = true; }
      }
      if (changed) res.updated++;
      continue;
    }
    const order = Object.values(st.folders).filter(x => x.parentId === parentId).length;
    st.folders[f.id] = { id: f.id, name: f.name, parentId, order, color: f.color, tags: mapTags(f.tags), style: f.style };
    remap[f.id] = f.id; res.foldersAdded++;
  }
  for (const c of conversations) {
    const key = c.provider + ":" + c.convId;
    if (st.convs[key]) { res.conversationsSkipped++; if (union(st.convs[key], mapTags(c.tags))) res.updated++; continue; }
    const fid = remap[c.folderId];
    const order = Number.isFinite(c.order) ? c.order : sortedConvs(st, fid).length;
    st.convs[key] = { key, provider: c.provider, convId: c.convId, folderId: fid, title: c.title, order, tags: mapTags(c.tags) };
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
      if (result && result.changed === 0) return { ok: true, result }; // nothing changed: skip write
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
