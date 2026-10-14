/*
 * Provider adapter interface + generic implementation (multi-AI support).
 * Every adapter exposes:
 *   id, label, badge {text, color}, hosts[]   identity / display
 *   matches(location): bool
 *   idFromPath(pathname): convId | null
 *   conversationUrl(convId): string
 *   currentConversation(): {convId, title} | null
 *   parseConvLink(anchorEl): {convId, title} | null
 *   collectTitles({includeDocTitle}): Map<convId,title>   (placeholders excluded)
 *   isPlaceholder(title, convId): bool
 *   navigate(convId): void          in-app (SPA) navigation when possible
 *   conversationLinkSelector: CSS selector for conversation links on the page
 *
 * GF.makeAdapter(config) builds an adapter from a small per-site config:
 *   { id, label, badge, hosts, pathRe, urlFor(id), linkSelector, linkTitleSelector,
 *     tabTitleRe (strips site suffix from document.title), placeholders: RegExp }
 * ALL site-specific values (selectors, regexes, title formats) live in the per-site
 * files and are GUESSES unless stated otherwise — verify in DevTools.
 */
var GF = globalThis.GF;
GF.adapters = GF.adapters || [];
GF.registerAdapter = (a) => { GF.adapters.push(a); return a; };
GF.pickAdapter = () => GF.adapters.find(a => a.matches(location)) || null;
GF.adapterById = (id) => GF.adapters.find(a => a.id === id) || null;
/* Parse any supported conversation URL (used for drops from other sites/windows). */
GF.parseAnyUrl = (url) => {
  try {
    const u = new URL(url, location.origin);
    for (const a of GF.adapters) {
      if (!a.hosts.includes(u.hostname)) continue;
      const convId = a.idFromPath(u.pathname);
      if (convId) return { provider: a.id, convId };
    }
  } catch (_) { /* not a URL */ }
  return null;
};

GF.makeAdapter = (cfg) => ({
  id: cfg.id, label: cfg.label, badge: cfg.badge, hosts: cfg.hosts,
  get conversationLinkSelector() { return cfg.linkSelector; },
  matches(loc) { return cfg.hosts.includes(loc.hostname); },
  idFromPath(path) { const m = cfg.pathRe.exec(path || ""); return m ? decodeURIComponent(m[1]) : null; },
  conversationUrl(id) { return cfg.urlFor(encodeURIComponent(id)); },
  isPlaceholder(title, convId) {
    const t = (title || "").trim();
    return !t || t === convId || cfg.placeholders.test(t);
  },
  linkId(a) {
    try { const u = new URL(a.getAttribute("href"), location.origin); return this.hosts.includes(u.hostname) ? this.idFromPath(u.pathname) : null; }
    catch (_) { return null; }
  },
  linkTitle(a) {
    const clean = (n) => (n && n.textContent || "").replace(/\s+/g, " ").trim();
    return clean(cfg.linkTitleSelector && a.querySelector(cfg.linkTitleSelector)) || clean(a);
  },
  tabTitle() { return document.title.replace(cfg.tabTitleRe, "").trim(); },
  pageLinks() { return [...document.querySelectorAll(cfg.linkSelector)].filter(a => this.linkId(a)); },
  collectTitles({ includeDocTitle = true } = {}) {
    const out = new Map();
    for (const a of this.pageLinks()) {
      const id = this.linkId(a), t = this.linkTitle(a);
      if (!this.isPlaceholder(t, id)) out.set(id, t);
    }
    const cur = this.idFromPath(location.pathname);
    if (includeDocTitle && cur && !out.has(cur)) {
      const t = this.tabTitle();
      if (!this.isPlaceholder(t, cur)) out.set(cur, t);
    }
    return out;
  },
  currentConversation() {
    const convId = this.idFromPath(location.pathname);
    if (!convId) return null;
    const link = this.pageLinks().find(a => this.linkId(a) === convId);
    const cands = [link && this.linkTitle(link), this.tabTitle()];
    return { convId, title: cands.find(t => !this.isPlaceholder(t, convId)) || convId };
  },
  parseConvLink(a) {
    const convId = this.linkId(a);
    if (!convId) return null;
    const t = this.linkTitle(a);
    return { convId, title: this.isPlaceholder(t, convId) ? convId : t };
  },
  /* SPA navigation: click the site's own history link (its router handles it); else full load. */
  navigate(convId) {
    const link = this.pageLinks().find(a => this.linkId(a) === convId);
    if (link) link.click();
    else location.assign(this.conversationUrl(convId));
  }
});
