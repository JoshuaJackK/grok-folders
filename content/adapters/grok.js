/*
 * Grok adapter.
 * !!! WARNING: The DOM selectors below are GUESSES based on the /c/<id> URL pattern.
 * !!! grok.com markup is not documented and changes often. Verify in DevTools and
 * !!! keep ALL grok-specific DOM knowledge in this file.
 */
var GF = globalThis.GF;
GF.registerAdapter({
  id: "grok",
  selectors: {
    convLink: 'a[href^="/c/"]',            // GUESS: sidebar history links
    title: "h1, [data-testid='conversation-title']" // GUESS
  },
  // GUESS: placeholder titles Grok shows before a real title exists (never stored).
  placeholderRe: /^(new chat|new conversation|untitled|grok|novi klepet|nov pogovor)$/i,
  isPlaceholder(title, convId) {
    const t = (title || "").trim();
    return !t || t === convId || this.placeholderRe.test(t);
  },
  /* Clean visible link text (GUESS: link may contain extra nodes like timestamps/menus). */
  linkTitle(a) {
    const el = a.querySelector("[data-testid='conversation-title'], .truncate, span") || a; // GUESS
    const clean = (n) => (n.textContent || "").replace(/\s+/g, " ").trim();
    return clean(el) || clean(a);
  },
  /*
   * Collect current titles visible on the page: Map<convId, title>.
   * Sources: history links (/c/<id>) and the open conversation (document.title).
   * includeDocTitle=false when document.title may still belong to the previous conversation.
   */
  collectTitles({ includeDocTitle = true } = {}) {
    const out = new Map();
    for (const a of document.querySelectorAll(this.selectors.convLink)) {
      const id = this.idFromPath(new URL(a.href, location.origin).pathname);
      const t = this.linkTitle(a);
      if (id && !this.isPlaceholder(t, id)) out.set(id, t);
    }
    const cur = this.idFromPath(location.pathname);
    if (includeDocTitle && cur && !out.has(cur)) {
      const t = document.title.replace(/\s*[-|–]\s*Grok.*$/i, "").trim(); // GUESS: "<title> - Grok"
      if (!this.isPlaceholder(t, cur)) out.set(cur, t);
    }
    return out;
  },
  get conversationLinkSelector() { return this.selectors.convLink; },
  matches: (loc) => loc.hostname === "grok.com",
  idFromPath(path) { const m = /^\/c\/([^/?#]+)/.exec(path); return m ? m[1] : null; },
  currentConversation() {
    const convId = this.idFromPath(location.pathname);
    if (!convId) return null;
    const link = document.querySelector(`a[href^="/c/${CSS.escape(convId)}"]`);
    const title = (link && link.textContent.trim()) ||
      (document.querySelector(this.selectors.title) || {}).textContent ||
      document.title.replace(/\s*[-|]\s*Grok.*$/i, "");
    return { convId, title: (title || convId).trim() };
  },
  parseConvLink(a) {
    const convId = this.idFromPath(new URL(a.href, location.origin).pathname);
    return convId ? { convId, title: a.textContent.trim() || convId } : null;
  },
  /* SPA navigation: click Grok's own history link (handled by its router) if present; else full load. */
  navigate(convId) {
    const host = document.getElementById("grok-folders-host");
    const link = [...document.querySelectorAll(this.selectors.convLink)]
      .find(a => a !== host && this.idFromPath(new URL(a.href, location.origin).pathname) === convId);
    if (link) link.click();
    else location.assign(this.conversationUrl(convId));
  },
  conversationUrl: (id) => "https://grok.com/c/" + encodeURIComponent(id)
});
