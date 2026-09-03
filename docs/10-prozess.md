# Prozessbeschreibung — CRM-Schnittstelle Timeline → Dynamics 365

Was die App tut, in welcher Reihenfolge, und was an jeder Stelle passieren
kann. Geschrieben für alle, die den Import ausführen oder verantworten — nicht
für Entwickler. Die technischen Begründungen stehen in `CLAUDE.md`, die
Einrichtung in `docs/01` bis `docs/03`.

---

## 1. Worum es geht

Das ERP **Timeline** legt wöchentlich eine Excel-Mappe in SharePoint ab. Ihr
Inhalt gehört ins CRM: Kunden, Ansprechpartner, Anfragen und deren Positionen.

Bisher hat ein Power-Automate-Flow das erledigt, automatisch beim Ablegen der
Datei. Er konnte hinterher nicht sagen, was er getan hat, und hat unter
Umständen Datensätze angelegt, die niemand wollte. Diese App ersetzt ihn.

**Der wichtigste Unterschied:** Der Flow lief von allein. Die App muss jemand
öffnen und starten — und sie zeigt vorher, was passieren wird.

---

## 2. Wer was tut

| Rolle | Aufgabe |
|---|---|
| **Timeline** | legt die Mappe in `/sites/IT` ▸ `Austausch` ▸ `Projekt CRM-Timeline` ab |
| **Anwender mit `editor`** | öffnet die App, wählt die Datei, prüft, startet den Import |
| **Anwender mit `viewer`** | darf alles ansehen, auch Prüflauf und Protokoll — aber nicht importieren |
| **IT** | pflegt Zuordnung und Wertzuordnungen in SharePoint, vergibt Rollen |

Die Rechte kommen aus der Liste `AppPermissions` auf `/sites/IT`. Wer dort
nicht steht, sieht den Hinweis „Kein Zugriff" und kann eine Freigabe anfordern.

**Die App hat keine eigenen Rechte.** Sie arbeitet mit dem Konto des
Angemeldeten. Wer im CRM nichts anlegen darf, kann es auch hier nicht.

---

## 3. Der Ablauf, Schritt für Schritt

### Start

Nach der Anmeldung läuft ein **Selbsttest**: Antwortet Dataverse? Ist die
Quellbibliothek erreichbar? Sind die Schlüsselfelder eindeutig? Steht dort
etwas auf `!`, lohnt es sich, das vor dem Import anzusehen.

Oben im Kopf steht dauerhaft die Umgebung — **TEST** in Orange, **PROD** in
Rot. Farbe allein wäre keine Information, deshalb steht der Name daneben.

### Datei wählen

Die App listet die Mappen aus dem Quellordner, neueste zuerst, mit Name,
Änderungsdatum, Größe und Importstatus. Ein Klick auf **Öffnen** lädt die
Datei in den Arbeitsspeicher des Browsers und liest sie.

Sofort sichtbar wird:

- ob beide erwarteten Blätter da sind (`Anfragen`, `Positionen`),
- welche Kopfzeilen normalisiert wurden (die Vorlage hat Leerzeichen am Ende,
  etwa `Breite (mm) `),
- ob Spaltennamen doppelt vorkommen,
- die ersten Zeilen je Blatt.

**Die Datei wird nicht verändert, nicht verschoben und nicht gelöscht.** Sie
bleibt liegen, wo Timeline sie abgelegt hat.

War sie schon einmal importiert, steht das dabei. Ein Wiederholungslauf ist
erlaubt und gefahrlos — jeder Schreibzugriff ist ein Abgleich, kein blindes
Anlegen.

### Zuordnung

Welche Spalte geht in welches Feld? Das steht **nicht im Programm**, sondern in
zwei SharePoint-Listen: `CRM_ImportProfiles` (die Schritte) und
`CRM_FieldMappings` (die Felder). Wer sie ändert, ändert das Verhalten der App
ohne eine einzige Zeile Code.

Diese Seite ändert nichts — sie **prüft**:

| Prüfung | Bedeutung |
|---|---|
| Spalte in der Datei? | Steht die Quellspalte wirklich in der Mappe? |
| Feld in Dataverse? | Gibt es das Zielfeld, ist es beschreibbar, passt der Typ? |
| **Quelle** | In wie vielen Zeilen ist die Quellspalte gefüllt? |
| **im CRM** | Wie viele Datensätze im CRM führen dieses Feld überhaupt? |

Die letzten beiden sind aus Schaden entstanden. Ein Import lief fehlerfrei
durch und schrieb in ein Feld, das es gibt, das Werte annimmt — und das
niemand ansieht: `new_dag_materialteuerungszuschlagmtzabsolut` trug 4 Werte
von 5000 Positionen, gepflegt wird `new_dag_mtzabsolut` mit 2340. Jede Zeile
grün, das Ergebnis unbrauchbar. **Zeilen zu zählen genügt nicht.**

Darunter steht eine **Feldsuche**: Name, Typ und Beschreibbarkeit aller Felder
der Zieltabelle. Die Frage „gibt es dafür überhaupt ein Feld?" wird hier
beantwortet, nicht im Graph Explorer.

### Prüflauf

Der Kern. Er **schreibt nichts** und sagt vorher, was ein Import täte.

Zuerst fragt er den Bestand ab — in wenigen Sammelabfragen, nicht einer je
Zeile. Er weiß danach, welche Konten, Kontakte und Chancen es schon gibt, was
geschlossen ist und welche Werte dort stehen. Erst damit sind die Aussagen
möglich, die den Prüflauf ausmachen:

| Kachel | Bedeutung |
|---|---|
| **neu** | entsteht |
| **geändert** | vorhanden, Werte weichen ab |
| **unverändert** | vorhanden, nichts zu tun |
| **übersprungen** | eine Regel lässt die Zeile aus |
| **ausgeschlossen** | der Bezug fehlt, die Zeile fällt aus allen Folgeschritten |
| **werden ersetzt** | vorhandene Positionen, die den neuen weichen |
| **mit Fehler** | so nicht schreibbar |

**`unverändert` ist ein eigenes Ergebnis.** Ohne diesen Wert sieht ein Lauf,
der nichts geändert hat, genauso aus wie einer, der nicht gelaufen ist.

Darunter, je nach Lage:

- **Offene Entscheidungen** — findet eine Kundennummer zwei Konten, entscheidet
  ein Mensch, welches gemeint ist. Geraten wird nie, und die Wahl steht im
  Protokoll.
- **Auflösung** — was gesucht und was gefunden wurde. Neben jedem „nicht
  gefunden" steht **Was steht dort?**: ein Klick zeigt die echten Werte der
  Zieltabelle neben den gesuchten. Damit ist in Sekunden klar, ob das
  Schlüsselfeld falsch ist oder die Werte.
- **Fehler**, **Ausgeschlossen**, **Warnungen** — jeweils mit Zeile, Spalte,
  Wert und Klartext.

Alles zusammen gibt es als **Excel-Bericht** zum Herunterladen.

### Import

Erreichbar nur über einen Prüflauf **ohne Fehler**. Gibt es ausgeschlossene
Zeilen, muss man ihre Kenntnisnahme ankreuzen — sonst wäre „12 Zeilen fehlen"
eine Zahl, die man wegklickt.

Geschrieben wird in der Reihenfolge des Profils, in Stapeln, mit
Fortschrittsbalken und **Abbruch**. Ein Import über 8.000 Zeilen, den man nicht
stoppen kann, wäre ein Fehler und kein Merkmal.

Zwei Dinge laufen dabei anders, als man vermuten würde:

**Eine kaputte Zeile reißt die anderen nicht mit.** Die Datensätze gehen als
eigenständige Anfragen ins CRM; 99 gehen durch, die eine landet im
Fehlerbericht.

**Positionen werden ersetzt, nicht abgeglichen.** Alle vorhandenen Positionen
einer Anfrage weichen den neuen aus der Datei — Löschen und Anlegen in *einer*
Transaktion. Schlägt etwas fehl, bleibt der alte Stand. Deshalb zählen
Positionen bei jedem Lauf als „neu", auch beim zweiten Import derselben Datei.
Der Altflow löscht, wartet eine Minute und legt dann an; bricht er dazwischen
ab, sind die Positionen weg.

Ist das CRM überlastet, wartet die App genau so lange, wie es verlangt, und
drosselt sich selbst.

### Ergebnis und Protokoll

Nach dem Lauf stehen die Zahlen da — angelegt, aktualisiert, unverändert,
übersprungen, ersetzt, fehlgeschlagen — und darunter zwei Abschnitte, die den
Unterschied zum Altflow ausmachen:

**Warum es fehlschlug.** Nach Ursache gruppiert, nicht Zeile für Zeile: 79
Fehler sind fast immer zwei Gründe und nicht 79.

**Geschrieben, aber nicht vollständig.** Zeilen, die im CRM gelandet sind,
denen aber einzelne Felder fehlen — weil ein Verweis nicht auflösbar war. Kein
Fehler, trotzdem eine Aussage: ein Feld, das in *jeder* Zeile fehlt, ist eine
offene Frage und kein Zufall.

Geschrieben wird das Protokoll auf drei Ebenen:

| Ebene | Wohin | Inhalt |
|---|---|---|
| Lauf | `CRM_ImportRuns` | ein Eintrag je Import: Datei, Zeit, Benutzer, Zahlen je Schritt |
| Zeile | `CRM_ImportErrors` | jede abgewiesene Zeile, mit Grund |
| Vollprotokoll | JSON-Datei | **jede einzelne Operation**, auch Löschungen, mit Vorher-Werten |

Zum Schluss wird die Quelldatei in der Bibliothek als importiert markiert. Der
Ordner dokumentiert sich damit selbst, und ein versehentlicher Doppelimport
fällt vor dem Start auf statt danach.

---

## 4. Was der Import mit den Daten macht

| Schritt | Ziel | Regel |
|---|---|---|
| 10 | Konten | werden **nur gesucht**, nie angelegt. Unbekannte Kundennummer ⇒ die Zeile fällt aus allen Folgeschritten |
| 20 | Kontakte | angelegt oder aktualisiert über die E-Mail-Adresse; die Sammeladresse erzeugt keinen Kontakt |
| 30 | Verkaufschancen | angelegt oder aktualisiert über die Opp-ID |
| 40 | Positionen | **ersetzt** — alle vorhandenen weichen den neuen |
| 50 | Vertriebsprozess | zurückgestellt |
| 60 | Abschluss (Win/Loss) | zurückgestellt — Abschlüsse laufen im CRM |

Kontakte laufen **vor** den Verkaufschancen, damit die Verknüpfung gleich beim
Anlegen steht und nicht nachgetragen werden muss.

### Welche Felder wie oft geschrieben werden

Nicht jedes Feld wird bei jedem Lauf überschrieben:

| Regel | Verhalten |
|---|---|
| `Always` | immer — das sind die Fachdaten aus der Quelle |
| `OnCreateOnly` | nur beim Anlegen — danach gehört das Feld dem CRM |
| `OnlyIfEmpty` | nur, wenn im CRM nichts steht |

Name und Besitzer einer Verkaufschance sind `OnCreateOnly`: Hat ein Vertriebler
sie übernommen oder den Namen korrigiert, darf der nächste Import das nicht
zurückdrehen.

---

## 5. Was schiefgehen kann, und was dann passiert

| Lage | Verhalten |
|---|---|
| Kundennummer unbekannt | Zeile ausgeschlossen, Lauf läuft weiter, Ausweis im Bericht |
| Kundennummer findet zwei Konten | Prüflauf fragt, jemand entscheidet, Wahl im Protokoll |
| Verweis nicht auflösbar (Produktgruppe, Besitzer) | Feld bleibt leer, Rest der Zeile wird geschrieben, Warnung |
| Pflichtfeld leer | Zeile wird nicht geschrieben, Fehler im Bericht |
| Verkaufschance geschlossen | übersprungen — geschlossene Chancen sind schreibgeschützt |
| CRM überlastet | App wartet die verlangte Zeit und fährt fort |
| Netzabbruch mitten im Lauf | Was geschrieben ist, steht im Protokoll. Erneut starten ist gefahrlos: der zweite Lauf findet die Datensätze und ändert sie, statt sie zu doppeln |
| Falsche Datei erwischt | Solange nur der Prüflauf lief, ist nichts passiert — er schreibt nichts |

---

## 6. Was regelmäßig zu tun ist

**Vor jedem Lauf** — nichts. Die App liest ihre Konfiguration bei jedem Aufruf
frisch aus SharePoint.

**Nach Änderungen an der Zuordnung** — nichts in der App; sie liest die Listen
neu. Nur wer die Zuordnung im Repo pflegt, muss sie mit
`setup-crm.ps1 -ProfilLaden` in die Listen übertragen.

**Wenn ein Feld dauerhaft leer bleibt** — im Prüflauf auf *Was steht dort?*
klicken und in der Zuordnung die Spalte *im CRM* ansehen. Fast immer ist es
eines von dreien: falsches Schlüsselfeld, andere Schreibweise, falsches
Zielfeld.

**Beim Produktivgang** — `dataverseUrl` und `umgebung` in `js/config.js`
umstellen. Das Band im Kopf wird dann rot.

---

## 7. Grenzen

Was diese App **nicht** tut:

- Sie legt **keine Konten an.** Unbekannte Kunden sind ein Stammdatenthema.
- Sie **schließt keine Verkaufschancen.** Win und Loss laufen im CRM.
- Sie setzt **keine Vertriebsphase.**
- Sie **löscht keine Dateien** und verschiebt keine.
- Sie läuft **nicht von allein.** Das ist Absicht: vor jedem Schreibzugriff
  steht ein Prüflauf, den ein Mensch gesehen hat.
