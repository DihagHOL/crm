# Session-Log

## 02.09.2026 — Phase 6 und 7: Import und Protokoll

Damit ist die Pipeline vollständig: anmelden, Datei wählen, Zuordnung
prüfen, Prüflauf, Import, Protokoll.

**Der Import.** `js/batch.js` baut und liest die Batch-Anfragen,
`js/lauf.js` führt sie aus. Eigenständige Anfragen mit
`Prefer: odata.continue-on-error` — eine kaputte Zeile lässt die anderen 99
durch. **Ausnahme: die Positionen.** Sie werden je Verkaufschance in EINEM
Changeset ersetzt, erst löschen, dann anlegen, atomar. Der Altflow löscht,
wartet 60 Sekunden und legt dann an; bricht er dazwischen ab, sind die
Positionen weg (Befund B3). Im Changeset kann das nicht passieren.

Drosselung nach `Retry-After`, nie mit festem Sleep. Nach drei Drosselungen
in Folge geht die Parallelität dauerhaft auf 1. Abbruch über
`AbortController` — ein Import über 8.000 Zeilen, den man nicht stoppen
kann, ist ein Fehler und kein Feature.

**Das Protokoll.** Laufeintrag in `CRM_ImportRuns`, Fehlerzeilen in
`CRM_ImportErrors` (gedeckelt bei 200 — ein Lauf mit 8.000 kaputten Zeilen
soll keine 8.000 Listeneinträge erzeugen), und das Vollprotokoll als
JSON-Datei. Danach wird die Quelldatei als importiert markiert.

*Abweichung von `docs/02`:* Dort ist das Vollprotokoll eine Anlage am
Listeneintrag. Microsoft Graph kann Anlagen an SharePoint-Listeneinträgen
aber nicht schreiben — das ginge nur über die SharePoint-REST-API mit einem
anderen Token. Es liegt jetzt als Datei in der Dokumentbibliothek, der
Laufeintrag verweist darauf.

**Mehrfachtreffer werden entschieden, nicht geraten.** Ein doppelter
Schlüsselwert war vorher ein Fehler und blockierte den Import. Jetzt listet
der Prüflauf die Kandidaten auf, jemand wählt, und die Wahl steht im
Protokoll. Damit sind die 7 verbliebenen doppelten Kundennummern kein
Blocker mehr.

**Zwei Fehler, die die Tests gefunden haben:**

Beim Auswerten der Batch-Antwort hatte ich die Grenze als `batch_…`
erwartet — Dataverse antwortet aber mit `batchresponse_…`, und Changesets
kommen als `changesetresponse_…` zurück. Gelesen wurde dadurch nur der
erste Teil. Jetzt wird an jeder Zeile geteilt, die mit `--` beginnt; der
Name wird nicht mehr vorhergesagt.

Und: `ReplaceByParent` brauchte die vorhandenen Positionen zum Löschen, die
Phase 0 gar nicht abgefragt hat. Ein Ersetzen, das nur anlegt, verdoppelt
die Positionen still. Die Abfrage ist ergänzt.

**Durchgespielt** mit gestellten Netzantworten: Prüflauf sagt „1 neu, 1
geändert, 1 unverändert", der Import liefert „1 angelegt, 1 aktualisiert,
1 unverändert" — die Vorhersage deckt sich mit dem Ergebnis. Protokoll
geschrieben, Vollprotokoll verlinkt, Quelldatei markiert.

**91 Prüfungen in sieben Testdateien**, alle im Workflow.

**Offen:** die 7 doppelten Kundennummern (werden jetzt in der App
entschieden), `SetStage` und `CloseOpportunity` (fachlich zurückgestellt),
und ein erster Lauf gegen die echte Datei.

---

## 02.09.2026 — Phase 3: Dateien aus SharePoint

Erste Phase mit echten Daten. `js/spFiles.js` (Bibliothek auflisten, Datei
laden, Status setzen) und `js/excel.js` (SheetJS-Kapsel), dazu Schritt 3 in
der Oberfläche: Mappenliste mit Importstatus, Vorschau je Blatt mit den
ersten 20 Zeilen.

**Zwei Fallen, die hier eingebaut sind, weil der Altflow in beide tritt:**

*Kopfzeilen werden normalisiert.* „Breite (mm) “ und „Höhe (mm) “ haben in
der echten Datei ein Leerzeichen am Ende; ein exakter Vergleich träfe nie
und der Wert ginge stumm verloren. Die Vorschau meldet, welche Kopfzeile
angefasst werden musste — dann weiß man, dass die Vorlage unsauber ist,
ohne dass der Import daran scheitert.

*Die echte Excel-Zeilennummer wird mitgeführt.* Jede Zeile trägt `_zeile`,
die Nummer wie in Excel sichtbar. Beinahe wäre das schiefgegangen: mit
`blankrows: false` entfernt SheetJS Leerzeilen aus dem Array und alle
folgenden Zeilennummern verschieben sich. Jetzt `blankrows: true`, und das
Überspringen passiert dort, wo der Index noch stimmt.

**Testbar gemacht.** Die Umsetzung von Rohzeilen in Zeilenobjekte steckt in
`blattAus()` — ohne SheetJS, ohne Browser. `tests/test-excel.mjs` prüft sie
mit den Eigenheiten aus `docs/06`: 18 Prüfungen, unter anderem dass eine
Leerzeile die Nummern der folgenden nicht verschiebt (2, 3, **5**).

**Zwei Darstellungsfehler gefunden und behoben:** Die Hausvorlage setzt
Abschnittsüberschriften und Tabellenköpfe in Versalien. Für Dateinamen und
Excel-Spaltennamen ist das falsch — beides ist Inhalt, keine Beschriftung.
„BREITE (MM)“ erkennt niemand als seine Spalte wieder.

Geprüft im Browser mit einer echten, zur Laufzeit erzeugten Mappe: beide
Blätter erkannt, zwei Kopfzeilen normalisiert gemeldet, Zeilennummern
2/3/5 korrekt, keine Konsolenfehler.

---

## 02.09.2026 — Infrastruktur steht

Alles eingerichtet, was die App braucht, bevor sie Daten anfassen kann.

| | Stand |
|---|---|
| Entra: Umleitungs-URI, alle vier Berechtigungen erteilt | ✅ |
| `dataverseUrl` = `https://dihag-test.crm4.dynamics.com` | ✅ |
| Quellbibliothek `Austausch` + vier Statusspalten | ✅ |
| Konfigurationssite `/teams/crm-integration` | ✅ |
| Fünf `CRM_*`-Listen (21 / 24 / 12 / 23 / 17 Spalten) | ✅ |
| `AppPermissions`-Eintrag für `crm` | ✅ |

**Zwei Stolpersteine, die Zeit gekostet haben und deshalb dokumentiert sind:**

`admin-consent` erteilt nur, was **deklariert** ist — und ersetzt dabei die
bestehende Zustimmung. Für Graph war nur `User.Read` deklariert, zugestimmt
waren aber auch `Sites.ReadWrite.All` und `offline_access`. Beide fielen weg,
und ohne `offline_access` gibt es keinen Refresh-Token — also auch kein
Dataverse-Token. Die Zustimmung für Dataverse allein half nichts. Regel in
`docs/01`: erst deklarieren, dann zustimmen.

Die Konfigurationssite liegt unter **`/teams/crm-integration`**, nicht unter
`/sites/CRM-Integration`. Der Tenant benutzt den verwalteten Pfad `/teams/`
und den `mailNickname` der Gruppe statt ihres Anzeigenamens.

**Was nicht ging:** Listen und Spalten mit dem Token der Azure CLI anlegen.
Der trägt keinen `Sites.*`-Scope, und Microsoft hat die CLI dafür nicht
vorautorisiert (`AADSTS65002`) — keine Zustimmungsfrage, sondern eine
Vorautorisierung, die es nicht gibt. Gelaufen ist es dann über
`Connect-MgGraph` mit dem Teilmodul `Microsoft.Graph.Authentication`.

**Fehler im eigenen Skript**, durch den Trockenlauf gefunden:
`Ensure-Columns` lief auch für noch nicht existierende Listen und brach
mitten im Bericht mit 404 ab. Eine fehlende Liste ist jetzt eine Zeile im
Bericht statt eines Abbruchs.

**Noch offen:** Alternativschlüssel an `opportunity` für die Opp-ID
(Befund B2) und die Anlagen in `CRM_ImportRuns` (über Graph nicht setzbar).

---

## 02.09.2026 — Phase 1 und 2: Gerüst, Anmeldung, Selbsttest

**Ausgangslage.** Spezifikation und Analysen lagen fertig vor (`docs/00`–`07`).
Gebaut war noch nichts.

**Entscheidung: Bauweise nach Hausvorlage statt Vite/MSAL.**
`CLAUDE.md` §3 legte Vite, npm und `@azure/msal-browser` ^5 fest. Der
Abgleich mit dem Bestand ergab, dass keine der 15 DIHAG-Apps so gebaut ist:

- Zehn ältere Apps (`zapp`, `compliance`, `tickets`, `bedarfsanfrage`,
  `e-rechnung`, `richtlinienmanagementsystem`, `dms`, `admin`,
  `besuchermanagement`, `3d-space`) laden MSAL v2 von
  `alcdn.msauth.net/browser/2.38.x` — dem letzten Stand, den das CDN je
  ausliefern wird.
- Die drei neueren (`rundumdenjob`, `powerbi`, `umfrage1`) ziehen daraus
  nicht den Schluss „dann npm“, sondern „dann ohne MSAL“: Auth-Code + PKCE
  von Hand, 197 Zeilen, kein Build.

Randbedingung 2 aus `CLAUDE.md` war damit der Grund für die Hausvorlage, nicht
der Gegengrund. Mit ihr entfallen auch Randbedingung 3 (`base: '/crm/'`) und
der Fallstrick hinter Nr. 4: `auth.js` leitet die Umleitungs-URI aus
`location` ab, `AADSTS50011` ist baulich ausgeschlossen.

Analyse und Begründung: `docs/08-frontend-github.md`. Nach Freigabe wurden
`CLAUDE.md` §1, §2 (Nr. 2–4), §3, §4, §5, §12 und §13 nachgezogen.

**Gebaut.**

| Datei | Inhalt |
|---|---|
| `index.html` | Boot-Schirm, Kein-Zugriff-Schirm, Kopfbereich mit Umgebungsband, Schrittleiste |
| `css/styles.css` | CI-Token-Satz aus `rundumdenjob`, Grundformen |
| `js/config.js` | eine Stelle für alles; `istOffen()` für `KLAEREN_`-Werte |
| `js/auth.js` | PKCE, stiller SSO, **zwei Ressourcen über einen Refresh-Token** |
| `js/graph.js` | aus `rundumdenjob` übernommen, ergänzt um `Retry-After` und Bibliothekszugriff |
| `js/dataverse.js` | Grundzugriff, Wiederholungsregeln, `WhoAmI` |
| `js/data.js` | Benutzerkontext, Rolle aus `AppPermissions`, `roleErklaerung()` |
| `js/app.js` | Startseite, Selbsttest, Gerüst der sechs Schritte |
| `tests/test-konsistenz.mjs` | Konfiguration, Ladereihenfolge, Doku |
| `.github/workflows/pruefung.yml` | `node --check` + Test, kein Build |

**Die eine Stelle, an der die Vorlage nicht reichte.** Die App braucht zwei
Token — Graph und Dataverse. Der v2-Endpunkt gibt ein Access-Token immer nur
für eine Ressource aus. Gelöst wie in MSAL: einmal mit den Graph-Scopes
anmelden, den Refresh-Token behalten und je Ressource einlösen.
`rundumdenjob` fordert `offline_access` bereits an und verwirft den
Refresh-Token — hier wird er gespeichert. Behandelt sind Rotation
(jede Einlösung entwertet den alten Token), die 24-Stunden-Grenze für
SPA-Refresh-Token und der Rückfall auf interaktive Zustimmung.

**Selbsttest statt Graph Explorer.** Die Startseite prüft Graph-Token,
`AppPermissions`, Quellbibliothek, Quellordner, Konfigurationssite und
`WhoAmI`. Die Bibliotheksprüfung erkennt beide Fälle — eigene Bibliothek
oder Ordner in „Dokumente“ — und nennt die Werte, die dann in `js/config.js`
gehören. Damit beantwortet der erste Aufruf die offene Frage aus `docs/02`.

**Corporate Design vorgezogen.** `CLAUDE.md` §12 hatte es als Phase 8
geführt, „erst wenn die Vorlage vorliegt“. Sie lag vor: der `:root`-Block in
`rundumdenjob/css/styles.css`. Phase 8 ist damit entfallen.

**`hauptAdmins` mit zwei Adressen.** `defaultRole` ist `none`; ohne Eintrag
in `AppPermissions` für `crm` käme sonst beim ersten Aufruf niemand hinein.
`administrator@dihag.com` und `fedorov@dihag.com` sind deshalb fest
hinterlegt. Sobald die Rechteliste gepflegt ist, kann die zweite Adresse
wieder raus.

**Geprüft.** `node --check` über alle sechs JS-Dateien und das Testskript,
`tests/test-konsistenz.mjs` grün (28 Prüfungen). Startseite örtlich gerendert.

**Veröffentlicht.** `dfedorov12/crm`, öffentlich, Pages aus `main` ▸ `/`.
Vor dem Push wurden personenbezogene Daten pseudonymisiert: in `docs/06`,
`CLAUDE.md` und dem Importprofil standen zwei benannte Personen bei fremden
Unternehmen sowie eine Verteilungstabelle mit fünf Mitarbeiteradressen. Zahlen
und fachliche Schlüsse sind unverändert.

`crm.dihag.de` löste bereits auf — der DNS-Eintrag war entgegen der Annahme
in `docs/08` nicht offen. Beim ersten Aufruf der Live-Seite fiel dafür ein
echter Fehler auf: über `http://` ist `crypto.subtle` nicht verfügbar, und
die Anmeldung scheiterte mit „Cannot read properties of undefined (reading
'digest')“ — eine Meldung, die niemanden zur Ursache führt. Zwei Konsequenzen:
„Enforce HTTPS“ in den Pages-Einstellungen gesetzt, und `signIn()` prüft nun
`isSecureContext` und nennt die https-Adresse. Die Prüfung bleibt drin, auch
wenn die Umleitung sie heute überflüssig macht.

Über HTTPS läuft der Ablauf durch: stiller SSO-Versuch, dann Kontoauswahl mit
`redirect_uri=https://crm.dihag.de/`. Abgeschlossen werden kann die Anmeldung
erst, wenn diese Adresse in der Registrierung unter der SPA-Plattform steht.

**Offen, blockierend.**

- **Umleitungs-URI `https://crm.dihag.de/`** in der Registrierung unter der
  Plattform *Single-Page-Anwendung*. Ohne sie endet jede Anmeldung in
  `AADSTS50011`. Einziger Punkt, der die Seite heute unbenutzbar macht.
- Alternativschlüssel an `opportunity` (Befund B2)
- ~~DNS für `crm.dihag.de`~~ — löst bereits auf, HTTPS erzwungen
- ~~`dataverseUrl`~~ — `https://dihag-test.crm4.dynamics.com`, eingetragen
- ~~Quellbibliothek~~ — `Austausch` ist eine eigene Dokumentbibliothek,
  `Projekt CRM-Timeline` der Ordner darin. Konfiguration stimmte bereits.

**Dazu.** `docs/09-rechte-eintragen.md` — Kurzanleitung, wie Zugriff über
`AppPermissions` freigeschaltet wird. Die Liste existiert bereits und wird von
`rundumdenjob`, `powerbi` und `umfrage1` mitgenutzt; für `crm` kommen nur
Zeilen dazu, keine Spalten. Die eigentliche Entscheidung steckt in der Rolle
`editor` — wer sie hat, schreibt ins CRM.

**Als Nächstes.** Phase 3: `js/spFiles.js` und `js/excel.js` — Dateiliste aus
der Bibliothek, Datei über `@microsoft.graph.downloadUrl` laden, mit SheetJS
öffnen, Blätter und die ersten 20 Zeilen anzeigen. Erste Phase mit echten
Daten, noch ohne Schreibzugriff.
