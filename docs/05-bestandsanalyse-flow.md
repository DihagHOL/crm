# Bestandsanalyse: Flow `TestumgebungExpImpCRMTimeline`

Ausgewertet aus dem Export (`definition.json`, 39 KB, 40 Aktionen). Dieses
Dokument hält fest, **was der Flow tut**, **was dabei schiefgeht** und **was
davon in die neue Anwendung übernommen wird**.

---

## 1. Was der Flow tut

**Auslöser:** neue Datei in
`https://dihag.sharepoint.com/sites/IT` ▸ `/Austausch/Projekt CRM-Timeline`,
Abfrage im Minutentakt.

**Quelldatei:** eine Excel-Arbeitsmappe mit zwei Blättern:

| Blatt | Bereich | Inhalt |
|---|---|---|
| `Anfragen` | `A1:R300` | eine Zeile je Verkaufschance |
| `Positionen` | `A1:R300` | eine Zeile je Angebotsposition |

**Ablauf in Kurzform:**

```
Datei erkannt
  └─ Excel-Tabellen über die Bereiche legen (Tabelle1/Tabelle2)
  └─ 60 Sekunden warten
  └─ je Zeile "Anfragen":
       Konto suchen  (accounts, dag_dihag_kdnr = Firma)
       Verkaufschance suchen (startswith(name, '#Opp-ID'))
       ├─ nicht gefunden → opportunity anlegen
       └─ gefunden      → opportunity aktualisieren + alle Positionen löschen
       Kontakt über E-Mail suchen, ggf. anlegen, an opportunity hängen
       Zwischenstand in eine Hilfsmappe schreiben
  └─ je Zeile "Positionen": Verkaufschance auflösen, in Hilfsmappe schreiben
  └─ 60 Sekunden warten
  └─ Hilfsmappe lesen → opportunityproducts anlegen
                      → opportunitysalesprocesses anlegen
  └─ Hilfsmappe leeren
```

**Berührte Dataverse-Tabellen:** `accounts`, `contacts`, `opportunities`,
`opportunityproducts`, `opportunitysalesprocesses`, `systemusers`,
`transactioncurrencies`, `cr570_technicalaudit_lookups`,
`cr570_productline_lookups`.

Die **Hilfsmappe** (Datei-ID `01HTUEJ2SHYU5FULSRPNE2SBXU7OVY2XMK`) ist kein
fachlicher Bestandteil. Sie ist ein Zwischenspeicher, weil Power Automate
keine brauchbaren Datenstrukturen über Schleifengrenzen hinweg hat. In der
neuen Anwendung entfällt sie ersatzlos — dort ist das eine Variable.

---

## 2. Befunde

Sortiert nach Dringlichkeit. Die ersten drei würde ich unabhängig vom
Neubau zeitnah prüfen, weil sie im laufenden Betrieb Daten betreffen.

### B1 — Verschachtelte Schleife erzeugt Verkaufschancen im Kreuzprodukt

**Kritisch.** In `Auf_alle_anwenden_1` (Schleife über alle Positionen) steckt
`Auf_alle_anwenden_4` — eine Schleife über alle Anfragen. Darin:
`CreateRecord` auf `opportunities`.

```
für jede Position
    für jede Anfrage
        neue Verkaufschance anlegen
```

Bei 10 Anfragen und 50 Positionen sind das **500 zusätzlich angelegte
Verkaufschancen** pro Lauf, mit Namen aus den Anfragen und fest verdrahteter
Währung. Die Aktion ist nicht deaktiviert und hat keine Bedingung.

Vermutlich sollte hier nur der Besitzer (`ownerid`) an einer bestehenden
Verkaufschance nachgetragen werden — dann wäre es ein `Update` auf die
konkrete Chance statt ein `Create` in einer Schleife.

**Vor der Migration klären:** Stehen im Testsystem Verkaufschancen, die
niemand angelegt hat? Das wäre die Bestätigung.

### B1 — bestätigt am 02.09.2026

Gemessen in der Testumgebung. Von 1.734 Verkaufschancen mit `#`-Namen
verteilen sich 115 Datensätze auf nur 39 Opp-IDs:

```
verschiedene Opp-IDs:             1.657
Opp-IDs mit mehreren Chancen:        39   (37 davon mit genau 3)
überzählige Datensätze:              76
```

Die 76 Überzähligen sind kein Zufallsbefund:

| Merkmal | Überzählige | Originale |
|---|---|---|
| angelegt am | **alle 76 am 04.06.2026** | verteilt über zwei Jahre |
| ohne Konto (`parentaccountid`) | **76 von 76** | 3 von 39 |
| ohne `new_dagextopid` | 76 von 76 | 0 von 39 |
| ohne Umsatzwert | 58 von 76 | 14 von 39 |
| aktiv | 76 von 76 | — |

**Das passt exakt auf die verschachtelte Schleife.** `Auf_alle_anwenden_4`
setzt beim Anlegen nur `name`, die fest verdrahtete Währung und `ownerid` —
kein `parentaccountid`. Genau deshalb hat keiner der 76 ein Konto, während
die Originale eines haben.

Und das Datum: **04.06.2026** ist der `clientLastModifiedTime` des Flows aus
dem Export. Der Flow wurde an diesem Tag geändert, lief einmal, und erzeugte
je betroffener Anfrage zwei zusätzliche Verkaufschancen.

**Folgen, die über die Aufräumarbeit hinausgehen:**

1. **Der Alternativschlüssel auf `new_dagextopid` lässt sich erst danach
   anlegen.** Ein Schlüssel verlangt Eindeutigkeit; bei 39 Opp-IDs mit
   mehreren Chancen scheitert er.
2. **Die Nachpflege der 213 leeren `new_dagextopid` darf nicht blind
   laufen.** 50 davon würden einen bereits vergebenen Wert doppeln, 39 Werte
   kämen unter den Kandidaten selbst mehrfach vor.
3. **Die Testumgebung ist als Vergleichsgrundlage verfälscht**, solange die
   76 drinstehen.

Reihenfolge daher: erst die 76 entfernen, dann die verbleibenden ~137
nachpflegen, dann den Schlüssel anlegen.

**Alles drei erledigt am 02.09.2026** mit `aufraeumen-b1.ps1`: 76 gelöscht,
137 nachgepflegt, Alternativschlüssel `dag_TimelineOppId` auf
`new_dagextopid` angelegt und aktiv. **Der Altflow ist seither
abgeschaltet** – ohne das wären die Geisterdatensätze beim nächsten Lauf
erneut entstanden.

### B2 — Verkaufschancen werden über einen Namenspräfix gesucht

```
$filter: startswith(name, '#<Opp-ID>')
```

`startswith` ist keine Gleichheit. Die Suche nach `#12` trifft auch `#120`,
`#123` und `#1234` — und `$top: 1` nimmt davon einfach die erste. Der Import
schreibt dann auf die falsche Verkaufschance.

Das fällt so lange nicht auf, wie alle Opp-IDs gleich lang sind. Sobald die
Nummernkreise zweistellig **und** dreistellig sind, ist es eine stille
Datenverfälschung ohne Fehlermeldung.

Ersatz: Alternativschlüssel auf `opportunity` mit einem eigenen Feld für die
Opp-ID.

### B3 — Positionen werden gelöscht, bevor die neuen sicher sind

Bei einer bestehenden Verkaufschance werden **erst alle
`opportunityproducts` gelöscht**, dann 60 Sekunden gewartet, dann aus der
Hilfsmappe neu angelegt. Bricht der Lauf dazwischen ab — Zeitüberschreitung,
Drosselung, Netzfehler — sind die Positionen weg und die neuen nicht da.

Es gibt keinen Rücksetzpunkt und keine Wiederholung.

### B4 — Die Hilfsmappe ist ein gemeinsam genutzter Zwischenspeicher

Der Auslöser prüft **jede Minute** und verarbeitet über `splitOn` jede Datei
als eigenen Lauf. Zwei Dateien im selben Intervall ergeben zwei parallele
Läufe, die

- in **dieselbe** Hilfstabelle schreiben,
- daraus lesen, was der jeweils andere geschrieben hat,
- und am Ende **alle** Zeilen daraus löschen.

Ergebnis: Positionen landen an fremden Verkaufschancen, oder ein Lauf findet
seine eigenen Daten nicht mehr vor. Die beiden `Verzögern`-Aktionen à 60
Sekunden vergrößern das Zeitfenster, in dem das passieren kann.

Solange immer nur eine Datei zur Zeit abgelegt wird, tritt es nicht auf. Es
ist ein Prozessrisiko, kein theoretisches.

### B5 — Harte Grenze bei 300 Zeilen

```
Tabelle1: Positionen!A1:R300
Tabelle2: Anfragen!A1:R300
```

Zeile 301 und alles darunter wird **ohne Meldung ignoriert**. Kein Fehler,
kein Hinweis, der Lauf gilt als erfolgreich.

### B6 — Kontakte werden ohne Konto angelegt

Beim Anlegen eines Kontakts werden nur `firstname`, `lastname` und
`emailaddress1` gesetzt. **`parentcustomerid` fehlt.** Die Kontakte hängen
danach an keiner Firma und tauchen in der Kontaktliste des Kontos nicht auf,
obwohl das Konto im selben Durchlauf bekannt ist.

Zusätzlich: gesucht wird ausschließlich über `emailaddress1 eq '…'`. Zeilen
ohne E-Mail finden nie einen Treffer und legen bei **jedem** Lauf einen neuen
leeren Kontakt an.

### B7 — Zwei Abfragen pro Zeile, deren Ergebnis nie verwendet wird

`cr570_technicalaudit_lookups` und `cr570_productline_lookups` werden je
Anfrage-Zeile abgefragt und in die Variablen `TechnicalAudit` und
`Productline` geschrieben. Diese Variablen werden danach **an keiner Stelle
gelesen** — im gesamten Export null Treffer.

Technische Prüfung und Produktgruppe kommen also nie im CRM an. Entweder ist
das eine unfertige Baustelle oder ein Rest aus einem Umbau. Bei 300 Zeilen
sind es 600 überflüssige Dataverse-Aufrufe pro Lauf.

### B8 — Felder gehen zwischen Excel und CRM verloren

In die Hilfsmappe geschrieben, aber nie nach `opportunityproducts` übertragen:

| Excel-Spalte | Status |
|---|---|
| `Breite (mm)` | geht verloren |
| `Höhe (mm)` | geht verloren |
| `Zeichennummer` | geht verloren |
| `Preisliste` | geht verloren |
| `Status` | geht verloren |

Zu klären, ob es dafür Zielfelder gibt (`dag_widthmm`, `dag_heightmm`, …)
oder ob die Spalten fachlich nicht gebraucht werden.

### B9 — Fest verdrahtete Werte

| Wert | Fundstelle |
|---|---|
| Währungs-GUID `be7f5393-3f5d-ed11-9561-0022489c8366` | Anlage der Verkaufschance |
| Empfänger `boehmer@dihag.com` | Fehlermeldung |
| Hilfsmappen-Datei-ID | 6 Aktionen |
| SharePoint-Bibliotheks-GUID | Auslöser |

Beim Umzug Test → Produktion muss jeder dieser Werte einzeln von Hand
angefasst werden. Genau daran scheitern solche Flows beim Deployment.

### B10 — Der Wiederherstellungsplan steht in einer E-Mail

> „… Import ist fehlgeschlagen: Firmennummer fehlt! Bitte Denis anschreiben,
> damit er die Datenbank leert."

Das ist die dokumentierte Fehlerbehandlung: Person anschreiben, Datenbank
leeren, von vorn. Das ist kein Vorwurf an den Erbauer — mit den Mitteln von
Power Automate ist ein Teilrücksetzen kaum machbar. Es ist aber das
deutlichste Argument für den Neubau.

### B11 — Kleinigkeiten

- Spaltenname `Voaussichtlicher Umsatz` — Tippfehler, muss in der Excel-Vorlage
  exakt so bleiben, sonst bricht der Flow. In der neuen Lösung wird die
  Zuordnung in SharePoint gepflegt, damit lässt sich der Name korrigieren.
- In der Hilfsmappe heißen Spalten `Breite (mm) ` und `Höhe (mm) ` — mit
  Leerzeichen am Ende. Der Vergleich ist trotzdem exakt.
- `Zeichennummer` (Quelle) gegen `Zeichnungsnummer` (Ziel) — zwei Schreibweisen.
- `opportunitysalesprocesses` wird **je Position** angelegt, nicht je
  Verkaufschance. Bei 8 Positionen also 8 Vertriebsprozesse an einer Chance.
- Keine Schleife hat Parallelität konfiguriert. Alles läuft sequentiell, plus
  120 Sekunden reine Wartezeit pro Lauf.

---

## 3. Was übernommen wird

Aus dem Flow ist die **Fachlogik** wertvoll — die ist über Monate gewachsen
und bildet einen realen Prozess ab. Verworfen wird nur die Mechanik.

| Aus dem Flow | In der neuen Anwendung |
|---|---|
| Konto über `dag_dihag_kdnr` finden | bleibt — wird zum Alternativschlüssel |
| Verkaufschance anlegen/aktualisieren | bleibt — als Upsert über Alternativschlüssel |
| Kontakt über E-Mail suchen | bleibt, **plus** Verknüpfung mit dem Konto (B6) |
| Positionen ersetzen | bleibt, aber erst löschen, wenn die neuen validiert sind (B3) |
| Vertriebsprozess anlegen | bleibt, einmal je Verkaufschance (B11) |
| Hilfsmappe + 2× 60 s Warten | entfällt — Zwischenstand im Arbeitsspeicher |
| Excel-Tabellen zur Laufzeit anlegen | entfällt — SheetJS liest Bereiche direkt |
| Grenze bei 300 Zeilen | entfällt |
| Nachricht an Denis als Rücksetzplan | ersetzt durch Prüflauf und Protokoll |

**Laufzeit:** heute rund 2 Minuten Wartezeit plus sequentielle
Einzelaufrufe. Neu: ein Batch pro 100 Datensätze, moderat parallel. Bei 300
Zeilen ist der Unterschied etwa eine Größenordnung.

---

## 4. Offene Fragen

Die stehen jetzt ganz oben, weil sie die Feldzuordnung bestimmen:

1. **B1:** Ist die verschachtelte Schleife gewollt? Falls nicht — stehen im
   Testsystem Verkaufschancen, die dadurch entstanden sind?
2. Gibt es an `opportunity` ein Feld für die **Opp-ID**? Wenn ja: logischer
   Name. Wenn nein: eins anlegen, sonst bleibt `startswith` (B2) das einzige
   Fundament.
3. Wofür sind **Technische Prüfung** und **Produktgruppe** gedacht (B7)?
   In welche Felder an `opportunity` sollen sie?
4. Zielfelder für **Breite, Höhe, Zeichennummer, Preisliste, Status** (B8)?
5. Führt `Firma` in der Excel-Datei die **Kundennummer** oder den Namen?
   Der Filter `dag_dihag_kdnr eq @{…Firma}` steht ohne Anführungszeichen —
   das deutet auf eine Zahl. Daneben gibt es eine Spalte `Firmaname`.
6. Ist `dag_dihag_kdnr` in `accounts` **eindeutig**? Für den
   Alternativschlüssel muss es das sein.
