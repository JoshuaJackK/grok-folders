# Grok Folders (Firefox, MVP)

Razširitev za Firefox (Manifest V3), ki pogovore na grok.com razvrsti v mape z neomejenim gnezdenjem.

## Funkcije (MVP)
- Gumb 📁 lahko premakneš z miško (položaj se shrani lokalno v `storage.local` pod `uiPos`); dvoklik ga ponastavi.
- Lastna stranska plošča (gumb 📁 levo zgoraj, poleg Grokovega menija; odmik nastaviš v `GF_POS` na vrhu `content/sidebar.js`), izolirana v **shadow DOM**.
- Ustvarjanje, preimenovanje in brisanje map (brisanje je **rekurzivno**: podmape in dodelitve).
- Neomejeno gnezdenje. Vleci in spusti v drevesu: mape in pogovore premikaš med mapami in jih razvrščaš (zgornja/spodnja ~25 % vrstice = pred/za – prikaže se črta; sredina = v mapo – obroba). Polje „⤒ Top level“ premakne mapo na koren. Zaprta mapa se med vlečenjem odpre po ~600 ms. Mape ni mogoče premakniti v lastno poddrevo.
- Dodajanje pogovora: izberi mapo (klik) → „+ Current chat“, ali **povleci** povezavo `/c/<id>` iz Grokovega seznama pogovorov na mapo.
- Iskanje po naslovih pogovorov in imenih map.
- **Barve map** (paleta 10 barv + brez): klik na ikono mape.
- **Oznake (tagi)** z imenom in barvo: gumb `#` na pogovoru/mapi (izbira, ustvarjanje), upravljanje v „Tags“ (preimenuj, prebarvaj, izbriši). Prikaz kot barvni čipi; klik na čip ali izbirnik „All tags“ filtrira; iskanje upošteva tudi imena oznak.
- Izvoz/uvoz JSON (gumba Export/Import): datoteka `grok-folders-LLLL-MM-DD.json` z `{app, schema, exportedAt, folders, conversations}`; uvoz z izbiro **Zamenjaj** ali **Združi** (idempotentno: mapa z istim id ali istim imenom pod istim staršem se ponovno uporabi, dodajo se le nove mape/pogovori; obstoječi pogovori ostanejo v svoji mapi).
- Sinhronizacija prek `browser.storage.sync`, z rezervo v `browser.storage.local`.

## Arhitektura
```
manifest.json            MV3, gecko id, strict_min_version 115, background.scripts (event page)
shared/constants.js      verzija sheme, tipi sporočil
background/storage.js    model shranjevanja: kodiranje, razkosanje, migracije, fallback
background/background.js EDINI lastnik shrambe; obdela sporočila, oddaja spremembe zavihkom,
                         posluša storage.onChanged (sync iz drugih naprav)
content/adapters/base.js vmesnik ponudnika (provider adapter) + registracija
content/adapters/grok.js adapter za grok.com (VSI Grok selektorji so tu)
content/sidebar.js       UI v zaprtem shadow rootu (brez innerHTML)
content/content.js       vstopna točka: adapter + UI + runtime.sendMessage
```
Tok: UI → `runtime.sendMessage({type, payload})` → background spremeni stanje → shrani → pošlje `gf:stateChanged` vsem zavihkom grok.com → UI se ponovno izriše.
Firefox MV3 ne podpira `service_worker`, zato je ozadje *event page* (`background.scripts`).

## Model shranjevanja
Omejitve `storage.sync`: 8 KB na element, ~100 KB skupaj, 512 elementov. Zato:
- `meta` → `{ v: verzijaSheme, fc: #kosov map, cc: #kosov pogovorov, ts }`
- `f0..fN` → ploščat slovar map: `{ id: [ime, parentId|null, vrstni_red] }`
- `c0..cN` → ploščat slovar dodelitev: `{ "grok:<convId>": [folderId, naslov, vrstni_red, tagIds?] }`
- `t0..tN` → oznake: `{ tagId: [ime, barva] }` (shema v3)
- Mapa (v3): `[ime, parentId, vrstni_red, barva?, tagIds?]`; barve so indeksi palete (`GF.PALETTE`), privzete vrednosti na koncu se izpustijo.
- Migracije: `1→2` doda vrstni red pogovorov, `2→3` doda tabelo oznak; obstoječi podatki ostanejo nespremenjeni. Uvoz sprejme tudi stare izvoze; pri združevanju se oznake ujemajo po imenu (ne glede na velike črke).

Normalizirano (drevo se izračuna iz `parentId`), kratki ključi in tuple‑polja zmanjšajo velikost. Kosi se polnijo do ~7000 B; odvečni stari kosi se izbrišejo. Naslovi so skrajšani na 80 znakov, imena map na 100.
Pred zapisom se izračuna skupna velikost; če preseže ~95 KB ali 500 elementov (ali zapis v sync ne uspe), se ista struktura zapiše v `storage.local` z `mode: "local"` (prikazano v nogi plošče).
Ključ pogovora ima predpono ponudnika (`provider` = `"grok"`) za prihodnjo podporo več AI storitvam.
**Migracije:** `MIGRATIONS` v `storage.js` – funkcija na verzijo (`1: all => …`), ki se izvede ob nalaganju, dokler `meta.v < SCHEMA_VERSION`.

## ⚠️ Grok selektorji so ugibanje
Selektorji v `content/adapters/grok.js` (`a[href^="/c/"]`, naslov) **niso preverjeni** na živem DOM‑u grok.com. Preveri jih v DevTools; vsa specifična znanja o DOM‑u morajo ostati v adapterju.

## Ohranjanje podatkov med razvojem
- Gecko id (`grok-folders@joshuajackk.github.io`) je enak v vseh verzijah – podatki so vezani nanj.
- Za posodobitev začasnega dodatka uporabi gumb **Reload** v about:debugging. **Remove** + ponovni „Load Temporary Add-on“ ali zaprtje Firefoxa začasni dodatek odstrani, Firefox pa ob odstranitvi izbriše njegove podatke.
- Za razvoj nastavi v `about:config`: `extensions.webextensions.keepStorageOnUninstall = true` (in `keepUuidOnUninstall = true`).
- Pred posodobitvijo naredi **Export**.

## Namestitev (about:debugging)
1. Firefox ≥ 115 → `about:debugging#/runtime/this-firefox`
2. „Load Temporary Add-on…“ → izberi `manifest.json` v tej mapi.
3. Odpri https://grok.com, klikni 📁 levo zgoraj.
4. V MV3 je dostop do gostitelja izbiren: v `about:addons` → Grok Folders → Permissions omogoči grok.com (ali preko ikone razširitev).
5. Ozadje razhroščuješ z gumbom „Inspect“ v about:debugging.

Lint: `npx web-ext lint` · Zagon: `npx web-ext run`

## Naslednji koraki
1. Preveriti in popraviti Grok selektorje (naslov, seznam pogovorov, SPA navigacija) ter dodati MutationObserver za posodobitev naslovov.
2. Ob prvem zagonu zahtevati host permission (`permissions.request`), če ni odobren.
4. Sporočanje stanja in konflikti pri sync: merge po `ts` namesto „zadnji zapis zmaga“; preklop nazaj iz local v sync.
5. Stran z nastavitvami.
6. Testi: `node tests/import.test.js`, `node tests/move.test.js`, `node tests/tags.test.js`; dodati še `encode/decode/chunk`.
7. Adapterji za druge ponudnike (ChatGPT, Claude) prek istega vmesnika.
8. Zamenjava `prompt/confirm` z lastnimi dialogi v shadow DOM; i18n (`_locales`).
