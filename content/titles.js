/*
 * Title watcher: keeps titles of ALREADY SAVED conversations in sync with grok.com.
 * - Debounced MutationObserver (DOM + <title>) and SPA navigation check (URL polling/popstate).
 * - One batch message per debounce window; only titles that actually differ are sent.
 * - Never adds unsaved conversations; placeholder/empty titles are ignored (adapter decides).
 */
var GF = globalThis.GF;
GF.TitleWatcher = class {
  constructor(adapter, getState, send, opts = {}) {
    this.adapter = adapter; this.getState = getState; this.send = send;
    this.debounceMs = opts.debounceMs ?? 2000;
    this.timer = null; this.inflight = false; this.lastUrl = location.href;
    this.seen = new Map(); // convId -> title last seen on THIS page (anti ping-pong between tabs)
    this.navTitle = null; // document.title captured at SPA navigation (stale until it changes)
  }
  start() {
    this.mo = new MutationObserver(() => this.schedule());
    this.mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    window.addEventListener("popstate", () => this.schedule());
    this.urlPoll = setInterval(() => { if (location.href !== this.lastUrl) { this.lastUrl = location.href; this.navTitle = document.title; this.schedule(); } }, 1000);
    this.schedule();
  }
  stop() { if (this.mo) this.mo.disconnect(); clearInterval(this.urlPoll); clearTimeout(this.timer); }
  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), this.debounceMs); }
  /* Returns { convId: title } for saved conversations whose stored title differs. */
  diff() {
    const st = this.getState(), p = this.adapter.id, out = {};
    if (!st || !st.convs) return out;
    // After SPA navigation, document.title may still show the previous chat: ignore it until it changes.
    const includeDocTitle = this.navTitle === null || document.title !== this.navTitle;
    if (includeDocTitle) this.navTitle = null;
    for (const [id, raw] of this.adapter.collectTitles({ includeDocTitle })) {
      const c = st.convs[p + ":" + id];
      if (!c) continue;                                  // never auto-add
      const t = raw.slice(0, GF.TITLE_MAX);
      if (this.adapter.isPlaceholder(t, id)) continue;
      // Only report when the page itself changed (or on first sighting). A stale tab whose list still
      // shows an old title must not overwrite a rename synced from another tab/device.
      const prev = this.seen.get(id); this.seen.set(id, t);
      if (prev === t || t === c.title) continue;
      out[id] = t;
    }
    return out;
  }
  async flush() {
    if (this.inflight) return this.schedule();          // max one write per batch
    const titles = this.diff();
    if (!Object.keys(titles).length) return;
    this.inflight = true;
    try { await this.send(GF.MSG.UPDATE_TITLES, { provider: this.adapter.id, titles }); }
    finally { this.inflight = false; }
  }
};
