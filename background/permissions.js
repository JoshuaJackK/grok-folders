/*
 * Host-permission onboarding. Firefox MV3 host_permissions are opt-in: on install/update new sites
 * are not granted automatically, and without them content scripts are NOT injected (no 📁 button).
 * - onInstalled (install/update): if any supported site is missing, open ui/permissions.html.
 * - Toolbar button: requests missing sites directly (user gesture); if all granted, opens the page.
 */
var GF = globalThis.GF;
GF.Perms = {
  async missing() {
    const out = [];
    for (const o of GF.HOST_MATCHES) if (!(await browser.permissions.contains({ origins: [o] }))) out.push(o);
    return out;
  },
  pageUrl() { return browser.runtime.getURL("ui/permissions.html"); },
  async openPage() { return browser.tabs.create({ url: this.pageUrl() }); },
  async onInstalled(details) {
    if (!details || !["install", "update"].includes(details.reason)) return;
    if ((await this.missing()).length) await this.openPage();
  },
  lastMissing: null, // cached by updateBadge(); lets onAction request synchronously
  /* Toolbar click. permissions.request must run directly in the click handler (no awaits before it),
   * otherwise Firefox no longer treats it as a user gesture. */
  onAction() {
    if (this.lastMissing === 0) return this.openPage();
    return browser.permissions.request({ origins: GF.HOST_MATCHES })
      .then((ok) => (ok ? this.updateBadge() : this.openPage()))
      .catch(() => this.openPage());
  },
  async updateBadge() {
    if (!browser.action || !browser.action.setBadgeText) { this.lastMissing = (await this.missing()).length; return; }
    const n = (await this.missing()).length;
    this.lastMissing = n;
    await browser.action.setBadgeText({ text: n ? "!" : "" });
    if (n && browser.action.setBadgeBackgroundColor) await browser.action.setBadgeBackgroundColor({ color: "#e5484d" });
    await browser.action.setTitle({ title: n ? `SI Folders – click to grant access to ${n} site(s)` : "SI Folders" });
  }
};
browser.runtime.onInstalled.addListener((d) => { GF.Perms.onInstalled(d); GF.Perms.updateBadge(); });
if (browser.action) browser.action.onClicked.addListener(() => { GF.Perms.onAction(); });
if (browser.permissions.onAdded) browser.permissions.onAdded.addListener(() => GF.Perms.updateBadge());
if (browser.permissions.onRemoved) browser.permissions.onRemoved.addListener(() => GF.Perms.updateBadge());
GF.Perms.updateBadge().catch(() => {});
