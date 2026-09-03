# Session-Log

## 03.09.2026 — Eine Regel, die zehnmal stimmt, ist trotzdem eine Falle

Der erste Prüflauf mit dem gebauten Schritt 50 endete sofort:

```
GET /opportunitysalesprocesses?$select=…,opportunitysalesprocessid
→ HTTP 400 0x80060888: Could not find a property named
  'opportunitysalesprocessid'
```

Phase 0 leitet das Primärschlüsselfeld seit jeher aus dem logischen Namen
ab, `+ "id"`. Von den elf Tabellen dieses Profils stimmt das bei zehn —
`opportunity` → `opportunityid`, `pricelevel` → `pricelevelid`, auch die
beiden `cr570_*`-Verweistabellen. Die elfte heißt
**`businessprocessflowinstanceid`**, und keine Ableitung der Welt kommt
darauf.

Jetzt liest `DV.primaerId()` das `PrimaryIdAttribute` aus den Metadaten,
einmal je Tabelle. Die Ableitung bleibt als Rückfallweg, falls die
Metadaten nicht lesbar sind.

Beim Absichern fiel auf, dass der neue Aufruf in den Testkulissen still in
den `catch` lief — die Stubs kannten `primaerId` nicht, jedes Feld wurde
`null`, und alle Tests blieben grün. Also genau der Fehlertyp, gegen den
diese Änderung gebaut ist. Die Kulissen kennen die Funktion jetzt, und ein
Test hält den Sonderfall fest.

Dritter Fall desselben Musters nach `@odata.bind` und dem `$select` auf
Verweise: **der Name, unter dem Dataverse etwas führt, ist nicht der Name,
den man sich ausrechnen kann.**

## 03.09.2026 — Status ist eine Prozessstufe, und Schritt 50 tut jetzt etwas

**Korrektur.** Ich hatte geschrieben, für `Status` gebe es kein Zielfeld,
weil `opportunityproduct` weder `statecode` noch `statuscode` hat. Das
stimmt — und führt trotzdem in die Irre. Die Vertriebsphase ist überhaupt
kein Feld: sie ist die aktive Stufe eines Geschäftsprozessflows und steht an
`opportunitysalesprocess.activestageid`. „Check Feasibility – Machbarkeit
prüfen" ist ein Stufenname, kein Feldwert.

Gegen die Umgebung geprüft:

| | |
|---|---|
| Instanzen | 4732, **alle** auf Prozess `Vertriebsprozess` (`3e8ebee6`) |
| Stufen | Setup Opportunity 3352 · Negotiate And Close 1227 · Develop And Submitt Proposal 86 · Calculate Products 43 · Check Feasibility 24 |
| Schlüssel | `stagename` — jeder der fünf Namen ist **systemweit eindeutig** |
| `activestageid` | Lookup, anlegbar und änderbar |

Drei weitere Verkaufschancen-Prozesse führen dieselben Stufen unter anderen
Beschriftungen — zweisprachig und deutsch — und haben **keine einzige
Instanz**. Ihre Namen stehen jetzt als Wertzuordnung im Profil, denn Dateien
und Oberflächen zeigen sie.

**Schritt 50 war eine Attrappe.** Er stand auf `Active: true`, und
`lauf.js:125` sprang ihn mit „Modus SetStage ist nicht scharf geschaltet"
für jede Zeile ab. Jetzt ist er gebaut:

- `stufenAuftrag()` in `lauf.js` — zwei Sprünge, Opp-ID → Chance → Instanz.
  Der gewöhnliche Weg findet einen Datensatz über einen Schlüsselwert; hier
  gibt es keinen.
- Phase 0 holt die Instanzen über `ParentField` **samt**
  `_activestageid_value`. Ohne den Wert meldete jede Zeile eine Änderung.
- Vorschau und Import rechnen denselben Weg — sonst kündigt der Prüflauf
  Änderungen an, die nie geschrieben werden.
- **Angelegt wird nichts.** Dynamics erzeugt Prozessinstanzen selbst; eine
  von Hand gebaute träfe womöglich den falschen Prozess, und das fällt
  später schwerer auf als eine fehlende. Fehlt sie, sagt das Protokoll es.

Beim Bauen fiel auf, dass mein eigener Zweig bei fehlender
Verweiskonfiguration **stumm** überspringt — genau das, was dieses Projekt
sonst vermeidet. Der Prüflauf nennt den Grund jetzt einmal je Schritt.

**Preisliste ist die Default Price List der Chance.** Auch hier lag der
Fehler in der Ebene, nicht in der Sache: `opportunityproduct` hat kein
`pricelevelid`, `opportunity` schon (Lookup, beschreibbar). 209 Preislisten,
alle aktiv, **keine Doppelnamen** — `name` genügt als Schlüssel. Die Spalte
steht im Blatt `Positionen` und wird über `SourceLookupBy` an die Chance
gezogen, wie `Mitarbeiter` auch.

Eine Preisliste zu setzen greift in die Preisfindung ein. Deshalb steht im
Profil ausdrücklich, dass `OnlyIfEmpty` die schonende Variante ist — ein
Wort, wenn bestehende Pflege nicht überschrieben werden soll.

**Als Nächstes.** `./setup-crm.ps1 -ProfilLaden`, dann ein Prüflauf. Er sagt
zum ersten Mal, welche Statuswerte wirklich in der Datei stehen — fehlende
Übersetzungen kommen danach in `CRM_ValueMappings`.

## 03.09.2026 — Die drei „offenen" Felder, und eine Prüfung, die schwieg

**Zwei der drei waren nie offen.** In der Zuordnung standen `Preisliste`,
`Status` und `Mitarbeiter` gemeinsam unter „Zielfeld fachlich offen". Gegen
die Metadaten der Umgebung geprüft, sind das drei verschiedene Fälle:

| Spalte | Befund |
|---|---|
| **Mitarbeiter** | wird längst importiert — Schritt 30 schreibt sie nach `ownerid` an der Verkaufschance. An der Position ist es *unmöglich*: `opportunityproduct.ownerid` ist `anlegbar=False`, `aenderbar=False`. |
| **Status** | `opportunityproduct` hat weder `statecode` noch `statuscode`. Es gibt an der Position kein Statusfeld, in das man schreiben könnte. |
| **Preisliste** | echte Entscheidung — aber an der falschen Stelle geführt. Die Position hat kein `pricelevelid`; das Feld gibt es nur an der Chance, dort beschreibbar, 307 von 1000 Chancen führen eine. |

Nur die Preisliste ist damit eine fachliche Frage. Die anderen beiden waren
falsch einsortiert, und die Hinweise im Profil sagen das jetzt auch.

**Die Gegenprobe schwieg genau dort, wo sie am nötigsten ist.** Verweise waren
von der Belegungsprüfung ausgenommen (`z.targetType !== "Lookup"`). Der Grund
schien technisch: `$select=ownerid` liefert den Wert nicht, gelesen werden
kann nur `_ownerid_value`.

Nachgesehen ist es schlimmer. Dataverse weist den Attributnamen nicht zurück —
es **verwirft das ganze `$select`** und gibt den vollen Datensatz zurück, in
dem `ownerid` schlicht fehlt. Die Zählung hätte also null ergeben, und null
liest sich wie „führt wirklich niemand". Dieselbe Falle wie bei MTZ, nur
umgekehrt: dort schrieb der Import fehlerfrei ins falsche Feld, hier hätte die
Prüfung ein richtiges Feld für tot erklärt.

`DV.belegung()` schlägt den Typ jetzt in den Metadaten nach und liest
`Lookup`, `Owner` und `Customer` als `_feld_value` — zurück kommt die Zahl
unter dem Profilnamen, sonst fände die Oberfläche ihre Zelle nicht.
`tests/test-belegung.mjs` hält das fest, samt Ausfall der Metadaten und
doppelter Verpackung.

**`Connect-MgGraph` scheiterte, aber nicht an Rechten.** Die Anmeldung läuft
standardmäßig über den Windows-Kontenmanager, und der bricht auf PowerShell
7.6 ab:

```
Method not found: BaseAbstractApplicationBuilder`1.WithLogging(IIdentityLogger, Boolean)
```

Die Methode ist da — MSAL 4.82.1 im Modulordner hat sie, per Reflection
geprüft. Es kollidieren zwei Fassungen im WAM-Pfad: `Microsoft.Graph.
Authentication` 2.39 ist für .NET 8 gebaut, 7.6 läuft auf .NET 10.
`-UseDeviceCode` umgeht WAM und läuft durch; steht jetzt in `setup-crm.ps1`,
`README` und `docs/02`.

**Als Nächstes.** `./setup-crm.ps1 -ProfilLaden`, dann ein Lauf mit
Belegungsprüfung über *alle* Felder — erstmals auch über die Verweise.

## 03.09.2026 — Felder statt Zeilen, und warum die Zuordnung nicht wirkte

**Die Wertzuordnung griff, die Auflösung nicht.** Die Warnungen zeigten
`Yes` und `50 Energieerzeugung` — übersetzt war also richtig. Nur suchte
Phase 0 weiter mit `Ja` und `Energieerzeugung`: die Auflösung fragt Dataverse
ab, **bevor** MAPPING übersetzt. Sie fand nichts, meldete „nicht vorhanden",
und der Verweis blieb leer, obwohl alles stimmte.

Jetzt bekommt Phase 0 die Wertzuordnungen und sucht mit dem Wert, der später
geschrieben wird. Beide Verweise lösen auf, gebunden wird über die GUID.

**MTZ — schlimmer als „nicht übernommen".** Das Feld wurde geschrieben, in
allen 87 Positionen. Nur ins falsche:

| Feld | im Bestand belegt |
|---|---|
| `new_dag_materialteuerungszuschlagmtzabsolut` (bisher) | **4** von 5000 — und die 4 sind unsere |
| `new_dag_mtzabsolut` | **2340** von 5000 |

Dasselbe beim Einzelpreis: `dag_einzelpreis` 13, `new_priceperunitreplacement`
4323. `priceperunit` ist bei Chancen ohne Preisliste gesperrt — deshalb das
Ersatzfeld. Beide Ziele umgestellt.

**Jede Zeile grün, das Ergebnis unbrauchbar.** Ein Feld kann existieren,
beschreibbar sein, jeden Wert annehmen — und trotzdem das falsche sein.
Zeilen zu zählen genügt nicht. Die Zuordnung zeigt jetzt zwei Zahlen je Feld:

    Quellspalte    Zielfeld                       Quelle   im CRM
    Länge (mm)     dag_lengthmm                   0 / 1    500 / 1000
    Material       dag_material                   1 / 1    900 / 1000
    Einzelpreis    new_priceperunitreplacement    1 / 1    865 / 1000
    MTZ absolut    new_dag_mtzabsolut             1 / 1    468 / 1000

Links: wie oft die Quellspalte gefüllt ist — eine Zuordnung mit `0 / 89` ist
falsch oder überflüssig. Rechts: wie viele Datensätze im CRM das Feld führen,
Stichprobe 1000. Unter einem Prozent wird rot.

**Mitarbeiter, Preisliste und Status an der Position** — gegen die Metadaten
geprüft, alle drei gehen dort nicht:

| Wunsch | Befund |
|---|---|
| Mitarbeiter | `ownerid` an `opportunityproduct` ist **nicht beschreibbar**. Positionen erben den Besitzer der Chance — dort wird er gesetzt. |
| Preisliste | `pricelevelid` gibt es nur an der **Verkaufschance**, nicht an der Position. |
| Status | An der Position nur `propertyconfigurationstatus` (etwas anderes) und das schreibgeschützte `opportunitystatecode`. Der Status gehört zur Chance — Win/Loss, fachlich zurückgestellt. |

**Reiter.** Die Nummern sind weg; sie zählten die Bauphasen mit, nicht die
Schritte des Anwenders — „3 Datei wählen" als erster Punkt nach „Start"
erklärt sich niemandem. Auf der Startseite steht jetzt eine Karte
*Loslegen* mit dem Weg in einem Satz und einem Knopf direkt zur Dateiwahl.

**Neu: `docs/10-prozess.md`** — die vollständige Prozessbeschreibung. Wer was
tut, was in jedem Schritt passiert, was schiefgehen kann und was dann
geschieht, was regelmäßig zu tun ist, und was die App ausdrücklich **nicht**
tut. Für die Fachabteilung, nicht für Entwickler.

267 automatische Prüfungen in neun Dateien.

## 03.09.2026 — Selbst nachgesehen: beide Verweise geklärt

Über die Azure CLI ging ein Dataverse-Token (`az account get-access-token
--resource https://dihag-test.crm4.dynamics.com`) — für Graph taugt sie
nicht, für Dataverse schon. `WhoAmI` antwortet, und damit liessen sich die
offenen Fragen selbst beantworten statt sie weiterzureichen.

**Technische Prüfung.** An der Verkaufschance gibt es beides:

    dag_technicalaudit            Boolean, beschreibbar, auf 1552 von 4740 Chancen true
    cr570_technicalaudit_lookup   Lookup auf eine Tabelle mit genau ZWEI Datensätzen: Yes und No

Die Quellspalte führt `Ja`. Der Verweis passte nie — die Tabelle heisst
**englisch**. Beide Felder sind gepflegt und stimmen in 1598 von 1616 Fällen
überein; **18 widersprechen sich**. Das ist der Preis dafür, dieselbe Aussage
zweimal zu führen und von Hand zu pflegen.

Der Import schreibt jetzt beide aus derselben Quelle und beendet damit das
Auseinanderlaufen: `dag_technicalaudit` über `bool:ja/nein`, der Verweis über
eine Wertzuordnung `Ja → Yes`.

**Produktgruppe.** `cr570_newcolumn` **ist** das Namensfeld — meine Vermutung
mit `cr570_name` war falsch. Die 39 Datensätze heissen aber
`50 Energieerzeugung`, mit vorangestellter Nummer, und die Quelle liefert nur
`Energieerzeugung`. Die Wertzuordnung stellt die Nummer voran; sie ist aus
der Tabelle **erzeugt**, nicht geraten.

**Der Fund nebenbei: Wertzuordnungen haben nie funktioniert.** `MAPPING`
sucht sie unter `mappingKey|feld`, `spListen` lieferte die Zuordnungen aber
ohne `mappingKey` — `undefined|feld` trifft nie. Die ganze Liste
`CRM_ValueMappings` war wirkungslos, und `-ProfilLaden` hat sie ausserdem gar
nicht befüllt. Beides behoben.

Dazu: Ein Wert **ohne** Zuordnung verwirft nicht mehr die Zeile, sondern
warnt und wird unverändert versucht. Eine neue Produktgruppe ist kein Grund,
die Verkaufschance nicht zu schreiben — und ob der Wert etwas trifft,
entscheidet ohnehin gleich darauf der Verweis.

**Nachtrag.** `ConvertFrom-Json` unterscheidet bei Schlüsseln **keine
Gross- und Kleinschreibung** und bricht ab, sobald zwei kollidieren — `Ja`
und `ja` nebeneinander einzutragen war also der falsche Weg, die
Schreibweise abzufangen. Die Zuordnung führt jetzt nur `Ja` und `Nein`;
gesucht wird erst genau, dann ohne Rücksicht auf die Schreibweise. Das ist
ohnehin die bessere Stelle dafür.

265 automatische Prüfungen in neun Dateien.

**Nötig vor dem nächsten Lauf:** `setup-crm.ps1 -ProfilLaden`. Es schreibt
die geänderten Zuordnungen und erstmals die 43 Wertzuordnungen.

## 03.09.2026 — Feldsuche in der Zuordnung

Die offene Frage lautet: Gibt es an der Verkaufschance ein Ja/Nein-Feld für
die technische Prüfung? Sie liess sich bisher nur über die
Dataverse-Oberfläche oder den Graph Explorer beantworten — dabei liegen die
Metadaten längst im Browser, `renderZuordnung` lädt sie ohnehin je Schritt.

Jede Schrittkarte hat jetzt eine **Feldsuche**. Zwei Buchstaben genügen, und
es steht da, was es gibt:

    Feld                         | Typ      | schreibbar
    cr570_auditdate              | DateTime | ja
    cr570_technicalaudit         | Boolean  | ja
    cr570_technicalaudit_lookup  | Lookup   | ja

Kein zusätzlicher Aufruf — gefiltert wird über die Feldliste, die die Karte
schon hat.

**Wenn es das Boolean-Feld gibt**, sind es drei Änderungen an der Zuordnung
in `CRM_FieldMappings`, Zeile *Technische Prüfung*:

    TargetField  cr570_technicalaudit   (statt …_lookup)
    TargetType   Boolean                (statt Lookup)
    Transform    bool:ja/nein

`bool:ja/nein` gibt es bereits in `js/transforms.js` und es liest auch
`true/false`, `1/0`, `x`, `yes/no` — Gross- und Kleinschreibung egal.
`LookupEntitySet` und `LookupKeyField` bleiben leer.

259 automatische Prüfungen, unverändert grün.

## 03.09.2026 — „Ja" und „Energieerzeugung", und warum 87 neu

**Die Gegenprobe hat geantwortet.** Die beiden Quellspalten führen:

| Spalte | Wert |
|---|---|
| Technische Prüfung | `Ja` |
| Produktgruppe | `Energieerzeugung` |

Zwei verschiedene Befunde.

*Produktgruppe* ist Klartext und gehört in eine Verweistabelle — nur nicht
unter `cr570_newcolumn`. Die Gegenprobe zeigt das Feld leer und das
Namensfeld gefüllt. Sie sagt es jetzt auch ausdrücklich: „Das eingetragene
Schlüsselfeld `cr570_newcolumn` ist leer, das Namensfeld `cr570_name` nicht.
Vermutlich gehört `cr570_name` ins Profil." Dafür holt sie sich den
`PrimaryNameAttribute` aus den Metadaten. Beide Verweise suchen jetzt über
`cr570_newcolumn|cr570_name`.

*Technische Prüfung* ist etwas anderes: **`Ja` ist kein Verweis.** Ein
Ja/Nein-Wert gegen eine Verweistabelle passt nicht zusammen — entweder hält
die Tabelle Datensätze `Ja` und `Nein`, oder das Zielfeld ist falsch und
gemeint ist ein Ja/Nein-Feld an der Verkaufschance. Das ist eine fachliche
Frage, keine technische; sie steht als `$offen` im Profil. Bis zur Klärung
bleibt das Feld leer, sichtbar im Bericht.

**Und die 87 „neu".** Berechtigte Irritation: Nach einem erfolgreichen Import
zeigte der zweite Prüflauf `87 neu · 0 geändert`. Die Zahl stimmt — es sind
die Positionen, und `ReplaceByParent` ersetzt sie grundsätzlich. Nur stand
nirgends, dass dafür 87 andere gelöscht werden.

Zwei Lücken:

- Die Vorschau nannte die Ersetzung nicht. Jetzt gibt es eine Kachel
  **„werden ersetzt"**, eine Spalte je Schritt und einen Satz darunter: dass
  Positionen ersetzt und nicht abgeglichen werden, dass sie deshalb bei jedem
  Lauf als „neu" zählen, und dass Löschen und Anlegen in einer Transaktion
  geschehen.
- Der Import **protokollierte die Löschungen gar nicht**. Sie liefen im
  Changeset mit, aber die Antwortauswertung übersprang sie (`if (!z.auftrag)
  continue`). Im Ergebnis stand „87 angelegt", und dass 66 andere weggeräumt
  wurden, stand nirgends — ein Vorgang am Datenbestand ohne Spur, also genau
  der Zustand, gegen den dieses Projekt gebaut ist. Jede Löschung steht jetzt
  mit Datensatz-ID und Grund im Protokoll und in der Bilanz.

**Nachgemessen.** Eine Anfrage mit zwei bestehenden Positionen:

    Vorschau:  2 neu · 1 geändert · 2 unverändert · 1 übersprungen · 2 werden ersetzt · 0 mit Fehler
    Ergebnis:  2 angelegt · 1 aktualisiert · 2 unverändert · 1 übersprungen · 2 ersetzt · 0 fehlgeschlagen

Im Batch stehen die beiden `DELETE` neben den `POST`, und die Produktgruppe
bindet über `cr570_ProductLinie_lookup → /cr570_productline_lookups(p-1)` —
gefunden über das zweite Schlüsselfeld, gebunden über die GUID.

259 automatische Prüfungen in neun Dateien. Das zweite Schlüsselfeld wirkt
erst nach `setup-crm.ps1 -ProfilLaden`.

## 03.09.2026 — Nachsehen statt raten: Gegenprobe und zwei Schlüsselfelder

Zwei offene Fragen aus Lauf 4, beide beantwortbar statt vermutbar.

**Was steht in `cr570_newcolumn`?** Das konnte die App bisher nicht sagen.
Sie meldete „29 nicht gefunden" und nannte die gesuchten Werte — aber nicht,
was stattdessen dort steht. Ein falsches Schlüsselfeld, eine andere
Schreibweise und ein leerer Bestand sehen aus der Ferne gleich aus.

Neben jedem „nicht gefunden" in der Auflösungstabelle steht jetzt ein Knopf
**Was steht dort?**. Er holt echte Werte aus der Zieltabelle und stellt sie
neben die gesuchten:

    In cr570_technicalaudit_lookups.cr570_newcolumn steht:  001  002
    Gesucht wurde:                                          TP-1  TP-9

Damit ist in zwei Sekunden entschieden, ob das Schlüsselfeld falsch ist oder
die Werte.

**Der Mitarbeiter ist kein Fremder.** `internalemailaddress` allein fand
keinen einzigen — dabei steht die Adresse am Systembenutzer an *zwei*
Stellen: als Primäradresse und als Anmeldename (`domainname`). Welche davon
Timeline liefert, ist von aussen nicht zu sehen.

`LookupKeyField` führt jetzt mehrere Felder, durch `|` getrennt und in der
Reihenfolge, in der gesucht wird. Phase 0 fragt jedes ab, die Auflösung nimmt
den ersten Treffer. Im Profil steht für `ownerid` nun
`internalemailaddress|domainname`. Findet ihn keines der Felder, bleibt es
bei der Meldung wie bei den anderen Verweisen — sichtbar, nicht still.

**Dazu.** Warnungen tragen Feld und Wert jetzt getrennt vom Text. Vorher
hätten 29 verschiedene Werte 29 Zeilen ergeben, jede mit demselben Satz; nun
ist es eine Zeile mit einer Wertespalte:

    2 | 30 | cr570_technicalaudit_lookup | „…" gibt es nicht … | TP-1 TP-9 | 2, 3

251 automatische Prüfungen in neun Dateien. Nachgemessen in der Vorschau:
Der Mitarbeiter wird über `domainname` gefunden und als
`ownerid@odata.bind: /systemusers(u-2)` gebunden; die Gegenprobe zeigt
`001 002` gegen `TP-1 TP-9`.

**Wirksam erst nach `setup-crm.ps1 -ProfilLaden`** — das zweite Schlüsselfeld
steht im Repo-Profil, gelesen wird aus der SharePoint-Liste.

## 03.09.2026 — Lauf 4 sauber durch, und was das Protokoll verschwieg

    angelegt 98 · aktualisiert 17 · unverändert 57 · übersprungen 37 · fehlgeschlagen 0

    10 accounts             29 unverändert ·  1 übersprungen (99912936 unbekannt)
    20 contacts             27 unverändert ·  3 übersprungen
    30 opportunities        11 angelegt · 17 aktualisiert · 1 unverändert · 1 übersprungen
    40 opportunityproducts  87 angelegt ·  2 übersprungen
    50 salesprocesses       30 übersprungen (nicht scharf geschaltet)

58 Sekunden, keine Drosselung. Die eine unbekannte Kundennummer nimmt ihre
Anfrage und deren zwei Positionen mit heraus — genau wie vorgesehen.

**Nur: vier Felder wurden in keiner einzigen Zeile geschrieben**, und im
Protokoll stand davon nichts.

| Feld | geschrieben |
|---|---|
| `cr570_technicalaudit_lookup` | 0 × |
| `cr570_productlinie_lookup` | 0 × |
| `ownerid` | 0 × |
| `parentcontactid` | 11 × (nur bei Neuanlagen — `OnCreateOnly`, korrekt) |

Die neue Regel „ein unauflösbarer Verweis kostet ein Feld, nicht die Zeile"
hat getan, was sie soll. Aber sie tat es **stumm**: `MAPPING` erzeugt
Warnungen, der Prüflauf zeigt sie — der Importlauf hat sie weggeworfen. Das
verletzt Randbedingung 12 („kein Datensatz wird geschrieben, ohne dass er im
Protokoll landet — auch gewarnte") und ist derselbe Mechanismus, mit dem der
Altflow die Zeichnungsnummer verliert: geschrieben wird, was geht, und was
nicht geht, erfährt niemand.

Warnungen stehen jetzt am Protokolleintrag, und das Ergebnis hat einen
eigenen Abschnitt **„Geschrieben, aber nicht vollständig"** — nach Ursache
gruppiert, wie die Fehler. Ein Feld, das in *jeder* Zeile fehlt, ist eine
offene Frage und kein Zufall.

**Dazu.** Bei einer Anlage über den Alternativschlüssel gibt Dataverse die
Schlüsseladresse zurück (`opportunities(new_dagextopid=7414)`), nicht die
GUID. Das Protokoll führte sie als `dataverseId` — eine Datensatz-ID, die
keine ist. Sie steht jetzt als `schluesselAdresse` daneben, und in die
Auflösung wandert nur eine echte GUID.

**Offen, fachlich:** `cr570_newcolumn` findet in beiden Verweistabellen
nichts, und `Mitarbeiter` sind fremde Adressen. Solange das so ist, bleiben
Technische Prüfung, Produktgruppe und Besitzer leer — sichtbar im Bericht,
nicht mehr stillschweigend.

243 automatische Prüfungen in neun Dateien.

## 03.09.2026 — Lauf 3: Kontakte laufen, ein Verweis kostet noch die Zeile

Aus dem Vollprotokoll von Lauf `afda0508`:

    angelegt 75 · aktualisiert 0 · unverändert 47 · übersprungen 37 · fehlgeschlagen 50

    10 accounts             29 unverändert ·  1 übersprungen
    20 contacts              9 angelegt    · 18 unverändert · 3 übersprungen
    30 opportunities        29 FEHLER      ·  1 übersprungen
    40 opportunityproducts  66 angelegt    · 21 FEHLER · 2 übersprungen
    50 salesprocesses       30 übersprungen (nicht scharf geschaltet)

**Schritt 20 ist geheilt** — die 29 Kontaktfehler sind weg, stattdessen 9
angelegt und 18 unverändert. Die Adressierung über die GUID trägt.

**Schritt 30 scheitert an einer anderen Stelle mit derselben Meldung.** Nicht
mehr die Verkaufschance selbst, sondern ihr Verweisziel:

    0x80060888: The key in the request URI is not valid for resource
    'Microsoft.Dynamics.CRM.cr570_technicalaudit_lookup'.

Gebunden wurde auf `/cr570_technicalaudit_lookups(cr570_newcolumn='…')`, weil
Phase 0 den Datensatz nicht gefunden hat und der Rückfallweg über den
Alternativschlüssel des Ziels lief. Diese Tabelle hat keinen — die wenigsten
haben einen. Ein Verweis, den es nicht gibt, kostete damit **29 vollständige
Verkaufschancen** samt aller ihrer Positionen.

Jetzt kostet er ein Feld: Ist ein Verweisziel abgefragt und nicht vorhanden,
bleibt das Feld leer und der Rest der Zeile wird geschrieben — mit einer
Warnung, die Wert und Zieltabelle nennt. **Pflichtverweise bleiben ein
Fehler**; eine Zeile ohne Pflichtverweis ist keine halbe Zeile, sondern eine
falsche.

Wichtig ist der Unterschied zwischen *nicht abgefragt* und *abgefragt und
nicht da*. Nur im zweiten Fall greift die Regel — sonst würde ein Feld
stillschweigend fallen, nur weil Phase 0 nichts darüber weiss. Der Auflöser
unterscheidet das jetzt (`undefined` gegen `null`).

**Elf Entscheidungen, die keine waren.** Im Bericht standen elf
Mehrfachtreffer auf `opportunityproducts|_opportunityid_value`. Eine
Verkaufschance hat mehrere Positionen — das ist der Normalfall, keine Frage,
und beim Ersetzen werden ohnehin alle gelöscht. Abfragen, bei denen mehrere
Treffer je Wert erwartet sind, tauchen nicht mehr unter „Offene
Entscheidungen" auf.

**Offen, fachlich:** Warum findet Phase 0 die Prüfungen und Produktgruppen
nicht? Entweder stehen in `cr570_technicalaudit_lookups` andere Werte als in
der Spalte *Technische Prüfung*, oder `cr570_newcolumn` ist nicht das
richtige Schlüsselfeld. Der Prüflauf zeigt es in der Auflösungstabelle unter
„nicht gefunden". Bis das geklärt ist, laufen die Chancen durch und die
beiden Felder bleiben leer.

237 automatische Prüfungen in neun Dateien.

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
