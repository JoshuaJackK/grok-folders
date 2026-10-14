/* Gemini (gemini.google.com). URLs /app/<id> and /u/<n>/app/<id> (multi-account); selectors GUESSES.
 * Note: Gemini's tab title is usually just "Gemini" -> titles come mainly from the sidebar list. */
GF.registerAdapter(GF.makeAdapter({
  id: "gemini", label: "Gemini", badge: { text: "Gm", color: "#4c8df6" },
  hosts: ["gemini.google.com"],
  pathRe: /^(?:\/u\/\d+)?\/app\/([^/?#]+)/,
  urlFor: (id) => "https://gemini.google.com/app/" + id,
  linkSelector: 'a[href*="/app/"]',                      // GUESS: history items may not be <a> in all versions
  linkTitleSelector: ".conversation-title, span",        // GUESS
  tabTitleRe: /\s*[-|–]\s*(Google\s+)?Gemini\s*$/i,      // GUESS
  placeholders: /^(gemini|google gemini|new chat|conversation with gemini|untitled)$/i // GUESS
}));
