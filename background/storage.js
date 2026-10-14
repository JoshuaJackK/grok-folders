/*
 * Storage model (sync-quota aware).
 *
 * storage.sync limits: 8192 B per item (key+JSON value), ~100 KB total, 512 items.
 * Layout:
 *   "meta" -> { v: schemaVersion, fc: <#folder chunks>, cc: <#conv chunks>, ts }
 *   "f0".."fN" -> { <folderId>: [name, parentId|null, order] }      (flat map)
 *   "c0".."cN" -> { "<provider>:<convId>": [folderId, title, order, tagIds?] } (v1 had no order)
 *   "t0".."tN" -> { <tagId>: [name, colorIdx] }                       (v3)
 * Folder tuple (v3): [name, parentId, order, colorIdx?, tagIds?]; trailing defaults
 * (color 0, no tags) are omitted to save bytes. Colors are palette indexes (GF.PALETTE).
 * Short keys + array tuples keep the payload small. Chunks are filled greedily
 * up to CHUNK_BYTES. Stale chunks beyond the new count are removed.
 * If the sync write fails (quota/unavailable) the same layout is written to
 * storage.local and meta.mode = "local" is recorded there.
 */
var GF = globalThis.GF;
GF.Storage = (() => {
  const CHUNK_BYTES = 7000;          // headroom under 8192
  const MAX_SYNC_BYTES = 95 * 1024;  // headroom under 102400
  let cache = null;                  // { folders: {}, convs: {} }
  let mode = "sync";
  let lastTs = 0;                    // ts of last write by this instance (ignore own onChanged)

  const bytes = (k, v) => new TextEncoder().encode(k + JSON.stringify(v)).length;

  function chunk(prefix, map) {
    const out = []; let cur = {}; let size = 2;
    for (const [k, v] of Object.entries(map)) {
      const s = bytes(k, v) + 4;
      if (size + s > CHUNK_BYTES && Object.keys(cur).length) { out.push(cur); cur = {}; size = 2; }
      cur[k] = v; size += s;
    }
    if (Object.keys(cur).length || !out.length) out.push(cur);
    const items = {};
    out.forEach((c, i) => { items[prefix + i] = c; });
    return items;
  }

  // Drop trailing default values (0 / empty array) beyond index `keep`.
  function trim(arr, keep) {
    while (arr.length > keep) { const v = arr[arr.length - 1]; if (v === 0 || v == null || (Array.isArray(v) && !v.length)) arr.pop(); else break; }
    return arr;
  }

  function encode(state) {
    const f = {}, c = {}, t = {};
    for (const [id, x] of Object.entries(state.folders)) f[id] = trim([x.name, x.parentId, x.order, x.color || 0, x.tags || []], 3);
    for (const [k, x] of Object.entries(state.convs)) c[k] = trim([x.folderId, x.title || "", x.order || 0, x.tags || []], 3);
    for (const [id, x] of Object.entries(state.tags || {})) t[id] = [x.name, x.color || 0];
    const fi = chunk("f", f), ci = chunk("c", c), ti = chunk("t", t);
    const meta = { v: GF.SCHEMA_VERSION, fc: Object.keys(fi).length, cc: Object.keys(ci).length, tc: Object.keys(ti).length, ts: Date.now() };
    return { meta, ...fi, ...ci, ...ti };
  }

  function decode(all) {
    const st = { folders: {}, convs: {}, tags: {} };
    const meta = all.meta; if (!meta) return st;
    for (let i = 0; i < (meta.tc || 0); i++) for (const [id, t] of Object.entries(all["t" + i] || {}))
      st.tags[id] = { id, name: t[0], color: t[1] || 0 };
    const tagList = (a) => Array.isArray(a) ? a.filter(id => st.tags[id]) : [];
    for (let i = 0; i < meta.fc; i++) for (const [id, t] of Object.entries(all["f" + i] || {}))
      st.folders[id] = { id, name: t[0], parentId: t[1], order: t[2] || 0, color: t[3] || 0, tags: tagList(t[4]) };
    for (let i = 0; i < meta.cc; i++) for (const [k, t] of Object.entries(all["c" + i] || {})) {
      const [provider, ...rest] = k.split(":");
      st.convs[k] = { key: k, provider, convId: rest.join(":"), folderId: t[0], title: t[1], order: Number.isFinite(t[2]) ? t[2] : 0, tags: tagList(t[3]) };
    }
    return st;
  }

  /* Migration hook: transform raw stored items from older schema versions. */
  const MIGRATIONS = {
    // v1 -> v2: add per-folder conversation order (existing stored sequence, preserved).
    1: (all) => {
      const next = {};
      for (let i = 0; i < all.meta.cc; i++) {
        const ch = all["c" + i] || {};
        for (const k of Object.keys(ch)) {
          const t = ch[k], fid = t[0];
          next[fid] = next[fid] || 0;
          ch[k] = [t[0], t[1] || "", next[fid]++];
        }
      }
      all.meta = { ...all.meta, v: 2 };
      return all;
    },
    // v2 -> v3: add (empty) tag chunk table; folder/conv tuples are forward-compatible.
    2: (all) => { all.meta = { ...all.meta, v: 3, tc: all.meta.tc || 0 }; return all; }
  };
  function migrate(all) {
    while (all.meta && all.meta.v < GF.SCHEMA_VERSION) {
      const fn = MIGRATIONS[all.meta.v];
      if (!fn) throw new Error("No migration from v" + all.meta.v);
      all = fn(all);
    }
    return all;
  }

  /* Returns true if every chunk referenced by meta is present. */
  function complete(all) {
    const m = all && all.meta; if (!m) return false;
    for (let i = 0; i < m.fc; i++) if (!all["f" + i]) return false;
    for (let i = 0; i < m.cc; i++) if (!all["c" + i]) return false;
    for (let i = 0; i < (m.tc || 0); i++) if (!all["t" + i]) return false;
    return true;
  }

  /*
   * Load picks the most recent COMPLETE copy among sync and local (by meta.ts).
   * - A read error is NOT treated as "empty": if neither area can be read, load throws
   *   and the background refuses writes (prevents overwriting good data with {}).
   * - An incomplete sync copy (chunks still arriving) is skipped in favour of local.
   */
  async function load() {
    let sync = null, local = null;
    try { sync = await browser.storage.sync.get(null); } catch (e) { console.warn("[GF] sync get failed", e); }
    try { local = await browser.storage.local.get(null); } catch (e) { console.warn("[GF] local get failed", e); }
    if (!sync && !local) throw new Error("storage unreadable");
    const cands = [];
    if (complete(sync)) cands.push({ area: "sync", all: sync });
    if (complete(local)) cands.push({ area: "local", all: local });
    cands.sort((x, y) => (y.all.meta.ts || 0) - (x.all.meta.ts || 0));
    const pick = cands[0];
    if (!pick && ((sync && sync.meta) || (local && local.meta)))
      throw new Error("stored data incomplete; refusing to load as empty");
    mode = pick && pick.area === "local" && local.mode === "local" ? "local" : "sync";
    cache = pick ? decode(migrate(pick.all)) : { folders: {}, convs: {}, tags: {} };
    lastTs = pick ? pick.all.meta.ts : 0;
    console.info("[GF] loaded from", pick ? pick.area : "(empty)", Object.keys(cache.folders).length, "folders");
    return cache;
  }

  async function write(area, items, prevKeys) {
    const stale = prevKeys.filter(k => /^[fct]\d+$/.test(k) && !(k in items));
    await browser.storage[area].set(items);
    if (stale.length) await browser.storage[area].remove(stale);
  }

  /* Always mirrors to storage.local (backup + fallback), then tries storage.sync. */
  async function save(state) {
    const items = encode(state);
    lastTs = items.meta.ts;
    const total = Object.entries(items).reduce((s, [k, v]) => s + bytes(k, v), 0);
    const tooBig = total > MAX_SYNC_BYTES || Object.keys(items).length > 500;
    let newMode = "sync";
    try {
      if (tooBig) throw new Error("sync quota would be exceeded (" + total + " B)");
      await write("sync", items, Object.keys(await browser.storage.sync.get(null)));
    } catch (e) {
      console.warn("[GF] sync write failed, using storage.local:", e.message);
      newMode = "local";
    }
    await write("local", { ...items, mode: newMode }, Object.keys(await browser.storage.local.get(null)));
    mode = newMode; cache = state;
    return state;
  }

  return { load, save, get: () => cache, getMode: () => mode, getLastTs: () => lastTs };
})();
