/* Grok (grok.com). URL /c/<id> confirmed by usage; selectors/title formats are GUESSES. */
GF.registerAdapter(GF.makeAdapter({
  id: "grok", label: "Grok", badge: { text: "Gk", color: "#444" },
  hosts: ["grok.com"],
  pathRe: /^\/c\/([^/?#]+)/,
  urlFor: (id) => "https://grok.com/c/" + id,
  linkSelector: 'a[href*="/c/"]',                                     // GUESS: history links
  linkTitleSelector: "[data-testid='conversation-title'], .truncate, span", // GUESS
  tabTitleRe: /\s*[-|–]\s*Grok\s*$/i,                                   // GUESS: "<title> - Grok"
  placeholders: /^(new chat|new conversation|untitled|grok|novi klepet|nov pogovor)$/i // GUESS
}));
