# CLAUDE.md — DIHAG CRM Schnittstelle

Arbeitsanweisung für Claude Code. Diese Datei ist die verbindliche Quelle für
Architektur, Konventionen und Reihenfolge der Umsetzung. Bei Widerspruch
zwischen Chatverlauf und dieser Datei gilt diese Datei — oder es wird
rückgefragt.

---

## 1. Ziel

Eine statische Single-Page-Application auf GitHub Pages, mit der ein
angemeldeter Fachanwender Excel-Dateien hochlädt und deren Inhalte in der
**richtigen Abhängigkeitsreihenfolge** nach Dynamics 365 / Dataverse
importiert.

**Explizit kein Power Automate, kein Data Import Wizard, kein Backend.**
Der Browser spricht direkt mit der Dataverse Web API (CORS ist serverseitig
freigeschaltet).

Deployment-Ziel: `https://crm.dihag.de/`
(Fallback `https://dfedorov12.github.io/crm/`, leitet dorthin um)

**Gebaut wird nach der Hausvorlage** — `rundumdenjob`, `powerbi`, `umfrage1`:
statische Auslieferung ohne Build, Anmeldung ohne MSAL. Begründung und
Umfang der Abweichung von der ersten Fassung dieser Datei stehen in
`docs/08-frontend-github.md`.

### Rollenverteilung

Das ist die tragende Entscheidung des Projekts:

| | |
|---|---|
| **GitHub** | ausschließlich der Programmcode. Keine Daten, keine Konfiguration mit Inhalt, keine Protokolle. |
| **SharePoint** | die Daten. Quelldateien, Feldzuordnungen, Protokolle. Sie liegen dort und bleiben dort. |
| **Dataverse** | das Importziel. |
| **Entra / M365** | die Anmeldung. Ein Arbeitskonto, kein zweites Kennwort. |

Die Excel-Dateien werden **nicht hochgeladen**. Sie liegen bereits in der
SharePoint-Bibliothek — dort, wo sie der bisherige Flow abholt. Die App
listet sie auf, lädt die ausgewählte Datei über Microsoft Graph in den
Arbeitsspeicher des Browsers und schreibt daraus nach Dataverse. Die Datei
bleibt unverändert in der Bibliothek liegen.

Kein Byte Fachdaten berührt GitHub. Ausgeliefert wird von dort nur HTML, CSS
und JavaScript.

### Was die App macht (Pipeline)

```
1. Anmelden            M365-Arbeitskonto, MSAL, Auth-Code + PKCE
2. Konfig laden        Importprofile + Mappings aus SharePoint
3. Datei wählen        Dateiliste der SharePoint-Bibliothek, Auswahl durch den Anwender
4. Einlesen            Datei über Graph in den Arbeitsspeicher, SheetJS; Original bleibt liegen
5. Zuordnen            Blatt -> Importprofil, Spalte -> Dataverse-Feld
6. Prüflauf (Dry-Run)  Validierung, Lookup-Auflösung, Fehlerbericht, KEIN Schreibzugriff
7. Import              Batch-Upsert über Alternativschlüssel, in Profil-Reihenfolge
8. Protokoll           Lauf + Fehler nach SharePoint, Bibliothekseintrag als importiert markieren
```

Schritt 6 ist nicht optional. Es gibt keinen Weg von Schritt 5 nach Schritt 7,
der den Prüflauf überspringt.

**Prozessänderung gegenüber heute:** Der Flow löst automatisch aus, sobald
eine Datei in der Bibliothek landet — Abfrage im Minutentakt. Die App muss
jemand öffnen und starten. Das ist gewollt (Prüflauf vor Schreibzugriff),
ändert aber den Ablauf für die Fachabteilung. Siehe §13, offener Punkt.

---

## 2. Harte Randbedingungen

Diese Punkte sind keine Vorlieben. Wer sie verletzt, bekommt eine App, die
nicht startet oder Daten zerstört.

| # | Randbedingung | Grund |
|---|---|---|
| 1 | **Niemals ein Client Secret im Repo.** Public Client / SPA, PKCE. | Repo ist öffentlich einsehbar. Client-ID und Tenant-ID sind keine Geheimnisse, ein Secret schon. |
| 2 | **Kein MSAL.** OAuth2 Auth-Code + PKCE von Hand, `js/auth.js`. | Das MSAL-CDN ist bei v2 eingefroren, v3+ gibt es nur per npm. Die Hausvorlage braucht von MSAL ohnehin nur das, was in 200 Zeilen passt. Siehe `docs/08` §1. |
| 3 | **Kein Build.** Repo-Wurzel = Pages-Wurzel, alle Pfade relativ. | Keine andere DIHAG-App hat eine Werkzeugkette. Ohne Bundler entfällt auch `base`. |
| 4 | **Redirect-URI mit Schrägstrich am Ende.** `js/auth.js` leitet sie aus `location` ab und erzwingt ihn. | Entra vergleicht bytegleich. Damit ist `AADSTS50011` baulich ausgeschlossen, und dieselbe Auslieferung läuft unter beiden Adressen. |
| 5 | **Schreibende Requests nur nach bestandenem Dry-Run.** | Ein Fehlimport in ein Produktiv-CRM ist manuell kaum rückholbar. |
| 6 | **Jeder Schreibzugriff ist ein Upsert über einen Alternate Key**, nie ein blindes `POST`. | Wiederholbarkeit. Ein zweiter Lauf derselben Datei darf keine Dubletten erzeugen. |
| 7 | **429 wird immer über `Retry-After` behandelt**, nie mit festem Sleep, nie ignoriert. | Dataverse Service Protection Limits, siehe §7. |
| 8 | **Kein `alert()`, kein `confirm()`, keine stillen `catch`-Blöcke.** | Fehler müssen im Protokoll landen, nicht im Nichts. |
| 9 | **Tokens in `sessionStorage`, nicht `localStorage`.** | Siehe Sicherheitshinweis §11. |
| 10 | **Alle Texte der Oberfläche auf Deutsch.** Code, Kommentare und Commit-Messages ebenfalls Deutsch. | Fachanwender im Haus. |
| 11 | **Kopfzeilen beim Einlesen trimmen**, Zuordnung gegen die normalisierte Fassung. | `Breite (mm) ` und `Höhe (mm) ` haben Leerzeichen am Ende. Exakter Vergleich träfe nie. |
| 12 | **Kein Datensatz wird geschrieben, ohne dass er im Protokoll landet.** Auch übersprungene und gewarnte Zeilen. | Der Altflow kann nicht beantworten, was er getan hat. Das ist der Hauptgrund für den Neubau. |

---

## 3. Stack

| Zweck | Wahl | Anmerkung |
|---|---|---|
| Build | **keiner** | Pages liefert das Repo direkt aus |
| Sprache | Vanilla JS + JSDoc-Typen | Ein globaler Name je Datei (IIFE), `<script>`-Tags in Abhängigkeitsreihenfolge. Kein Framework: die App ist ein Assistent mit sechs Schritten. |
| Auth | `js/auth.js` — Auth-Code + PKCE, ohne Bibliothek | Zwei Ressourcen über einen Login, siehe §6 |
| Excel | `xlsx` (SheetJS Community, Apache-2.0) | bei Bedarf nachgeladen, Version gepinnt — Muster aus `bedarfsanfrage` |
| Styling | Eigenes CSS mit Custom Properties | CI-Token-Satz aus `rundumdenjob`, in Phase 1 gesetzt |
| Deployment | Pages „Deploy from a branch“, `main`, `/` | Workflow **prüft** nur: `node --check` plus Tests |

Keine weiteren Laufzeit-Abhängigkeiten ohne Rückfrage. Jede zusätzliche
Dependency in einem Frontend, das Firmendaten anfasst, ist Angriffsfläche.
SheetJS ist die einzige.

---

## 4. Verzeichnisstruktur

Flach, wie in jeder anderen DIHAG-App. `✓` = **alle Phasen vorhanden**.

```
crm/
├─ CLAUDE.md                ✓ diese Datei
├─ README.md                ✓
├─ SESSION_LOG.md           ✓
├─ index.html               ✓ Boot-Schirm, Kein-Zugriff-Schirm, App
├─ CNAME                    ✓ crm.dihag.de
├─ .nojekyll                ✓
├─ assets/dihag-logo.png    ✓
├─ css/styles.css           ✓ CI-Token-Satz und Grundformen
├─ js/
│  ├─ config.js             ✓ EINE Stelle für IDs, Pfade, Listennamen
│  ├─ auth.js               ✓ PKCE, stiller SSO, zwei Ressourcen
│  ├─ graph.js              ✓ Graph, Listen, Bibliotheken, Spaltentoleranz
│  ├─ dataverse.js          ✓ Grundzugriff + WhoAmI; Batch folgt Phase 5/6
│  ├─ data.js               ✓ Benutzerkontext und Rolle
│  ├─ app.js                ✓ Oberfläche, Selbsttest, Schrittgerüst
│  ├─ spFiles.js            ✓ Bibliothek listen, Datei laden, Status setzen
│  ├─ spListen.js           ✓ Konfigurationslisten lesen
│  ├─ excel.js              ✓ SheetJS, Kopfzeilen normalisieren
│  ├─ mapping.js            ✓ Zeile + Zuordnung → Nutzlast
│  ├─ transforms.js         ✓ trim, decimal:de, date, empty2null, zero2null
│  ├─ aufloesung.js         ✓ Phase 0 – Sammelabfragen
│  ├─ pruefung.js           ✓ Einstufung und Prüfbericht
│  ├─ batch.js             ✓ Batch-Aufbau und -Auswertung
│  └─ lauf.js              ✓ Ausführung, Drosselung, Abbruch, Protokoll
├─ tests/                   ✓ *.mjs, laufen unter Node ohne Browser
├─ .github/workflows/pruefung.yml  ✓
├─ config/import-profile.dihag.json ✓
└─ docs/                    ✓ 00–08
```

---

## 5. Konfiguration

Alles steht in **`js/config.js`** — eine Datei, wie in jeder anderen App.
`public/runtime-config.json` entfällt: Sein Zweck war, ohne Rebuild zwischen
Test und Produktion zu wechseln. Ohne Build gibt es nichts zu bauen, und die
Datei läge ohnehin im Repo — ein Commit wäre in beiden Fällen nötig.

Werte mit dem Präfix `KLAEREN_` sind die offenen Punkte aus §13. Die App
fragt über `istOffen()` darauf ab und sperrt die betroffenen Stellen mit
einer verständlichen Meldung, statt an einem Netzwerkfehler gegen
`https://<org>.crm4.dynamics.com` zu scheitern.

`umgebung` wird als farbiges Band dauerhaft im Kopf angezeigt: `TEST` in
Orange, `PROD` in Rot. Der Wert steht ausgeschrieben daneben — Farbe allein
ist keine Information. Niemand soll versehentlich ins Produktivsystem
importieren, weil beide Umgebungen gleich aussehen.

Der Bibliothekspfad stammt aus dem Auslöser des Altflows:
`https://dihag.sharepoint.com/sites/IT`, Ordner
`/Austausch/Projekt CRM-Timeline`. Die Bibliotheks-GUID des Flows
(`6fcaa8c8-02d3-4474-9e7c-e67da451f6cd`) wird **nicht** übernommen — die App
löst Site, Drive und Ordner über Graph zur Laufzeit aus den Namen auf. Sonst
wiederholt sich Befund B9: fest verdrahtete GUIDs, die beim Umzug in die
Produktion einzeln von Hand nachgezogen werden müssen.

**Offen:** `dataverseUrl` ist noch nicht bekannt. `sourceSiteUrl` und die
Bibliotheksnamen stammen aus dem Altflow und sind noch zu bestätigen.
`configSiteUrl` entsteht erst mit der neuen Site.

---

## 6. SharePoint-Zugriff (Graph)

### Anmeldung

Ein Login mit dem M365-Arbeitskonto. Daraus werden **zwei getrennte Token**
still bezogen — eines für Graph, eines für Dataverse. Der Anwender merkt
davon nichts, aber ein Token gilt nie für beide Ressourcen.

| Ressource | Scope |
|---|---|
| Dataverse | `https://<org>.crm4.dynamics.com/user_impersonation` |
| Microsoft Graph | `Sites.ReadWrite.All`, `User.Read` |

`acquireTokenSilent` je Ressource, interaktiv nur wenn das fehlschlägt.

### Datei finden und laden

```
1. Site auflösen     GET /sites/dihag.sharepoint.com:/sites/IT
2. Drive auflösen    GET /sites/{siteId}/drives            -> name == "Austausch"
3. Ordner listen     GET /drives/{driveId}/root:/Projekt CRM-Timeline:/children
4. Datei laden       siehe Fallstrick unten
```

Alles über Namen, nichts über GUIDs. Damit funktioniert dieselbe
Konfiguration in Test und Produktion.

### Fallstrick: Datei-Inhalt holen

Der naheliegende Weg ist falsch:

```js
// FUNKTIONIERT NICHT im Browser
fetch(`https://graph.microsoft.com/v1.0/drives/${d}/items/${i}/content`,
      { headers: { Authorization: `Bearer ${token}` } })
```

`/content` antwortet mit einer Weiterleitung auf einen Speicher-Host. `fetch`
folgt ihr automatisch und schickt den Graph-Token an eine fremde Domäne mit.
Ergebnis ist ein CORS- oder 401-Fehler, dessen Meldung in die Irre führt.

Richtig ist der zweistufige Weg:

```js
// 1. Metadaten holen, dort steckt eine vorab signierte URL
const item = await graphGet(`/drives/${driveId}/items/${itemId}`);
// 2. Diese URL OHNE Authorization-Header abrufen
const buf = await (await fetch(item['@microsoft.graph.downloadUrl'])).arrayBuffer();
```

`@microsoft.graph.downloadUrl` ist kurzlebig und bereits authentifiziert. Der
`ArrayBuffer` geht unverändert an SheetJS.

### Nach dem Import: Bibliothekseintrag markieren

```
PATCH /sites/{siteId}/lists/{listId}/items/{itemId}/fields
{ "ImportStatus": "Importiert", "ImportRunId": "...", "ImportedAt": "..." }
```

Die Spalten dafür beschreibt `docs/02-sharepoint-setup.md`. Zweck: Der Ordner
dokumentiert sich selbst, und ein versehentlicher Doppelimport fällt vor dem
Start auf statt danach.

Dateien werden **nicht verschoben und nicht gelöscht.** Ein Verschieben würde
die Item-ID entwerten, auf die das Protokoll verweist.

Vor dem Start prüft die App den Status und warnt, wenn eine bereits
importierte Datei erneut gewählt wird. Blockiert wird nicht — ein
Wiederholungslauf nach einem Teilfehler ist ein legitimer Vorgang, und dank
Upsert über Alternativschlüssel ist er gefahrlos.

---

## 7. Dataverse-Zugriff

### Upsert über Alternativschlüssel

Der gesamte Import beruht darauf. Für jede Zieltabelle existiert ein
Alternate Key auf einem Feld, das die Quelldaten mitbringen (siehe
`docs/03-dataverse-vorbereitung.md`).

```
PATCH /api/data/v9.2/accounts(dag_dihag_kdnr=10042)
```

- Datensatz existiert -> Update
- Datensatz existiert nicht -> Anlage
- Nur anlegen, nicht überschreiben: Header `If-None-Match: *`
- Nur aktualisieren, nicht anlegen: Header `If-Match: *`

Der Modus kommt pro Schritt aus dem Importprofil (`Create` / `Update` /
`Upsert`).

**Escaping:** Einfache Anführungszeichen im Schlüsselwert werden verdoppelt,
danach URL-kodiert. Das ist keine Kosmetik — ein Firmenname wie
`O'Brien GmbH` als Schlüssel bricht sonst die URL auf.

### Adressierung: GUID, Schlüsseladresse oder POST

Drei Fälle, und der mittlere hat im ersten echten Lauf 29 Kontakte gekostet:

| Lage | Weg |
|---|---|
| Phase 0 kennt den Datensatz | `PATCH entitySet(<GUID>)` — geht immer, auch ohne Alternativschlüssel |
| Unbekannt, Schritt hat einen Alternativschlüssel | `PATCH entitySet(feld=wert)` — Dataverse legt an |
| Unbekannt, kein Alternativschlüssel | `POST entitySet` — der Schlüsselwert steht dann **im Rumpf** |

Nicht jede Tabelle hat einen Alternativschlüssel. `contact` hat keinen (das
Profil sagt das auch: `AlternateKey: null`), und wer trotzdem
`contacts(emailaddress1='…')` adressiert, bekommt für **jede** Zeile

    0x80060888: The key in the request URI is not valid for resource
    'Microsoft.Dynamics.CRM.contact'.

Der Prüflauf prüft deshalb, ob ein im Profil eingetragener
Alternativschlüssel in der Umgebung überhaupt existiert und aktiv ist —
und sperrt den Import, wenn nicht.

### Lookups binden

Ebenfalls über den Alternate Key des Ziels. Damit entfällt jede
GUID-Zwischentabelle:

```json
{
  "lastname": "Meier",
  "parentcustomerid_account@odata.bind": "/accounts(dag_dihag_kdnr=10042)"
}
```

**`@odata.bind` verlangt den Namen der NAVIGATIONSEIGENSCHAFT**, nicht den
des Attributs. Bei Standardfeldern sind beide gleich (`parentaccountid`), bei
selbst angelegten fast nie: das Attribut `cr570_technicalaudit_lookup` heisst
als Navigationseigenschaft `cr570_TechnicalAudit_lookup`. Auf den falschen
Namen antwortet Dataverse mit

    An undeclared property '…' which only has property annotations in the
    payload but no property value was found in the payload.

— einer Meldung, die den Grund nicht nennt. Die Zuordnung kommt aus den
Metadaten (`ManyToOneRelationships`), nicht aus einer Konstante.

**Gebunden wird über die aufgelöste GUID**, nicht über den
Alternativschlüssel des Ziels, wo Phase 0 sie kennt. Drei Gründe: es geht
auch dort, wo es keinen Alternativschlüssel gibt; eine getroffene
Entscheidung bei Mehrfachtreffern wirkt tatsächlich (über
`dag_dihag_kdnr=47000004` gebunden sucht Dataverse selbst und trifft dieselbe
Doppeldeutigkeit wieder); und nur so lässt sich `unveraendert` feststellen —
im Bestand steht eine GUID, keine Kundennummer.

Was ein früherer Schritt anlegt, wird in die Auflösung nachgetragen. Ohne das
kennt Schritt 40 die Verkaufschance nicht, die Schritt 30 gerade angelegt
hat, und die Positionen jeder **neuen** Anfrage scheitern.

### Batch

`POST /api/data/v9.2/$batch`, `multipart/mixed`, maximal 1000 Requests pro
Batch. Praxiswert: **100**.

Entscheidend: Die einzelnen Datensätze kommen als **eigenständige Requests in
den Batch, nicht in ein Changeset**, zusammen mit `Prefer:
odata.continue-on-error`. Ein Changeset ist eine Transaktion — eine
kaputte Zeile rollt sonst 99 gute mit zurück. Wir wollen das Gegenteil: die
99 gehen durch, die eine landet im Fehlerbericht.

Changesets nur dort, wo mehrere Requests fachlich wirklich atomar sein
müssen. Standardfall ist das nicht.

### Throttling

Grenzen pro Benutzer und Webserver im gleitenden 300-Sekunden-Fenster:

- 6.000 Requests
- 1.200 Sekunden kumulierte Ausführungszeit
- 52 gleichzeitige Requests

Bei Überschreitung: `429` mit `Retry-After` in Sekunden.

Umsetzung im Client:

1. Mit niedriger Parallelität starten (4 Batches), langsam steigern.
2. Bei `429`: **exakt** `Retry-After` warten, dann genau diesen Batch
   wiederholen, Parallelität halbieren.
3. Nach drei aufeinanderfolgenden `429` in einem Lauf die Parallelität dauerhaft
   auf 1 senken und im Protokoll vermerken.
4. Maximal 5 Wiederholungen pro Batch, danach Batch als fehlgeschlagen
   protokollieren und weiterlaufen.
5. `429` und `503` sind wiederholbar. `400`, `403` und `404` sind es nicht —
   das sind Datenfehler und gehören sofort in den Fehlerbericht.

Große Batches sind nicht schneller. Kleine Batches mit moderater Parallelität
sind der von Microsoft empfohlene Weg, weil die Ausführungszeitgrenze sonst
zuerst zuschlägt.

---

## 8. Auflösungsphase (Phase 0)

**Läuft vor jedem Schreibzugriff, auch beim Prüflauf.** Ohne sie funktionieren
drei Dinge nicht:

1. Der Prüflauf kann nicht vorhersagen, was passieren wird.
2. Das Protokoll kann `angelegt` nicht von `aktualisiert` unterscheiden —
   Dataverse antwortet auf einen Upsert per `PATCH` **immer** mit `204`,
   unabhängig davon, was passiert ist.
3. `unveraendert` ist überhaupt nicht feststellbar.

Sechs bis sieben Sammelabfragen, nicht hunderte Einzelaufrufe. Umgesetzt mit
`Microsoft.Dynamics.CRM.In`, in Blöcken wegen der URL-Längenbegrenzung:

```
$filter=Microsoft.Dynamics.CRM.In(PropertyName='dag_dihag_kdnr',
                                  PropertyValues=['99900245','99900051',…])
```

Abgefragt werden Konten, Systembenutzer, Währung, Kontakte, Verkaufschancen,
Positionen und Prozessinstanzen. Die genaue Liste samt `$select` steht in
`config/import-profile.dihag.json` unter `resolution`.

**Zwei Felder sind im `$select` nicht verhandelbar:**

- `statecode` an der Verkaufschance — geschlossene Chancen sind
  schreibgeschützt, jedes `PATCH` scheitert
- alle Felder, die der Import schreiben will — sonst ist kein Vergleich und
  damit kein `unveraendert` möglich

### Schreibrichtlinie je Feld

Aus der Auflösung folgt die Unterscheidung, die den Import erst zu einem
Abgleich macht:

| Richtlinie | Verhalten |
|---|---|
| `Always` | bei Anlage und Aktualisierung |
| `OnCreateOnly` | nur bei Anlage — danach gehört das Feld dem CRM |
| `OnlyIfEmpty` | nur schreiben, wenn im CRM leer |

`ownerid` und `name` sind `OnCreateOnly`. Hat ein Vertriebler die Chance im
CRM übernommen oder den Namen korrigiert, darf der nächste Import das nicht
zurückdrehen. `estimatedvalue`, `estimatedclosedate` und `closeprobability`
sind `Always` — das sind die Fachdaten aus der Quelle.

---

## 9. Importreihenfolge

Das eigentliche fachliche Problem. Die Reihenfolge steht im Importprofil
(Feld `Step`), nicht im Code. Der Planer sortiert danach.

### Der konkrete Fall: DIHAG CRM-Timeline

Abgeleitet aus dem Power-Automate-Export, siehe
`docs/05-bestandsanalyse-flow.md` und `config/import-profile.dihag.json`.

**Quelle:** eine Arbeitsmappe mit zwei Blättern — `Anfragen` (je Zeile eine
Verkaufschance) und `Positionen` (je Zeile eine Angebotsposition, verknüpft
über `Opp-ID`).

| Step | Ziel | Modus | Blatt | Hinweis |
|---|---|---|---|---|
| 10 | `accounts` | **LookupOnly** | Anfragen | Konten werden nie angelegt, nur über `dag_dihag_kdnr` gefunden. Kein Treffer ⇒ Zeile abweisen. |
| 20 | `contacts` | Upsert über `emailaddress1` | Anfragen | setzt **zusätzlich** `parentcustomerid` — der Altflow tut das nicht |
| 30 | `opportunities` | Upsert | Anfragen | `parentaccountid` + `parentcontactid` liegen jetzt beide vor |
| 40 | `opportunityproducts` | **ReplaceByParent** | Positionen | siehe unten |
| 50 | `opportunitysalesprocesses` | CreateIfMissing | Anfragen | genau einer je Verkaufschance |

Kontakte laufen **vor** den Verkaufschancen. Damit entfällt der Nachtrag von
`parentcontactid`, den der Altflow über drei verschachtelte Bedingungen
erledigt. Ein zweiter Durchlauf ist hier nicht nötig — es gibt keine
zirkuläre Abhängigkeit, weil Konten nicht geschrieben werden.

### Modus `ReplaceByParent`

Positionen werden nicht gemischt, sondern ersetzt: alle bestehenden
`opportunityproducts` einer Verkaufschance weichen den neuen aus der Datei.

**Reihenfolge ist hier sicherheitsrelevant:**

1. neue Positionen vollständig aufbauen und validieren, **im Speicher**
2. erst dann ein Changeset senden: erst `DELETE` der alten, dann `POST` der neuen
3. das Changeset ist eine Transaktion — schlägt etwas fehl, bleibt der alte
   Stand erhalten

Der Altflow macht es umgekehrt: löschen, 60 Sekunden warten, neu anlegen.
Bricht er dazwischen ab, sind die Positionen weg. Das ist der einzige Ort im
Projekt, an dem ein Changeset zwingend ist — sonst gilt §7.

### Generelles Muster (andere Profile)

Wenn Konten **geschrieben** statt nur gelesen werden, entsteht eine
zirkuläre Abhängigkeit: das Konto verweist über `primarycontactid` auf den
Kontakt, der Kontakt über `parentcustomerid` zurück. Dazu kommen
Konzernhierarchien über `parentaccountid` auf Konten, die in derselben Datei
weiter unten stehen. In einem Durchlauf nicht auflösbar.

Lösung: `SecondPass = Ja` im Profil, `SecondPassFields =
parentaccountid,primarycontactid`. Der Planer hängt dann einen reinen
Update-Schritt ans Ende, der **ausschließlich** diese Felder sendet.

**Polymorphe Lookups** (`customerid`, `regardingobjectid`, `ownerid`)
brauchen den Zieltyp im Bindungsnamen. Für DIHAG derzeit nicht relevant — der
Altflow nutzt die getrennten Felder `parentaccountid` und `parentcontactid`.
Für spätere Profile:

```json
"customerid_account@odata.bind": "/accounts(dag_dihag_kdnr=10042)"
"customerid_contact@odata.bind": "/contacts(emailaddress1='a.meier@kunde.de')"
```

Das Mapping muss also eine Typspalte mitführen. Ohne die ist nicht
entscheidbar, ob eine Verkaufschance an einem Konto oder einem Kontakt hängt.

---

## 10. Protokollierung

Anforderung: **nachvollziehbar, was genau gemacht wurde.** Das ist kein
Nebenprodukt, sondern eine der beiden Kernanforderungen neben der
Reihenfolge.

### Drei Ebenen

| Ebene | Wohin | Inhalt |
|---|---|---|
| Lauf | `CRM_ImportRuns` | ein Eintrag je Import: Datei, Version, Benutzer, Zeit, Zahlen je Schritt |
| Zeile | `CRM_ImportErrors` | jede abgewiesene, übersprungene und gewarnte Zeile |
| Vollprotokoll | Anlage am Laufeintrag | jede einzelne Schreiboperation als JSON |

### Was je Datensatz festgehalten wird

```json
{ "schritt": 30, "entitySet": "opportunities", "zeile": 14,
  "schluessel": "7263", "aktion": "aktualisiert",
  "felder": ["name","estimatedvalue","estimatedclosedate","ownerid"],
  "vorher": { "estimatedvalue": 150000 },
  "dataverseId": "a1b2…", "httpStatus": 204, "dauerMs": 87 }
```

`aktion` ist eines von: `angelegt`, `aktualisiert`, `unveraendert`,
`uebersprungen`, `fehlgeschlagen`. **`unveraendert` ist wichtig** — ohne
diesen Wert sieht ein Lauf, der nichts geändert hat, genauso aus wie einer,
der nicht gelaufen ist.

`vorher` wird nur bei `aktualisiert` gefüllt und nur für die tatsächlich
geänderten Felder. Das ist die einzige Möglichkeit, eine Änderung im
Nachhinein zu beurteilen — und der Ersatz für das „Datenbank leeren" des
Altflows.

### Ausschlüsse sind keine Fehler

Ein Datensatz, den `LookupOnly` nicht findet, ist kein blockierender
Fehler. Genau das war Befund B3: *Vorher hätte eine einzige unbekannte
Nummer den ganzen Import verhindert.* Die Zeile fällt aus allen
Folgeschritten, der Rest läuft durch.

Damit sie nicht hinten herunterfällt, gilt dreierlei:

1. Der Prüflauf weist sie **eigens aus** — eigene Kachel, eigene Liste,
   eigenes Blatt im Excel-Bericht. Sie zählt nicht als Fehler.
2. Der Import ist erst frei, wenn jemand die Kenntnisnahme **ankreuzt**.
   Ohne das wäre „12 Zeilen fehlen" eine Zahl, die man wegklickt.
3. Die Vorschau rechnet sie in **allen Folgeschritten** heraus. Täte sie
   das nicht, sagte sie mehr voraus, als der Import tut.

Prüflauf und Import erkennen dieselbe Zeile über denselben Verfolger
(`PRUEFUNG.ausschluss`) — innerhalb eines Blattes über die Zeilennummer,
blattübergreifend über die Spalte, mit der ein Kindblatt an sein
Elternblatt hängt. Zwei Fassungen desselben Gedankens liefen auseinander.

### Warnungen sind keine Fehler

Drei Fälle aus der Datenanalyse, die protokolliert werden, den Import aber
nicht aufhalten:

- Besitzer nicht auflösbar (`<person>@<fremde-domaene>.de`) ⇒ Verkaufschance
  behält den importierenden Benutzer
- Sammeladresse `dummy@dihag.com` ⇒ kein Kontakt, keine Verknüpfung
- Abschlussdatum in der Vergangenheit ⇒ Hinweis

Sie erscheinen im Prüfbericht **vor** dem Import, nicht erst danach. Der
Anwender entscheidet in Kenntnis der Lage.

---

## 11. Sicherheit

### Wo die Daten fließen

```
SharePoint  ──Graph──▶  Browser (Arbeitsspeicher)  ──Web API──▶  Dataverse
                              ▲
                              │  nur Code
                        GitHub Pages
```

Beide Datenwege enden auf Microsoft-Endpunkten und laufen mit dem Token des
angemeldeten Benutzers. GitHub liefert ausschließlich das Programm aus und
sieht keine Fachdaten — kein Dateiinhalt, keine Feldwerte, keine Protokolle.

Das gehört in die Oberfläche geschrieben, weil die Frage garantiert kommt.

### Punkte, die beim Hosten auf `github.io` konkret relevant sind

1. **`dfedorov12.github.io` ist ein gemeinsamer Origin für alle Repos dieses
   GitHub-Kontos.** Jede andere Pages-Seite unter demselben Konto kann auf
   denselben Browser-Storage zugreifen — und damit auf ein dort liegendes
   Token. Deshalb `sessionStorage` statt `localStorage`, und unter diesem
   Konto liegt kein fremder oder experimenteller Code. Fremde Konten
   (`andereruser.github.io`) sind ein anderer Origin und kommen nicht heran.
2. **Für den Dauerbetrieb eigene Domain oder Azure Static Web Apps.** Punkt 1
   ist der Grund. Für Pilot und Abnahme in der Testumgebung ist Pages in
   Ordnung; spätestens beim Produktivgang würde ich wechseln. Der Umzug ist
   klein — anderer Host, andere Redirect-URI, sonst nichts.
3. **Die Rechte des angemeldeten Benutzers gelten.** Die App verwendet
   `user_impersonation`, keinen Anwendungsbenutzer. Wer im CRM nichts anlegen
   darf, kann es auch hier nicht; wer die SharePoint-Bibliothek nicht sehen
   darf, bekommt keine Dateiliste. Der Sicherheitsrahmen bleibt in M365, nicht
   in dieser App.

Das ist ein Unterschied zum Altflow: der läuft unter den fest hinterlegten
Verbindungen seines Erstellers, unabhängig davon, wer die Datei ablegt.

---

## 12. Umsetzungsreihenfolge

Nach jeder Phase steht etwas Lauffähiges. Nicht vorgreifen.

**Phase 1 — Gerüst · ERLEDIGT**
`index.html`, `css/styles.css` mit dem CI-Token-Satz, `js/config.js`,
Prüf-Workflow. Das Corporate Design ist hier schon drin, nicht in Phase 8:
die Vorlage liegt vor, „erst neutral, später umbauen“ löst damit ein Problem,
das nicht besteht.

**Phase 2 — Anmeldung · ERLEDIGT**
`js/auth.js` (PKCE, stiller SSO, zwei Ressourcen über einen Refresh-Token),
`js/data.js` (Rolle aus `AppPermissions`), Boot- und Kein-Zugriff-Schirm.
Dazu ein **Selbsttest** auf der Startseite, der `WhoAmI`, die Rechteliste,
die Quellbibliothek, den Quellordner und die Konfigurationssite prüft. Er
beantwortet mehrere offene Punkte aus §13 beim ersten Aufruf, ohne dass
jemand den Graph Explorer öffnen muss.

**Phase 3 — Dateien aus SharePoint**
Site, Drive und Ordner über Graph auflösen, Dateiliste anzeigen (Name,
geändert am, geändert von, Importstatus), Auswahl. Datei über
`@microsoft.graph.downloadUrl` laden, mit SheetJS öffnen, Blätter und die
ersten 20 Zeilen anzeigen. Noch kein CRM-Kontakt.

Das ist bewusst die erste Phase mit echten Daten: Wenn die Blätter
`Anfragen` und `Positionen` hier sauber aufgehen, ist die Annahme über die
Dateistruktur bestätigt, bevor irgendetwas geschrieben wird.

**Phase 4 — Mapping**
Konfiguration aus SharePoint lesen. Mapping-Oberfläche mit Vorbelegung
über Namensähnlichkeit, manuell korrigierbar. Feldliste kommt aus den
Dataverse-Metadaten, nicht aus einer gepflegten Konstante.

**Phase 5 — Auflösung und Prüflauf**
Zuerst Phase 0 (§8): sechs bis sieben Sammelabfragen, die feststellen, was
existiert, was geschlossen ist und welche Werte im CRM stehen. Erst danach
die Validierung.

Der Bericht nennt Zeile, Spalte, Wert, Regel, Meldung — **und die Vorschau**:
„12 neu, 57 Aktualisierungen, 3 unverändert, 2 übersprungen". Ohne die
Auflösung ist diese Aussage nicht möglich, und ohne sie ist der Prüflauf
wertlos. Download als Excel. Danach erst wird der Import-Knopf aktiv.

**Phase 6 — Import**
Planer, Batch-Runner, Throttling, Fortschrittsanzeige mit Abbruch,
Fehlerbericht. Schreibschritte in der Reihenfolge des Profils, Abschlüsse
zuletzt.

**Phase 7 — Protokoll**
Lauf und Fehler nach SharePoint schreiben, Bibliothekseintrag der Quelldatei
auf `Importiert` setzen. Historie in der App einsehbar.

**Phase 8 — entfällt**
Das Corporate Design ist in Phase 1 aufgegangen.

---

## 13. Offene Punkte

Diese Werte fehlen und dürfen **nicht geraten** werden. Im Profil sind sie
als `KLAEREN…` markiert; solange dort etwas steht, darf der Schritt nicht
scharf geschaltet werden.

**Blockierend für den Bau:**

- [x] ~~`dataverseUrl`~~ — `https://dihag-test.crm4.dynamics.com`, eingetragen
      am 02.09.2026. Die Produktiv-URL wird erst beim Produktivgang gebraucht.
- [ ] **Alternativschlüssel an `opportunity`** anlegen — das Feld ist
      gefunden: **`new_dagextopid`** (Integer), passt bei 200 von 200
      geprüften Chancen exakt zum `#NNNN` im Namen. Vorher aber
      **213 Chancen nachpflegen**, die einen `#`-Namen tragen und das Feld
      noch nicht gesetzt haben (seit 29.05.2026 wird es nicht mehr gefüllt).
      Sonst legt der Import sie neu an. Details in `docs/03`.
- [x] ~~`dag_dihag_kdnr`: 15 doppelte Nummern~~ — 8 bereinigt, **die
      restlichen 7 werden in der App entschieden**: Der Prüflauf listet jeden
      Mehrfachtreffer mit seinen Kandidaten auf, jemand wählt, und die Wahl
      geht ins Protokoll. Geraten wird nicht. Ein Alternativschlüssel auf
      `accounts` bleibt damit entbehrlich; Schritt 10 löst über `$filter` auf.
- [x] ~~Führt die Spalte `Firma` die Kundennummer oder den Namen?~~
      Die **Nummer** — `dag_dihag_kdnr` ist ein Integer.
- [x] ~~Heißt die Bibliothek unter `/sites/IT` tatsächlich **Austausch**?~~
      Ja — eigene Dokumentbibliothek, `Projekt CRM-Timeline` ist der Ordner
      darin, in den Timeline die Mappen legt. Bestätigt am 02.09.2026.

**Neu, aus der Umstellung auf die Hausvorlage (`docs/08`):**

- [ ] **DNS-Eintrag für `crm.dihag.de`** und dieselbe Adresse als
      Umleitungs-URI unter der SPA-Plattform der Registrierung. Ohne die
      eigene Domäne liegen die Token auf dem gemeinsamen Origin
      `dfedorov12.github.io` — siehe §11, Punkt 1.
- [ ] SheetJS vom CDN nachladen oder als `js/vendor/xlsx.full.min.js`
      einchecken? Ohne Build ist eine eingecheckte Datei kein Bruch und
      ausfallsicher. Entscheidung vor Phase 3.
- [ ] Wer bekommt `editor` in `AppPermissions`? Das ist die Prozessfrage
      oben, jetzt als konkrete Eintragung. Bis dahin greifen die
      `hauptAdmins` aus `js/config.js`.

**Prozessfrage, vor Phase 3 zu klären:**

- [ ] Heute löst das Ablegen einer Datei den Import automatisch aus. Künftig
      muss jemand die App öffnen und starten. **Wer ist das?** Legt die
      Fachabteilung weiterhin nur ab und jemand aus der IT startet, oder
      startet die Fachabteilung selbst? Davon hängt ab, wie streng der
      Prüflauf abgenommen werden muss und wer die SharePoint-Berechtigung
      braucht.

**Blockierend für einzelne Felder (Schritt bleibt inaktiv):**

- [x] ~~Technische Prüfung / Produktgruppe~~ (B7) — `cr570_technicalaudit_lookup`
      und `cr570_productlinie_lookup`, beide aktiv im Profil
- [x] ~~Breite, Höhe, Zeichnungsnummer~~ (B8) — `dag_widemm`, `dag_heightmm`,
      `new_zeichnungsid`, alle drei **Textfelder**
- [x] ~~ISO-Währungscode statt GUID~~ (B9) — die GUID des Altflows ist **EUR**
- [x] ~~Was `Mitarbeiter` setzen soll~~ (B1) — `ownerid` an der Verkaufschance,
      `OnCreateOnly`, aktiv im Profil
- [x] ~~Preisliste~~ (A7) — bleibt außen vor. Die Vermutung, dass Positionen
      ohne `pricelevelid` scheitern, gilt hier nicht: 59 von 60 geprüften
      Positionen hängen an Chancen ohne Preisliste.
- [x] ~~Status / Win-Loss~~ (A5) — Abschlüsse werden vorerst **nicht**
      importiert, Schritt 60 bleibt inaktiv. Win/Loss laufen im CRM.

**Nicht blockierend:**

- [ ] Wohin die **Konfigurationslisten**? Eigene Site `CRM-Integration`
      empfohlen, damit Quelldaten und Steuerung getrennt bleiben. Alternativ
      in `/sites/IT` mit dazu. Quellbibliothek bleibt in jedem Fall, wo sie ist.
- [x] ~~Corporate-Design-Vorlage~~ — liegt vor, in Phase 1 umgesetzt
- [ ] Redirect-URI in der App-Registrierung eingetragen? (`docs/01-…`)

**Zu prüfen, unabhängig vom Neubau:**

- [x] ~~Befund B1 — stehen Verkaufschancen da, die niemand angelegt hat?~~
      **Ja, 76 Stück.** Alle am 04.06.2026 angelegt, alle ohne Konto — genau
      das Muster der verschachtelten Schleife. 04.06.2026 ist das
      Änderungsdatum des Flows. Messung in `docs/05`.
- [x] ~~Die 76 überzähligen Verkaufschancen entfernen~~ — **erledigt am
      02.09.2026** mit `aufraeumen-b1.ps1`. 76 gelöscht, 0 Fehler, danach
      137 `new_dagextopid` nachgepflegt. Ergebnis: 1.662 Verkaufschancen mit
      Opp-ID, **1.662 verschiedene Werte, 0 Dubletten**.
- [x] ~~Alternativschlüssel auf `new_dagextopid`~~ — angelegt am 02.09.2026
      als `dag_TimelineOppId`, Index **Aktiv**. Probe:
      `GET /opportunities(new_dagextopid=6440)` liefert die Chance.
      **Befund B2 ist damit erledigt**, der `startswith`-Vergleich entfällt.
- [x] ~~Läuft der Altflow während der Entwicklung weiter?~~ **Nein, er ist
      abgeschaltet** (02.09.2026). Damit entstehen die Geisterdatensätze aus
      B1 nicht erneut, und ein Vergleichslauf ist eindeutig zuzuordnen.

---

## 14. Konventionen

- Commits auf Deutsch, Präfixe `feat:`, `fix:`, `docs:`, `refactor:`.
- Keine Konsolenausgaben in Produktivpfaden. Ab Phase 6 gibt es `js/log.js`
  mit einem Log-Puffer, der in den Protokolleintrag wandert. `console.warn`
  ist bis dahin nur für Zustände erlaubt, die die App selbst abfängt
  (Drosselung, fehlende Spalte).
- Jede Funktion, die mit dem Netz spricht, hat einen Timeout und ist über
  `AbortController` abbrechbar. Ein Import über 8.000 Zeilen, den man nicht
  stoppen kann, ist ein Fehler und kein Feature.
- Fehlermeldungen für Fachanwender enthalten Zeilennummer und Spaltenname
  der Quelldatei. `"Fehler bei Datensatz 4711"` hilft niemandem, wenn in der
  Excel-Datei Zeile 4713 steht.
