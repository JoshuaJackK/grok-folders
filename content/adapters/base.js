/*
 * Provider adapter interface + generic implementation (multi-AI support).
 * Every adapter exposes:
 *   id, label, badge {text, color}, hosts[]   identity / display
 *   matches(location): bool
 *   idFromPath(pathname): convId | null
 *   idFromUrl(URL|Location): convId | null   (default: idFromPath(pathname); query-based ids override)
 *   providerFor(convId): provider id the conversation is STORED under (default: adapter id; Grok on X
 *                                   maps UUID chats to "grok" since grok.com shares those ids)
 *   handles(provider): bool         true if this site can open that provider's chats in-app
 *   routeScoped: bool               true if the adapter claims only some paths of its hosts (SPA routes);
 *                                   content.js then mounts lazily and hides the panel off-route
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
 *     tabTitleRe (strips site suffix from document.title), placeholders: RegExp,
 *     optional: routeRe (pathname regex the adapter is active on; omitted = whole host),
 *               idFromUrl(URL|Location) (ids carried in the query string),
 *               currentTitleSelector (on-page title of the OPEN conversation, e.g. a header),
 *               normalizeId(id) (canonical form, e.g. lowercase UUID), providerFor(id), providers[] }
 * ALL site-specific values (selectors, regexes, title formats) live in the per-site
 * files and are GUESSES unless stated otherwise — verify in DevTools.
 */
var GF = globalThis.GF;
GF.adapters = GF.adapters || [];
GF.registerAdapter = (a) => { if (a && a.id) GF.adapters.push(a); return a; };
/* Robust: a broken adapter must not prevent others from matching. */
GF.pickAdapter = () => GF.adapters.find(a => { try { return a.matches(location); } catch (e) { console.warn("[SI Folders] adapter error", a && a.id, e); return false; } }) || null;
GF.adapterById = (id) => GF.adapters.find(a => a.id === id) || null;
/* Parse any supported conversation URL (used for drops from other sites/windows). */
GF.parseAnyUrl = (url) => {
  try {
    const u = new URL(url, location.origin);
    for (const a of GF.adapters) {
      if (!a.hosts.includes(u.hostname)) continue;
      const convId = a.idFromUrl(u);
      if (convId) return { provider: a.providerFor(convId), convId };
    }
  } catch (_) { /* not a URL */ }
  return null;
};

GF.makeAdapter = (cfg) => ({
  id: cfg.id, label: cfg.label, badge: cfg.badge, hosts: cfg.hosts,
  get conversationLinkSelector() { return cfg.linkSelector; },
  routeScoped: !!cfg.routeRe,
  providers: cfg.providers || [cfg.id],
  providerFor(convId) { return cfg.providerFor ? cfg.providerFor(convId) : cfg.id; },
  handles(provider) { return this.providers.includes(provider); },
  matches(loc) { return cfg.hosts.includes(loc.hostname) && (!cfg.routeRe || cfg.routeRe.test(loc.pathname || "")); },
  idFromPath(path) {
    if (cfg.idFromUrl) { try { return cfg.idFromUrl(new URL(path || "", "https://" + cfg.hosts[0])); } catch (_) { return null; } }
    const m = cfg.pathRe.exec(path || ""); if (!m) return null;
    const id = decodeURIComponent(m[1]); return cfg.normalizeId ? cfg.normalizeId(id) : id;
  },
  idFromUrl(u) { return cfg.idFromUrl ? cfg.idFromUrl(u) : this.idFromPath(u.pathname); },
  conversationUrl(id) { return cfg.urlFor(encodeURIComponent(id)); },
  isPlaceholder(title, convId) {
    const t = (title || "").trim();
    return !t || t === convId || cfg.placeholders.test(t);
  },
  linkId(a) {
    try { const u = new URL(a.getAttribute("href"), location.origin); return this.hosts.includes(u.hostname) ? this.idFromUrl(u) : null; }
    catch (_) { return null; }
  },
  linkTitle(a) {
    const clean = (n) => (n && n.textContent || "").replace(/\s+/g, " ").trim();
    return clean(cfg.linkTitleSelector && a.querySelector(cfg.linkTitleSelector)) || clean(a);
  },
  tabTitle() { return document.title.replace(cfg.tabTitleRe, "").trim(); },
  headerTitle() {
    const n = cfg.currentTitleSelector && document.querySelector(cfg.currentTitleSelector);
    return n ? (n.textContent || "").replace(/\s+/g, " ").trim() : "";
  },
  pageLinks() { return [...document.querySelectorAll(cfg.linkSelector)].filter(a => this.linkId(a)); },
  collectTitles({ includeDocTitle = true } = {}) {
    const out = new Map();
    for (const a of this.pageLinks()) {
      const id = this.linkId(a), t = this.linkTitle(a);
      if (!this.isPlaceholder(t, id)) out.set(id, t);
    }
    const cur = this.idFromUrl(location);
    if (includeDocTitle && cur && !out.has(cur)) {
      const t = [this.headerTitle(), this.tabTitle()].find(x => !this.isPlaceholder(x, cur));
      if (t) out.set(cur, t);
    }
    return out;
  },
  currentConversation() {
    const convId = this.idFromUrl(location);
    if (!convId) return null;
    const link = this.pageLinks().find(a => this.linkId(a) === convId);
    const cands = [link && this.linkTitle(link), this.headerTitle(), this.tabTitle()];
    return { provider: this.providerFor(convId), convId, title: cands.find(t => !this.isPlaceholder(t, convId)) || convId };
  },
  parseConvLink(a) {
    const convId = this.linkId(a);
    if (!convId) return null;
    const t = this.linkTitle(a);
    return { provider: this.providerFor(convId), convId, title: this.isPlaceholder(t, convId) ? convId : t };
  },
  /* SPA navigation: click the site's own history link (its router handles it); else full load. */
  navigate(convId) {
    const link = this.pageLinks().find(a => this.linkId(a) === convId);
    if (link) link.click();
    else location.assign(this.conversationUrl(convId));
  }
});
