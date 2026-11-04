# Übergabe — Stand und Selbstprüfung

Einstiegspunkt. Wer hier anfängt, weiß nach fünf Minuten, worum es geht, was
entschieden ist und was noch fehlt. Danach `CLAUDE.md` für die Details.

---

## 1. Der Auftrag in vier Sätzen

Ein Power-Automate-Flow (`TestumgebungExpImpCRMTimeline`) importiert heute
Excel-Daten aus einer SharePoint-Bibliothek nach Dynamics 365. Er hat
strukturelle Fehler, die er wegen der Mittel von Power Automate nicht lösen
kann. Er wird durch eine statische Web-Anwendung auf GitHub Pages ersetzt,
die direkt mit der Dataverse Web API spricht. Alles bleibt, wo es ist — nur
die Ausführungslogik zieht um.

---

## 2. Die vier Entscheidungen, die alles andere bestimmen

**E1 — Trennung von Logik und Daten.**
GitHub trägt nur Programmcode. Daten, Konfiguration und Protokolle liegen in
SharePoint und bleiben dort. Die Excel-Dateien werden nicht hochgeladen; die
App holt sie über Graph aus der bestehenden Bibliothek.

```
SharePoint ──Graph──▶ Browser ──Web API──▶ Dataverse
                         ▲
                         │ nur Code
                   GitHub Pages
```

**E2 — Anmeldung über das M365-Arbeitskonto.**
MSAL, Auth-Code + PKCE, kein Secret. Ein Login, daraus still zwei Token
(Graph, Dataverse). Delegiert: es gelten die Rechte des Angemeldeten. Der
Sicherheitsrahmen bleibt in M365, nicht in der App.

**E3 — Jeder Schreibzugriff ist ein Upsert über einen Alternativschlüssel.**
Damit ist jeder Lauf wiederholbar. Bricht er bei Zeile 3.000 ab, startet man
die Datei neu, ohne Dubletten zu erzeugen. Das ersetzt den
`startswith`-Präfixvergleich des Altflows.

**E4 — Prüflauf vor jedem Schreibzugriff, ohne Umgehung.**
Validierung, Lookup-Auflösung, Fehlerbericht — erst dann wird der Import-Knopf
aktiv.

---

## 3. Das Datenmodell

Eine Arbeitsmappe, zwei Blätter, fünf Schritte.

| Step | Ziel | Modus | Quelle | Schlüssel |
|---|---|---|---|---|
| 10 | `accounts` | LookupOnly | Anfragen | `dag_dihag_kdnr` |
| 20 | `contacts` | Upsert | Anfragen | `emailaddress1` + Firma |
| 30 | `opportunities` | Upsert | Anfragen | **offen** |
| 40 | `opportunityproducts` | ReplaceByParent | Positionen | über Verkaufschance |
| 50 | `opportunitysalesprocesses` | CreateIfMissing | Anfragen | über Verkaufschance |

**Besitzer:** Die Verkaufschance bekommt als Besitzer den Systembenutzer aus
der Spalte `Mitarbeiter`. Die steht zwar im Blatt `Positionen`, ist aber je
Verkaufschance eindeutig — 0 Konflikte bei 72 Chancen. Der Altflow setzt
stattdessen seinen eigenen Verbindungsbenutzer und wirft den Mitarbeiter weg.

Konten werden nie geschrieben, nur aufgelöst. Kontakte laufen **vor** den
Verkaufschancen — dadurch entfällt der Nachtrag von `parentcontactid`, den
der Altflow über drei verschachtelte Bedingungen erledigt, und es gibt keine
zirkuläre Abhängigkeit und keinen zweiten Durchlauf.

---

## 4. Was am Altflow kaputt ist

Elf Befunde, vollständig in `docs/05-bestandsanalyse-flow.md`. Die drei, die
laufende Daten betreffen:

| | Befund | Wirkung |
|---|---|---|
| **B1** | Schleife über Positionen enthält Schleife über Anfragen mit `CreateRecord` auf `opportunities` | Verkaufschancen im Kreuzprodukt: 10 Anfragen × 50 Positionen = 500 zusätzliche |
| **B2** | `startswith(name, '#<Opp-ID>')` als Schlüssel | `#12` trifft auch `#120`; Import schreibt stumm auf die falsche Chance |
| **B3** | Positionen werden gelöscht, dann 60 s gewartet, dann neu angelegt | Abbruch dazwischen ⇒ Positionen weg |

Dazu: Kontakte ohne `parentcustomerid` (hängen an keiner Firma), zwei
Lookup-Abfragen pro Zeile deren Ergebnis nie gelesen wird, fünf Excel-Spalten
die nie im CRM ankommen, harte Grenze bei Zeile 300, Hilfsmappe als
gemeinsamer Zwischenspeicher bei parallelen Läufen.

Die dokumentierte Fehlerbehandlung lautet: *„Bitte Denis anschreiben, damit
er die Datenbank leert."* Das ist kein Vorwurf an den Erbauer — mit Power
Automate ist ein Teilrücksetzen kaum machbar. Es ist das Argument für den
Neubau.

---

## 5. Selbstprüfung: was ich im eigenen Entwurf korrigiert habe

Durchgang gegen den Flow-Export und die Dokumente untereinander. Sieben
Funde, alle behoben:

| | Problem | Korrektur |
|---|---|---|
| 1 | Vier Quellspalten ASCII-umgeschrieben (`Laenge (mm)`, `Stueckzahl`, `Hoehe (mm)`, `Technische Pruefung`) | Die App vergleicht Kopfzeilen **exakt** — hätte nie getroffen. Echte Namen mit Umlaut eingesetzt, Behelfsfeld `$quellspalte` entfernt. |
| 2 | Kontaktemail als Pflichtfeld | Hätte die ganze Zeile abgewiesen und damit auch die Verkaufschance. Neu: `OnMissingKey: Skip` — Zeile wird nur in Schritt 20 übersprungen, als Warnung gemeldet, Verkaufschance läuft ohne Kontakt durch. |
| 3 | `ReplaceByParent` ohne Umfangsregel | Eine Anfrage ohne Positionen hätte deren Bestand gelöscht. Neu: `ReplaceScope: SourceParentsOnly` — nur Verkaufschancen, die im Blatt Positionen vorkommen. |
| 4 | Profil nutzt Modi `LookupOnly`, `ReplaceByParent`, `CreateIfMissing`; SharePoint-Liste kannte nur `Upsert/Create/Update` | Auswahlwerte ergänzt, Modustabelle in `docs/02`. |
| 5 | Spalten `ParentField`, `ReplaceScope`, `OnMissingKey` fehlten in der Listendefinition | ergänzt |
| 6 | Schlüsseltabelle in `docs/03` nannte generisch `dihag_extid` für alle Tabellen | durch das echte Modell ersetzt, `contact` als Sonderfall begründet |
| 7 | `MaxLength` als Pflichtangabe im Mapping | Dataverse kennt das Limit selbst. Jetzt reine Übersteuerung, Normalfall leer. |
| 8 | `sharePointSiteUrl` mehrdeutig (Quelle oder Konfiguration?) | in `sourceSiteUrl` und `configSiteUrl` getrennt |

**Was ich stehen lasse, obwohl es unschön ist:** `emailaddress1` als
Schlüssel für Kontakte. Es ist kein guter Schlüssel — E-Mail-Adressen
ändern sich. Aber die Quelldaten geben nichts Besseres her, und der Altflow
macht es genauso. Der Kompromiss ist dokumentiert statt versteckt.

---

## 5a. Zweite Selbstprüfung: gegen die echten Daten

Die Datei `Anfragen_2026-08-27.xlsx` (72 Anfragen, 206 Positionen) hat drei
weitere Fehler in meinem Entwurf aufgedeckt — alle behoben, Details in
`docs/06-datenanalyse.md`.

| | Problem | Korrektur |
|---|---|---|
| 9 | `emailaddress1` als Kontaktschlüssel | **`dummy@dihag.com` steht in 7 von 72 Zeilen bei 7 verschiedenen Firmen.** Mein Upsert hätte denselben Kontakt bei jedem Lauf umgehängt. Neu: Schlüssel ist E-Mail **+ Firma**, Sammeladressen erzeugen gar keinen Kontakt. |
| 10 | Exakter Vergleich der Kopfzeilen | `Breite (mm) ` und `Höhe (mm) ` haben ein Leerzeichen am Ende. Hätte nie getroffen. Neu: Kopfzeilen werden beim Einlesen normalisiert. |
| 11 | `Zeichennummer` aus dem Flow übernommen | Die Spalte heißt in Wahrheit `Zeichnungsnummer`. Der Altflow liest eine Spalte, die es nicht gibt — die Nummer geht bei jedem Lauf verloren, in 202 von 206 Zeilen. |

Das ist der Grund, warum Phase 3 vor allen Schreibphasen liegt: Annahmen
über Dateistruktur halten der Realität nicht stand, und man merkt es erst,
wenn man die Datei aufmacht.

---

## 6. Was jetzt blockiert

Reihenfolge nach Abhängigkeit. Punkt 1 und 2 gehen parallel.

**1. Der Alternativschlüssel an `opportunity`.**
Ohne ihn bleibt B2 unlösbar und Schritt 30 kann nicht gebaut werden. Zu
klären: Gibt es an `opportunity` ein Feld für die Opp-ID? Falls nein: anlegen,
und die Bestandsdaten daraus befüllen (Präfix aus `name` extrahieren), bevor
die App das erste Mal läuft. Sonst legt sie Chancen neu an, die es gibt.

**2. Bibliothekspfad bestätigen.** Drei Aufrufe im Graph Explorer:
```
GET /sites/dihag.sharepoint.com:/sites/IT
GET /sites/{siteId}/drives
GET /drives/{driveId}/root:/Projekt CRM-Timeline:/children
```
Klärt in zwei Minuten, ob `Austausch` eine Bibliothek oder ein Ordner in
„Dokumente" ist.

**3. `dataverseUrl`** der Testumgebung.

**4. Ist `dag_dihag_kdnr` eindeutig?** Und: Führt die Spalte `Firma` die
Kundennummer oder den Namen? Der Flow-Filter steht ohne Anführungszeichen,
das deutet auf eine Zahl — daneben existiert `Firmaname`.

**5. Offene Zielfelder.** Technische Prüfung, Produktgruppe, Breite, Höhe,
Zeichnungsnummer, sonstige Zuschläge, Status, Währungscode. Im Profil als
`KLAEREN` und `Active: false` markiert — sichtbar offen statt stillschweigend
falsch verdrahtet. Zwei davon sind neu dazugekommen, weil die echte Datei
Spalten enthält, die der Altflow gar nicht kennt.

**5a. Regel für den Statuskonflikt.** Bei 9 von 72 Verkaufschancen
widersprechen sich die Positionen; Opp 6889 ist gleichzeitig `Win` und
`Loss`. Solange keine Regel feststeht, bleibt das Feld inaktiv und der
Prüfbericht meldet die Konflikte.

**6. Prozessfrage.** Heute löst das Ablegen einer Datei den Import
automatisch aus. Künftig startet ihn jemand. Wer? Davon hängen
Berechtigungen und Abnahmetiefe ab.

---

## 7. Baureihenfolge

Nach jeder Phase steht etwas Lauffähiges.

| Phase | Ergebnis | Abnahme |
|---|---|---|
| 1 | Vite-Gerüst, Deploy | URL ist live |
| 2 | Anmeldung | `WhoAmI` liefert eine UserId |
| 3 | Dateien aus SharePoint | Blätter `Anfragen`/`Positionen` gehen sauber auf |
| 4 | Zuordnung | Feldliste kommt aus den Metadaten |
| 5 | Prüflauf | Fehlerbericht als Excel, ohne Schreibzugriff |
| 6 | Import | Batch, Throttling, Abbruch möglich |
| 7 | Protokoll | Lauf in SharePoint, Datei als importiert markiert |
| 8 | Corporate Design | erst wenn die Vorlage da ist |

Phase 3 ist die erste mit echten Daten und damit der erste ehrliche Test der
Annahmen über die Dateistruktur — noch bevor irgendwo geschrieben wird.

---

## 8. Fallstricke, die Zeit kosten würden

- **Graph `/content` antwortet mit einer Weiterleitung.** `fetch` folgt ihr
  und schickt den Token an eine fremde Domäne. Ergebnis: CORS-Fehler mit
  irreführender Meldung. Richtig: Metadaten holen,
  `@microsoft.graph.downloadUrl` **ohne** Authorization-Header abrufen.
- **MSAL gibt es seit v3 nicht mehr per CDN.** Nur npm-Bundle.
- **Vite braucht `base: '/crm/'`**, sonst laufen alle Asset-Pfade ins Leere.
- **Redirect-URI vergleicht Entra bytegleich**, inklusive Schrägstrich am Ende.
- **SharePoint friert interne Spaltennamen beim Anlegen ein.** Erst technisch
  benennen, dann Anzeige auf Deutsch umstellen — sonst `Quell_x0020_Spalte`.
- **Batch: Datensätze als eigenständige Requests**, nicht im Changeset, mit
  `Prefer: odata.continue-on-error`. Ein Changeset ist eine Transaktion — eine
  kaputte Zeile würde 99 gute mitreißen. Einzige Ausnahme: Schritt 40, dort ist
  Atomarität gewollt, ein Changeset **je Verkaufschance**.
- **429 immer über `Retry-After`**, nie mit festem Sleep.
- **Prozesse und Plug-ins auf den Zieltabellen prüfen**, bevor produktiv
  importiert wird. Ein Willkommens-Flow, der 8.000 Mails verschickt, ist nicht
  zurücknehmbar.

---

## 9. Was noch aussteht

- Corporate-Design-Vorlage → Phase 8
- Entscheidung, ob GitHub Pages dauerhaft trägt. Für Test und Abnahme ja.
  Für den Produktivbetrieb spricht der gemeinsame Origin aller Repos unter
  `dihaghol.github.io` für eine Firmendomäne oder Azure Static Web Apps.
  Der Umzug ist klein: anderer Host, andere Redirect-URI, sonst nichts.
