/* Perplexity (perplexity.ai). URL /search/<slug> (known pattern; slug = title words + id); selectors GUESSES. */
try {
GF.registerAdapter(GF.makeAdapter({
  id: "perplexity", label: "Perplexity", badge: { text: "Px", color: "#20808d" },
  hosts: ["www.perplexity.ai", "perplexity.ai"],
  pathRe: /^\/search\/([^/?#]+)/,
  urlFor: (id) => "https://www.perplexity.ai/search/" + id,
  linkSelector: 'a[href*="/search/"]',                   // GUESS: library / sidebar threads
  linkTitleSelector: ".line-clamp-1, span",              // GUESS
  tabTitleRe: /\s*[-|–]\s*Perplexity(\s+AI)?\s*$/i,     // GUESS
  placeholders: /^(perplexity|perplexity ai|new thread|untitled)$/i // GUESS
}));
} catch (e) { console.error("[AI Folders] adapter failed to load: perplexity.js", e); }
