# Session-Log

## 03.09.2026 — Die 79 Fehler: vier Ursachen, alle im Code

Lauf 2 lieferte dieselben Zahlen wie Lauf 1 — **66 angelegt, 0 aktualisiert,
79 fehlgeschlagen** — aber diesmal stand der Grund auf dem Schirm. Vier
Ursachen, davon drei in der App und eine echte Folge.

**1. `contacts`: 29 × 0x80060888.** „The key in the request URI is not valid
for resource 'contact'." Schritt 20 hat im Profil ausdrücklich
`AlternateKey: null` — `contact` hat keinen. Der Lauf baute bei Modus
`Upsert` trotzdem immer die Schlüsseladresse `contacts(emailaddress1='…')`.
Jede Zeile abgewiesen.

Jetzt gilt: bekannter Datensatz → über seine **GUID**; unbekannt mit
Alternativschlüssel → Schlüsseladresse; unbekannt ohne → **POST**, und der
Schlüsselwert wandert in den Rumpf, sonst entstünde ein Kontakt ohne
E-Mail-Adresse. Dazu löst Phase 0 den eigenen Schlüssel eines Schrittes jetzt
auch **ohne** Alternativschlüssel auf — ob ein Datensatz existiert, hängt
nicht daran, wie er adressiert wird.

**2. `opportunities`: 29 × 0x80048d19.** „An undeclared property
'cr570_technicalaudit_lookup' which only has property annotations in the
payload but no property value was found in the payload." `@odata.bind`
verlangt den Namen der **Navigationseigenschaft**, nicht den des Attributs.
Bei `parentaccountid` sind beide gleich, bei selbst angelegten Feldern fast
nie: das Attribut heisst `cr570_technicalaudit_lookup`, die
Navigationseigenschaft `cr570_TechnicalAudit_lookup`. Die Zuordnung kommt
jetzt aus den Metadaten (`ManyToOneRelationships`), wie die Feldliste auch.

**3. Gebunden wird über die GUID.** Nicht über den Alternativschlüssel des
Ziels. Das war ursprünglich nur der bequeme Weg — es ist aber auch der
einzige richtige: über `dag_dihag_kdnr=47000004` gebunden sucht Dataverse
selbst und trifft dieselbe Doppeldeutigkeit wieder, gegen die im Prüflauf
gerade jemand entschieden hat. Und `unveraendert` wird endlich feststellbar:
im Bestand steht eine GUID, keine Kundennummer.

**4. Die 21 Positionen** waren keine eigene Ursache, sondern die Folge: ihre
Verkaufschancen sind in Schritt 30 gescheitert. Mit 1–3 behoben, erledigen
sie sich mit.

**Dazu, damit die Vorschau wieder stimmt.** Drei Stellen sagten mehr voraus,
als der Import tut:

- `SetStage` und `CloseOpportunity` sind nicht scharf geschaltet — der Import
  überspringt sie, die Vorschau zählte sie als „neu".
- `SkipOnValues` war im Profil, aber nirgends umgesetzt. `dummy@dihag.com`
  soll keinen Kontakt erzeugen (docs/06); ohne die Regel legt der Import die
  Sammeladresse an wie jede andere. Neue Spalte in `CRM_ImportProfiles`.
- `OnLookupFail` stand ebenfalls nur im Profil. `WarnAndSkipField` lässt das
  Feld jetzt leer, statt an einen Datensatz zu binden, von dem die App
  **weiss**, dass es ihn nicht gibt. Für `parentcontactid` eingetragen: keine
  Sammeladresse, keine Verknüpfung.

Dabei war eine Feinheit nötig: Was ein früherer Schritt anlegt, gibt es beim
Import — die Vorschau darf für einen Kontakt, den Schritt 20 gerade anlegt,
nicht „nicht gefunden" melden. Prüflauf und Import führen dieselbe Buchhaltung.

**Und ein Wächter.** Der Prüflauf prüft jetzt, ob ein im Profil eingetragener
Alternativschlüssel in der Umgebung überhaupt existiert und sein Index aktiv
ist. Er sperrt den Import, wenn nicht — statt 156-mal dieselbe HTTP 400 zu
sammeln.

**Geprüft.** Gegen die Vorschau mit dem echten Profil, drei Anfragen
(eine bekannt, eine neu, eine mit Sammeladresse) und drei Positionen:

    Vorschau:  6 neu · 1 geändert · 4 unverändert · 4 übersprungen · 0 mit Fehler
    Ergebnis:  6 angelegt · 1 aktualisiert · 4 unverändert · 4 übersprungen · 0 fehlgeschlagen

Deckungsgleich. Im Rumpf: `parentaccountid → /accounts(a-1)`,
`parentcontactid → /contacts(<GUID aus Schritt 20>)`,
`cr570_TechnicalAudit_lookup@odata.bind`. Die Sammeladresse ist nirgends
verknüpft. 229 automatische Prüfungen in neun Dateien.

**Vor dem nächsten Lauf nötig:** `setup-crm.ps1` erneut laufen lassen (legt
die Spalte `SkipOnValues` an) und danach `-ProfilLaden` (schreibt
`SkipOnValues` und `OnLookupFail` in die Liste). Ohne das bleiben beide
Regeln wirkungslos.

## 03.09.2026 — Erster echter Import: 79 Fehler, eine Ursache

Der Lauf gegen `Anfragen 2026-09-03.xlsx` kündigte **156 neu · 18 geändert**
an und lieferte **66 angelegt · 0 aktualisiert · 79 fehlgeschlagen**. Die
Zahlen im Ergebnis waren richtig, die Vorhersage war es nicht — und warum,
stand nirgends auf dem Schirm.

**Die Ursache: Phase 0 fragt vor dem Lauf ab.** Was Schritt 30 anlegt, steht
dort nicht — und Schritt 40 sucht den Elterndatensatz genau dort. Die
Positionen jeder **neuen** Verkaufschance scheiterten mit „Elterndatensatz
nicht aufgelöst"; Positionen zu Bestandschancen gingen durch. Ein Fehler, der
mit der Zahl der Neuanlagen wächst, und den der Prüflauf nicht sehen kann,
weil er die Auflösung nicht fortschreibt.

Behoben an zwei Stellen. Was der Lauf anlegt, wird in die Auflösung
nachgetragen — die GUID steht in `OData-EntityId` und lag bereits am
Protokolleintrag. Und falls eine Antwort sie nicht mitliefert, geht es
trotzdem weiter, solange der Elterndatensatz *in diesem Lauf* entstanden ist:
Dann gibt es keine alten Positionen zu löschen, und gebunden wird ohnehin
über den Alternativschlüssel. Ein Elterndatensatz, den es wirklich nicht
gibt, bleibt ein Fehler.

Neu: `tests/test-lauf.mjs`. Ohne die zweite Hälfte der Korrektur fällt es um.

**Warum es fehlschlug — jetzt auf dem Schirm.** Das Ergebnis nannte „79
fehlgeschlagen" und sonst nichts; wer den Grund wollte, musste das
Vollprotokoll herunterladen. Es steht jetzt darunter, **nach Ursache
gruppiert** — 79 Fehler sind fast immer zwei Gründe und nicht 79. Dafür
werden Datensatz-Kennungen und eingebettete Werte aus der Meldung
herausgenormt, sonst steht dieselbe Ursache 79-mal einzeln da. Darunter die
Einzelfälle mit Schritt, Zeile, Schlüssel und HTTP-Status.

**Der Reiterwechsel wirft nichts mehr weg.** Er war teuer und ärgerlich
zugleich: Die Dateiliste wurde jedes Mal neu von SharePoint geholt, die
geöffnete Mappe verschwand, der Prüflauf rechnete sechs Dataverse-Abfragen
neu, das Häkchen für die ausgeschlossenen Zeilen war wieder leer, und das
Ergebnis des gerade gelaufenen Imports war weg. Alles bleibt jetzt stehen;
neu gerechnet wird auf Knopfdruck. Wird eine **andere** Datei geöffnet,
werden Bericht, Ergebnis und Entscheidungen verworfen — ein Bericht gilt für
genau eine Mappe.

Dazu ein 🔄 an der Dateiliste, weil sie jetzt behalten wird.

**Offen aus diesem Lauf:** `Die Quelldatei konnte nicht markiert werden` —
die Statusspalten der Bibliothek fehlen oder heißen anders (`docs/02`). Der
Lauf ist trotzdem gültig, aber der Ordner dokumentiert sich nicht selbst, und
ein Doppelimport fällt nicht vor dem Start auf.

**Geprüft.** 212 automatische Prüfungen in neun Dateien. In der Vorschau mit
gestellten Antworten: die Position zur neu angelegten Chance entsteht,
gleichartige Fehler werden zu einer Zeile zusammengefasst, und nach einem
Reiterwechsel stehen Mappe, Bericht, Häkchen und Ergebnis unverändert da —
bei einem einzigen Abruf der Dateiliste.

## 03.09.2026 — Eine unbekannte Kundennummer sperrt den Import nicht mehr

Der erste Prüflauf gegen echte Daten meldete `1 Fehler` bei 30 Zeilen — und
darunter stand: *„Solange Fehler offen sind, bleibt der Import gesperrt. Es
gibt keinen Weg daran vorbei."*

Das widersprach zwei Stellen im eigenen Haus. Die Fehlermeldung derselben
Zeile sagte *„wird in allen Folgeschritten übersprungen, der Lauf geht
weiter"*, und im Profil steht seit Review B3: *„Vorher hätte eine einzige
unbekannte Nummer den ganzen Import verhindert."* Genau das tat die App
wieder.

**Ausschluss statt Fehler.** Ein Konto, das es nicht gibt, ist jetzt eine
eigene Kategorie: eigene Kachel, eigene Liste, eigenes Blatt im
Excel-Bericht. Es sperrt den Import nicht. Damit die Zeile trotzdem nicht
hinten herunterfällt, ist der Import erst frei, wenn jemand die
Kenntnisnahme ankreuzt — ohne das wäre „12 Zeilen fehlen" eine Zahl, die man
wegklickt.

**Zwei Fehler, die dabei auffielen.**

Der Import merkte sich ausgeschlossene Zeilen über den *Schlüsselwert des
Schrittes*, in dem sie durchfielen — also die Kundennummer aus Schritt 10.
Schritt 20 sucht aber über die E-Mail, Schritt 30 über die Opp-ID. Der
Vergleich traf **nie**. „Wird in allen Folgeschritten übersprungen" war eine
Zusage, die der Code nicht hielt; die Zeile wäre weitergelaufen und erst an
einem 404 von Dataverse gescheitert.

Und die Vorschau zählte dieselbe Zeile in den Schritten 20, 30, 40 und 50 als
*neu* mit. Sie hätte „7 neu" gesagt, wo der Import 3 anlegt — der eine Satz,
den ein Prüflauf können muss, wäre falsch gewesen.

Beides hängt an derselben Frage: *Ist das dieselbe Zeile?* Die Antwort steht
jetzt an einer Stelle (`PRUEFUNG.ausschluss`) und wird von beiden Läufen
benutzt — innerhalb eines Blattes über die Zeilennummer, blattübergreifend
über die Spalte, mit der ein Kindblatt an sein Elternblatt hängt (`Opp-ID`).
Welche Spalte das ist, steht im Profil, nicht im Code.

**Dazu.** Die Fehlerliste auf dem Schirm zeigt jetzt den **Wert** — bei
„nicht gefunden" ist er die Information, und er stand bisher nur im
Excel-Bericht. Daneben der Klartext aus den Spalten ohne Zielfeld: das
Profil reserviert `Firmaname` ausdrücklich „nur für Fehlermeldungen und
Vorschau", benutzt wurde die Spalte dafür nie. Statt `99999999` steht dort
jetzt `99999999 · Unbekannt AG`.

**Geprüft.** Gegen eine Vorschau mit erzeugter Mappe und gestellten
Dataverse-Antworten, zwei Anfragen mit je einer Position, davon eine mit
unbekannter Kundennummer:

    3 neu · 1 geändert · 1 unverändert · 4 übersprungen · 1 ausgeschlossen · 0 mit Fehler

    10 accounts             LookupOnly        1 unverändert   1 ausgeschlossen
    20 contacts             Upsert            1 neu           1 übersprungen
    30 opportunities        Upsert            1 geändert      1 übersprungen
    40 opportunityproducts  ReplaceByParent   1 neu           1 übersprungen
    50 salesprocesses       SetStage          1 neu           1 übersprungen

Der Import-Knopf blieb gesperrt („Erst die ausgeschlossenen Zeilen
bestätigen"), bis das Häkchen gesetzt war. 205 automatische Prüfungen in acht
Dateien.

## 03.09.2026 — Erster echter Prüflauf: drei Befunde behoben

Der erste Prüflauf gegen die echte Datei brach ab. Das ist der Zweck eines
Prüflaufs, aber die drei Ursachen waren verschieden schwer.

**1. Der Abbruch (HTTP 400).** Die Auflösungsphase fragte die vorhandenen
Positionen über

    Microsoft.Dynamics.CRM.In(PropertyName='_opportunityid_value', …)

und bekam:

    'OpportunityProduct' entity doesn't contain attribute with
    Name = '_opportunityid_value'

`In(...)` kennt nur Attributnamen. `_opportunityid_value` ist die
OData-Schreibweise eines Verweises und keiner. Gefiltert wird jetzt über
`opportunityid`, gelesen und gruppiert weiterhin über den Aliasnamen — nur
unter dem steht die GUID in der Antwort. Dazu ein Rückfallweg: Weist eine
Umgebung `In(...)` trotzdem ab (HTTP 400), wird auf eine Kette aus
`feld eq wert or …` umgeschaltet, in kleineren Blöcken wegen der
Adresslänge. `429` läuft dort ausdrücklich nicht hinein — Drosselung ist
keine falsch gebaute Abfrage, und der Rückfallweg würde sie verschleiern.

Neu: `tests/test-aufloesung.mjs`, 17 Prüfungen. Eine davon hält fest, dass
`_opportunityid_value` **nicht** im Filter stehen darf — genau daran brach es
ab.

**2. „Feld gibt es in Dataverse nicht" bei `$action`.** Schritt 60 zeigte
einen Befund, den es nicht gibt: `$action` ist kein Feld, sondern eine
Anweisung an den Lauf (`WinOpportunity` / `LoseOpportunity`). Gegen die
Metadaten geprüft, musste sie fehlschlagen. Pseudo-Ziele mit `$` werden jetzt
übersprungen und als *„Anweisung an den Lauf, kein Feld"* ausgewiesen.
Gleich mit erledigt: Ein Befund in einem **abgeschalteten** Schritt zählt
nicht mehr als Problem — dort läuft nichts. Sichtbar bleibt er, wer den
Schritt später einschaltet, soll ihn vorher sehen.

**3. Die doppelten Kundennummern als Fehlermeldung.** Der Selbsttest meldete
die sieben doppelten `dag_dihag_kdnr` mit einem `!` und dem Satz, ein
Alternativschlüssel sei nicht anlegbar und die Auflösung müsse raten. Das war
seit der letzten Sitzung nicht mehr wahr. Die beiden geprüften Felder haben
verschiedene Rollen:

| Feld | Rolle | Dublette bedeutet |
|---|---|---|
| `new_dagextopid` | Schlüssel für den Upsert | Fehler — ohne Alternativschlüssel kein Upsert |
| `dag_dihag_kdnr` | Verweis, über `$filter` gesucht | Frage — der Prüflauf legt die Kandidaten vor |

Der Selbsttest sagt das jetzt und steht auf ✓. Die Antwort auf die Frage aus
der Sitzung: **entschieden wird im Prüflauf**, nicht erst beim Import — und
ohne Wahl schreibt die Zeile nicht. `docs/03` nachgezogen.

**Dazu.** Die Ablauftabelle mit den Phasen 1–7 ist von der Startseite
verschwunden. Sie war eine Bauzustandsanzeige; alle Phasen stehen.

**Geprüft.** 191 automatische Prüfungen in acht Dateien, alle grün. Die
Oberfläche gegen eine Vorschau mit gestellten Antworten: Schritt 60 hat kein
Warnband mehr, `$action` ist nicht mehr durchgestrichen, und der Selbsttest
meldet die sieben Nummern als entscheidbar statt als Sackgasse.

**Offen.** Ein erster echter Lauf bis zum Ende — bis hierher war es nur der
Prüflauf. `SetStage` und `CloseOpportunity` bleiben fachlich zurückgestellt.

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
