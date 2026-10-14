# Izdajanje novih verzij (samostojno gostovane posodobitve)

Razširitev je podpisana na AMO kot **unlisted** (ni javno na addons.mozilla.org) in se posodablja sama prek GitHuba.

## Kako deluje samodejna posodobitev
- `manifest.json` → `browser_specific_settings.gecko.id = grok-folders@joshuajackk.github.io` (**nikoli ne spreminjaj** – podatki in posodobitve so vezani nanj).
- `gecko.update_url` = `https://raw.githubusercontent.com/JoshuaJackK/grok-folders/main/updates.json`
- Firefox ta JSON občasno (privzeto ~na 24 h) prebere; če najde višjo `version`, prenese `.xpi` iz `update_link` (GitHub Release) in preveri `update_hash`.
- Repozitorij mora ostati **javen**, sicer Firefox posodobitve ne more prebrati.

## Nova verzija
Predpogoji: `gh` prijavljen, `npm i -g web-ext`, `python3`, spremenljivki `AMO_JWT_ISSUER` in `AMO_JWT_SECRET` (AMO API ključi – nikoli jih ne commitaj).

```bash
# vse spremembe commitane, nato:
./release.sh 0.2.1
```
Skripta: dvigne verzijo v `manifest.json` → zažene teste in lint → podpiše (`web-ext sign --channel=unlisted`, počaka na odobritev) → commit + tag `v0.2.1` + push → GitHub Release z `grok-folders-0.2.1.xpi` → doda vnos (verzija, povezava, sha256) v `updates.json` in ga pushne → preveri obe URL‑ja s curl (pričakovano `200`).

Pravila: verzija mora biti vedno višja od prejšnje; ista verzija se na AMO ne more podpisati dvakrat.

## Ročno preverjanje posodobitve
`about:addons` → zobnik → **Check for Updates**. Za hiter test v `about:config` lahko znižaš `extensions.update.interval`.

## Namestitev podpisane verzije
Odpri `.xpi` iz [Releases](https://github.com/JoshuaJackK/grok-folders/releases) v Firefoxu (ali povleci datoteko v okno). Podpisana razširitev ostane nameščena tudi po ponovnem zagonu.

**Pozor:** prehod z začasnega dodatka (`grok-folders@example.com`, ≤ 0.1.5) na podpisanega (`grok-folders@joshuajackk.github.io`) pomeni **drug id = druga shramba**. Pred prehodom v stari verziji naredi **Export**, v novi pa **Import**.
