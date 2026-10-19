/* Sidebar UI inside a closed shadow root (style isolation from the host site). No innerHTML. */
var GF = globalThis.GF;
/* Position tweaks: toggle button sits top-left next to Grok's own menu/logo. */
const GF_POS = {
  left: 60, top: 12,          // default position (top-left, beside Grok's menu); double-click resets here
  size: 36,                   // toggle button size (px)
  panelGap: 8,                // gap between button and panel
  panelWidth: 300,
  panelMinHeight: 260,        // prefer opening below if at least this much room
  margin: 4,                  // min distance from viewport edges
  dragThreshold: 4,           // px of movement before a press becomes a drag
  autoExpandMs: 600,          // hover time before a collapsed folder opens during drag
  storageKey: "uiPos",        // storage.local key: button position (per-device)
  uiStateKey: "uiState",      // storage.local key: { open, collapsed[] } (survives navigation + reloads)
  sizeKey: "uiSize",          // storage.local key: { w, h } panel size (per device); h null = auto
  minW: 220, maxW: 800, minH: 200, maxH: 1200,
  prefsKey: "uiPrefs",        // storage.sync key: { fs, ff } font prefs (tiny; follows the user)
  fontMin: 11, fontMax: 18, fontDefault: 13
};
GF.Sidebar = class {
  constructor(adapter, api) {
    this.adapter = adapter; this.api = api;
    this.state = { folders: {}, convs: {}, tags: {} }; this.mode = "sync";
    this.query = ""; this.tagFilter = null; this.providerFilter = null; this.collapsed = new Set(); this.selected = null;
    this.layer = document.createElement("div"); // modal layer, survives re-renders
    this.live = null;                              // refresh fn of an open live modal
    const host = document.createElement("div");
    host.id = "grok-folders-host";
    host.style.cssText = "position:fixed;top:0;left:0;z-index:2147483646;";
    document.documentElement.appendChild(host);
    this.host = host;
    this.root = host.attachShadow({ mode: "closed" });
    // Keep keystrokes inside the panel: from outside, events are retargeted to the host <div>, so
    // page-level "type anywhere to focus the composer" handlers would otherwise steal focus.
    for (const t of ["keydown", "keyup", "keypress", "beforeinput", "input", "paste", "cut", "copy", "compositionstart", "compositionupdate", "compositionend"])
      host.addEventListener(t, (e) => e.stopPropagation());
    this.root.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.panel.classList.contains("open") && !this.layer.childElementCount) this.setOpen(false);
    });
    const style = document.createElement("style");
    style.textContent = GF.Sidebar.CSS;
    this.root.appendChild(style);
    this.toggle = this.el("button", { className: "toggle", title: "AI Folders", textContent: "📁" });
    this.panel = this.el("div", { className: "panel" });
    this.root.append(this.toggle, this.panel);
    this.pos = { left: GF_POS.left, top: GF_POS.top };
    this.initDrag();
    this.size = { w: GF_POS.panelWidth, h: null };
    this.prefs = { fs: GF_POS.fontDefault, ff: "system" };
    this.handles = ["r", "b", "br"].map(d => this.initResizeHandle(d));
    this.restoreUiState();
    this.restoreSize();
    this.restorePrefs();
  }

  /* ---- Resizable panel (handles: right edge, bottom edge, bottom-right corner) ---- */
  initResizeHandle(dir) {
    const h = this.el("div", { className: "rz rz-" + dir, title: "Drag to resize · double-click to reset" });
    let start = null;
    h.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const r = this.panel.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, w: this.size.w, h: this.size.h || Math.round(r.height) || 400 };
      try { h.setPointerCapture(e.pointerId); } catch (_) { /* jsdom */ }
    });
    h.addEventListener("pointermove", (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      this.applySize({ w: dir === "b" ? start.w : start.w + dx, h: dir === "r" ? this.size.h : start.h + dy });
    });
    const end = () => { if (start) { start = null; this.saveSize(); } };
    h.addEventListener("pointerup", end);
    h.addEventListener("pointercancel", end);
    h.addEventListener("dblclick", (e) => { e.stopPropagation(); this.applySize({ w: GF_POS.panelWidth, h: null }); this.saveSize(); });
    return h;
  }
  clampSize(sz) {
    const m = GF_POS.margin, vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.round(Math.min(Math.max(GF_POS.minW, sz.w || GF_POS.panelWidth), GF_POS.maxW, Math.max(GF_POS.minW, vw - 2 * m)));
    const h = sz.h == null ? null : Math.round(Math.min(Math.max(GF_POS.minH, sz.h), GF_POS.maxH, Math.max(GF_POS.minH, vh - 2 * m)));
    return { w, h };
  }
  applySize(sz) { this.size = this.clampSize(sz); if (this.isOpen()) this.placePanel(); }
  saveSize() { browser.storage.local.set({ [GF_POS.sizeKey]: this.size }).catch(() => {}); }
  async restoreSize() {
    try {
      const r = await browser.storage.local.get(GF_POS.sizeKey);
      const v = r && r[GF_POS.sizeKey];
      if (v && Number.isFinite(v.w)) this.applySize({ w: v.w, h: Number.isFinite(v.h) ? v.h : null });
    } catch (_) { /* ignore */ }
  }

  /* ---- Font preferences (storage.sync, tiny) ---- */
  applyPrefs(p) {
    const fs = Math.min(GF_POS.fontMax, Math.max(GF_POS.fontMin, Math.round(Number(p && p.fs) || GF_POS.fontDefault)));
    const ff = GF.Sidebar.FONTS[p && p.ff] ? p.ff : "system";
    this.prefs = { fs, ff };
    this.panel.style.setProperty("--gf-fs", fs + "px");
    this.panel.style.setProperty("--gf-ff", GF.Sidebar.FONTS[ff].stack);
  }
  savePrefs() { browser.storage.sync.set({ [GF_POS.prefsKey]: this.prefs }).catch(() => browser.storage.local.set({ [GF_POS.prefsKey]: this.prefs }).catch(() => {})); }
  async restorePrefs() {
    let v = null;
    try { v = (await browser.storage.sync.get(GF_POS.prefsKey))[GF_POS.prefsKey]; } catch (_) { /* sync unavailable */ }
    if (!v) { try { v = (await browser.storage.local.get(GF_POS.prefsKey))[GF_POS.prefsKey]; } catch (_) { /* ignore */ } }
    this.applyPrefs(v || this.prefs);
    if (browser.storage.onChanged) browser.storage.onChanged.addListener((ch, area) => {
      if (area === "sync" && ch[GF_POS.prefsKey] && ch[GF_POS.prefsKey].newValue) this.applyPrefs(ch[GF_POS.prefsKey].newValue);
    });
  }
  openSettings() {
    this.modal((card, close) => {
      const val = this.el("span", { className: "cnt", textContent: this.prefs.fs + "px" });
      const range = this.el("input", { type: "range", min: GF_POS.fontMin, max: GF_POS.fontMax, step: 1, value: this.prefs.fs, title: "Font size" });
      range.oninput = () => { this.applyPrefs({ ...this.prefs, fs: +range.value }); val.textContent = this.prefs.fs + "px"; };
      range.onchange = () => this.savePrefs();
      const fam = this.el("select", { className: "tagsel", title: "Font" },
        ...Object.entries(GF.Sidebar.FONTS).map(([k, f]) => this.el("option", { value: k, textContent: f.label, selected: k === this.prefs.ff })));
      fam.onchange = () => { this.applyPrefs({ ...this.prefs, ff: fam.value }); this.savePrefs(); };
      const reset = this.el("button", { textContent: "Reset" });
      reset.onclick = () => { this.applyPrefs({ fs: GF_POS.fontDefault, ff: "system" }); range.value = this.prefs.fs; fam.value = "system"; val.textContent = this.prefs.fs + "px"; this.savePrefs(); };
      const done = this.el("button", { textContent: "Close" }); done.onclick = () => close();
      card.append(this.el("b", { textContent: "Settings" }),
        this.el("div", { className: "row" }, this.el("span", { textContent: "Size" }), range, val),
        this.el("div", { className: "row" }, this.el("span", { textContent: "Font" }), fam),
        this.el("div", { className: "row" }, reset, done));
    });
  }

  /* ---- Collapse / expand all ---- */
  collapseAll() { this.collapsed = new Set(Object.keys(this.state.folders)); this.saveUiState(); this.renderTree(); }
  expandAll() { this.collapsed = new Set(); this.saveUiState(); this.renderTree(); }

  /* ---- Persistent UI state (panel open + collapsed folders) ---- */
  async restoreUiState() {
    try {
      const r = await browser.storage.local.get(GF_POS.uiStateKey);
      const u = r && r[GF_POS.uiStateKey];
      if (u) {
        if (Array.isArray(u.collapsed)) this.collapsed = new Set(u.collapsed);
        if (u.open) this.setOpen(true, false);
        if (this.tree) this.renderTree();
      }
    } catch (_) { /* ignore */ }
  }
  saveUiState() {
    browser.storage.local.set({ [GF_POS.uiStateKey]: { open: this.panel.classList.contains("open"), collapsed: [...this.collapsed] } }).catch(() => {});
  }
  setOpen(open, save = true) {
    this.panel.classList.toggle("open", open);
    if (open) this.placePanel();
    if (save) this.saveUiState();
  }
  toggleCollapsed(id, collapsed) {
    collapsed ? this.collapsed.add(id) : this.collapsed.delete(id);
    this.saveUiState(); this.renderTree();
  }
  /* Re-attach the host if the page re-renders and drops it. */
  ensureMounted() { if (!this.host.isConnected) (document.documentElement || document).appendChild(this.host); }

  /* ---- Focus preservation across re-renders (inputs carry data-fk keys) ---- */
  snapFocus() {
    const a = this.root.activeElement;
    if (!a || !a.dataset || !a.dataset.fk) return null;
    return { fk: a.dataset.fk, value: a.value, ss: a.selectionStart, se: a.selectionEnd };
  }
  restoreFocus(snap) {
    if (!snap) return;
    const el = this.root.querySelector(`[data-fk="${snap.fk}"]`);
    if (!el) return;
    if (el.value !== snap.value) el.value = snap.value; // keep uncommitted typing
    if (this.root.activeElement !== el) el.focus({ preventScroll: true });
    try { el.setSelectionRange(snap.ss, snap.se); } catch (_) { /* not a text input */ }
  }
  preserving(fn) { const s = this.snapFocus(); fn(); this.restoreFocus(s); }

  /* ---- Draggable toggle button; position persisted per-device in storage.local ---- */
  initDrag() {
    const t = this.toggle;
    let start = null, dragging = false;
    t.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, left: this.pos.left, top: this.pos.top };
      dragging = false; t.setPointerCapture(e.pointerId);
    });
    t.addEventListener("pointermove", (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!dragging && Math.hypot(dx, dy) < GF_POS.dragThreshold) return;
      dragging = true; t.classList.add("dragging");
      this.applyPos({ left: start.left + dx, top: start.top + dy });
    });
    const end = (e) => {
      if (!start) return;
      start = null; t.classList.remove("dragging");
      try { t.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
      if (dragging) this.savePos(); else this.togglePanel();
    };
    t.addEventListener("pointerup", end);
    t.addEventListener("pointercancel", (e) => { dragging = true; end(e); });
    t.addEventListener("dblclick", () => { this.applyPos({ left: GF_POS.left, top: GF_POS.top }); this.savePos(); });
    window.addEventListener("resize", () => this.applyPos(this.pos));
    browser.storage.local.get(GF_POS.storageKey).then((r) => {
      const p = r && r[GF_POS.storageKey];
      this.applyPos(p && Number.isFinite(p.left) && Number.isFinite(p.top) ? p : this.pos);
    }).catch(() => this.applyPos(this.pos));
    this.applyPos(this.pos);
  }
  clamp(p) {
    const m = GF_POS.margin, s = GF_POS.size;
    return {
      left: Math.round(Math.min(Math.max(m, p.left), Math.max(m, window.innerWidth - s - m))),
      top: Math.round(Math.min(Math.max(m, p.top), Math.max(m, window.innerHeight - s - m)))
    };
  }
  applyPos(p) {
    this.pos = this.clamp(p);
    this.toggle.style.left = this.pos.left + "px";
    this.toggle.style.top = this.pos.top + "px";
    if (this.panel.classList.contains("open")) this.placePanel();
  }
  savePos() { browser.storage.local.set({ [GF_POS.storageKey]: this.pos }).catch(() => {}); }
  togglePanel() { this.setOpen(!this.panel.classList.contains("open")); }
  /* Open below the button (or above if no room); left-aligned (or right-aligned if near right edge). */
  placePanel() {
    const { left, top } = this.pos, s = GF_POS.size, g = GF_POS.panelGap, m = GF_POS.margin;
    const vw = window.innerWidth, vh = window.innerHeight, P = this.panel.style;
    const w = Math.min(this.size ? this.size.w : GF_POS.panelWidth, vw - 2 * m);
    P.width = w + "px";
    const x = left + w > vw - m ? left + s - w : left;
    P.left = Math.max(m, Math.min(x, vw - w - m)) + "px";
    const below = vh - (top + s + g) - m, above = top - g - m;
    P.top = P.bottom = "";
    const want = this.size && this.size.h;
    let room;
    if (below >= (want || GF_POS.panelMinHeight) || below >= above) { P.top = (top + s + g) + "px"; room = Math.max(below, 120); }
    else { P.bottom = (vh - top + g) + "px"; room = above; }
    P.maxHeight = room + "px";
    P.height = want ? Math.min(want, room) + "px" : "";
  }
  el(tag, props = {}, ...kids) { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; }
  setState(state, mode) {
    this.state = state || {}; for (const k of ["folders", "convs", "tags"]) this.state[k] = this.state[k] || {};
    if (this.tagFilter && !this.state.tags[this.tagFilter]) this.tagFilter = null;
    this.mode = mode || this.mode; this.render(); if (this.live) this.preserving(this.live);
  }
  async call(type, payload) { const r = await this.api(type, payload); if (!r.ok) alert("AI Folders: " + r.error); return r; }

  children(pid) { return Object.values(this.state.folders).filter(f => f.parentId === pid).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)); }
  convsIn(fid) { return Object.values(this.state.convs).filter(c => c.folderId === fid).sort((a, b) => (a.order || 0) - (b.order || 0) || a.title.localeCompare(b.title)); }
  /* Search matches titles, folder names and tag names; tag/provider filters narrow the result. */
  filtering() { return !!(this.query || this.tagFilter || this.providerFilter); }
  tagNames(x) { return (x.tags || []).map(id => (this.state.tags[id] || {}).name || "").join(" ").toLowerCase(); }
  hasFilterTag(x) { return !this.tagFilter || (x.tags || []).includes(this.tagFilter); }
  textHit(x, text) { const q = this.query.toLowerCase(); return !q || text.toLowerCase().includes(q) || this.tagNames(x).includes(q); }
  folderSelfMatch(f) { return !!(this.query || this.tagFilter) && this.textHit(f, f.name) && this.hasFilterTag(f); }
  convMatch(c, f) {
    if (this.providerFilter && c.provider !== this.providerFilter) return false;
    if (!this.query && !this.tagFilter) return true;
    if (this.folderSelfMatch(f)) return true;
    return this.textHit(c, c.title || "") && this.hasFilterTag(c);
  }
  matchesSearch(f) {
    if (!this.filtering()) return true;
    const self = this.folderSelfMatch(f) && (!this.providerFilter || this.convsIn(f.id).some(c => this.convMatch(c, f)));
    return self || this.convsIn(f.id).some(c => this.convMatch(c, f)) || this.children(f.id).some(ch => this.matchesSearch(ch));
  }
  render() {
    const M = GF.MSG;
    const snap = this.snapFocus();
    const search = this.el("input", { type: "search", placeholder: "Search titles / tags…", value: this.query });
    search.dataset.fk = "search";
    const tf = this.el("select", { className: "tagsel", title: "Filter by tag" },
      this.el("option", { value: "", textContent: "All tags" }),
      ...Object.values(this.state.tags).sort((a, b) => a.name.localeCompare(b.name)).map(t => this.el("option", { value: t.id, textContent: "# " + t.name, selected: t.id === this.tagFilter })));
    tf.onchange = () => { this.tagFilter = tf.value || null; this.render(); };
    const pf = this.el("select", { className: "tagsel", title: "Filter by AI" },
      this.el("option", { value: "", textContent: "All AIs" }),
      ...GF.adapters.map(a => this.el("option", { value: a.id, textContent: a.label, selected: a.id === this.providerFilter })));
    pf.onchange = () => { this.providerFilter = pf.value || null; this.render(); };
    const tagsBtn = this.el("button", { textContent: "Tags", title: "Manage tags" });
    tagsBtn.onclick = () => this.manageTags();
    search.oninput = () => { this.query = search.value; this.renderTree(); };
    const newRoot = this.el("button", { textContent: "+ Folder" });
    newRoot.onclick = async () => { const n = prompt("Folder name"); if (n) await this.call(M.CREATE_FOLDER, { name: n, parentId: null }); };
    const addCur = this.el("button", { textContent: "+ Current chat", title: "Add current conversation to selected folder" });
    addCur.onclick = () => this.addCurrent();
    const exp = this.el("button", { textContent: "Export", title: "Download JSON backup" });
    exp.onclick = () => this.exportJson();
    const imp = this.el("button", { textContent: "Import", title: "Import JSON backup" });
    const file = this.el("input", { type: "file", accept: "application/json,.json", hidden: true });
    imp.onclick = () => file.click();
    file.onchange = () => { const f = file.files[0]; file.value = ""; if (f) this.importJson(f); };
    this.tree = this.el("div", { className: "tree" });
    const footer = this.el("div", { className: "footer", textContent: "storage: " + this.mode });
    const hb = (t, title, fn) => { const b = this.el("button", { className: "mini hbtn", textContent: t, title }); b.onclick = fn; return b; };
    const head = this.el("div", { className: "head" }, this.el("b", { textContent: "AI Folders" }),
      hb("⊟", "Collapse all folders", () => this.collapseAll()),
      hb("⊞", "Expand all folders", () => this.expandAll()),
      hb("⚙", "Settings (font)", () => this.openSettings()));
    this.panel.replaceChildren(head, this.el("div", { className: "row" }, search), this.el("div", { className: "row" }, tf, pf), this.el("div", { className: "row" }, newRoot, addCur), this.el("div", { className: "row" }, exp, imp, tagsBtn, file), this.tree, footer, this.layer, ...this.handles);
    this.renderTree();
    this.restoreFocus(snap);
  }

  renderTree() {
    const build = (pid, depth) => this.children(pid).filter(f => this.matchesSearch(f)).map(f => this.folderNode(f, depth, build));
    const nodes = build(null, 0);
    const rootZone = this.el("div", { className: "rootzone", textContent: "⤒ Top level (drop folder here)" });
    this.dropTarget(rootZone, () => "root", (e) => this.handleDrop(e, { type: "root" }));
    this.tree.replaceChildren(rootZone, ...(nodes.length ? nodes : [this.el("div", { className: "empty", textContent: this.filtering() ? "No matches" : "No folders yet" })]));
  }

  /* ---- Drag & drop inside the tree ----
   * this.drag = { kind: "folder"|"conv", id } for internal drags; null for external (Grok page links).
   * Zones: folder row top 25% = before, bottom 25% = after, middle = inside; conv row top/bottom half. */
  zone(e, el, kind) {
    const r = el.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
    if (kind === "conv") return y < 0.5 ? "before" : "after";
    return y < 0.25 ? "before" : y > 0.75 ? "after" : "inside";
  }
  clearIndicators() { this.tree.querySelectorAll(".over,.drop-before,.drop-after").forEach(x => x.classList.remove("over", "drop-before", "drop-after")); }
  dropTarget(el, getZone, onDrop, onHover) {
    el.addEventListener("dragover", (e) => {
      const z = getZone(e); if (!z) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = this.drag ? "move" : "copy";
      this.clearIndicators();
      el.classList.add(z === "before" ? "drop-before" : z === "after" ? "drop-after" : "over");
      if (onHover) onHover(z);
    });
    el.addEventListener("dragleave", (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove("over", "drop-before", "drop-after"); });
    el.addEventListener("drop", (e) => { const z = getZone(e); if (!z) return; e.preventDefault(); e.stopPropagation(); this.clearIndicators(); clearTimeout(this.expandTimer); onDrop(e, z); this.drag = null; });
  }
  dragSource(el, kind, id) {
    el.draggable = true;
    el.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      this.drag = { kind, id };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(kind === "conv" ? "application/x-gf-conv-key" : "application/x-gf-folder", id);
      e.dataTransfer.setData("text/plain", kind + ":" + id);
    });
    el.addEventListener("dragend", () => { this.drag = null; this.clearIndicators(); clearTimeout(this.expandTimer); });
  }

  folderNode(f, depth, build) {
    const M = GF.MSG;
    const open = !this.collapsed.has(f.id) || this.filtering();
    const caret = this.el("span", { className: "caret", textContent: open ? "▾" : "▸" });
    caret.onclick = (e) => { e.stopPropagation(); this.toggleCollapsed(f.id, !this.collapsed.has(f.id)); };
    const btn = (t, title, fn) => { const b = this.el("button", { className: "mini", textContent: t, title }); b.onclick = (e) => { e.stopPropagation(); fn(); }; return b; };
    const label = this.el("div", { className: "folder" + (this.selected === f.id ? " sel" : "") },
      caret, this.folderIcon(f), GF.Sidebar.styleName(this.el("span", { className: "name", textContent: f.name }), GF.decodeStyle(f.style)), this.chips(f),
      btn("#", "Tags", () => this.editTags("folder", f.id, f.tags)),
      btn("+", "Subfolder", async () => { const n = prompt("Subfolder name"); if (n) await this.call(M.CREATE_FOLDER, { name: n, parentId: f.id }); }),
      btn("✎", "Rename", async () => { const n = prompt("Rename", f.name); if (n) await this.call(M.RENAME_FOLDER, { id: f.id, name: n }); }),
      btn("🗑", "Delete (recursive)", async () => { if (confirm(`Delete "${f.name}" with all subfolders?`)) await this.call(M.DELETE_FOLDER, { id: f.id }); }));
    label.style.paddingLeft = (4 + depth * 12) + "px";
    label.onclick = () => { this.selected = f.id; this.renderTree(); };
    label.dataset.fid = f.id;
    this.dragSource(label, "folder", f.id);
    this.dropTarget(label,
      (e) => {
        if (this.drag && this.drag.kind === "folder" && this.drag.id === f.id) return null;
        return this.drag && this.drag.kind === "folder" ? this.zone(e, label, "folder") : "inside"; // convs/links go into folder
      },
      (e, z) => this.handleDrop(e, { type: "folder", id: f.id, position: z }),
      (z) => { // auto-expand collapsed folder after hovering ~600ms
        if (z !== "inside" || !this.collapsed.has(f.id)) { clearTimeout(this.expandTimer); this.expandFor = null; return; }
        if (this.expandFor === f.id) return;
        clearTimeout(this.expandTimer); this.expandFor = f.id;
        this.expandTimer = setTimeout(() => { this.expandFor = null; this.toggleCollapsed(f.id, false); }, GF_POS.autoExpandMs);
      });
    const wrap = this.el("div", {}, label);
    if (open) {
      for (const c of this.convsIn(f.id)) {
        if (!this.convMatch(c, f)) continue;
        const prov = GF.adapterById(c.provider);
        const badge = this.el("span", { className: "badge", textContent: prov ? prov.badge.text : c.provider.slice(0, 3), title: prov ? prov.label : c.provider });
        if (prov) badge.style.background = prov.badge.color;
        const a = this.el("a", { className: "conv", href: prov ? prov.conversationUrl(c.convId) : "#", title: (prov ? prov.label + ": " : "") + c.title },
          badge, this.el("span", { className: "name", textContent: c.title || c.convId }), this.chips(c));
        const tg = this.el("button", { className: "mini", textContent: "#", title: "Tags" });
        tg.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.editTags("conv", c.key, c.tags); };
        a.append(tg);
        a.style.paddingLeft = (20 + depth * 12) + "px";
        // Plain left click: navigate inside Grok's SPA (keeps panel + page state). Modified clicks behave natively.
        a.addEventListener("click", (e) => {
          if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          if (c.provider === this.adapter.id) this.adapter.navigate(c.convId);      // same site: in-app navigation
          else if (prov) window.open(prov.conversationUrl(c.convId), "_blank", "noopener"); // other AI: new tab
        });
        const x = this.el("button", { className: "mini", textContent: "✕", title: "Remove from folder" });
        x.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.call(M.UNASSIGN_CONV, { key: c.key }); };
        a.append(x);
        a.dataset.ckey = c.key; a.dataset.fid = f.id;
        this.dragSource(a, "conv", c.key);
        this.dropTarget(a,
          (e) => (this.drag && this.drag.kind === "folder") ? null : this.zone(e, a, "conv"),
          (e, z) => this.handleDrop(e, { type: "conv", key: c.key, folderId: f.id, position: z }));
        wrap.append(a);
      }
      wrap.append(...build(f.id, depth + 1));
    }
    return wrap;
  }

  /* target: {type:"root"} | {type:"folder", id, position} | {type:"conv", key, folderId, position} */
  async handleDrop(e, target) {
    const M = GF.MSG, dt = e.dataTransfer;
    const drag = this.drag || (() => {
      const fid = dt.getData("application/x-gf-folder"), ck = dt.getData("application/x-gf-conv-key");
      if (fid) return { kind: "folder", id: fid };
      if (ck && this.state.convs[ck]) return { kind: "conv", id: ck };
      return null;
    })();
    if (drag && drag.kind === "folder") {
      if (target.type === "root") return this.call(M.MOVE_FOLDER, { id: drag.id, position: "root" });
      if (target.type === "folder") return this.call(M.MOVE_FOLDER, { id: drag.id, targetId: target.id, position: target.position });
      return;
    }
    if (target.type === "root") return;
    const folderId = target.type === "folder" ? target.id : target.folderId;
    const pos = target.type === "conv" ? { targetKey: target.key, position: target.position } : {};
    if (drag && drag.kind === "conv") {
      if (drag.id === target.key) return;
      return this.call(M.MOVE_CONV, { key: drag.id, folderId, ...pos });
    }
    // External drop: a conversation link from a site sidebar (annotated by content/dnd.js) or any supported AI URL.
    const info = GF.Sidebar.infoFromDataTransfer(dt, this.adapter);
    if (!info) { console.info("[AI Folders] drop ignored: no conversation URL in", [...(dt.types || [])]); return; }
    return this.dropExternal(info, target);
  }

  /* Assign an external conversation {provider, convId, title} at a drop target. */
  async dropExternal(info, target) {
    if (!target || target.type === "root") return;
    const folderId = target.type === "folder" ? target.id : target.folderId;
    const pos = target.type === "conv" ? { targetKey: target.key, position: target.position } : {};
    console.info("[AI Folders] add", info.provider + ":" + info.convId, "->", folderId);
    return this.call(GF.MSG.ASSIGN_CONV, { provider: info.provider, convId: info.convId, title: info.title || info.convId, folderId, ...pos });
  }

  /* ---- Pointer-drag fallback support (used by content/dnd.js when native DnD doesn't start) ---- */
  isOpen() { return this.panel.classList.contains("open"); }
  targetFromPoint(x, y) {
    const el = this.root.elementFromPoint ? this.root.elementFromPoint(x, y) : null;
    if (!el || !this.tree || !this.tree.contains(el)) return null;
    const conv = el.closest("a.conv"), folder = el.closest(".folder");
    if (conv) { const r = conv.getBoundingClientRect(); return { type: "conv", key: conv.dataset.ckey, folderId: conv.dataset.fid, position: y < r.top + r.height / 2 ? "before" : "after", el: conv }; }
    if (folder) return { type: "folder", id: folder.dataset.fid, position: "inside", el: folder };
    return null;
  }
  highlight(target) {
    this.clearIndicators();
    if (target && target.el) target.el.classList.add(target.type === "conv" ? (target.position === "before" ? "drop-before" : "drop-after") : "over");
  }
  showGhost(text, x, y) {
    if (!this.ghost) { this.ghost = this.el("div", { className: "ghost" }); this.root.appendChild(this.ghost); }
    this.ghost.textContent = text; this.ghost.style.left = (x + 12) + "px"; this.ghost.style.top = (y + 8) + "px";
  }
  hideGhost() { if (this.ghost) { this.ghost.remove(); this.ghost = null; } this.clearIndicators(); }

  /* ---- JSON export / import ---- */
  exportJson() {
    const data = {
      app: "grok-folders", schema: GF.SCHEMA_VERSION, exportedAt: new Date().toISOString(),
      tags: Object.values(this.state.tags).map(({ id, name, color }) => ({ id, name, color: GF.PALETTE[color] || null })),
      folders: Object.values(this.state.folders).map(({ id, name, parentId, order, color, tags, style }) => ({ id, name, parentId, order, color: GF.PALETTE[color] || null, tags: tags || [], ...GF.decodeStyle(style) })),
      conversations: Object.values(this.state.convs).map(({ provider, convId, folderId, title, order, tags }) => ({ provider, convId, folderId, title, order, tags: tags || [] }))
    };
    const d = new Date(), pad = (n) => String(n).padStart(2, "0");
    const name = `grok-folders-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = this.el("a", { href: url, download: name });
    this.root.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async importJson(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { return this.dialog("Invalid JSON: " + e.message, [["OK", null]]); }
    if (!data || data.app !== "grok-folders" || !Array.isArray(data.folders) || !Array.isArray(data.conversations))
      return this.dialog("This is not an AI Folders export file.", [["OK", null]]);
    const mode = await this.dialog(
      `Import ${data.folders.length} folders and ${data.conversations.length} conversations from "${file.name}".\n` +
      "Replace: delete current data first. Merge: keep existing, add only new folders/conversations (safe to repeat).",
      [["Merge", "merge"], ["Replace", "replace"], ["Cancel", null]]);
    if (!mode) return;
    if (mode === "replace" && !(await this.dialog("Really delete all current folders and replace them?", [["Replace", true], ["Cancel", null]]))) return;
    const r = await this.call(GF.MSG.IMPORT, { data, mode });
    if (r.ok) this.dialog(`Tags: ${r.result.tagsAdded} added, ${r.result.tagsSkipped} already present.\nFolders: ${r.result.foldersAdded} added, ${r.result.foldersSkipped} already present.\nConversations: ${r.result.conversationsAdded} added, ${r.result.conversationsSkipped} already present.\nUpdated (tags/colors): ${r.result.updated}.`, [["OK", null]]);
  }

  /* ---- In-panel modals (rendered in this.layer so re-renders don't close them) ---- */
  modal(build) {
    if (!this.panel.classList.contains("open")) this.setOpen(true);
    return new Promise((resolve) => {
      const card = this.el("div", { className: "dlg-card" });
      const box = this.el("div", { className: "dlg" }, card);
      const close = (val) => { box.remove(); resolve(val); };
      build(card, close);
      this.layer.appendChild(box);
    });
  }
  dialog(text, buttons) {
    return this.modal((card, close) => card.append(
      this.el("div", { className: "dlg-text", textContent: text }),
      this.el("div", { className: "row" }, ...buttons.map(([label, val]) => { const b = this.el("button", { textContent: label }); b.onclick = () => close(val); return b; }))));
  }

  /* ---- Colors & tags ---- */
  swatch(idx, size = 12) {
    const c = GF.PALETTE[idx];
    const s = this.el("span", { className: "sw" + (c ? "" : " none") });
    s.style.width = s.style.height = size + "px";
    if (c) s.style.background = c;
    return s;
  }
  folderIcon(f) {
    const i = this.el("span", { className: "ficon", title: "Folder color & name font" });
    if (GF.PALETTE[f.color]) i.style.setProperty("--fc", GF.PALETTE[f.color]);
    i.onclick = async (e) => {
      e.stopPropagation();
      const r = await this.pickFolderLook(f);
      if (!r) return;
      if (r.color !== (f.color || 0)) await this.call(GF.MSG.SET_COLOR, { id: f.id, color: r.color });
      if (GF.encodeStyle(r.style) !== (f.style || 0)) await this.call(GF.MSG.SET_STYLE, { id: f.id, ...r.style });
    };
    return i;
  }
  /* Folder look: color + name font (own row only, not inherited) + bold/italic. Resolves {color, style} or null. */
  pickFolderLook(f) {
    let color = f.color || 0;
    const st = GF.decodeStyle(f.style);
    return this.modal((card, close) => {
      const sws = GF.PALETTE.map((_, i) => {
        const b = this.el("button", { className: "swbtn" + (i === color ? " cur" : ""), title: i ? GF.PALETTE[i] : "None" }, this.swatch(i, 16));
        b.onclick = () => { color = i; sws.forEach((x, j) => x.classList.toggle("cur", j === i)); };
        return b;
      });
      const fam = this.el("select", { className: "tagsel", title: "Name font" },
        this.el("option", { value: "", textContent: "Default" }),
        ...GF.FONT_KEYS.map(k => this.el("option", { value: k, textContent: GF.FONTS[k].label, selected: k === st.font })));
      const bold = this.el("input", { type: "checkbox", checked: st.bold });
      const italic = this.el("input", { type: "checkbox", checked: st.italic });
      let size = st.fontSize; // null = default (global size)
      const range = this.el("input", { type: "range", min: GF.FOLDER_FS_MIN, max: GF.FOLDER_FS_MAX, step: 1, value: size || this.prefs.fs, title: "Name size" });
      const sizeLbl = this.el("span", { className: "cnt" });
      const sizeDef = this.el("button", { className: "mini", textContent: "Default", title: "Use the panel's font size" });
      const preview = this.el("span", { className: "name", textContent: f.name });
      const cur = () => ({ font: fam.value || null, bold: bold.checked, italic: italic.checked, fontSize: size });
      const upd = () => { sizeLbl.textContent = size ? size + "px" : "Default"; GF.Sidebar.styleName(preview, cur()); };
      fam.onchange = bold.onchange = italic.onchange = upd;
      range.oninput = () => { size = +range.value; upd(); };
      sizeDef.onclick = () => { size = null; range.value = this.prefs.fs; upd(); };
      upd();
      const ok = this.el("button", { textContent: "Apply" });
      ok.onclick = () => close({ color, style: cur() });
      const cancel = this.el("button", { textContent: "Cancel" }); cancel.onclick = () => close(null);
      card.append(this.el("b", { textContent: "Folder look" }), this.el("div", { className: "swgrid" }, ...sws),
        this.el("div", { className: "row" }, this.el("span", { textContent: "Font" }), fam),
        this.el("div", { className: "row" }, this.el("label", { className: "tagrow" }, bold, this.el("b", { textContent: "B" })),
          this.el("label", { className: "tagrow" }, italic, this.el("i", { textContent: "I" }))),
        this.el("div", { className: "row" }, this.el("span", { textContent: "Size" }), range, sizeLbl, sizeDef),
        this.el("div", { className: "row prev" }, preview),
        this.el("div", { className: "row" }, ok, cancel));
    });
  }
  pickColor(current, title = "Color") {
    return this.modal((card, close) => {
      const grid = this.el("div", { className: "swgrid" }, ...GF.PALETTE.map((_, i) => {
        const b = this.el("button", { className: "swbtn" + (i === (current || 0) ? " cur" : ""), title: i ? GF.PALETTE[i] : "None" }, this.swatch(i, 16));
        b.onclick = () => close(i);
        return b;
      }));
      const cancel = this.el("button", { textContent: "Cancel" }); cancel.onclick = () => close(undefined);
      card.append(this.el("b", { textContent: title }), grid, cancel);
    });
  }
  chips(x) {
    const ids = (x.tags || []).filter(id => this.state.tags[id]);
    const box = this.el("span", { className: "chips" });
    for (const id of ids) {
      const t = this.state.tags[id];
      const ch = this.el("span", { className: "chip" + (this.tagFilter === id ? " on" : ""), textContent: t.name, title: "Filter by #" + t.name });
      ch.style.background = GF.PALETTE[t.color] || "#555";
      ch.onclick = (e) => { e.preventDefault(); e.stopPropagation(); this.tagFilter = this.tagFilter === id ? null : id; this.render(); };
      box.append(ch);
    }
    return box;
  }
  nextColor() { return (Object.keys(this.state.tags).length % (GF.PALETTE.length - 1)) + 1; }

  /* Choose tags for a conversation or folder; can create new tags inline. */
  async editTags(target, id, current) {
    const sel = new Set(current || []);
    const res = await this.modal((card, close) => {
      const list = this.el("div", { className: "taglist" });
      const draw = () => list.replaceChildren(...Object.values(this.state.tags).sort((a, b) => a.name.localeCompare(b.name)).map(t => {
        const cb = this.el("input", { type: "checkbox", checked: sel.has(t.id) });
        cb.onchange = () => { cb.checked ? sel.add(t.id) : sel.delete(t.id); };
        return this.el("label", { className: "tagrow" }, cb, this.swatch(t.color), this.el("span", { textContent: t.name }));
      }), ...(Object.keys(this.state.tags).length ? [] : [this.el("div", { className: "empty", textContent: "No tags yet" })]));
      draw();
      const inp = this.el("input", { placeholder: "New tag…" });
      inp.dataset.fk = "tagpick-new";
      const add = this.el("button", { textContent: "Add" });
      add.onclick = async () => {
        const name = inp.value.trim(); if (!name) return;
        const r = await this.call(GF.MSG.CREATE_TAG, { name, color: this.nextColor() });
        if (r.ok) { sel.add(r.result); inp.value = ""; draw(); }
      };
      inp.onkeydown = (e) => { if (e.key === "Enter") add.onclick(); };
      this.live = draw; // redraw when the new tag arrives via state broadcast
      const save = this.el("button", { textContent: "Save" }); save.onclick = () => { this.live = null; close([...sel]); };
      const cancel = this.el("button", { textContent: "Cancel" }); cancel.onclick = () => { this.live = null; close(null); };
      card.append(this.el("b", { textContent: "Tags" }), list, this.el("div", { className: "row" }, inp, add), this.el("div", { className: "row" }, save, cancel));
    });
    if (res) this.call(GF.MSG.SET_TAGS, { target, id, tagIds: res });
  }

  /* Manage tags: create / rename / recolor / delete. Live-refreshes on state changes. */
  manageTags() {
    const M = GF.MSG;
    this.modal((card, close) => {
      const list = this.el("div", { className: "taglist" });
      const usage = (id) => [...Object.values(this.state.convs), ...Object.values(this.state.folders)].filter(x => (x.tags || []).includes(id)).length;
      const draw = () => list.replaceChildren(...Object.values(this.state.tags).sort((a, b) => a.name.localeCompare(b.name)).map(t => {
        const sw = this.el("button", { className: "swbtn", title: "Color" }, this.swatch(t.color, 14));
        sw.onclick = async () => { const c = await this.pickColor(t.color, "Tag color"); if (c !== undefined) this.call(M.UPDATE_TAG, { id: t.id, color: c }); };
        const name = this.el("input", { value: t.name, title: "Rename: type, then Enter (Esc reverts)" });
        name.dataset.fk = "tag-rename-" + t.id;
        const commit = () => { if (name.value.trim() && name.value.trim() !== t.name) this.call(M.UPDATE_TAG, { id: t.id, name: name.value }); };
        name.onkeydown = (e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { e.stopPropagation(); name.value = t.name; }
        };
        const n = usage(t.id);
        const del = this.el("button", { className: "mini", textContent: "🗑", title: "Delete tag" });
        del.onclick = async () => { if (await this.dialog(`Delete tag "${t.name}"? It is used on ${n} item(s).`, [["Delete", true], ["Cancel", false]])) this.call(M.DELETE_TAG, { id: t.id }); };
        return this.el("div", { className: "tagrow" }, sw, name, this.el("span", { className: "cnt", textContent: String(n) }), del);
      }), ...(Object.keys(this.state.tags).length ? [] : [this.el("div", { className: "empty", textContent: "No tags yet" })]));
      draw();
      this.live = draw;
      const inp = this.el("input", { placeholder: "New tag…" });
      inp.dataset.fk = "tag-new";
      const add = this.el("button", { textContent: "Add" });
      add.onclick = async () => { const v = inp.value.trim(); if (v && (await this.call(M.CREATE_TAG, { name: v, color: this.nextColor() })).ok) inp.value = ""; };
      inp.onkeydown = (e) => { if (e.key === "Enter") add.onclick(); };
      const done = this.el("button", { textContent: "Close" }); done.onclick = () => { this.live = null; close(); };
      card.append(this.el("b", { textContent: "Manage tags" }), list, this.el("div", { className: "row" }, inp, add), done);
    });
  }

  async addCurrent() {
    const conv = this.adapter.currentConversation();
    if (!conv) return alert("Open a conversation first.");
    if (!this.selected || !this.state.folders[this.selected]) return alert("Select a folder first (click it).");
    await this.call(GF.MSG.ASSIGN_CONV, { provider: this.adapter.id, convId: conv.convId, title: conv.title, folderId: this.selected });
  }
};

/* Extract {provider, convId, title} from a DataTransfer: our annotation, text/x-moz-url, uri-list, plain text. */
GF.Sidebar.infoFromDataTransfer = (dt, adapter) => {
  const get = (t) => { try { return dt.getData(t) || ""; } catch (_) { return ""; } };
  const custom = get("application/x-gf-conv");
  if (custom) { try { const j = JSON.parse(custom); if (j.convId) return { provider: j.provider || adapter.id, ...j }; } catch (_) { /* fall through */ } }
  const moz = get("text/x-moz-url").split("\n");                    // Firefox: "url\ntitle"
  const candidates = [moz[0], ...get("text/uri-list").split("\n").filter(l => l && !l.startsWith("#")), get("text/plain").split("\n")[0]];
  for (const raw of candidates) {
    const url = (raw || "").trim(); if (!url) continue;
    const parsed = GF.parseAnyUrl(url);
    if (!parsed) continue;
    let title = parsed.convId;
    const a = GF.adapterById(parsed.provider);
    const link = parsed.provider === adapter.id && adapter.pageLinks().find(l => adapter.linkId(l) === parsed.convId);
    if (link) title = adapter.parseConvLink(link).title;
    else if (raw === moz[0] && moz[1] && a && !a.isPlaceholder(moz[1].trim(), parsed.convId)) title = moz[1].trim();
    return { ...parsed, title };
  }
  return null;
};

GF.Sidebar.FONTS = GF.FONTS;
/* Apply a folder's own name style to ONE element (no inheritance to children). */
GF.Sidebar.styleName = (el, st) => {
  el.style.fontFamily = st && st.font && GF.FONTS[st.font] ? GF.FONTS[st.font].stack : "";
  el.style.fontWeight = st && st.bold ? "700" : "";
  el.style.fontStyle = st && st.italic ? "italic" : "";
  el.style.fontSize = st && st.fontSize ? st.fontSize + "px" : ""; // row grows (no fixed height)
  return el;
}; // local font stacks only (shared/constants.js)

GF.Sidebar.CSS = `
:host{all:initial}
:host{--gf-fs:13px;--gf-ff:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
*{box-sizing:border-box;font-family:var(--gf-ff);font-size:var(--gf-fs);line-height:1.4}
.head{display:flex;align-items:center;gap:2px}.head b{flex:1;font-size:calc(var(--gf-fs)*1.05)}
.hbtn{font-size:calc(var(--gf-fs)*1.1)}
.rz{position:absolute;z-index:3}.rz-r{top:8px;right:-3px;bottom:12px;width:7px;cursor:ew-resize}
.rz-b{left:8px;right:12px;bottom:-3px;height:7px;cursor:ns-resize}
.rz-br{right:-2px;bottom:-2px;width:14px;height:14px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 55%,#666 55%,#666 62%,transparent 62%,transparent 75%,#666 75%,#666 82%,transparent 82%)}
input[type=range]{flex:1}
.toggle{position:fixed;touch-action:none;user-select:none;width:${GF_POS.size}px;height:${GF_POS.size}px;border-radius:50%;border:1px solid #444;background:#1e1e1e;color:#fff;cursor:grab}
.toggle.dragging{cursor:grabbing;opacity:.8}
.panel{position:fixed;display:none;flex-direction:column;gap:6px;padding:10px;background:#1b1b1b;color:#eee;border:1px solid #333;border-radius:10px;box-shadow:0 8px 24px #0008}
.panel.open{display:flex}
input{width:100%;padding:5px 8px;background:#111;color:#eee;border:1px solid #444;border-radius:6px}
.row{display:flex;gap:6px}
button{background:#2b2b2b;color:#eee;border:1px solid #444;border-radius:6px;padding:4px 8px;cursor:pointer}
.tree{overflow:auto;flex:1;min-height:60px}
.folder{display:flex;align-items:center;gap:4px;padding:3px 4px;border-radius:5px;cursor:pointer}
.folder:hover{background:#262626}.folder.sel{background:#22334f}
.over{outline:2px dashed #4a7cff;background:#1d2a44}
.drop-before{box-shadow:inset 0 2px 0 #4a7cff}.drop-after{box-shadow:inset 0 -2px 0 #4a7cff}
.rootzone{color:#888;font-size:calc(var(--gf-fs)*.85);padding:3px 6px;border:1px dashed #333;border-radius:5px;margin-bottom:4px}
.name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.caret{width:12px;color:#999}
.mini{padding:0 4px;font-size:calc(var(--gf-fs)*.85);border:none;background:transparent;opacity:.6}.mini:hover{opacity:1}
.conv{display:flex;justify-content:space-between;align-items:center;color:#bcd;text-decoration:none;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.conv:hover{background:#262626}
.dlg{position:absolute;inset:0;background:#000a;display:flex;align-items:center;justify-content:center;border-radius:10px;padding:10px}
.dlg-card{background:#222;border:1px solid #444;border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:8px}
.dlg-text{white-space:pre-wrap}
.dlg-card{max-height:100%;overflow:auto;min-width:200px}
.ficon{display:inline-block;width:14px;height:10px;margin:0 3px;border-radius:1px 3px 2px 2px;background:var(--fc,#8a8a8a);position:relative;flex:none;cursor:pointer}
.ficon::before{content:"";position:absolute;left:0;top:-3px;width:6px;height:3px;border-radius:2px 2px 0 0;background:var(--fc,#8a8a8a)}
.chips{display:inline-flex;gap:2px;flex:none;max-width:45%;overflow:hidden}
.chip{font-size:calc(var(--gf-fs)*.77);line-height:1.4;padding:0 5px;border-radius:7px;color:#fff;cursor:pointer;white-space:nowrap;text-shadow:0 0 2px #0008}
.chip.on{outline:1px solid #fff}
.sw{display:inline-block;border-radius:50%;flex:none}.sw.none{border:1px dashed #888}
.swgrid{display:grid;grid-template-columns:repeat(6,auto);gap:4px}
.swbtn{padding:3px;line-height:0}.swbtn.cur{outline:2px solid #4a7cff}
.taglist{display:flex;flex-direction:column;gap:3px;max-height:200px;overflow:auto}
.tagrow{display:flex;align-items:center;gap:6px}.tagrow input:not([type]){flex:1;padding:2px 6px}
.cnt{color:#888;font-size:calc(var(--gf-fs)*.85);min-width:16px;text-align:right}
select.tagsel{flex:1;min-width:0;background:#111;color:#eee;border:1px solid #444;border-radius:6px}
.conv .name{flex:1;overflow:hidden;text-overflow:ellipsis}
.ghost{position:fixed;pointer-events:none;z-index:2;background:#22334f;color:#fff;border:1px solid #4a7cff;border-radius:6px;padding:2px 8px;font-size:12px;max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.badge{flex:none;font-size:calc(var(--gf-fs)*.7);line-height:1.45;padding:0 3px;margin-right:4px;border-radius:3px;color:#fff;background:#666;font-weight:600}
.empty,.footer{color:#888;font-size:calc(var(--gf-fs)*.85);padding:4px}
`;
