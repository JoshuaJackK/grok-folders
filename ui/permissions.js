/* Extension page: shows per-site access and requests missing host permissions (button = user gesture). */
var GF = globalThis.GF;
const LABELS = { "grok.com": "Grok", "chatgpt.com": "ChatGPT", "claude.ai": "Claude", "gemini.google.com": "Gemini", "www.perplexity.ai": "Perplexity", "perplexity.ai": "Perplexity (no www)", "x.com": "Grok on X (x.com/i/grok)", "twitter.com": "Grok on X (twitter.com)" };
const hostOf = (o) => o.replace(/^https:\/\//, "").replace(/\/\*$/, "");

async function status() {
  const rows = [];
  for (const o of GF.HOST_MATCHES) rows.push({ origin: o, granted: await browser.permissions.contains({ origins: [o] }) });
  return rows;
}

async function render() {
  const rows = await status();
  const tbody = document.querySelector("#sites tbody");
  tbody.replaceChildren(...rows.map(r => {
    const tr = document.createElement("tr");
    const name = document.createElement("td"); name.textContent = LABELS[hostOf(r.origin)] || hostOf(r.origin);
    const host = document.createElement("td"); host.textContent = hostOf(r.origin);
    const st = document.createElement("td"); st.textContent = r.granted ? "✓ allowed" : "✗ not allowed"; st.className = r.granted ? "ok" : "no";
    tr.append(name, host, st); return tr;
  }));
  const missing = rows.filter(r => !r.granted).map(r => r.origin);
  const btn = document.getElementById("grant");
  btn.disabled = !missing.length;
  btn.textContent = missing.length ? `Grant access to ${missing.length} site(s)` : "All sites allowed";
  return missing;
}

document.getElementById("grant").addEventListener("click", async () => {
  const msg = document.getElementById("msg");
  const missing = GF.HOST_MATCHES.slice(); // request all; already-granted ones are a no-op
  try {
    const ok = await browser.permissions.request({ origins: missing });
    msg.textContent = ok ? "Done – reload your open AI tabs." : "Not granted.";
  } catch (e) { msg.textContent = "Error: " + e.message; }
  render();
});
if (browser.permissions.onAdded) browser.permissions.onAdded.addListener(render);
if (browser.permissions.onRemoved) browser.permissions.onRemoved.addListener(render);
GF.permissionsReady = render();
