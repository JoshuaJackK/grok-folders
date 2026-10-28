# SI Folders (Firefox) – prej „Grok Folders“

Razširitev za Firefox (Manifest V3), ki pogovore z AI asistenti razvrsti v **eno skupno drevo map** (po temah) z neomejenim gnezdenjem.

Podprte strani (vsaka ima svoj adapter v `content/adapters/`):

| Ponudnik | Gostitelj | URL pogovora | Značka |
|---|---|---|---|
| Grok | grok.com | `/c/<id>` | Gk |
| Grok (X) | x.com, twitter.com | `/i/grok?conversation=<id>`: UUID → shranjen kot **Grok** (`grok:<uuid>`), številčni (stari) → `grokx:<id>` | Gk / GX |
| ChatGPT | chatgpt.com | `/c/<id>`, `/g/<gpt>/c/<id>` | GPT |
| Claude | claude.ai | `/chat/<uuid>` | Cl |
| Gemini | gemini.google.com | `/app/<id>`, `/u/<n>/app/<id>` | Gm |
| Perplexity | www.perplexity.ai | `/search/<slug>` | Px |

⚠️ Vzorci URL so preverjeni po javnih virih; **selektorji, formati naslovov zavihkov in nadomestni naslovi so ugibanja** (označeno v vsakem adapterju). Klik na pogovor iste strani = navigacija znotraj aplikacije; pogovor drugega ponudnika se odpre v novem zavihku. Filter „All AIs“ omeji prikaz na enega ponudnika.

**Grok v X** (`content/adapters/grokx.js`, ponudnik `grokx`): pogovori imajo **lasten prostor id‑jev** (`grokx:<id>`), ločen od grok.com. Id je v poizvedbi (`?conversation=`), ne v poti. Ker je X ena sama SPA, se skript naloži na celem x.com, a plošča 📁 se prikaže **samo na `/i/grok`** (preverjanje ob SPA navigaciji); drugje na X ni gumba, vlečenje in posodabljanje naslovov sta neaktivna in DOM X ostane nedotaknjen. Klik na shranjen pogovor uporabi Xovo povezavo v zgodovini (če obstaja), sicer naloži URL. ⚠️ Selektorji zgodovine (`a[href*="/i/grok?conversation="]`), naslova in format naslova zavihka („… / X“) so ugibanje. Gecko id ostaja `grok-folders@joshuajackk.github.io`.

**Skupni id‑ji (0.5.5):** X in grok.com uporabljata iste UUID id‑je (`grok.com/c/<uuid>` = `x.com/i/grok?conversation=<uuid>`), zato je tak pogovor shranjen **enkrat** kot `grok:<uuid>` (male črke, kot na grok.com) z značko Gk. Klik nanj na X ga odpre znotraj X (prek Xove povezave v zgodovini, sicer prek URL‑ja X), na grok.com na grok.com, drugje v novem zavihku na grok.com. Ob nalaganju se obstoječi `grokx:<uuid>` samodejno pretvorijo v `grok:<uuid>`; če obstajata oba, se združita (en vnos, boljši naslov, unija oznak). Ker je pogovor v tem modelu vedno v **eni** mapi, ob združevanju iz različnih map ostane mapa vnosa `grok:`. Enako normalizacijo uporablja uvoz JSON. Številčni id‑ji X ostanejo `grokx:<id>` (GX).

## Funkcije (MVP)
- Gumb 📁 lahko premakneš z miško (položaj se shrani lokalno v `storage.local` pod `uiPos`); dvoklik ga ponastavi.
- Plošča ostane odprta med navigacijo (klik na pogovor uporabi Grokovo SPA navigacijo) in po ponovnem nalaganju; stanje (odprta/zaprta, zaprte mape) je v `storage.local` (`uiState`). Zapre se le z gumbom 📁 ali tipko Esc.
- **Velikost plošče**: ročaji na desnem robu, spodnjem robu in spodnjem desnem kotu (min/max, prilagojeno oknu); shrani se lokalno (`uiSize`), dvoklik na ročaj ponastavi.
- **Pisava** (⚙ v glavi plošče): velikost 11–18 px in družina (System, Sans, Humanist, Rounded, Serif, Mono – samo lokalne pisave); shrani se v `storage.sync` (`uiPrefs`, nekaj bajtov).
- **⊟ / ⊞**: strni / razširi vse mape (stanje se ohrani).
- Lastna stranska plošča (gumb 📁 levo zgoraj, poleg Grokovega menija; odmik nastaviš v `GF_POS` na vrhu `content/sidebar.js`), izolirana v **shadow DOM**.
- Ustvarjanje, preimenovanje in brisanje map (brisanje je **rekurzivno**: podmape in dodelitve).
- Neomejeno gnezdenje. Vleci in spusti v drevesu: mape in pogovore premikaš med mapami in jih razvrščaš (zgornja/spodnja ~25 % vrstice = pred/za – prikaže se črta; sredina = v mapo – obroba). Polje „⤒ Top level“ premakne mapo na koren. Zaprta mapa se med vlečenjem odpre po ~600 ms. Mape ni mogoče premakniti v lastno poddrevo.
- Dodajanje pogovora: izberi mapo (klik) → „+ Current chat“, ali **povleci** povezavo `/c/<id>` iz Grokovega seznama pogovorov na mapo.
- Iskanje po naslovih pogovorov in imenih map.
- **Barve map** (paleta 10 barv + brez) in **pisava imena mape** (Default/System/Sans/Humanist/Rounded/Serif/Mono + krepko/ležeče + velikost 10–24 px): klik na ikono mape. Pisava velja **samo za vrstico te mape** (ne deduje se na podmape/pogovore). Shranjeno kot neobvezno zadnje polje `style` (majhno število, izpuščeno pri privzetem) – brez dviga sheme; starejše verzije ga ignorirajo.
- **Oznake (tagi)** z imenom in barvo: gumb `#` na pogovoru/mapi (izbira, ustvarjanje), upravljanje v „Tags“ (preimenuj, prebarvaj, izbriši). Prikaz kot barvni čipi; klik na čip ali izbirnik „All tags“ filtrira; iskanje upošteva tudi imena oznak.
- **Samodejno posodabljanje naslovov** shranjenih pogovorov (`content/titles.js`): naslovi se berejo iz Grokovega seznama zgodovine (`/c/<id>`) in iz naslova odprtega pogovora; MutationObserver + preverjanje SPA navigacije, debounce ~2 s, en paketni zapis, piše se le ob dejanski spremembi. Neshranjeni pogovori se nikoli ne dodajo; nadomestni naslovi („New chat“ ipd.) se ignorirajo; zaščita pred „ping‑pong“ prepisi med zavihki. ⚠️ Selektorji/regex za naslove so ugibanje (adapter).
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
content/adapters/*.js    GF.makeAdapter (base.js) + konfiguracija za grok, grokx (Grok v X), chatgpt, claude, gemini, perplexity
content/dnd.js           vlečenje pogovorov iz stranske vrstice strani (native DnD v capture fazi + pointer fallback)
content/titles.js        samodejno posodabljanje naslovov (TitleWatcher)
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
- Mapa (v3): `[ime, parentId, vrstni_red, barva?, tagIds?, slog?, velikost?]` (slog: bit 0–2 pisava, bit 3 krepko, bit 4 ležeče; velikost v px kot ločeno zadnje polje, da 0.5.1 ostane združljiva); barve so indeksi palete (`GF.PALETTE`), privzete vrednosti na koncu se izpustijo.
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

## Dostop do strani (host permissions)
V Firefoxu MV3 je dostop do strani **izbiren**: ob posodobitvi se nove strani ne odobrijo samodejno in brez dostopa se vsebinski skript ne naloži (ni gumba 📁). Zato:
- ob namestitvi/posodobitvi se, če kakšna stran manjka, odpre stran `ui/permissions.html` s stanjem in gumbom **Grant access**;
- gumb razširitve v orodni vrstici (z rdečim „!“, če kaj manjka) zahteva manjkajoči dostop; ko je vse odobreno, odpre stran s stanjem;
- ročno: `about:addons` → SI Folders → Permissions. Po odobritvi znova naloži odprte zavihke.
- **0.5.3 doda x.com in twitter.com** (Grok v X): Firefox ob posodobitvi MV3 razširitve novih strani ne odobri in ne vpraša (bug 1893232) – posodobitev se namesti tiho, prikaže se „!“ na gumbu in odpre se `ui/permissions.html`; dostop odobriš s klikom na gumb ali v `about:addons`.

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
6. Testi: `node tests/import.test.js`, `node tests/move.test.js`, `node tests/tags.test.js`, `node tests/ui.test.js`, `node tests/titles.test.js`, `node tests/adapters.test.js`, `node tests/permissions.test.js`, `node tests/pagednd.test.js`, `node tests/prefs.test.js`, `node tests/folderstyle.test.js`, `node tests/grokx.test.js`, `node tests/normalize.test.js` (jsdom); dodati še `encode/decode/chunk`.
7. Adapterji za druge ponudnike (ChatGPT, Claude) prek istega vmesnika.
8. Zamenjava `prompt/confirm` z lastnimi dialogi v shadow DOM; i18n (`_locales`).
