/* ChatGPT (chatgpt.com). URLs /c/<uuid> and /g/<gpt>/c/<uuid> (known pattern); selectors GUESSES. */
try {
GF.registerAdapter(GF.makeAdapter({
  id: "chatgpt", label: "ChatGPT", badge: { text: "GPT", color: "#10a37f" },
  hosts: ["chatgpt.com"],
  pathRe: /^(?:\/g\/[^/]+)?\/c\/([^/?#]+)/,
  urlFor: (id) => "https://chatgpt.com/c/" + id,
  linkSelector: 'nav a[href*="/c/"], a[href*="/c/"]',    // GUESS: sidebar history (nav)
  linkTitleSelector: ".truncate, span",                  // GUESS
  tabTitleRe: /\s*[-|–]\s*ChatGPT\s*$/i,                 // GUESS: tab title is "<title>" (or "ChatGPT")
  placeholders: /^(new chat|chatgpt|untitled)$/i         // GUESS
}));
} catch (e) { console.error("[AI Folders] adapter failed to load: chatgpt.js", e); }
