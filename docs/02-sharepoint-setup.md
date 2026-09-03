# SharePoint vorbereiten

SharePoint ist in diesem Projekt nicht Beiwerk, sondern **der Ort der Daten**.
Die Quelldateien liegen dort und bleiben dort, die Steuerung liegt dort, das
Protokoll liegt dort. GitHub liefert nur den Programmcode aus.

Zwei Baustellen:

| | Was | Aufwand |
|---|---|---|
| A | **Quellbibliothek** um vier Statusspalten ergänzen | 10 Minuten |
| B | **Konfigurations- und Protokolllisten** neu anlegen | gut eine Stunde |

---

# Teil A — Quellbibliothek ergänzen

Der Ordner existiert bereits, dort landen die Dateien heute:

```
https://dihag.sharepoint.com/sites/IT
   └─ Austausch
       └─ Projekt CRM-Timeline
```

**Nichts umbenennen, nichts verschieben.** Der bisherige Ablauf — Datei
ablegen — bleibt für die Fachabteilung unverändert.

Ergänzt werden vier Spalten in der Bibliothek, damit der Ordner
selbstdokumentierend wird und ein versehentlicher Doppelimport vor dem Start
auffällt statt danach:

| Interner Name | Typ | Anzeige | Werte |
|---|---|---|---|
| `ImportStatus` | Auswahl | Importstatus | `Neu` `Geprüft` `Importiert` `Fehlgeschlagen` |
| `ImportRunId` | Einzeilig | Lauf-ID | Verweis auf `CRM_ImportRuns` |
| `ImportedAt` | Datum/Uhrzeit | Importiert am | |
| `ImportedBy` | Person | Importiert von | |

Standardwert für `ImportStatus`: `Neu`. Bestandsdateien bleiben leer, das
behandelt die App wie `Neu`.

Die App setzt diese Spalten nach dem Lauf per Graph. Sie **verschiebt und
löscht keine Dateien** — ein Verschieben würde die Item-ID entwerten, auf die
das Protokoll verweist.

**Bestätigt am 02.09.2026:** `Austausch` ist eine eigene Dokumentbibliothek,
`Projekt CRM-Timeline` ein Ordner darin — dorthin legt Timeline die Mappen.
`js/config.js` steht entsprechend auf `quellDrive: "Austausch"` und
`quellOrdner: "/Projekt CRM-Timeline"`.

---

# Teil B — Konfigurations- und Protokolllisten

## Vorab: Warum nicht als JSON im Repo?

Technisch ginge das. Es widerspräche aber der Grundentscheidung dieses
Projekts — Logik nach GitHub, Daten nach SharePoint. Feldzuordnungen sind
Konfiguration, das Protokoll sind Daten. Beides gehört nicht ins Repo.

Praktisch kommt dazu:

| | In SharePoint | Als JSON im Repo |
|---|---|---|
| Mapping ändern | Fachanwender, im Browser, ohne Deployment | Entwickler, Commit, Build |
| Wer hat wann was importiert | Liste mit Versionsverlauf | nirgends |
| Fehleranalyse nach drei Wochen | durchsuchbar | Browser-Konsole ist längst zu |

Den Ausschlag gibt Punkt 2. Bei einem Import ins CRM ist die Frage „wer hat
diese 40 Verkaufschancen aus welcher Datei angelegt" keine akademische.
Der Altflow kann sie nicht beantworten.

Die App liest zusätzlich eine lokale JSON als Rückfallebene, damit ein
SharePoint-Ausfall keinen Import blockiert. Die enthält nur Struktur, keine
Fachdaten.

---

## Schritt 0 — Site anlegen

Eigene Team-Site, getrennt von `/sites/IT`. Damit liegen Quelldaten und
Steuerung nicht im selben Topf und lassen sich unterschiedlich berechtigen:
Die Fachabteilung legt Dateien ab, ändert aber keine Feldzuordnungen.

**Angelegt am 02.09.2026** als private Microsoft-365-Gruppe:

| | |
|---|---|
| Anzeigename | `CRM-Integration` |
| Gruppen-ID | `a1b40543-0cd4-4324-9043-6f8372dfa259` |
| Adresse | `crm-integration@dihag.onmicrosoft.com` |
| **Site-URL** | **`https://dihag.sharepoint.com/teams/crm-integration`** |

> ⚠️ **Nicht `/sites/CRM-Integration`.** Der Tenant legt gruppenverbundene
> Sites unter dem verwalteten Pfad `/teams/` ab und benutzt dafür den
> `mailNickname` der Gruppe, nicht den Anzeigenamen. Wer die Adresse aus dem
> Anzeigenamen ableitet, bekommt `itemNotFound`. In `js/config.js` steht
> deshalb `konfigSite: "dihag.sharepoint.com:/teams/crm-integration"`.

Berechtigung: die Personen, die importieren dürfen, als **Mitglied** der
Gruppe. Nicht „Jeder in der Organisation".

---

## Wichtig, bevor Du die erste Spalte anlegst

SharePoint vergibt den **internen Namen** einer Spalte aus dem Namen, den Du
beim Anlegen eingibst — und friert ihn danach ein. Ein späteres Umbenennen
ändert nur die Anzeige.

Aus `Quell Spalte` wird intern `Quell_x0020_Spalte`. Aus `Zielfeld (CRM)` wird
`Zielfeld_x0020__x0028_CRM_x0029_`. Damit ist jede API-Abfrage unlesbar.

**Vorgehen:** Spalte immer zuerst mit dem technischen Namen aus den Tabellen
unten anlegen (`SourceColumn`, `TargetField`, …), also ohne Leerzeichen und
ohne Umlaute. Danach über *Spalte bearbeiten* die Anzeige auf Deutsch ändern.
Intern bleibt der saubere Name, in der Liste steht "Quellspalte".

Das ist zehn Sekunden Mehraufwand pro Spalte und spart später eine Menge
Ärger.

---

## Liste 1 — `CRM_ImportProfiles`

Definiert **was in welcher Reihenfolge** importiert wird. Das Herzstück.

| Interner Name | Typ | Anzeige | Bemerkung |
|---|---|---|---|
| `Title` | Einzeilig | Profilname | z. B. `DIHAG Kundenimport` |
| `Step` | Zahl | Schritt | **Die Reihenfolge.** 10, 20, 30 … in Zehnerschritten |
| `EntitySet` | Einzeilig | Zieltabelle | Plural-Name der Web API: `accounts`, `contacts` |
| `SourceSheet` | Einzeilig | Excel-Blatt | Name des Tabellenblatts |
| `MappingKey` | Einzeilig | Mapping | Verweis auf `CRM_FieldMappings.MappingKey` |
| `Mode` | Auswahl | Modus | siehe Modustabelle unten |
| `OnMissingKey` | Auswahl | Ohne Schlüsselwert | `Fail` \| `Skip` |
| `ParentField` | Einzeilig | Elternfeld | nur bei `ReplaceByParent`, z. B. `opportunityid` |
| `ReplaceScope` | Auswahl | Ersetzungsumfang | `SourceParentsOnly` \| `All` |
| `AlternateKey` | Einzeilig | Alternativschlüssel | z. B. `dag_dihag_kdnr` |
| `BatchSize` | Zahl | Stapelgröße | Vorgabe 100 |
| `SecondPass` | Ja/Nein | Zweiter Durchlauf | für zirkuläre Verweise |
| `SecondPassFields` | Einzeilig | Felder 2. Durchlauf | kommasepariert, z. B. `parentaccountid,primarycontactid` |
| `StopOnError` | Ja/Nein | Bei Fehler anhalten | Ja = folgende Schritte werden übersprungen |
| `Active` | Ja/Nein | Aktiv | Vorgabe Ja |

### Auswahlwerte für `Mode`

| Wert | Bedeutung |
|---|---|
| `Upsert` | Anlegen oder aktualisieren, über den Alternativschlüssel |
| `Create` | Nur anlegen. Vorhandener Datensatz ⇒ Fehler |
| `Update` | Nur aktualisieren. Fehlender Datensatz ⇒ Fehler |
| `LookupOnly` | Nichts schreiben, nur auflösen und prüfen. Für Konten. |
| `ReplaceByParent` | Kinddatensätze eines Elternsatzes ersetzen. Für Positionen. |
| `CreateIfMissing` | Anlegen, wenn noch keiner existiert. Sonst überspringen. |

### Auswahlwerte für `OnMissingKey`

Was passiert, wenn der Schlüsselwert einer Zeile leer ist:

| Wert | Verhalten |
|---|---|
| `Fail` | Zeile wird abgewiesen und im Fehlerbericht gemeldet |
| `Skip` | Zeile wird **nur in diesem Schritt** übersprungen, als Warnung gemeldet, folgende Schritte laufen weiter |

`Skip` ist für die Kontakte gedacht. Eine Anfrage ohne Kontaktemail soll die
Verkaufschance nicht mitreißen — sie wird dann eben ohne Kontakt importiert.
`Fail` überall sonst.

**Ansicht anlegen:** gruppiert nach `Title`, sortiert nach `Step` aufsteigend.
Nur so ist auf einen Blick sichtbar, dass Konten vor Kontakten laufen.

### Beispielinhalt

| Title | Step | EntitySet | SourceSheet | Mode | SecondPass | SecondPassFields |
|---|---|---|---|---|---|---|
| DIHAG Kundenimport | 20 | accounts | Firmen | Upsert | Nein | |
| DIHAG Kundenimport | 30 | contacts | Ansprechpartner | Upsert | Nein | |
| DIHAG Kundenimport | 40 | accounts | Firmen | Update | Ja | `parentaccountid,primarycontactid` |

Zeile 3 ist kein Tippfehler. Konten laufen zweimal: erst ohne die Verweise auf
Mutterkonzern und Hauptansprechpartner, ganz am Ende mit. Anders ist die
wechselseitige Abhängigkeit zwischen Konto und Kontakt nicht auflösbar.

---

## Liste 2 — `CRM_FieldMappings`

Übersetzt Excel-Spalten in Dataverse-Felder. Eine Zeile pro Feld.

| Interner Name | Typ | Anzeige | Bemerkung |
|---|---|---|---|
| `Title` | Einzeilig | Bezeichnung | frei, z. B. `Firmenname` |
| `MappingKey` | Einzeilig | Mapping-Schlüssel | Klammer zum Profil, z. B. `ACCOUNT_STD` |
| `SourceColumn` | Einzeilig | Quellspalte | Kopfzeile aus Excel, **exakt** |
| `TargetField` | Einzeilig | Zielfeld | logischer Name, z. B. `name`, `telephone1` |
| `TargetType` | Auswahl | Datentyp | `String` `Int` `Decimal` `Money` `Boolean` `DateTime` `OptionSet` `Lookup` |
| `IsKey` | Ja/Nein | Schlüsselfeld | Teil des Alternativschlüssels |
| `Required` | Ja/Nein | Pflicht | leer ⇒ Zeile wird abgewiesen |
| `LookupEntitySet` | Einzeilig | Lookup-Ziel | nur bei `Lookup`, z. B. `accounts` |
| `LookupKeyField` | Einzeilig | Lookup-Schlüssel | Alternativschlüssel des Ziels |
| `LookupTypeColumn` | Einzeilig | Typspalte | nur bei polymorphen Lookups, siehe unten |
| `Transform` | Mehrzeilig (Nur Text) | Umwandlung | Kette, z. B. `trim\|upper` |
| `DefaultValue` | Einzeilig | Vorgabewert | wenn Zelle leer |
| `MaxLength` | Zahl | Maximallänge | **nur als Übersteuerung.** Normalfall: leer lassen, die App liest das Limit aus den Dataverse-Metadaten |
| `SortOrder` | Zahl | Sortierung | Reihenfolge in der Oberfläche |
| `Active` | Ja/Nein | Aktiv | |

### Verfügbare Umwandlungen

Kette mit `|`, Ausführung von links nach rechts:

```
trim              Leerzeichen außen entfernen
upper / lower     Groß-/Kleinschreibung
title             Erster Buchstabe je Wort groß
digits            Alles außer Ziffern entfernen
phone:DE          Auf +49… normalisieren
date:TT.MM.JJJJ   Deutsches Datum nach ISO-8601
decimal:de        1.234,56 nach 1234.56
bool:ja/nein      Textwerte nach true/false
empty2null        Leerstring wird null statt ""
truncate:100      Hart auf n Zeichen kürzen
```

`empty2null` klingt nach Kleinigkeit, ist aber wichtig: ein leerer String
überschreibt in Dataverse ein befülltes Feld, `null` löscht es explizit — und
ein nicht mitgesendetes Feld bleibt unangetastet. Das sind drei verschiedene
Ergebnisse. Bei einem `Update`-Lauf entscheidet das darüber, ob vorhandene
CRM-Daten überlebt werden.

### Polymorphe Lookups

`customerid` an einer Verkaufschance kann auf ein Konto **oder** einen Kontakt
zeigen. Die Excel-Datei braucht dann zwei Spalten: den Schlüssel und den Typ.

| SourceColumn | TargetField | TargetType | LookupEntitySet | LookupTypeColumn |
|---|---|---|---|---|
| `Kundennummer` | `customerid` | Lookup | | `Kundenart` |

In `Kundenart` steht je Zeile `account` oder `contact`. Die App bildet daraus
`customerid_account@odata.bind` bzw. `customerid_contact@odata.bind`.

---

## Liste 3 — `CRM_ValueMappings`

Für Auswahlfelder. `Deutschland` in Excel, `100000001` im CRM.

| Interner Name | Typ | Anzeige |
|---|---|---|
| `Title` | Einzeilig | Bezeichnung |
| `MappingKey` | Einzeilig | Mapping-Schlüssel |
| `TargetField` | Einzeilig | Zielfeld |
| `SourceValue` | Einzeilig | Wert in Excel |
| `TargetValue` | Einzeilig | Wert im CRM |
| `IsDefault` | Ja/Nein | Rückfall bei unbekanntem Wert |
| `Active` | Ja/Nein | Aktiv |

Ansicht gruppiert nach `TargetField`.

Unbekannter Wert ohne `IsDefault`-Eintrag ⇒ Zeile wird im Prüflauf beanstandet
und nicht importiert. Nicht stillschweigend leer lassen.

---

## Liste 4 — `CRM_ImportRuns`

Das Protokoll. Wird von der App geschrieben, nicht von Hand.

| Interner Name | Typ | Anzeige |
|---|---|---|
| `Title` | Einzeilig | Lauf-ID (GUID) |
| `ProfileName` | Einzeilig | Profil |
| `SourceFile` | Einzeilig | Dateiname |
| `SourceFileHash` | Einzeilig | Prüfsumme SHA-256 |
| `EnvironmentLabel` | Auswahl | Umgebung (`TEST` / `PROD`) |
| `StartedAt` | Datum/Uhrzeit | Start |
| `FinishedAt` | Datum/Uhrzeit | Ende |
| `StartedBy` | Person | Ausgeführt von |
| `Status` | Auswahl | `Laeuft` `Erfolgreich` `MitFehlern` `Fehlgeschlagen` `Abgebrochen` |
| `IsDryRun` | Ja/Nein | Nur Prüflauf |
| `TotalRows` | Zahl | Zeilen gesamt |
| `CreatedCount` | Zahl | Angelegt |
| `UpdatedCount` | Zahl | Aktualisiert |
| `SkippedCount` | Zahl | Übersprungen |
| `FailedCount` | Zahl | Fehlgeschlagen |
| `DurationSeconds` | Zahl | Dauer |
| `StepSummary` | Mehrzeilig (Nur Text) | Zusammenfassung je Schritt (JSON) |

`SourceFileHash` beantwortet die Frage "wurde genau diese Datei schon einmal
importiert" zuverlässig — der Dateiname tut das nicht, weil
`Kunden_final_v2.xlsx` dreimal existiert und jedes Mal anders aussieht.

**Anlagen aktivieren** (Listeneinstellungen ▸ Erweitert ▸ Anlagen zulassen).
Dort landet das vollständige Log als JSON. Ein mehrzeiliges Textfeld reicht
für einen Lauf über 8.000 Zeilen nicht.

---

## Liste 5 — `CRM_ImportErrors`

Fehler auf Zeilenebene, damit die Fachabteilung nachbessern kann.

| Interner Name | Typ | Anzeige |
|---|---|---|
| `Title` | Einzeilig | Lauf-ID |
| `RowNumber` | Zahl | Excel-Zeile |
| `SheetName` | Einzeilig | Tabellenblatt |
| `EntitySet` | Einzeilig | Zieltabelle |
| `SourceKey` | Einzeilig | Schlüssel des Datensatzes |
| `ErrorType` | Auswahl | `Validierung` `Lookup` `Berechtigung` `Dublette` `API` `Throttling` |
| `HttpStatus` | Zahl | HTTP-Status |
| `ErrorCode` | Einzeilig | Dataverse-Fehlercode |
| `ErrorMessage` | Mehrzeilig (Nur Text) | Meldung |
| `FieldName` | Einzeilig | betroffenes Feld |
| `SourceValue` | Einzeilig | Wert aus Excel |
| `Resolved` | Ja/Nein | Erledigt |

`RowNumber` ist die **Zeilennummer wie in Excel sichtbar**, inklusive
Kopfzeile. Nicht der nullbasierte Array-Index. Der Fachanwender soll die Zeile
aufschlagen können, ohne zu rechnen.

Ansicht: gefiltert auf `Resolved = Nein`, gruppiert nach `ErrorType`.

---

## Schritt 6 — Berechtigungen

Die App greift über Microsoft Graph zu — auf **beides**: die Quellbibliothek
(lesen, Statusspalten schreiben) und die Konfigurationslisten. Nötig in der
App-Registrierung (Details in `01-entra-app-registration.md`):

- `Sites.ReadWrite.All` — **delegiert**, mit Administrator-Zustimmung
- `User.Read` — delegiert

Delegiert heißt: Es gelten die Rechte des angemeldeten Benutzers. Wer die
Bibliothek nicht sehen darf, bekommt keine Dateiliste. Die Berechtigung
erweitert nichts, sie erlaubt der App nur, im Namen des Benutzers zu
handeln.

**Falls die Zustimmung nicht erteilt wird:** `Sites.ReadWrite.All` gilt
tenantweit und manche Administratoren lehnen das ab. Zwei Alternativen:

1. `Sites.Selected` mit Freigabe nur für diese eine Site. Sauberer, aber die
   Freigabe muss ein Administrator einmalig per PowerShell setzen.
2. Konfiguration als JSON im Repo, Protokoll als Excel-Download. Funktioniert,
   widerspricht aber der Trennung Logik/Daten und verliert die Historie.
   Die Quelldateien wären damit trotzdem nicht erreichbar — für die ist der
   Graph-Zugriff zwingend, sonst müsste doch wieder hochgeladen werden.

Diese Frage besser vorab mit dem Tenant-Administrator klären als nach dem Bau.

---

## Schritt 7 — Prüfen

Wenn alles steht, im Browser als angemeldeter Benutzer aufrufen:

```
https://dihag.sharepoint.com/sites/CRM-Integration/_api/web/lists/getbytitle('CRM_ImportProfiles')/items
```

Und für Teil A, im Graph Explorer (`developer.microsoft.com/graph/graph-explorer`)
mit dem eigenen Konto angemeldet:

```
GET /sites/dihag.sharepoint.com:/sites/IT
GET /sites/{siteId}/drives
GET /drives/{driveId}/root:/Projekt CRM-Timeline:/children
```

Damit ist in drei Aufrufen geklärt, wie Bibliothek und Ordner wirklich heißen
— schneller als jede Vermutung.

Kommt JSON zurück, stimmen Listenname und Berechtigung. Kommt `404`, stimmt
der Listenname nicht — meist ein Leerzeichen oder ein Unterstrich zu viel.

Zusätzlich in der Spaltenansicht kontrollieren, dass keine internen Namen
`_x0020_` enthalten. Falls doch: Spalte löschen und neu anlegen. Umbenennen
hilft nicht.

---

## Statt zu klicken: `setup-crm.ps1`

Liegt im Wurzelverzeichnis und macht alles aus diesem Dokument in einem
Durchlauf — Teil A und Teil B, dazu den Eintrag in `AppPermissions`:

```powershell
Connect-MgGraph -Scopes "Sites.Manage.All","Sites.ReadWrite.All" -UseDeviceCode
./setup-crm.ps1 -NurPruefen     # zeigt nur, was fehlt
./setup-crm.ps1
```

### Warum `-UseDeviceCode`

Ohne den Schalter meldet sich das Modul ueber den Windows-Kontenmanager
(WAM) an. Auf PowerShell 7.6 endet das so:

```
Connect-MgGraph: InteractiveBrowserCredential authentication failed:
Method not found: Microsoft.Identity.Client.
BaseAbstractApplicationBuilder`1.WithLogging(IIdentityLogger, Boolean)
```

Das liest sich wie ein Rechteproblem, ist aber keins. `Microsoft.Graph.
Authentication` 2.39 ist fuer .NET 8 gebaut, PowerShell 7.6 laeuft auf
.NET 10 — im WAM-Pfad treffen dabei zwei Fassungen von MSAL aufeinander.
Der Geraetecode-Weg fasst WAM nicht an: PowerShell zeigt einen Code, man
meldet sich im Browser an, und das Skript laeuft weiter wie gehabt.

Wer den Fehler trotzdem loswerden will: PowerShell 7.4 (LTS) nehmen oder
auf eine Modulfassung warten, die fuer .NET 10 gebaut ist. Fuer die
Einrichtung lohnt beides nicht — sie laeuft einmal.

Wiederholbar: Vorhandenes wird erkannt und nicht angefasst. Die Spalten
entstehen mit den technischen Namen aus den Tabellen oben, das
`_x0020_`-Problem tritt also gar nicht erst auf.

**Es braucht kein PnP.** Das Modul `Microsoft.Graph` reicht und benötigt
keine eigene App-Registrierung — damit entfällt auch der Abschnitt
`docs/01` §5 samt der Plattform *Mobile Geräte und Desktopanwendungen*.

### Womit es NICHT läuft: der Token der Azure CLI

Naheliegend, weil `az` meist schon angemeldet ist:

```powershell
$t = az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv
./setup-crm.ps1 -AccessToken $t
```

**Funktioniert nicht.** Der Token der Azure CLI enthält keinen einzigen
`Sites.*`-Scope — nur `Directory.AccessAsUser.All` und `Group.ReadWrite.All`.
Lesen und Gruppen anlegen geht damit, Listen und Spalten anlegen endet in
`403 Forbidden`.

Nachfordern lässt sich der Scope auch nicht:

```
AADSTS65002: Consent between first party application '04b07795-…' and first
party resource '00000003-…' must be configured via preauthorization
```

Microsoft hat die Azure CLI für `Sites.Manage.All` schlicht nicht
vorautorisiert. Das ist keine Zustimmungsfrage und auch durch interaktives
`az login --scope` nicht zu beheben.

**Es braucht also einen Token aus einer Registrierung mit
`Sites.ReadWrite.All`** — entweder `Connect-MgGraph` (Modul
`Microsoft.Graph`) oder ein Gerätecode-Flow über die eigene Registrierung.

### Zwei Dinge kann das Skript nicht:

- **Anlagen in `CRM_ImportRuns` aktivieren.** Über Graph ist der Schalter
  nicht erreichbar; einmal von Hand unter Listeneinstellungen ▸ Erweitert.
- **Die Site anlegen**, ohne eine Microsoft-365-Gruppe zu erzeugen. Mit
  `-SiteAnlegen` tut es das bewusst; sonst nennt es die Alternativen.
