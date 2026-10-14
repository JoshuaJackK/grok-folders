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
