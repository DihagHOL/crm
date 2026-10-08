# Automatik — der unbeaufsichtigte Import

Der Cron sieht im Quellordner nach, prüft jede neue Mappe und importiert
die unstrittigen von selbst. Was er nicht allein entscheiden kann, legt er
im Reiter **Automatik** zur Freigabe vor. Zum Schluss geht ein Bericht per
Mail an die eingetragene Adresse.

| | |
|---|---|
| Wo läuft es | GitHub Actions, `.github/workflows/automatik.yml` |
| Was läuft | `cron/automatik.mjs` — lädt **dieselben** Dateien wie der Browser |
| Zeitplan | GitHub löst unregelmässig aus, gemessen rund 5× am Tag; **ob** gearbeitet wird, steht in SharePoint |
| Identität | App **DIHAG Cron-Job** (`089bf9ad-…`) — dieselbe wie ZAPP, Bedarfsanfrage, Compliance |

---

## Warum der Takt nicht im Workflow steht

Im Workflow steht `*/15 * * * *`. Das ist kein Takt, sondern ein Blick auf
die Uhr. Der eigentliche Takt steht in der SharePoint-Liste
`CRM_Automatik`, und der Lauf hält sich daran:

```
Aktiv = ja, TaktMinuten = 30, VonUhr = 0, BisUhr = 23, Wochentage = täglich
→ jeder Lauf, den GitHub auslöst, darf arbeiten; gearbeitet wird nur,
  wenn eine neue Mappe da ist.
```

**Der Zeitplan ist unzuverlässiger als er aussieht.** Am 06.10.2026
nachgezählt: von 96 möglichen Auslösungen am Tag materialisiert GitHub rund
**fünf**, zu beliebigen Minuten (68 Läufe in 13 Tagen). Am Donnerstag,
01.10., waren es 02:15, 08:14, 15:18, 20:56 und 00:58 deutscher Zeit — genau
einer davon lag im damals eingestellten Fenster 4–14 Uhr. Deshalb steht das
Fenster jetzt offen: ein enges Fenster verlässt sich auf einen Zeitplan, den
es nicht gibt.

Der Grund ist der Bedienbare: **eine Taktänderung soll eine Eingabe im
Werkzeug sein und kein Pull Request.** Dieselbe Linie wie beim
Importprofil, das auch in SharePoint steht und nicht im Repository.

Alles im Reiter **Automatik** einstellbar:

| Einstellung | Standard | Bedeutung |
|---|---|---|
| `Aktiv` | `nein` | Hauptschalter. Nach der Einrichtung bewusst auf `ja` stellen. |
| `TaktMinuten` | `60` | Mindestabstand zwischen zwei Läufen. |
| `VonUhr` / `BisUhr` | `6` / `18` | Zeitfenster in **deutscher** Zeit, Sommerzeit inbegriffen. |
| `Wochentage` | `Mo-Fr` | Auch `täglich` oder `Mo,Mi,Fr`. |
| `AbDatum` | Tag der Einrichtung | **Stichtag.** Ältere Mappen bleiben liegen. Leer = alle. |
| `MaxDateien` | `3` | Höchstzahl Mappen je Lauf. |
| `WarnungenBlockieren` | `nein` | Sollen Warnungen eine Freigabe erzwingen? |
| `ErwartetAn` | — (leer) | **Fehlanzeige.** Tage, an denen eine Mappe erwartet wird, z. B. `Do`. Leer = keine Erwartung. |
| `ErwartetBisUhr` | `14` | Bis zu dieser Stunde muss sie da sein (deutsche Zeit). |
| `ErwartetEmpfaenger` | — (leer) | Wer die Fehlanzeige bekommt, z. B. `ticket@dihag.com`. Leer = wie `Empfaenger`. |
| `Empfaenger` | `administrator@dihag.com` | Mehrere durch Semikolon. |
| `Absender` | `administrator@dihag.com` | Postfach für den Versand. |
| `LetzterLauf` | — | Schreibt der Cron. **Von Hand leeren erzwingt den nächsten Lauf.** |
| `LetzteFehlanzeige` | — | Schreibt der Cron: das Datum des gemeldeten **Termins**. Sorgt dafür, dass es je Termin eine Meldung gibt, auch wenn sie nachgeholt wird. |

---

## Einrichtung

**Es wird keine neue App-Registrierung gebraucht.** Der Haus-Cron
**DIHAG Cron-Job** (`089bf9ad-2d9a-4cbc-b85d-88b4484af0bb`) — derselbe, mit
dem ZAPP, Bedarfsanfrage und das Compliance-Cockpit laufen — bringt das
meiste schon mit. Geprüft am 23.09.2026 gegen den Tenant:

| Was | Stand |
|---|---|
| `Sites.Selected` (Anwendung) | ✅ vorhanden |
| `Sites.Read.All` (Anwendung) | ✅ vorhanden — Lesen tenant-weit |
| `Mail.Send` (Anwendung) | ✅ vorhanden, sendet bereits als `administrator@dihag.com` |
| Schreibrecht auf `/sites/IT` | ✅ für ZAPP vergeben |
| Schreibrecht auf `/teams/crm-integration` | ❌ **fehlt** — die Site gibt es erst seit diesem Projekt |
| Dynamics-CRM-Berechtigung | ❌ **fehlt** |
| Anwendungsbenutzer in Dataverse | ❌ **fehlt** (0 von 211 Anwendungsbenutzern ist unserer) |

Bleiben drei Schritte statt fünf.

### 1. Dynamics CRM als Berechtigung — **nicht nötig**

Fast jede Anleitung zu Server-zu-Server-Zugriff auf Dataverse verlangt, der
Registrierung die Berechtigung *Dynamics CRM → user_impersonation*
hinzuzufügen. Am 23.09.2026 gegen die Umgebung geprüft: **die App hat sie
nicht, und der Lauf bekommt trotzdem ein Dataverse-Token.** Bei
Client-Credentials zählt allein der Anwendungsbenutzer (Schritt 3).

Steht hier, damit es niemand ein zweites Mal ausprobiert.

### 2. Schreibrecht auf die Konfigurationssite

`Sites.Selected` gilt **je Site**. Lesen kann die App überall
(`Sites.Read.All`), schreiben nur dort, wo sie einzeln freigeschaltet ist.
Für `/sites/IT` ist das seit ZAPP der Fall; die CRM-Konfigurationssite kam
später dazu. Einmalig als Global- oder SharePoint-Administrator:

```powershell
Connect-MgGraph -TenantId fdb70646-023a-403b-a4b9-1f474a935123 -Scopes "Sites.FullControl.All" -UseDeviceCode
$site = Invoke-MgGraphRequest GET "https://graph.microsoft.com/v1.0/sites/dihag.sharepoint.com:/teams/crm-integration"
Invoke-MgGraphRequest POST "https://graph.microsoft.com/v1.0/sites/$($site.id)/permissions" -Body (@{
  roles = @("write")
  grantedToIdentities = @(@{ application = @{ id = "089bf9ad-2d9a-4cbc-b85d-88b4484af0bb"; displayName = "DIHAG Cron-Job" } })
} | ConvertTo-Json -Depth 6) -ContentType "application/json"
```

Fehlt sie, antwortet Graph mit `403 accessDenied` und verrät nicht, auf
welcher Site. Der Lauf fängt das ab und sagt es.

> `-UseDeviceCode` nicht vergessen: PowerShell 7.6 und das Graph-SDK 2.39
> vertragen sich beim Browser-Login nicht (`Method not found: …WithLogging`).

### 3. Anwendungsbenutzer in Dataverse

**Der einzige Schritt, der wirklich Arbeit macht, und nur ein
Power-Platform-Administrator kann ihn.** Ein App-Token allein öffnet
Dataverse nicht; die Umgebung muss die Anwendung als Benutzer kennen:

```
admin.powerplatform.microsoft.com
  → Umgebungen → (die Umgebung) → Einstellungen
  → Benutzer + Berechtigungen → Anwendungsbenutzer
  → Neuer App-Benutzer
      Anwendung:        DIHAG Cron-Job
      Geschäftseinheit: die Stammeinheit
      Sicherheitsrolle: eine Rolle mit Lese-/Schreibrecht auf
                        Verkaufschance, Verkaufschancenprodukt, Kontakt,
                        Firma und Geschäftsprozessfluss
```

Fehlt er, scheitert der Lauf beim Token-Abruf — und die Meldung sagt genau
das.

**Das ist eine bewusste Abweichung von CLAUDE.md §11.3**, wo steht, dass
die App ausschliesslich mit `user_impersonation` arbeitet und der
Sicherheitsrahmen in M365 bleibt. Für einen Lauf ohne angemeldete Person
gibt es dazu keine Alternative. Der Rahmen bleibt trotzdem im CRM: was der
Anwendungsbenutzer darf, entscheidet seine Sicherheitsrolle, nicht dieses
Skript. Wer ihm nur Leserechte gibt, bekommt eine Automatik, die prüft und
berichtet, aber nichts schreibt.

### 3a. Welche Rechte der Anwendungsbenutzer wirklich braucht

In TEST trägt „DIHAG Cron-Job" **System Administrator**, in PROD seit dem
05.10.2026 die Hausrolle **DIHAG-Admin** (958 Rechte). Beides ist mehr, als
der Import braucht. Am 05.10.2026 gegen die PROD-Metadaten ausgezählt: es
sind **24 Rechte**.

| Tabelle | Anlegen | Lesen | Schreiben | Anfügen | Anfügen an | Tiefe |
|---|---|---|---|---|---|---|
| Firma (`account`) | | ✔ | | | ✔ | Organisation |
| Kontakt (`contact`) | ✔ | ✔ | ✔ | ✔ | ✔ | Organisation |
| Verkaufschance (`opportunity`) | ✔ | ✔ | ✔ | ✔ | ✔ | Organisation |
| Notiz (`annotation`) | ✔ | ✔ | | ✔ | | Benutzer |
| Produkt / Preisliste | | ✔ | | | | Organisation |
| Benutzer (`systemuser`) | | ✔ | | | | Organisation |
| Verkaufsprozess (`opportunitysalesprocess`) | | ✔ | ✔ | | ✔ | Organisation |
| **Technische Prüfung** (`cr570_technicalaudit_lookup`) | | ✔ | | | | Organisation |
| **Produktlinie** (`cr570_productline_lookup`) | | ✔ | | | | Organisation |
| Anpassung: Entität, Attribut, Beziehung, Entitätsschlüssel | | ✔ | | | | Organisation |

**Die beiden letzten Nachschlagetabellen fehlten in der ersten Fassung
dieser Tabelle, und das hat am 08.10.2026 den ersten Produktivlauf
gekostet.** Ich hatte sie über `EntityDefinitions(...)?$select=Privileges`
geprüft; für diese beiden Tabellen kam dort eine **leere** Rechteliste
zurück, und ich habe daraus „kein eigenes Recht, hängt am Elterndatensatz"
geschlossen. Falsch: die Rechte gibt es, die Abfrage liefert sie nur nicht.
Verlässlich ist die Tabelle `privileges` selbst:

```
GET /privileges?$select=name           → prvReadcr570_TechnicalAudit_Lookup
GET /RetrieveRolePrivilegesRole(RoleId=…)   → hat die Rolle es?
```

`DIHAG-Admin` deckt vier `cr570`-Tabellen ab (Businesspartnerrole,
DIHAG_Industry_Lookup, DIHAG_Sites, Payment_Mode) und genau die beiden
nicht, die der Import liest. Im Rolleneditor stehen sie unter
**Benutzerdefinierte Entitäten** als *Technical Audit_Lookup* und
*Product Line_Lookup*.

Kein Löschrecht, nirgends. Keine Anpassungs- oder Lösungsrechte, keine
Benutzerverwaltung, kein Massenlöschen, kein Export.

**Die Positionen brauchen kein eigenes Recht.** `opportunityproduct` hat in
Dataverse keine eigenen Rechte — der Zugriff hängt an der Verkaufschance.
Schritt 40 ersetzt Positionen also über *Schreiben* an der Chance. Scheitert
er mit 403, fehlt nicht ein Positionsrecht, sondern Schreiben an
`opportunity`.

**Tiefe „Organisation" ist keine Bequemlichkeit.** Die Datensätze gehören dem
Vertrieb, nicht dem Dienstkonto. Auf „Benutzer" gestellt sieht der
Anwendungsbenutzer nur, was er selbst besitzt, und das ist nichts.

Die vier Hausrollen in PROD, gegen denselben Bedarf geprüft: *DIHAG-Admin*,
*DIHAG-Direktor Sales* und *DIHAG-Sales Manager* reichen aus,
*DIHAG-Sales Operations* nicht — dort fehlt das Anlegen bei Kontakt und
Verkaufschance. Das betrifft auch Menschen: wer die App mit dieser Rolle
bedient, kann keine neue Verkaufschance anlegen, denn die Oberfläche
schreibt mit den Rechten des Angemeldeten.

### 4. Secrets im Repo `dfedorov12/crm`

Dieselben drei Werte wie bei `bedarfsanfrage`, dieselben Namen. Die beiden
ersten sind keine Geheimnisse und stehen so auch in den anderen Repos:

```bash
gh secret set TENANT_ID     -R dfedorov12/crm -b "fdb70646-023a-403b-a4b9-1f474a935123"
gh secret set CLIENT_ID     -R dfedorov12/crm -b "089bf9ad-2d9a-4cbc-b85d-88b4484af0bb"
gh secret set CLIENT_SECRET -R dfedorov12/crm -b "<Wert des Client-Secrets>"
```

Der Secret-Wert lässt sich nirgends nachlesen — auch nicht aus den anderen
Repos. Entweder liegt er im Kennwortspeicher, oder in Entra ID →
*DIHAG Cron-Job* → Zertifikate & Geheimnisse ein **zweites** Secret
anlegen. Mehrere Secrets nebeneinander sind zulässig, und die bestehenden
Cron-Jobs laufen unverändert weiter.

> Ablaufdatum notieren. Läuft das Secret ab, scheitert jeder Lauf mit
> `AADSTS7000215`, und der Bericht bleibt aus.

### 5. Listen anlegen

```powershell
cd crm
./setup-crm.ps1
```

Legt `CRM_Automatik` und `CRM_Freigaben` an, schreibt die Standardwerte
(`Aktiv = nein`) und ergänzt der Quellbibliothek die beiden neuen
Statuswerte `Wartet auf Freigabe` und `Abgelehnt`. Vorhandene
Einstellungen werden **nicht** überschrieben — wer den Takt im Werkzeug
geändert hat, findet ihn nach dem nächsten Skriptlauf unverändert vor.

### 6. Probelauf, dann einschalten

Actions → *Automatischer Import* → **Run workflow**, mit
„Takt und Zeitfenster übergehen" = an und „Nur prüfen, nichts schreiben" =
**an**. Das Protokoll zeigt, was der Lauf täte, ohne etwas zu tun.

Sieht das gut aus: im Reiter **Automatik** `Aktiv` auf `ja`.

> **Vorher den Stichtag ansehen.** Der Quellordner ist ein Archiv, kein
> Eingang: am 23.09.2026 lagen dort 71 Mappen zurück bis Mai 2025, 66 davon
> ohne Importvermerk. Ohne `AbDatum` beginnt der erste eingeschaltete Lauf,
> sechzehn Monate Altbestand nachzuimportieren — drei Dateien je Stunde,
> jede mit dem Stand von damals über dem Stand von heute.

### Wenn es doch eine eigene Registrierung sein soll

Spricht etwas dagegen, dass derselbe Dienst ZAPP-Mails verschickt und ins
CRM schreibt, ist eine eigene Registrierung der sauberere Weg: gleiche
Berechtigungen (`Sites.Selected`, `Mail.Send`, Dynamics CRM), eigenes
Secret, eigener Anwendungsbenutzer, eigene Site-Freigaben. Am Code ändert
sich nichts — nur die drei Secrets zeigen dann woanders hin.

Dafür spricht die Trennung, dagegen der doppelte Pflegeaufwand: zwei
Secrets mit zwei Ablaufdaten, zwei Consent-Vorgänge, zwei Stellen, an
denen bei einem Umzug etwas nachzuziehen ist.

---

## Was der Lauf mit einer Datei macht

```
Datei im Quellordner
   │
   ├─ Status „Importiert“, „Fehlgeschlagen“ oder „Abgelehnt“ → liegen lassen
   │
   └─ Status „Neu“ (oder leer)
        │
        ├─ laden, lesen, auflösen, prüfen   ← dieselben Bausteine wie in der App
        │
        ├─ Prüflauf hat nichts zu fragen?
        │     └─ importieren · Protokoll schreiben · Datei als „Importiert“ markieren
        │
        └─ Fehler, fehlendes Blatt oder offene Mehrdeutigkeit?
              └─ Vorgang in CRM_Freigaben · Datei auf „Wartet auf Freigabe“
                 → jemand entscheidet im Reiter Automatik
                 → der nächste Lauf importiert mit dieser Auswahl
```

**Was NICHT anhält:** Warnungen. „Bei 108 Zeilen war der Besitzer nicht
auffindbar" ist ein Hinweis und steht im Bericht — würde es anhalten,
wartete praktisch jede Datei auf eine Freigabe, und die Automatik wäre
keine. Wer das anders will, stellt `WarnungenBlockieren` auf `ja`.

**Was gar nicht erst gefragt wird:** doppelte Treffer, bei denen genau
einer aktiv ist. Dafür gibt es seit dem 23.09.2026 die Hausregel *der
aktive gewinnt* — nachzulesen in CLAUDE.md §8. Sie gilt auch in der
Oberfläche; die Automatik entscheidet nicht anders als ein Mensch am
selben Bildschirm.

---

## Wenn nichts kommt — die Fehlanzeige

Der Import meldet, was er getan hat. Die teuerste Lücke ist die andere:
**wurde nichts geliefert, gibt es nichts zu melden.** Kein Bericht, keine
Warnung, keine Protokollzeile — und niemand merkt es, bis im CRM Zahlen
fehlen. Ausbleiben sieht genauso aus wie „alles in Ordnung".

Timeline liefert donnerstags. Gemessen am 01.10.2026 am Ordnerinhalt: 74
Mappen, jede Woche eine, angelegt zwischen 06:00 und 06:33 deutscher Zeit,
jede unter neuem Namen (`Anfragen 2026-10-01.xlsx`). Drei Eingaben im
Reiter **Automatik** machen daraus eine Erwartung:

```
ErwartetAn         = Do
ErwartetBisUhr     = 14
ErwartetEmpfaenger = ticket@dihag.com
```

Donnerstags ab 14 Uhr geschieht dann genau eines:

- **Eine Mappe ist eingegangen** → nichts. Keine Mail, nur eine Zeile im
  Actions-Protokoll („2 Mappe(n) im Zeitfenster eingegangen").
- **Es ist keine eingegangen** → eine Mail an `ticket@dihag.com`, Betreff
  `CRM-Import PROD: keine neue Mappe eingegangen (Stand Do 14 Uhr)`. Darin
  steht, welche Mappe zuletzt kam und wann, und dass die Lieferung aus
  Timeline zu prüfen ist. **Einmal je Termin**, nicht einmal je Lauf.

Fällt zwischen Frist und nächstem Lauf alles aus — was bei diesem Zeitplan
vorkommt —, wird die Meldung **nachgeholt** und sagt dazu, dass sie
verspätet ist. Ausgerechnet die Meldung über ein Ausbleiben darf nicht
selbst ausbleiben.

Was als eingegangen zählt:

- **Zeitraum:** ab dem **vorigen erwarteten Termin**, bei `Do` also ab
  letztem Donnerstag 14 Uhr. Eine Mappe, die Mittwochabend für den
  Donnerstag kommt, ist damit pünktlich. Bei `Mo-Fr` ist das Fenster ein
  Tag — es stellt sich aus dem Plan selbst ein.
- **Zeitpunkt:** wann die Datei **angelegt** wurde. Das Änderungsdatum
  zählt nur mit, solange kein Importvermerk es erklärt. Sonst machte der
  Statusvermerk der Automatik jede alte Mappe taufrisch (Fehlanzeige käme
  nie) — oder eine unter gleichem Namen überschriebene Mappe würde
  übersehen (Fehlanzeige käme jede Woche falsch).
- **Jede Arbeitsmappe im Quellordner**, nicht nur eine mit dem Namen
  `Anfragen …`. Der Ordner ist der Eingang des Werkzeugs: liegt dort eine
  neue Mappe, ist etwas zu importieren da. Die zwei Fremddateien von 2025
  (`OppID-FirmaMapping.xlsx`, `Test.xlsx`) zählen nur an einem Tag, an dem
  jemand sie verändert.

Die Fehlanzeige hängt **nicht** an `Aktiv`: die Erwartung gilt der Datei,
nicht der Automatik. Wer den Import für eine Umstellung abschaltet, soll
nicht gleichzeitig blind dafür werden, dass nichts geliefert wird.
Umgekehrt heisst `ErwartetAn` leer: keine Erwartung, keine Mail — auch
diese Meldung schaltet sich nicht von selbst ein.

---

## Wer freigeben darf

**Rolle `editor`.** Sonst nur ansehen — und das ist der einzige Ort in der
App, an dem die Rolle wirklich etwas sperrt. Überall sonst gilt der Satz
aus CLAUDE.md §11.3: die App schreibt mit den CRM-Rechten des
Angemeldeten, wer dort nichts darf, kann auch hier nichts.

Eine Freigabe ist anders. Sie lässt den **Anwendungsbenutzer** schreiben,
also an den eigenen Rechten vorbei — ohne die Sperre wäre „nur zusehen“
plötzlich „schreiben lassen“. Dasselbe gilt für die Einstellungen: wer den
Takt stellen kann, stellt den Import.

---

## Betrieb

**Nichts passiert.** Reiter Automatik öffnen: die erste Zeile nennt den
Grund („Ausgeschaltet", „Sa steht nicht im Plan", „Letzter Lauf vor 12 min,
Takt sind 60"). Ein Lauf, der nichts tut, sagt immer warum — in Actions
steht derselbe Satz als erste Zeile.

**Der Altbestand soll doch importiert werden.** `AbDatum` zurücksetzen
oder leeren — aber mit Bedacht: die Automatik arbeitet sich dann von der
ältesten Mappe zur jüngsten vor, `MaxDateien` je Lauf. Das ist die richtige
Reihenfolge (die jüngere Mappe schreibt zuletzt), dauert aber bei 66 Dateien
und Takt 60 rund zweiundzwanzig Stunden. Für einen einmaligen Nachzug ist
der Weg über die Oberfläche der ehrlichere.

**Eine Datei wurde nach dem Import noch geändert.** Sie wird von selbst
wieder aufgegriffen — der Vergleich läuft über den Änderungszeitpunkt, nicht
über den Status. Das gilt auch für Kopien, die den Status des Originals
geerbt haben, und für reparierte Dateien, die auf `Fehlgeschlagen` standen.

**Eine Datei soll sofort laufen.** In `CRM_Automatik` das Feld
`LetzterLauf` leeren, dann Actions → Run workflow. Oder in der Bibliothek
den `ImportStatus` der Datei auf `Neu` zurücksetzen, falls sie schon
abgehakt ist.

**Ein Lauf soll in die andere Umgebung.** Actions → Run workflow → Eingabe
*Zielumgebung*. Sie gilt nur für diesen einen Lauf (`CRM_DATAVERSE_URL` und
`CRM_UMGEBUNG`); der Zeitplan hält sich immer an `js/config.js`. Seit dem
05.10.2026 zeigt der auf **PROD** — ein Probelauf gegen TEST geht damit
weiterhin, ohne den Code anzufassen.

**Der Bericht kommt nicht.** Erst im Reiter **Automatik** unter *Berichte*
nachsehen: dort liegt jeder Bericht als Datei, unabhängig vom Mailversand.
Steht er da, hat der Lauf gearbeitet und die Mail hängt im Postfach fest
(Junk-Ordner, Transportregel). Steht er nicht da, gab es nichts zu
berichten — keine neue Datei.

Scheitert der Versand selbst, schlägt der Lauf in Actions sichtbar fehl
statt still zu schweigen; meist fehlt dann `Mail.Send` oder das
Absenderpostfach gibt es nicht.

**Die Fehlanzeige kommt nicht.** Im Reiter **Automatik** steht in der
zweiten Zeile der Grund: „Fr ist kein erwarteter Eingangstag (Do)", „Do
erwartet, Frist 14 Uhr — es ist erst 11 Uhr", „Kein Eingang erwartet —
ErwartetAn ist leer". War heute schon eine, steht das Datum in
`LetzteFehlanzeige`; von Hand leeren erzwingt eine zweite.

**Die Fehlanzeige kam, obwohl die Datei da ist.** Dann liegt sie nicht im
Quellordner (`Austausch` ▸ `Projekt CRM-Timeline` auf `/sites/IT`), oder
sie wurde dorthin verschoben, ohne verändert zu werden — verschobene
Dateien behalten ihr Anlagedatum. Einmal öffnen und speichern genügt.

**Ein Lauf hat Mist gebaut.** Jeder Lauf schreibt Protokoll wie der
Import von Hand: Eintrag in `CRM_ImportRuns`, Fehlerzeilen in
`CRM_ImportErrors`, Vollprotokoll als JSON. Der Reiter **Protokoll** zeigt
beides nebeneinander — automatische und von Hand gestartete Läufe stehen
in derselben Liste.

**Abschalten in Eile.** `Aktiv` auf `nein`. Wirkt ab dem nächsten Blick auf
die Uhr, also binnen weniger Stunden, ohne dass jemand am Repository etwas tun
muss. Wer schneller sein muss: in Actions den Workflow deaktivieren.
