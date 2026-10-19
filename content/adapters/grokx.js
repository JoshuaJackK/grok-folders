/*
 * Grok inside X (x.com/i/grok, twitter.com/i/grok). Own ID space ("grokx:<id>"), separate from grok.com.
 * VERIFIED (public sources: userscripts/exporters, user-shared links): conversation URL is
 *   https://x.com/i/grok?conversation=<numeric rest_id>   (id lives in the QUERY string, not the path).
 * X is one SPA: the content script is injected on all of x.com but this adapter only claims /i/grok
 * (routeRe); content.js mounts lazily and hides the panel elsewhere on X.
 * Everything below marked GUESS is unverified against the live DOM — check in DevTools.
 */
try {
GF.registerAdapter(GF.makeAdapter({
  id: "grokx", label: "Grok (X)", badge: { text: "GX", color: "#1d9bf0" },
  hosts: ["x.com", "twitter.com"],
  routeRe: /^\/i\/grok(\/|$)/,
  pathRe: /$^/, // unused: ids come from ?conversation=
  idFromUrl: (u) => {
    if (!/^\/i\/grok\/?$/.test(u.pathname || "")) return null;
    const id = new URLSearchParams(u.search || "").get("conversation");
    return id && /^\d{1,25}$/.test(id) ? id : null;            // rest_id is a numeric snowflake
  },
  urlFor: (id) => "https://x.com/i/grok?conversation=" + id,
  // GUESS: history drawer/panel ("Chat history" button inside /i/grok) renders items as links to
  // /i/grok?conversation=<id>. If X renders them as non-link [role=button] rows, page drag/titles from
  // the list won't work and navigation falls back to a full page load.
  linkSelector: 'a[href*="/i/grok?conversation="], a[href*="/i/grok/?conversation="]',
  linkTitleSelector: '[data-testid="grokConversationTitle"], [dir="ltr"] span, span', // GUESS
  currentTitleSelector: '[data-testid="grokConversationTitle"][aria-current], [data-testid="grokHeaderTitle"]', // GUESS
  tabTitleRe: /^\s*\(\d+\+?\)\s*|\s*\/\s*(X|Twitter)\s*$/gi,     // GUESS: "(3) <title> / X" -> "<title>"
  placeholders: /^(grok|x|twitter|home|new chat|new conversation|untitled|chat history|history|novi klepet|nov pogovor)$/i // GUESS
}));
} catch (e) { console.error("[AI Folders] adapter failed to load: grokx.js", e); }
