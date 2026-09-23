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
| Identität | Anwendungsbenutzer in Dataverse, App-Registrierung mit Secret |

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
| `MaxDateien` | `3` | Höchstzahl Mappen je Lauf. Schützt vor einem Ordner voller Altbestand. |
| `WarnungenBlockieren` | `nein` | Sollen Warnungen eine Freigabe erzwingen? |
| `Empfaenger` | `administrator@dihag.com` | Mehrere durch Semikolon. |
| `Absender` | `administrator@dihag.com` | Postfach für den Versand. |
| `LetzterLauf` | — | Schreibt der Cron. **Von Hand leeren erzwingt den nächsten Lauf.** |

---

## Einrichtung

### 1. Eigene App-Registrierung für den Cron

**Nicht** die der Oberfläche erweitern. Die ist eine SPA ohne Secret, und
das soll so bleiben (CLAUDE.md Randbedingung 1). Der Cron bekommt eine
zweite Registrierung — Entra ID → App-Registrierungen → Neue Registrierung:

```
Name:  DIHAG CRM Automatik
Konto: Nur Organisationsverzeichnis
Umleitungs-URI: keine
```

Dann **API-Berechtigungen** (alle vom Typ *Anwendung*, nicht *Delegiert*),
jeweils mit Administratorzustimmung:

| API | Berechtigung | Wofür |
|---|---|---|
| Microsoft Graph | `Sites.ReadWrite.All` | Quellordner lesen, Status und Protokoll schreiben |
| Microsoft Graph | `Mail.Send` | den Bericht verschicken |
| Dynamics CRM | `user_impersonation` | wird über den Anwendungsbenutzer wirksam |

> `Sites.Selected` statt `Sites.ReadWrite.All` ist die sparsamere Variante
> (so läuft der Bedarfsanfrage-Cron). Dann muss je Site ein Schreibrecht
> vergeben werden — für `/sites/IT` **und** `/teams/crm-integration`.
> Wer das mag, nimmt es; nötig ist es nicht.

Unter **Zertifikate & Geheimnisse** ein Secret anlegen, Laufzeit notieren.
Der Wert ist genau einmal sichtbar.

### 2. Anwendungsbenutzer in Dataverse

**Das ist der Schritt, den nur ein Power-Platform-Administrator machen
kann, und ohne ihn läuft gar nichts.** Ein App-Token allein öffnet
Dataverse nicht; die Umgebung muss die Anwendung als Benutzer kennen:

```
admin.powerplatform.microsoft.com
  → Umgebungen → (die Umgebung) → Einstellungen
  → Benutzer + Berechtigungen → Anwendungsbenutzer
  → Neuer App-Benutzer
      Anwendung:        DIHAG CRM Automatik
      Geschäftseinheit: die Stammeinheit
      Sicherheitsrolle: eine Rolle mit Lese-/Schreibrecht auf
                        Verkaufschance, Verkaufschancenprodukt, Kontakt,
                        Firma und Geschäftsprozessfluss
```

Fehlt er, meldet der Lauf beim Token-Abruf `AADSTS500011` — und die
Meldung sagt genau das.

**Das ist eine bewusste Abweichung von CLAUDE.md §11.3**, wo steht, dass
die App ausschliesslich mit `user_impersonation` arbeitet und der
Sicherheitsrahmen in M365 bleibt. Für einen Lauf ohne angemeldete Person
gibt es dazu keine Alternative. Der Rahmen bleibt trotzdem im CRM: was der
Anwendungsbenutzer darf, entscheidet seine Sicherheitsrolle, nicht dieses
Skript. Wer ihm nur Leserechte gibt, bekommt eine Automatik, die prüft und
berichtet, aber nichts schreibt.

### 3. Secrets in GitHub

Repository → Settings → Secrets and variables → Actions:

```
TENANT_ID      fdb70646-023a-403b-a4b9-1f474a935123
CLIENT_ID      (die der neuen Registrierung, NICHT b6078457-…)
CLIENT_SECRET  (der Wert aus Schritt 1)
```

### 4. Listen anlegen

```powershell
cd crm
./setup-crm.ps1
```

Legt `CRM_Automatik` und `CRM_Freigaben` an, schreibt die Standardwerte
(`Aktiv = nein`) und ergänzt der Quellbibliothek die beiden neuen
Statuswerte `Wartet auf Freigabe` und `Abgelehnt`. Vorhandene
Einstellungen werden **nicht** überschrieben — wer den Takt im Werkzeug
geändert hat, findet ihn nach dem nächsten Skriptlauf unverändert vor.

### 5. Probelauf, dann einschalten

Actions → *Automatischer Import* → **Run workflow**, mit
„Takt und Zeitfenster übergehen" = an und „Nur prüfen, nichts schreiben" =
**an**. Das Protokoll zeigt, was der Lauf täte, ohne etwas zu tun.

Sieht das gut aus: im Reiter **Automatik** `Aktiv` auf `ja`.

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

## Betrieb

**Nichts passiert.** Reiter Automatik öffnen: die erste Zeile nennt den
Grund („Ausgeschaltet", „Sa steht nicht im Plan", „Letzter Lauf vor 12 min,
Takt sind 60"). Ein Lauf, der nichts tut, sagt immer warum — in Actions
steht derselbe Satz als erste Zeile.

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
