/* Content script entry: wires adapter + sidebar + messaging. */
(async () => {
  var GF = globalThis.GF;
  const adapter = GF.pickAdapter && GF.pickAdapter();
  if (!adapter) { console.warn("[AI Folders] no adapter for", location.hostname); return; }
  if (document.getElementById("grok-folders-host")) return;
  const api = (type, payload) => browser.runtime.sendMessage({ type, payload }).catch(e => ({ ok: false, error: e.message }));
  let sidebar;
  const mount = () => { sidebar = new GF.Sidebar(adapter, api); };
  try {
    if (!document.documentElement) await new Promise(r => document.addEventListener("DOMContentLoaded", r, { once: true }));
    mount();
  } catch (e) { console.error("[AI Folders] failed to mount panel", e); return; }

  // Drag conversations from the site's own sidebar (native DnD + pointer fallback).
  try { sidebar.pageDnD = new GF.PageDnD(adapter, sidebar); sidebar.pageDnD.start(); }
  catch (e) { console.error("[AI Folders] page drag support failed", e); }

  // Re-mount if the page re-renders <html> children and drops our host.
  new MutationObserver(() => sidebar.ensureMounted()).observe(document.documentElement, { childList: true });
  setInterval(() => sidebar.ensureMounted(), 2000);

  browser.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === GF.MSG.STATE_CHANGED) sidebar.setState(msg.state, msg.mode);
  });
  const r = await api(GF.MSG.GET_STATE);
  if (r.ok) sidebar.setState(r.state, r.mode);

  // Keep saved conversation titles in sync with the page.
  try {
    sidebar.titleWatcher = new GF.TitleWatcher(adapter, () => sidebar.state, api, { debounceMs: GF.titleDebounceMs });
    sidebar.titleWatcher.start();
  } catch (e) { console.error("[AI Folders] title watcher failed", e); }
})();
