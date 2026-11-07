/* DeepSeek: public-source URL pattern verified; see README for sources.
 * Sidebar/title DOM and title formats are UNVERIFIED without login.
 * Detect the current chat by URL first; generic link text / document.title fall back to the id.
 */
try {
GF.registerAdapter(GF.makeAdapter({
  id: "deepseek", label: "DeepSeek", badge: { text: "DS", color: "#4d6bfe" },
  hosts: ["chat.deepseek.com"],
  pathRe: /^\/a\/chat\/s\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/,
  urlFor: (id) => "https://chat.deepseek.com/a/chat/s/" + id,
  linkSelector: 'a[href*="/a/chat/s/"]', // UNVERIFIED: generic conversation anchors
  linkTitleSelector: "span", // UNVERIFIED; base adapter falls back to full anchor text
  tabTitleRe: /\s*[-|–]\s*DeepSeek(\s+AI)?\s*$/i, // UNVERIFIED
  placeholders: /^(deepseek|deepseek ai|new chat|new conversation|untitled)$/i // UNVERIFIED
}));
} catch (e) { console.error("[SI Folders] adapter failed to load: deepseek.js", e); }
