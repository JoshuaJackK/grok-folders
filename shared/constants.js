/* Shared constants (loaded in background and content scripts). */
var GF = globalThis.GF || (globalThis.GF = {});
GF.SCHEMA_VERSION = 2; // v2: conversations carry an order field
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
  STATE_CHANGED: "gf:stateChanged"
};
