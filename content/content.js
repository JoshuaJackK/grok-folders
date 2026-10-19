/* Content script entry: wires adapter + sidebar + messaging. */
(async () => {
  var GF = globalThis.GF;
  let adapter = GF.pickAdapter && GF.pickAdapter();
  if (!adapter) {
    // Route-scoped adapters (e.g. Grok inside X, only on /i/grok): the script runs on the whole SPA host,
    // so wait for an in-app navigation onto the route instead of giving up. Nothing is touched meanwhile.
    const scoped = (GF.adapters || []).filter(a => a.routeScoped && a.hosts.includes(location.hostname));
    if (!scoped.length) { console.warn("[AI Folders] no adapter for", location.hostname); return; }
    adapter = await new Promise((resolve) => {
      const check = () => {
        const a = scoped.find(x => { try { return x.matches(location); } catch (_) { return false; } });
        if (a) { clearInterval(t); window.removeEventListener("popstate", check); resolve(a); }
      };
      const t = setInterval(check, GF.routePollMs || 500);
      window.addEventListener("popstate", check);
    });
  }
  if (document.getElementById("grok-folders-host")) return;
  const api = (type, payload) => browser.runtime.sendMessage({ type, payload }).catch(e => ({ ok: false, error: e.message }));
  let sidebar;
  const mount = () => { sidebar = new GF.Sidebar(adapter, api); };
  try {
    if (!document.documentElement) await new Promise(r => document.addEventListener("DOMContentLoaded", r, { once: true }));
    mount();
  } catch (e) { console.error("[AI Folders] failed to mount panel", e); return; }

  // Route-scoped: show the panel only while on the adapter's route (SPA navigation in/out of /i/grok).
  const onRoute = () => { try { return adapter.matches(location); } catch (_) { return false; } };
  if (adapter.routeScoped) {
    let last = null;
    const sync = () => { const on = onRoute(); if (on !== last) { last = on; sidebar.host.style.display = on ? "" : "none"; } };
    sync();
    setInterval(sync, GF.routePollMs || 500);
    window.addEventListener("popstate", sync);
  }

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
