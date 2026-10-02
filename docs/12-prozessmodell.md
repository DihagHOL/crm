# Prozessmodell — BPMN nach dem Hausschema des RMS

Die Seite [`prozess.html`](../prozess.html) (live:
[crm.dihag.de/prozess.html](https://crm.dihag.de/prozess.html)) beschreibt den
Ablauf **als Modell**: Steckbrief, Takt, Kennzahlen, vier BPMN-Diagramme,
Rollen und die verknüpften Regelwerke im
[RMS](https://rms.dihag.de/).

Sie ist bewusst eine eigene Seite und kein Reiter in der Anwendung: eine
Prozessbeschreibung, die erst nach dem Anmelden etwas zeigt, liest niemand im
Vorbeigehen — und verlinken lässt sie sich dann auch nicht.

---

## Die Regeln kommen aus dem RMS

Nicht aus diesem Repository. Im RMS steht in `js/prozessschema.js` das
Hausschema: **zehn** zugelassene BPMN-Bausteine und **zehn** Regeln, gegen die
jedes Modell geprüft wird.

| | Regel | Warum |
|---|---|---|
| R1 | Genau ein Auslöser. | Zwei Startpunkte heissen: es sind zwei Prozesse. |
| R2 | Mindestens ein Ergebnis, jedes benannt. | Ein unbenanntes Ende sagt nicht, wie die Sache ausging. |
| R3 | Keine nackte Aufgabe: 👤, ⚙ oder ✋. | Ob Mensch oder System handelt, ist die erste Frage bei jeder Übergabe. |
| R4 | Jeder Knoten in genau einer Bahn. | Sonst hat „wer ist zuständig" keine Antwort. |
| R5 | Bahnen tragen Rollen, keine Personen. | Personen wechseln; ein Modell mit Namen ist am nächsten Montag falsch. |
| R6 | Jede Entscheidung hat ≥ 2 beschriftete Ausgänge. | Ein unbeschrifteter Ausgang zwingt zum Raten. |
| R7 | Nichts hängt lose. | Ein loser Kasten ist eine Notiz, kein Prozessschritt. |
| R8 | Aufgaben als Verb, Entscheidungen mit „?". | Ein Substantiv sagt nicht, was zu tun ist. |
| R9 | Mindestens eine Richtlinie. | Ein Ablauf ohne Regelwerk ist Gewohnheit, keine Vorgabe. |
| R10 | Unterprozesse werden eingebunden, nicht abgeschrieben. | Was zweimal ausgeschrieben steht, ist bald zweimal verschieden. |

`tests/test-prozess.mjs` prüft die **erzeugten Dateien** gegen dieselben
Regeln, bevor sie irgendwo landen — sonst fällt ein Verstoss erst beim Import
ins RMS auf, wenn das Modell schon verteilt ist.

---

## Vier Modelle, nicht eines

| Datei | Modell | Rolle |
|---|---|---|
| `docs/bpmn/01-anfragen-uebernehmen.bpmn` | Anfragen aus TimeLine ins CRM übernehmen | Hauptprozess |
| `docs/bpmn/02-datensaetze-schreiben.bpmn` | Datensätze ins CRM schreiben | Unterprozess (⊞) |
| `docs/bpmn/03-freigabe-einholen.bpmn` | Freigabe einholen | Unterprozess (⊞) |
| `docs/bpmn/04-eingang-ueberwachen.bpmn` | Eingang der TimeLine-Mappe überwachen | eigener Prozess |

**Warum die Überwachung ein eigenes Modell ist:** R1. Sie beginnt mit einer
Uhrzeit (Donnerstag 14 Uhr) und nicht mit einer gelieferten Datei. Als Zweig
im Hauptprozess wäre sie ein zweiter Auslöser — und damit laut Hausschema ein
zweiter Prozess.

`docs/bpmn/modelle.json` ist die Liste, aus der `prozess.html` Reiter, Namen,
Dateipfade und die RMS-Kennungen nimmt. Die Seite führt **keine** eigene
Liste; ein abgeschriebener Name wäre beim nächsten Umbau falsch, ohne dass
irgendetwas rot wird.

---

## Ändern

```bash
node scripts/bpmn/generate-bpmn.js   # erzeugt docs/bpmn/*.bpmn + modelle.json
node tests/test-prozess.mjs          # prüft gegen R1–R10
```

Der Generator ist der Weg für den **Erstimport und für grössere Umbauten**.
Sein Motor (Raster, Kantenführung, BPMN-DI) ist wörtlich der aus
`e-rechnung/scripts/bpmn/generate-bpmn.js` — zwei Layout-Engines im Haus wären
zwei Bildsprachen für dieselbe Sache. Geändert werden nur die Modellangaben
oben in der Datei: Bahnen, Knoten (`c` = Spalte, `r` = Zeile), Flüsse,
Anmerkungen.

---

## Ins RMS bringen

**Führend sind die Modelle im RMS**, nicht die Kopien hier. Solange sie dort
noch nicht liegen, zeigt `prozess.html` die Repository-Fassung und der Knopf
führt auf das RMS statt auf das Modell.

1. In `prozess.html` beim gewünschten Modell **Modell (.bpmn)** herunterladen.
2. Im RMS: Reiter **Prozesse** → Ablage **KONZERN** → Modell importieren. Das
   RMS prüft dabei selbst gegen R1–R10 und zeigt die Befunde am Element.
3. Die Datei-Kennungen (`itemId`) aus dem RMS in `docs/bpmn/rms-ids.json`
   eintragen:

   ```json
   {
     "driveId": "<Kennung der ISMS-Bibliothek>",
     "ablage": "Prozesse/KONZERN",
     "modelle": {
       "uebernahme": "01...", "import": "01...",
       "freigabe": "01...", "eingang": "01..."
     }
   }
   ```

4. `node scripts/bpmn/generate-bpmn.js` erneut laufen lassen. Danach zeigt
   jeder Knopf **Im RMS öffnen** auf `rms.dihag.de/?modell=<itemId>`, und die
   ⊞-Aufrufe tragen den Marker `[[rms:modell=…]]`, den das RMS selbst schreibt.

Ab dann wird **im RMS** gepflegt. Wer hier weiterbaut, baut an einer Kopie.

---

## Verknüpfte Regelwerke

Im Modell stehen sie so, wie das RMS sie selbst schreibt: eine Klartextzeile
plus Marker `[[rms:policies=120,111,119]]` in der Prozess-Dokumentation. Ohne
den Marker wäre die Verknüpfung beim ersten Speichern im RMS verloren.

| ID | Regelwerk | Warum hier |
|---|---|---|
| 120 | Konzernfachregelung Prozessmanagement | Rollen, Lebenszyklus, Standardisierungsgrad — danach ist der Steckbrief gebaut. |
| 111 | ISMS-Richtlinie Sichere Softwareentwicklung | Die Schnittstelle ist Eigenentwicklung. |
| 119 | ISMS-Richtlinie Aufbewahrungsfristen und -pflichten | Protokolle und Berichte sind Nachweise. |

---

## Was die Seite bewusst nicht tut

**Sie liest das Modell nicht live aus dem RMS.** Technisch ginge es (die
E-Rechnung macht es), es hängt aber an einer stillen Anmeldung mit Zugriff auf
die ISMS-Bibliothek. Eine Prozessbeschreibung, die ohne Anmeldung leer bleibt,
ist keine. Stattdessen: Repository-Fassung anzeigen, deutlich sagen, woher sie
kommt, und auf das führende Modell verlinken.

**Sie beschliesst nichts.** Prozesseigner, Standardisierungsgrad und Reifegrad
stehen als Vorschlag da (orange) und gehören ins RMS an die Kachel des
Prozesses. Eine Seite in der Fachanwendung kann sie anzeigen, nicht festlegen.
