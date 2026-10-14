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
