# Automatik — der unbeaufsichtigte Import

Der Cron sieht im Quellordner nach, prüft jede neue Mappe und importiert
die unstrittigen von selbst. Was er nicht allein entscheiden kann, legt er
im Reiter **Automatik** zur Freigabe vor. Zum Schluss geht ein Bericht per
Mail an die eingetragene Adresse.

| | |
|---|---|
| Wo läuft es | GitHub Actions, `.github/workflows/automatik.yml` |
| Was läuft | `cron/automatik.mjs` — lädt **dieselben** Dateien wie der Browser |
| Zeitplan | alle 15 Minuten *nachsehen*; **ob** gearbeitet wird, steht in SharePoint |
| Identität | App **DIHAG Cron-Job** (`089bf9ad-…`) — dieselbe wie ZAPP, Bedarfsanfrage, Compliance |

---

## Warum der Takt nicht im Workflow steht

Im Workflow steht `*/15 * * * *`. Das ist kein Takt, sondern ein Blick auf
die Uhr. Der eigentliche Takt steht in der SharePoint-Liste
`CRM_Automatik`, und der Lauf hält sich daran:

```
Aktiv = ja, TaktMinuten = 60, VonUhr = 6, BisUhr = 18, Wochentage = Mo-Fr
→ der Cron startet viermal je Stunde und tut dreimal davon nichts.
```

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
| `Empfaenger` | `administrator@dihag.com` | Mehrere durch Semikolon. |
| `Absender` | `administrator@dihag.com` | Postfach für den Versand. |
| `LetzterLauf` | — | Schreibt der Cron. **Von Hand leeren erzwingt den nächsten Lauf.** |

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

**Eine Datei soll sofort laufen.** In `CRM_Automatik` das Feld
`LetzterLauf` leeren, dann Actions → Run workflow. Oder in der Bibliothek
den `ImportStatus` der Datei auf `Neu` zurücksetzen, falls sie schon
abgehakt ist.

**Der Bericht kommt nicht.** Kein Bericht heisst: es gab nichts zu
berichten — keine neue Datei. Kommt er trotz Arbeit nicht, fehlt meist
`Mail.Send` oder das Absenderpostfach gibt es nicht; der Lauf schlägt dann
sichtbar fehl statt still zu schweigen.

**Ein Lauf hat Mist gebaut.** Jeder Lauf schreibt Protokoll wie der
Import von Hand: Eintrag in `CRM_ImportRuns`, Fehlerzeilen in
`CRM_ImportErrors`, Vollprotokoll als JSON. Der Reiter **Protokoll** zeigt
beides nebeneinander — automatische und von Hand gestartete Läufe stehen
in derselben Liste.

**Abschalten in Eile.** `Aktiv` auf `nein`. Wirkt ab dem nächsten Blick auf
die Uhr, also binnen 15 Minuten, ohne dass jemand am Repository etwas tun
muss. Wer schneller sein muss: in Actions den Workflow deaktivieren.
