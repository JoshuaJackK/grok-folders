/* Claude (claude.ai). URL /chat/<uuid> (known pattern); selectors/title format GUESSES. */
try {
GF.registerAdapter(GF.makeAdapter({
  id: "claude", label: "Claude", badge: { text: "Cl", color: "#d97757" },
  hosts: ["claude.ai"],
  pathRe: /^\/chat\/([^/?#]+)/,
  urlFor: (id) => "https://claude.ai/chat/" + id,
  linkSelector: 'a[href*="/chat/"]',                     // GUESS: sidebar "Recents"
  linkTitleSelector: ".truncate, span",                  // GUESS
  tabTitleRe: /\s*[-|–]\s*Claude\s*$/i,                  // GUESS: "<title> - Claude"
  placeholders: /^(new chat|new conversation|claude|untitled)$/i // GUESS
}));
} catch (e) { console.error("[AI Folders] adapter failed to load: claude.js", e); }
