# Frontend und Repository — nach Hausvorlage

Wie das GitHub-Frontend für die CRM-Schnittstelle konkret aufgebaut wird, und
zwar so, wie die übrigen DIHAG-Apps aufgebaut sind. Bezugspunkt ist
`rundumdenjob` (live auf `rundumdenjob.dihag.de`), dieselbe Bauweise nutzen
`powerbi` und `umfrage1`.

Dieses Dokument ergänzt `CLAUDE.md` — und **widerspricht dessen §3 und §4**.
Der Widerspruch ist der eigentliche Inhalt von Abschnitt 1. Nach der
Vorrangregel aus `CLAUDE.md` §1 ist das eine Rückfrage, keine Entscheidung:
solange §3 nicht geändert ist, gilt §3.

---

## 1. Der Widerspruch: Vite und MSAL gegen die Hausvorlage

`CLAUDE.md` §3 legt Vite als Build, npm als Paketquelle und
`@azure/msal-browser` ^5 als Anmeldebibliothek fest. **Keine einzige
DIHAG-App arbeitet so.** Die Begründung in §3 ist trotzdem richtig — sie
führt nur, zu Ende gedacht, woandershin.

| | `CLAUDE.md` §3 | Hausvorlage (`rundumdenjob`) |
|---|---|---|
| Build | Vite, `base: '/crm/'` | **keiner.** Repo-Wurzel = Pages-Wurzel |
| Auslieferung | GitHub Actions baut nach `dist/` | Pages liefert das Repo direkt aus |
| Module | ES-Module, gebündelt | `<script src>` in fester Reihenfolge, IIFE mit einem globalen Namen je Datei |
| Anmeldung | `@azure/msal-browser` ^5 | **OAuth2 Auth-Code + PKCE von Hand**, `js/auth.js`, 197 Zeilen, keine Bibliothek |
| Workflow | Build + Deploy | **nur Prüfung**: `node --check` über alle `js/*.js`, dann drei Testskripte |
| Konfiguration | `public/runtime-config.json` | `js/config.js` |

### Warum die Hausvorlage hier gewinnt

**Randbedingung 2 aus `CLAUDE.md` ist der Grund, nicht der Gegengrund.**
Sie lautet: „MSAL nur per npm-Bundle, nie per CDN — das MSAL-CDN ist seit v3
abgekündigt." Das stimmt, und man sieht es im Bestand: zehn ältere Apps
(`zapp`, `compliance`, `tickets`, `bedarfsanfrage`, `e-rechnung`,
`richtlinienmanagementsystem`, `dms`, `admin`, `besuchermanagement`,
`3d-space`) hängen an `alcdn.msauth.net/browser/2.38.x` fest — dem letzten
Stand, den das CDN je ausliefern wird.

Die drei neueren Apps ziehen daraus aber nicht den Schluss „dann npm",
sondern „dann ohne MSAL". `rundumdenjob/js/auth.js` macht Auth-Code + PKCE
selbst: 197 Zeilen, `crypto.subtle` für den Code-Challenge, `fetch` gegen
`/oauth2/v2.0/token`, Token im `sessionStorage`. Das ist der komplette
Umfang dessen, was diese App von MSAL braucht.

Damit lösen sich drei Randbedingungen von selbst auf:

- **Nr. 2** (kein CDN-MSAL) — es gibt gar kein MSAL.
- **Nr. 3** (`base: '/crm/'`) — entfällt mit dem Build. Alle Pfade sind relativ.
- **Nr. 4** (Redirect-URI bytegleich) — `auth.js` leitet die Redirect-URI aus
  `location` ab, schneidet `index.html` ab und erzwingt den Schrägstrich am
  Ende. Genau der Fehler, der `AADSTS50011` erzeugt, ist damit baulich
  ausgeschlossen, und dieselbe Auslieferung läuft unter eigener Domäne **und**
  unter `github.io`.

Dazu kommt der Wartungsgrund: Die CRM-Schnittstelle wäre die einzige App im
Bestand mit `node_modules`, Lockfile und Build-Schritt. Wer sie in zwei
Jahren anfasst, müsste für dieses eine Repo eine andere Werkzeugkette
kennen.

### Was das kostet

Ehrlich gegengerechnet, drei Punkte:

- **Kein Bundler heißt keine Baumschüttelung und kein Minifizieren.** Bei
  rund 4.400 Zeilen JavaScript in `rundumdenjob` ist das messbar irrelevant.
- **Kein npm heißt: Fremdbibliotheken kommen per `<script>`.** Betrifft hier
  genau eine, SheetJS — siehe §7. Der Bestand hat dafür ein Muster.
- **Kein TypeScript.** `CLAUDE.md` §3 will ohnehin nur JSDoc-Typen; die
  Hausvorlage macht das genauso.

**Vorschlag:** `CLAUDE.md` §3 und §4 auf die Hausvorlage umstellen, Nr. 2
und Nr. 3 in §2 streichen, Nr. 4 als „durch `auth.js` erledigt" markieren.
Alles Übrige aus `CLAUDE.md` bleibt unberührt — siehe §11.

---

## 2. Was die Hausvorlage konkret vorgibt

Nachgesehen in `rundumdenjob`, nicht aus dem Gedächtnis.

### Aufbau

```
rundumdenjob/
├─ index.html              100 Zeilen: Boot-Schirm, Kein-Zugriff-Schirm, App
├─ CNAME                   rundumdenjob.dihag.de
├─ assets/dihag-logo.png
├─ css/styles.css          493 Zeilen, :root mit den CI-Farben
├─ js/
│  ├─ config.js            EINE Stelle für IDs, Pfade, Listennamen
│  ├─ auth.js              PKCE, stiller SSO, Token im sessionStorage
│  ├─ graph.js             Graph-Aufrufe, Site-/Listen-Auflösung, Paging, Cache
│  ├─ data.js              Benutzerkontext, Rolle, Sichtbarkeitslogik
│  └─ app.js               Oberfläche
├─ tests/                  *.mjs, laufen unter Node ohne Browser
├─ .github/workflows/pruefung.yml
├─ README.md
├─ LISTEN-ANLEGEN.md
├─ SESSION_LOG.md
└─ setup-rundumdenjob.ps1
```

### Konventionen

- Jede JS-Datei beginnt mit `"use strict";` und einem Blockkommentar, der
  sagt, wofür die Datei da ist.
- Ein globaler Name je Datei, per IIFE: `RUDJ_CONFIG`, `AUTH`, `GRAPH`,
  `DATA`, `APP`. Die Reihenfolge der `<script>`-Tags in `index.html` ist die
  Abhängigkeitsreihenfolge und in `index.html` auskommentiert, wo sie nicht
  offensichtlich ist.
- Kommentare, Bezeichner, Commits, Oberfläche: **deutsch**.
- Kommentare begründen, sie beschreiben nicht. In `config.js` steht nicht
  „Client-ID", sondern warum diese Registrierung und nicht die andere.
- Drei Vollbild-Zustände in `index.html`: `#boot` (Anmeldung läuft),
  `#noAccess` (angemeldet, aber keine Rolle), `#app`.

### Der Workflow prüft, er baut nicht

`.github/workflows/pruefung.yml` läuft bei Push und PR:

```yaml
- name: Syntax aller JavaScript-Dateien
  run: |
    fehler=0
    for f in js/*.js tests/*.mjs; do
      if node --check "$f"; then echo "  ok   $f"
      else echo "  FEHLER $f"; fehler=1; fi
    done
    exit $fehler
```

Die Begründung steht im Workflow selbst: „die Seite wird ohne Build-Schritt
ausgeliefert, es gibt also keine zweite Instanz, die das abfängt." Danach
laufen drei Node-Testskripte gegen die Kernlogik.

Für die CRM-App sind die Kandidaten dafür klar — es sind die Stellen, an
denen ein stiller Fehler Daten kostet:

| Test | prüft |
|---|---|
| `test-transforms.mjs` | `decimal:de`, `date:auto`, `empty2null`, `zero2null` |
| `test-mapping.mjs` | Zeile + Mapping → Nutzlast; Schlüsselfelder **nicht** im Rumpf |
| `test-schluessel.mjs` | Sonderzeichen `/ < > * % & : \ ? +` in Schlüsselwerten (Review A2) |
| `test-planer.mjs` | Schrittreihenfolge, Abschlüsse zuletzt |
| `test-konsistenz.mjs` | `config.js` gegen README und Doku |

---

## 3. Repository anlegen

| | |
|---|---|
| Name | `crm` |
| Sichtbarkeit | öffentlich (Pages auf privaten Repos braucht ein kostenpflichtiges Konto; Randbedingung 1 — kein Secret — gilt ohnehin) |
| Pages | Quelle „Deploy from a branch", `main`, `/` |
| URL | `https://dfedorov12.github.io/crm/` |
| Eigene Domäne | siehe unten |

```
crm/
├─ index.html
├─ CNAME
├─ .nojekyll
├─ assets/dihag-logo.png          aus rundumdenjob/assets/ übernehmen
├─ css/styles.css
├─ js/
│  ├─ config.js
│  ├─ auth.js                     aus rundumdenjob, um §4 erweitert
│  ├─ graph.js                    aus rundumdenjob, weitgehend unverändert
│  ├─ dataverse.js                NEU: Batch, Upsert, Retry, Throttling
│  ├─ spFiles.js                  NEU: Bibliothek listen, Datei laden, Status setzen
│  ├─ spListen.js                 NEU: Konfigurationslisten, Protokoll
│  ├─ excel.js                    NEU: SheetJS-Kapsel, Kopfzeilen normalisieren
│  ├─ mapping.js                  NEU: Zeile + Mapping → Nutzlast
│  ├─ transforms.js               NEU
│  ├─ pruefung.js                 NEU: Validierung, Prüfbericht
│  ├─ planer.js                   NEU: Profil → Schrittliste
│  ├─ lauf.js                     NEU: Ausführung, Fortschritt, Abbruch
│  └─ app.js                      Oberfläche, sechs Schritte
├─ tests/
├─ .github/workflows/pruefung.yml
├─ docs/                          00–08, dieses Dokument eingeschlossen
├─ config/import-profile.dihag.json
├─ README.md
├─ SESSION_LOG.md
└─ setup-crm.ps1
```

`.nojekyll` verhindert, dass GitHub Pages die Dateien durch Jekyll schickt.
Solange keine Datei mit Unterstrich beginnt, ändert es nichts — es kostet
aber auch nichts und `compliance` hat es aus gutem Grund.

### Eigene Domäne — und warum sie mehr ist als Kosmetik

`CLAUDE.md` §11 nennt als Sicherheitspunkt: `dfedorov12.github.io` ist **ein
gemeinsamer Origin für alle Repos dieses Kontos**, jede andere Pages-Seite
dort kommt an denselben `sessionStorage` und damit an ein dort liegendes
Token. Als Konsequenz steht dort „für den Dauerbetrieb eigene Domain oder
Azure Static Web Apps".

Eine eigene Domäne per `CNAME` ist bereits die vollständige Lösung dieses
Punktes: `crm.dihag.de` ist ein anderer Origin als `dfedorov12.github.io`.
`rundumdenjob.dihag.de` und `zapp.dihag.de` machen genau das. Ein Umzug zu
Azure Static Web Apps ist dafür nicht nötig.

Eine Bedingung: Ist die App unter beiden Adressen erreichbar, landen Token
bei einem Aufruf über `github.io` doch wieder auf dem gemeinsamen Origin.
`rundumdenjob` löst das, indem die `github.io`-Adresse auf die eigene Domäne
umleitet. Für `crm` genauso — und dann nur die eigene Domäne als
Redirect-URI in Entra eintragen.

---

## 4. Anmeldung: zwei Ressourcen, ein Login

Das ist die **einzige Stelle, an der die Vorlage nicht ausreicht**, und
zugleich die, an der man am leichtesten in eine Sackgasse läuft.

`rundumdenjob` braucht ein Token für eine Ressource: Microsoft Graph. Die
CRM-App braucht zwei — Graph für SharePoint und Dataverse für das CRM. Der
v2-Endpunkt gibt ein Access-Token aber **immer für genau eine Ressource**
aus. Beide Scope-Sätze in dieselbe `/authorize`-Anfrage zu schreiben,
scheitert.

Der Weg ist der, den MSAL intern auch geht: **einmal anmelden, dann den
Refresh-Token je Ressource einlösen.** Der Refresh-Token gilt
ressourcenübergreifend für alles, dem zugestimmt wurde.

`rundumdenjob/js/auth.js` fordert `offline_access` bereits an und bekommt
den Refresh-Token folglich schon heute — und wirft ihn weg. Ihn zu behalten
ist eine Zeile.

### Änderungen an `auth.js`

```js
/* Je Ziel ein eigener Scope-Satz. Ein Access-Token gilt immer für genau
   eine Ressource; der Refresh-Token dagegen für alle, denen zugestimmt
   wurde. Deshalb: einmal anmelden (Graph), danach je Ressource einlösen. */
const RES = {
  graph:     ["User.Read", "Sites.ReadWrite.All"],
  dataverse: [CRM_CONFIG.dataverseUrl + "/user_impersonation"]
};

/** Access-Token für eine Ressource. */
async function getToken(res = "graph") {
  const c = ladeTok(res);
  if (c) return c;
  const rt = ss.get("crm_rt");
  if (rt) {
    const t = await einloesen(rt, res);
    if (t) return t;
  }
  throw new Error("Nicht angemeldet");
}

async function einloesen(rt, res) {
  const r = await fetch(TU, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CID,
      grant_type: "refresh_token",
      refresh_token: rt,
      scope: [...RES[res], "offline_access"].join(" ")
    }).toString()
  });
  const d = await r.json().catch(() => ({}));
  if (d.error) return null;                                  // z. B. interaction_required
  if (d.refresh_token) ss.set("crm_rt", d.refresh_token);    // Rotation – sonst ist der nächste ungültig
  saveTok(res, d.access_token, Date.now() + (d.expires_in || 3600) * 1000);
  return d.access_token;
}
```

Dazu: `saveTok`/`ladeTok` bekommen die Ressource als Schlüsselbestandteil
(`crm_t_graph`, `crm_t_dataverse`), und in `handleRedirect` wird
`d.refresh_token` gespeichert.

### Vier Fallstricke

**Rotation.** Jede Einlösung liefert einen neuen Refresh-Token und
entwertet den alten. Wer den neuen nicht zurückschreibt, hat beim übernächsten
Aufruf einen ungültigen — und der Fehler tritt zeitversetzt und scheinbar
zufällig auf.

**24 Stunden.** Refresh-Token, die an eine Single-Page-Anwendung ausgegeben
werden, leben 24 Stunden und lassen sich nicht darüber hinaus verlängern.
Für eine Sitzung, in der jemand einen Import startet, ist das reichlich;
danach greift der stille Redirect (`prompt=none`) wie beim ersten Aufruf.

**Zustimmung.** Ist für `user_impersonation` keine Administratorzustimmung
erteilt (`docs/01`, §2), schlägt die Einlösung für Dataverse mit
`interaction_required` fehl. `getToken` muss dann auf `startLogin` mit den
Dataverse-Scopes zurückfallen, statt einen leeren Fehler zu werfen.

**Plattformtyp.** Der Token-Endpunkt akzeptiert die Anfrage aus dem Browser
nur, wenn die Redirect-URI unter der Plattform **Single-Page-Anwendung**
eingetragen ist. Unter „Web" gibt es CORS-Fehler beim `POST` auf `/token`,
und die Meldung zeigt nicht dorthin. `docs/01` §1 deckt das ab.

### Korrektur an `docs/01`

Dort steht als zweite Redirect-URI `http://localhost:5173/` — die
Vite-Entwicklungsadresse. Ohne Vite ist sie falsch. Ein statischer Server
tut es:

```bash
python -m http.server 8080
```

Dann `http://localhost:8080/` eintragen, oder den Eintrag ganz weglassen
und gegen Pages entwickeln. `localhost` ist ein sicherer Kontext, deshalb
funktioniert `crypto.subtle` dort trotz `http`.

---

## 5. `js/config.js`

Startfassung. Die mit `KLAEREN` markierten Werte sind die offenen Punkte aus
`CLAUDE.md` §13 und dürfen nicht geraten werden.

```js
"use strict";

/* Zentrale Konfiguration – DIHAG CRM Schnittstelle
   ------------------------------------------------
   Einzige Stelle, an der IDs und Pfade angepasst werden. */

const CRM_CONFIG = {

  /* ── Entra ID / Anmeldung ──────────────────────────────────────── */
  tenantId: "fdb70646-023a-403b-a4b9-1f474a935123",

  // Eigene Registrierung „DIHAG CRM Schnittstelle" – NICHT die der ZAPP-App.
  // Sie braucht Dynamics CRM user_impersonation, das hat keine andere.
  // Redirect-URIs unter „Authentifizierung → Single-Page-Anwendung":
  //   https://crm.dihag.de/   (siehe setup-crm.ps1)
  clientId: "b6078457-e2ab-41e7-91a1-b49dfaf9d532",

  /* ── Dataverse ─────────────────────────────────────────────────── */
  dataverseUrl: "KLAEREN_https://<org>.crm4.dynamics.com",
  apiVersion:   "v9.2",

  // Wird dauerhaft als farbiges Band im Kopf angezeigt. PROD in Rot.
  umgebung: "TEST",

  /* ── SharePoint: Quelldateien ──────────────────────────────────── */
  // Über Namen aufgelöst, nie über GUIDs – der Altflow verdrahtet die
  // Bibliotheks-GUID fest und scheitert daran beim Umzug (Befund B9).
  quellSite:    "dihag.sharepoint.com:/sites/IT",
  quellDrive:   "Austausch",              // KLAEREN: Bibliothek oder Ordner?
  quellOrdner:  "/Projekt CRM-Timeline",

  /* ── SharePoint: Steuerung und Protokoll ───────────────────────── */
  konfigSite: "dihag.sharepoint.com:/sites/CRM-Integration",
  listen: {
    profile:   "CRM_ImportProfiles",
    mappings:  "CRM_FieldMappings",
    werte:     "CRM_ValueMappings",
    laeufe:    "CRM_ImportRuns",
    fehler:    "CRM_ImportErrors"
  },

  /* ── Zugriffssteuerung ─────────────────────────────────────────── */
  permSite: "dihag.sharepoint.com:/sites/IT",
  permList: "AppPermissions",
  appKey:   "crm",

  // Abweichend von rundumdenjob: KEINE Standardrolle. Wer nicht in
  // AppPermissions steht, sieht den Kein-Zugriff-Schirm. Ein Importwerkzeug
  // ist kein Portal.
  defaultRole: "none",
  hauptAdmins: ["administrator@dihag.com"],

  /* ── Laufzeit ──────────────────────────────────────────────────── */
  batchSize: 100,
  maxParallel: 4,
  suppressDuplicateDetection: true,

  scopes: ["User.Read", "Sites.ReadWrite.All"]
};
```

**`runtime-config.json` entfällt.** Der Zweck aus `CLAUDE.md` §5 war,
zwischen Test und Produktion zu wechseln, „ohne neu zu bauen". Ohne Build
gibt es nichts zu bauen — `js/config.js` ist genauso ohne Rebuild änderbar,
und die Datei liegt ohnehin im Repo, ein Commit ist also in beiden Fällen
nötig. Eine Datei statt zwei, wie in jeder anderen App.

---

## 6. Corporate Design — nicht mehr offen

`CLAUDE.md` §12 stellt Phase 8 hinten an, „erst wenn die Vorlage vorliegt",
und §13 führt „Corporate-Design-Vorlage" als offenen Punkt. **Sie liegt
vor.** `rundumdenjob/css/styles.css` beginnt mit einem vollständigen
Token-Satz:

```css
:root {
  --azur:      #17509E;
  --navy:      #1A2644;
  --anthrazit: #424241;
  --lichtblau: #99B7CD;
  --orange:    #F08300;

  --azur-dark: #113f7c;
  --bg:        #f2f5f9;
  --card:      #ffffff;
  --text:      var(--anthrazit);
  --muted:     #6d7d8e;
  --border:    #d7e0ea;
  --green:     #1e7e34;  --green-bg: #e6f4ea;
  --red:       #b02a37;  --red-bg:   #fdecea;
  --radius:    12px;
  --shadow:    0 1px 2px rgba(26,38,68,.06), 0 4px 16px rgba(26,38,68,.06);
  --maxw:      1180px;
}
```

Schrift ist **Exo** über Google Fonts, mit `"Segoe UI", system-ui` als
Rückfall. Logo: `assets/dihag-logo.png`, im Kopf über
`filter: brightness(0) invert(1)` weiß auf Navy.

Damit kehrt sich die Reihenfolge um: Das CI kommt in **Phase 1** und nicht
in Phase 8. „Schlichtes, neutrales CSS, damit der Umbau später eine
Farbdatei ist" löst ein Problem, das nicht mehr besteht — und erzeugt
stattdessen einen zweiten Anlauf.

Direkt übernehmbar sind außerdem der Boot-Schirm (`#boot`, Navy-Verlauf,
Spinner in Orange), der Kein-Zugriff-Schirm (`#noAccess`) und die
Kopfleiste. Das ist der sichtbare Teil der Phasen 1 und 2, fertig.

### Das Umgebungsband

`CLAUDE.md` §5 verlangt ein dauerhaftes Band mit `TEST`/`PROD`, „damit
niemand versehentlich ins Produktivsystem importiert". Im Token-Satz ist
das vorhanden: `--orange` für TEST, `--red` für PROD. Text ausgeschrieben,
nicht nur Farbe — Farbe allein ist keine Information, und rot-grün-blind
ist ungefähr jeder zwölfte Mann.

---

## 7. SheetJS

Die einzige Fremdbibliothek. `CLAUDE.md` §3 erlaubt sie ausdrücklich, und
das Haus hat ein Muster dafür — `bedarfsanfrage/app.js`:

```js
// SheetJS (xlsx) erst bei Bedarf nachladen – spart ~900 KB beim Start
let _xlsxPromise = null;
function ensureXLSX() {
  if (typeof XLSX !== 'undefined') return Promise.resolve();
  if (_xlsxPromise) return _xlsxPromise;
  _xlsxPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload  = () => resolve();
    s.onerror = () => { _xlsxPromise = null; reject(new Error('SheetJS konnte nicht geladen werden')); };
    document.head.appendChild(s);
  });
  return _xlsxPromise;
}
```

Version fest gepinnt, nachgeladen erst beim Öffnen einer Datei. Zwei
Anmerkungen:

- **Fehlerpfad.** `onerror` wirft eine verständliche Meldung, statt die App
  stumm hängen zu lassen. Das ist Randbedingung 8.
- **Alternative.** Wer die Abhängigkeit von einem fremden CDN ganz vermeiden
  will, legt `js/vendor/xlsx.full.min.js` in das Repo. Ohne Build ist eine
  eingecheckte Datei kein Bruch, und sie ist versioniert, prüfbar und
  ausfallsicher. Für ein Werkzeug, das Firmendaten ins CRM schreibt, spricht
  einiges dafür.

---

## 8. Zugriffssteuerung über `AppPermissions`

Bestehende Liste auf `/sites/IT`, genutzt von `rundumdenjob`, `powerbi`,
`umfrage1`, `tickets`, `3d-space`. Ein Eintrag mit `App = *` gilt
app-übergreifend, `App = crm` nur hier.

| Rolle | Darf |
|---|---|
| `none` (Standard) | nichts — Kein-Zugriff-Schirm |
| `viewer` | Läufe und Protokolle ansehen |
| `editor` | Prüflauf starten, Import ausführen |
| `admin` | zusätzlich Profile und Feldzuordnungen bearbeiten |

Der Unterschied zu `rundumdenjob` ist `defaultRole`. Dort ist er `viewer`,
weil jeder im Tenant das Mitarbeiterportal sehen soll. Hier ist er `none`:
Wer nicht ausdrücklich eingetragen ist, kommt nicht hinein.

Das beantwortet zugleich die Prozessfrage aus `CLAUDE.md` §13 — **wer den
Import künftig startet, ist eine Zeile in `AppPermissions`.** Ob die
Fachabteilung `editor` bekommt oder nur die IT, muss trotzdem entschieden
werden; die Technik nimmt die Entscheidung nur nicht vorweg.

Übernehmbar aus `rundumdenjob/js/data.js`: `loadRole()`, die
`RANK`-Tabelle und die Domänenauswertung. Aus `js/app.js`: der
Kein-Zugriff-Schirm samt Knopf „Freigabe anfragen", der eine Mail an die IT
schickt — das erspart die Rückfrage, wie man denn nun Zugriff bekommt.

---

## 9. `setup-crm.ps1`

`docs/02` schlägt für die SharePoint-Listen ein PnP-PowerShell-Skript vor
und `docs/01` §5 richtet dafür eigens die Plattform „Mobile Geräte und
Desktopanwendungen" ein, mit `Öffentliche Clientflows: Ja`.

**Beides ist nicht nötig.** `setup-rundumdenjob.ps1` benutzt das Modul
`Microsoft.Graph`, das keine eigene App-Registrierung braucht:

```powershell
Install-Module Microsoft.Graph -Scope CurrentUser
Connect-MgGraph -UseDeviceCode `
                -Scopes "Application.ReadWrite.All","Sites.Manage.All",`
                        "Sites.ReadWrite.All","User.Read.All"
./setup-crm.ps1
```

Damit entfällt `docs/01` §5 ersatzlos, und die App-Registrierung bleibt auf
`Öffentliche Clientflows: Nein` — weniger Angriffsfläche, wie dort selbst
angemerkt.

Das Skript sollte, der Vorlage folgend, vier Dinge tun:

1. Redirect-URI unter der SPA-Plattform ergänzen (`docs/01` §1)
2. Die vier Statusspalten in der Quellbibliothek anlegen (`docs/02`, Teil A)
3. Die fünf `CRM_*`-Listen anlegen (`docs/02`, Teil B)
4. Den Haupt-Administrator in `AppPermissions` eintragen

Und den Hinweis aus der Vorlage mitnehmen: Das Anlegen von Listen scheitert
mit `403`, wenn das angemeldete Konto auf der Site keinen Vollzugriff hat.
Dafür gibt es dort die App-only-Betriebsart (`-AppOnly`); sie ist
übernehmbar.

**Wichtig, aus `docs/02`:** SharePoint friert den internen Spaltennamen beim
Anlegen ein. Das Skript legt technisch an (`SourceColumn`) und stellt die
Anzeige danach auf Deutsch um. Wer klickt, muss dasselbe tun — sonst heißt
die Spalte intern `Quell_x0020_Spalte`.

---

## 10. Umsetzungsreihenfolge, angepasst

`CLAUDE.md` §12 bleibt inhaltlich gültig. Was sich verschiebt:

| Phase | Neu | Warum |
|---|---|---|
| 1 | `index.html`, `css/styles.css` **mit CI**, `js/config.js`, Workflow, Pages an | Kein Vite-Gerüst. CI ist vorhanden (§6), also gleich richtig. Halber Tag statt Phase 8. |
| 2 | `auth.js` aus `rundumdenjob` + Erweiterung §4, Boot- und Kein-Zugriff-Schirm, `WhoAmI` | Anmeldung und Zugriffssteuerung in einem. Der `WhoAmI`-Aufruf ist zugleich der CORS- und der Berechtigungstest. |
| 3 | `graph.js` **weitgehend unverändert übernehmen**, `spFiles.js` neu | 264 Zeilen mit Site-/Listen-Auflösung, Paging über `@odata.nextLink`, Metadaten-Cache und Spaltennamen-Toleranz sind fertig. |
| 4 | `spListen.js`, `mapping.js`, `transforms.js` | wie gehabt |
| 5 | `dataverse.js` (Phase 0 + Batch + Throttling), `pruefung.js` | unverändert der kritische Teil |
| 6 | `planer.js`, `lauf.js` | unverändert |
| 7 | Protokoll nach SharePoint | unverändert |
| 8 | **entfällt** | in Phase 1 aufgegangen |

Die ersten drei Phasen schrumpfen dadurch spürbar — sie bestehen zum
größeren Teil aus Übernehmen und Anpassen. Der Aufwand liegt danach, in
`dataverse.js` und der Auflösungsphase, und das ist die richtige Verteilung:
Dort steht auch das fachliche Risiko.

---

## 11. Was aus `CLAUDE.md` unverändert bleibt

Damit der Umfang der Änderung klar ist — betroffen sind **§3, §4, §5 sowie
die Randbedingungen 2 und 3**. Alles Folgende gilt weiter, ohne Abstrich:

- Die Rollenverteilung GitHub / SharePoint / Dataverse / Entra (§1)
- Prüflauf vor jedem Schreibzugriff, ohne Umgehung (Randbedingung 5)
- Upsert über Alternativschlüssel statt blindem `POST` (6)
- `Retry-After` bei `429` (7), kein `alert()`, keine stillen `catch` (8)
- Token im `sessionStorage` (9) — die Vorlage macht genau das
- Oberfläche und Code auf Deutsch (10)
- Kopfzeilen trimmen (11)
- Kein Datensatz ohne Protokolleintrag (12)
- Die gesamte Auflösungsphase (§8), Schreibrichtlinien, Importreihenfolge
  (§9), Protokollierung (§10)
- Sämtliche Befunde und Regeln aus `docs/05`, `docs/06` und `docs/07`

Die Änderung betrifft die Werkzeugkette, nicht die Fachlogik.

---

## 12. Was dieses Dokument nicht auflöst

Unverändert offen aus `CLAUDE.md` §13, hier nur um die neuen Punkte ergänzt:

**Blockierend:**

- [ ] `dataverseUrl` der Testumgebung
- [ ] Alternativschlüssel an `opportunity` für die Opp-ID
- [ ] Ist `dag_dihag_kdnr` eindeutig?
- [ ] Führt `Firma` die Kundennummer oder den Namen?
- [ ] Heißt die Bibliothek unter `/sites/IT` wirklich `Austausch`?

**Neu, durch dieses Dokument:**

- [ ] **Wird §3 umgestellt?** Ohne Entscheidung gilt weiter Vite und MSAL.
- [ ] Eigene Domäne — `crm.dihag.de` oder ein anderer Name? Braucht einen
      DNS-Eintrag; ohne sie greift der Origin-Punkt aus `CLAUDE.md` §11.
- [ ] SheetJS vom CDN oder eingecheckt (§7)?
- [ ] Wer bekommt `editor` in `AppPermissions` — Fachabteilung oder IT? Das
      ist die Prozessfrage aus §13, jetzt als konkrete Eintragung.

---

*Grundlage: `rundumdenjob` (Stand 02.09.2026), quergelesen gegen `zapp`,
`compliance`, `powerbi`, `umfrage1`, `bedarfsanfrage` und `hinweis`.*
