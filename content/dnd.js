/*
 * Dragging conversations from the SITE's own sidebar onto the AI Folders panel.
 * Sites differ: some set draggable="false" on history links, some run their own drag libraries
 * (pointer events, preventDefault/stopPropagation on dragstart). Strategy:
 *  1. Native DnD: window-level CAPTURE dragstart (runs before page handlers) annotates the drag with
 *     application/x-gf-conv + text/uri-list (absolute URL). Links with draggable="false" are re-enabled.
 *  2. Pointer fallback: if no native dragstart happens, a press on a conversation link that moves
 *     > threshold while the panel is open starts our own ghost drag; release over a folder row drops it.
 *     The click that would follow is swallowed so the site doesn't navigate.
 * Debug logs are prefixed "[AI Folders]".
 */
var GF = globalThis.GF;
GF.PageDnD = class {
  constructor(adapter, sidebar, opts = {}) {
    this.adapter = adapter; this.sidebar = sidebar;
    this.threshold = opts.threshold ?? 8;
    this.press = null; this.fallback = null; this.nativeActive = false;
  }
  log(...a) { console.info("[AI Folders]", ...a); }
  /* Route-scoped adapters (Grok on X): stay inert outside the adapter's route so the rest of X is untouched. */
  active() { if (!this.adapter.routeScoped) return true; try { return this.adapter.matches(location); } catch (_) { return false; } }
  /* Conversation link for an event (composedPath handles shadow DOM / nested spans). */
  linkFor(e) {
    if (!this.active()) return null;
    const path = e.composedPath ? e.composedPath() : [];
    if (path.includes(this.sidebar.host) || e.target === this.sidebar.host) return null; // our own panel
    for (const n of path.length ? path : [e.target]) {
      if (n && n.tagName === "A" && n.hasAttribute("href") && this.adapter.linkId(n)) return n;
    }
    const a = e.target && e.target.closest && e.target.closest("a[href]");
    return a && this.adapter.linkId(a) ? a : null;
  }
  infoFor(a) {
    const i = this.adapter.parseConvLink(a);
    return i && { provider: this.adapter.id, ...i };
  }
  start() {
    const opt = { capture: true };
    window.addEventListener("dragstart", (e) => this.onDragStart(e), opt);
    window.addEventListener("dragend", () => { this.nativeActive = false; }, opt);
    window.addEventListener("pointerdown", (e) => this.onDown(e), opt);
    window.addEventListener("pointermove", (e) => this.onMove(e), opt);
    window.addEventListener("pointerup", (e) => this.onUp(e), opt);
    window.addEventListener("pointercancel", () => this.cancel("pointercancel"), opt);
    window.addEventListener("keydown", (e) => { if (e.key === "Escape" && this.fallback) this.cancel("escape"); }, opt);
    this.enableDraggable();
    this.mo = new MutationObserver(() => this.enableDraggable());
    this.mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["draggable"] });
  }
  /* Re-enable native dragging on conversation links the site marked draggable="false". */
  enableDraggable() {
    if (!this.active()) return;
    for (const a of this.adapter.pageLinks()) if (a.getAttribute("draggable") === "false") a.setAttribute("draggable", "true");
  }
  onDragStart(e) {
    const a = this.linkFor(e);
    if (!a) return;
    const info = this.infoFor(a);
    if (!info || !e.dataTransfer) return;
    this.nativeActive = true; this.press = null;
    const url = this.adapter.conversationUrl(info.convId);
    try {
      e.dataTransfer.setData("application/x-gf-conv", JSON.stringify(info));
      e.dataTransfer.setData("text/uri-list", url);
      e.dataTransfer.setData("text/plain", url);
      e.dataTransfer.effectAllowed = "copyLink";
    } catch (err) { this.log("could not annotate drag", err); }
    this.log("dragstart detected", info.provider + ":" + info.convId, JSON.stringify(info.title));
  }
  onDown(e) {
    if (e.button !== 0 || !this.sidebar.isOpen()) return;
    const a = this.linkFor(e);
    if (!a) return;
    this.press = { x: e.clientX, y: e.clientY, a, info: this.infoFor(a) };
    this.nativeActive = false;
  }
  onMove(e) {
    if (this.fallback) {
      e.preventDefault();
      this.sidebar.showGhost("📁 " + this.fallback.info.title, e.clientX, e.clientY);
      this.fallback.target = this.sidebar.targetFromPoint(e.clientX, e.clientY);
      this.sidebar.highlight(this.fallback.target);
      return;
    }
    const p = this.press;
    if (!p || this.nativeActive || !p.info) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < this.threshold) return;
    this.fallback = { info: p.info };
    this.press = null;
    this.log("native drag did not start; using pointer-drag fallback for", p.info.provider + ":" + p.info.convId);
    this.onMove(e);
  }
  onUp(e) {
    this.press = null;
    const f = this.fallback;
    if (!f) return;
    this.fallback = null;
    const target = this.sidebar.targetFromPoint(e.clientX, e.clientY);
    this.sidebar.hideGhost();
    // Swallow the click that follows the release so the site doesn't navigate.
    const swallow = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 300);
    if (!target) { this.log("pointer drop outside folders; ignored"); return; }
    this.sidebar.dropExternal(f.info, target);
  }
  cancel(why) {
    if (this.fallback) this.log("pointer drag cancelled:", why);
    this.press = null; this.fallback = null; this.sidebar.hideGhost();
  }
};
