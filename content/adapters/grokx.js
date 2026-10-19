/*
 * Grok inside X (x.com/i/grok, twitter.com/i/grok).
 * IDS (0.5.5): UUID conversations are the SAME chats as grok.com/c/<uuid> (confirmed by the user), so they are
 * stored as "grok:<lowercase uuid>" (one entry, Grok badge) and open inside X when clicked here. Legacy numeric
 * X ids have no grok.com counterpart and stay "grokx:<id>".
 * VERIFIED (public sources: userscripts/exporters, user-shared links): conversation URL is
 *   https://x.com/i/grok?conversation=<id>   (id lives in the QUERY string, not the path).
 *   <id> is a numeric rest_id (older chats) or a UUID (seen on v0.5.3: 124e3867-8ba5-476d-aa9a-0395edd41b65).
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
    // Ids seen in the wild: numeric snowflakes (1990017815781278167) AND UUIDs (124e3867-8ba5-…), so
    // accept any safe token. Stored as-is (case kept) under "grokx:<id>".
    if (!id || !/^[A-Za-z0-9-]{6,100}$/.test(id)) return null;
    return GF.UUID_RE.test(id) ? id.toLowerCase() : id;  // same canonical form as grok.com
  },
  urlFor: (id) => "https://x.com/i/grok?conversation=" + id,
  providers: ["grokx", "grok"],                                  // grok: UUID chats open in-app on X too
  providerFor: (id) => (GF.UUID_RE.test(id) ? "grok" : "grokx"),
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
