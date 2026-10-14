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
GF.HOST_MATCHES = ["https://grok.com/*", "https://chatgpt.com/*", "https://claude.ai/*", "https://gemini.google.com/*", "https://www.perplexity.ai/*", "https://perplexity.ai/*"];
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
 * bits 0-2 font index (0 = default, 1..6 = GF.FONT_KEYS[i-1]), bit 3 bold, bit 4 italic. */
GF.encodeStyle = ({ font = null, bold = false, italic = false } = {}) => {
  const i = GF.FONT_KEYS.indexOf(font) + 1;
  return (i > 0 ? i : 0) | (bold ? 8 : 0) | (italic ? 16 : 0);
};
GF.decodeStyle = (n) => {
  n = Number.isInteger(n) && n > 0 && n < 32 ? n : 0;
  const i = n & 7;
  return { font: i >= 1 && i <= GF.FONT_KEYS.length ? GF.FONT_KEYS[i - 1] : null, bold: !!(n & 8), italic: !!(n & 16) };
};
GF.cleanStyle = (n) => GF.encodeStyle(GF.decodeStyle(n));
