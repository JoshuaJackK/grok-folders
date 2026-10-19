/* Shared constants (loaded in background and content scripts). */
var GF = globalThis.GF || (globalThis.GF = {});
GF.SCHEMA_VERSION = 3; // v2: conversation order; v3: folder color + tags
GF.MSG = {
  GET_STATE: "gf:getState",
  CREATE_FOLDER: "gf:createFolder",
  RENAME_FOLDER: "gf:renameFolder",
  DELETE_FOLDER: "gf:deleteFolder",
  MOVE_FOLDER: "gf:moveFolder",
  ASSIGN_CONV: "gf:assignConv",
  MOVE_CONV: "gf:moveConv",
  UNASSIGN_CONV: "gf:unassignConv",
  IMPORT: "gf:import",
  SET_COLOR: "gf:setColor",
  SET_STYLE: "gf:setStyle",
  CREATE_TAG: "gf:createTag",
  UPDATE_TAG: "gf:updateTag",
  DELETE_TAG: "gf:deleteTag",
  SET_TAGS: "gf:setTags",
  UPDATE_TITLES: "gf:updateTitles",
  STATE_CHANGED: "gf:stateChanged"
};
/* Color palette; stored as index (0 = none) to keep storage.sync compact. */
GF.PALETTE = [null, "#e5484d", "#f76b15", "#ffc53d", "#46a758", "#12a594", "#0090ff", "#3e63dd", "#8e4ec6", "#d6409f", "#8d8d8d"];
GF.colorIndex = (c) => {
  if (Number.isInteger(c) && c >= 0 && c < GF.PALETTE.length) return c;
  if (typeof c === "string") { const i = GF.PALETTE.indexOf(c.toLowerCase()); return i > 0 ? i : 0; }
  return 0;
};
GF.TITLE_MAX = 80; // stored title length (storage.sync quota)
/* Supported sites (keep in sync with manifest host_permissions / content_scripts.matches). */
GF.HOST_MATCHES = ["https://grok.com/*", "https://chatgpt.com/*", "https://claude.ai/*", "https://gemini.google.com/*", "https://www.perplexity.ai/*", "https://perplexity.ai/*", "https://x.com/*", "https://twitter.com/*"];
/* Font stacks (local fonts only). Order matters: folder style stores the 1-based index. */
GF.FONTS = {
  system: { label: "System", stack: 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif' },
  sans: { label: "Sans", stack: '"Helvetica Neue",Arial,"Liberation Sans","DejaVu Sans",sans-serif' },
  humanist: { label: "Humanist", stack: '"Segoe UI","Noto Sans",Ubuntu,Cantarell,"Open Sans",sans-serif' },
  rounded: { label: "Rounded", stack: 'ui-rounded,"SF Pro Rounded","Nunito","Varela Round",system-ui,sans-serif' },
  serif: { label: "Serif", stack: 'Georgia,Cambria,"Times New Roman","DejaVu Serif",serif' },
  mono: { label: "Mono", stack: 'ui-monospace,"SFMono-Regular",Menlo,Consolas,"DejaVu Sans Mono",monospace' }
};
GF.FONT_KEYS = Object.keys(GF.FONTS);
/* Folder name style packed in one small int (0 = default, omitted from storage):
 * bits 0-2 font index (0 = default, 1..6 = GF.FONT_KEYS[i-1]), bit 3 bold, bit 4 italic,
 * bits 5-8 font size code (0 = default, 1..15 = 10..24 px). */
GF.FOLDER_FS_MIN = 10; GF.FOLDER_FS_MAX = 24;
GF.cleanFontSize = (v) => (Number.isInteger(v) && v >= GF.FOLDER_FS_MIN && v <= GF.FOLDER_FS_MAX ? v : null);
GF.encodeStyle = ({ font = null, bold = false, italic = false, fontSize = null } = {}) => {
  const i = GF.FONT_KEYS.indexOf(font) + 1, fs = GF.cleanFontSize(fontSize);
  return (i > 0 ? i : 0) | (bold === true ? 8 : 0) | (italic === true ? 16 : 0) | ((fs ? fs - GF.FOLDER_FS_MIN + 1 : 0) << 5);
};
GF.decodeStyle = (n) => {
  n = Number.isInteger(n) && n > 0 && n < 512 ? n : 0;
  const i = n & 7, s = (n >> 5) & 15;
  return { font: i >= 1 && i <= GF.FONT_KEYS.length ? GF.FONT_KEYS[i - 1] : null, bold: !!(n & 8), italic: !!(n & 16),
    fontSize: s ? s + GF.FOLDER_FS_MIN - 1 : null };
};
GF.cleanStyle = (n) => GF.encodeStyle(GF.decodeStyle(n));
/* Conversation identity shared by grok.com and Grok inside X (0.5.5): both use the SAME UUID conversation ids
 * (grok.com/c/<uuid> == x.com/i/grok?conversation=<uuid>), so a UUID chat is stored once as "grok:<uuid>",
 * lowercase (grok.com's canonical form). Legacy numeric X ids stay "grokx:<id>". */
GF.UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
GF.canonConv = (provider, convId) => {
  const id = String(convId == null ? "" : convId);
  if ((provider === "grok" || provider === "grokx") && GF.UUID_RE.test(id)) return { provider: "grok", convId: id.toLowerCase() };
  return { provider, convId: id };
};
GF.canonKey = (key) => {
  const i = String(key).indexOf(":"); if (i < 0) return key;
  const c = GF.canonConv(key.slice(0, i), key.slice(i + 1)); return c.provider + ":" + c.convId;
};
/* Title quality for merges: 0 = empty / just the id, 1 = generic placeholder, 2 = real title. */
GF.TITLE_PLACEHOLDER_RE = /^(new chat|new conversation|untitled|grok|x|twitter|chat history|history|novi klepet|nov pogovor)$/i;
GF.titleScore = (t, convId) => {
  const s = String(t || "").trim();
  if (!s || s.toLowerCase() === String(convId || "").toLowerCase()) return 0;
  return GF.TITLE_PLACEHOLDER_RE.test(s) ? 1 : 2;
};
/*
 * Normalise conversation keys in a decoded state IN PLACE (idempotent). "grokx:<uuid>" (any case) and
 * "grok:<UUID>" become "grok:<uuid>". Duplicates collapse into ONE entry: the one already under the
 * canonical key wins (else the first by key); title = best score (tie: winner's), tags = union. A
 * conversation lives in exactly one folder in this data model, so the winner's folder is kept.
 * Returns the number of keys changed/merged (0 => nothing to save).
 */
GF.normalizeConvs = (st) => {
  const groups = new Map();
  for (const k of Object.keys(st.convs || {}).sort()) {
    const ck = GF.canonKey(k);
    if (!groups.has(ck)) groups.set(ck, []);
    groups.get(ck)[k === ck ? "unshift" : "push"](k);
  }
  let changed = 0; const touched = new Set();
  for (const [ck, keys] of groups) {
    if (keys.length === 1 && keys[0] === ck) continue;
    const entries = keys.map(k => st.convs[k]);
    const win = entries[0], { provider, convId } = GF.canonConv(win.provider, win.convId);
    let title = win.title || "";
    for (const e of entries.slice(1)) if (GF.titleScore(e.title, convId) > GF.titleScore(title, convId)) title = e.title;
    const tags = [...new Set(entries.flatMap(e => e.tags || []))];
    for (const k of keys) { touched.add(st.convs[k].folderId); delete st.convs[k]; }
    st.convs[ck] = { ...win, key: ck, provider, convId, title, tags };
    changed += keys.length - (keys[0] === ck ? 1 : 0);
  }
  for (const fid of touched) // dense, stable order within affected folders
    Object.values(st.convs).filter(c => c.folderId === fid).sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((c, i) => { c.order = i; });
  return changed;
};
