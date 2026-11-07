/* Kimi: public-source URL pattern verified; see README for sources.
 * Sidebar/title DOM and title formats are UNVERIFIED without login.
 * Detect the current chat by URL first; generic link text / document.title fall back to the id.
 */
try {
GF.registerAdapter(GF.makeAdapter({
  id: "kimi", label: "Kimi", badge: { text: "Km", color: "#027aff" },
  hosts: ["kimi.ai", "www.kimi.ai", "kimi.com", "www.kimi.com", "kimi.moonshot.cn"],
  pathRe: /^\/chat\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/,
  urlFor: (id) => "https://www.kimi.com/chat/" + id,
  linkSelector: 'a[href*="/chat/"]', // UNVERIFIED: generic conversation anchors
  linkTitleSelector: "span", // UNVERIFIED; base adapter falls back to full anchor text
  tabTitleRe: /\s*[-|–]\s*Kimi(\s+AI)?\s*$/i, // UNVERIFIED
  placeholders: /^(kimi|kimi ai|new chat|new conversation|untitled)$/i // UNVERIFIED
}));
} catch (e) { console.error("[SI Folders] adapter failed to load: kimi.js", e); }
