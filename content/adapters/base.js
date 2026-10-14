/*
 * Provider adapter interface (future multi-AI support).
 * Every adapter must implement:
 *   id: string                      e.g. "grok"
 *   matches(location): bool
 *   currentConversation(): {convId, title} | null
 *   parseConvLink(anchorEl): {convId, title} | null
 *   conversationUrl(convId): string
 *   conversationLinkSelector: CSS selector for draggable conversation links
 */
var GF = globalThis.GF;
GF.adapters = GF.adapters || [];
GF.registerAdapter = (a) => GF.adapters.push(a);
GF.pickAdapter = () => GF.adapters.find(a => a.matches(location)) || null;
