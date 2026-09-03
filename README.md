# CRM-Schnittstelle

Excel-Daten aus SharePoint nach Dynamics 365 / Dataverse importieren — in der
richtigen Abhängigkeitsreihenfolge, wiederholbar, mit Prüflauf und Protokoll.
Ablösung des Power-Automate-Flows `TestumgebungExpImpCRMTimeline`.

**Live:** https://crm.dihag.de/
(Fallback https://dfedorov12.github.io/crm/)

**Stand:** Phase 1 und 2 — Gerüst, Anmeldung, Zugriffssteuerung, Selbsttest.
Der Import selbst folgt in Phase 3 bis 7.

---

## Rollenverteilung

| | |
|---|---|
| **GitHub** | nur der Programmcode. Keine Daten, keine Protokolle. |
| **SharePoint** | die Daten. Quelldateien, Feldzuordnungen, Protokolle — sie liegen dort und bleiben dort. |
| **Dataverse** | das Importziel. |
| **M365 / Entra** | die Anmeldung. Ein Arbeitskonto, kein zweites Kennwort. |

Die Dateien werden **nicht hochgeladen**. Sie liegen bereits in der
Bibliothek unter `/sites/IT` ▸ `Austausch` ▸ `Projekt CRM-Timeline`. Die App
listet sie auf, lädt die ausgewählte über Microsoft Graph in den
Arbeitsspeicher und schreibt daraus nach Dataverse.

```
SharePoint  ──Graph──▶  Browser  ──Web API──▶  Dataverse
                           ▲
                           │ nur Code
                     GitHub Pages
```

---

## Bauweise

Nach der Hausvorlage (`rundumdenjob`, `powerbi`, `umfrage1`):

- **Kein Build.** Repo-Wurzel = Pages-Wurzel, alle Pfade relativ.
- **Kein MSAL.** OAuth2 Auth-Code + PKCE in `js/auth.js`. Das MSAL-CDN ist
  bei v2 eingefroren, v3+ gibt es nur per npm — und gebraucht wird davon
  ohnehin nur, was in 200 Zeilen passt.
- **Ein globaler Name je Datei** (`CRM_CONFIG`, `AUTH`, `GRAPH`, `DV`,
  `DATA`, `APP`). Die Reihenfolge der `<script>`-Tags ist die
  Abhängigkeitsreihenfolge.
- **Der Workflow prüft, er baut nicht:** `node --check` über alle Dateien,
  dann `tests/test-konsistenz.mjs`.

Ausführliche Begründung: [`docs/08-frontend-github.md`](docs/08-frontend-github.md).

### Anmeldung für zwei Ressourcen

Ein Access-Token gilt immer für genau eine Ressource; Graph-Scopes und den
Dataverse-Scope in dieselbe `/authorize`-Anfrage zu schreiben, scheitert.
Deshalb: einmal mit den Graph-Scopes anmelden, den **Refresh-Token**
behalten und je Ressource einlösen. Rotation, 24-Stunden-Grenze und der
Rückfall bei fehlender Zustimmung sind in `js/auth.js` behandelt und dort
kommentiert.

---

## Selbsttest

Die Startseite prüft nach dem Anmelden von selbst:

| Prüfung | Beantwortet |
|---|---|
| Microsoft Graph | Token gültig, welche Scopes |
| `AppPermissions` | Rechteliste lesbar, Einträge für `crm` |
| Quellbibliothek | Ist `Austausch` eine Bibliothek oder ein Ordner in „Dokumente“? |
| Quellordner | Wie viele Excel-Mappen liegen dort? |
| Konfigurationssite | Existiert `CRM-Integration` samt der fünf `CRM_*`-Listen? |
| Dataverse | `WhoAmI` — zugleich der CORS- und der Berechtigungstest |

Damit sind mehrere offene Punkte aus `CLAUDE.md` §13 beim ersten Aufruf
geklärt, ohne dass jemand den Graph Explorer öffnen muss.

---

## Zugriff

Die Rolle kommt aus der zentralen Liste **`AppPermissions`** auf
**`/sites/IT`**. Ein Eintrag mit `App = *` gilt app-übergreifend,
`App = crm` nur hier.

| Rolle | Darf |
|---|---|
| `none` (Standard) | nichts — Kein-Zugriff-Schirm mit Knopf „Freigabe anfragen“ |
| `viewer` | Läufe und Protokolle ansehen |
| `editor` | Prüflauf starten, Import ausführen |
| `admin` | zusätzlich Profile und Feldzuordnungen bearbeiten |

Anders als in `rundumdenjob` ist die Standardrolle **`none`**: Wer nicht
ausdrücklich eingetragen ist, kommt nicht hinein. Ein Werkzeug, das ins CRM
schreibt, ist kein Portal.

Die `hauptAdmins` aus `js/config.js` haben immer `admin` — sonst wäre beim
ersten Aufruf niemand drin, solange die Rechteliste keinen Eintrag für `crm`
enthält.

**Wie man jemanden einträgt — welche Felder, welche Rolle, welche
Fallstricke:** [`docs/09-rechte-eintragen.md`](docs/09-rechte-eintragen.md).
Neue Spalten sind dafür nicht nötig, die Liste gibt es schon.

---

## Der Prozess

| Blatt | Inhalt | Ziel im CRM |
|---|---|---|
| `Anfragen` | eine Zeile je Verkaufschance | `opportunities`, `contacts` |
| `Positionen` | eine Zeile je Angebotsposition | `opportunityproducts` |

Reihenfolge: auflösen (Phase 0) → Konto suchen → Kontakt → Verkaufschance →
Positionen ersetzen → Vertriebsprozess → Abschlüsse.

---

## Dokumente

| Datei | Inhalt |
|---|---|
| `CLAUDE.md` | Vollständige Spezifikation. Verbindlich bei Widerspruch. |
| `docs/00-uebergabe.md` | Einstieg: Auftrag, Entscheidungen, Stand |
| `docs/05-bestandsanalyse-flow.md` | **Was der Altflow tut und wo er Daten beschädigt** |
| `docs/06-datenanalyse.md` | Die echte Datei, 72 Anfragen, 206 Positionen |
| `docs/07-review-crm-anbindung.md` | Prüfung gegen die Dataverse-Web-API |
| `docs/08-frontend-github.md` | **Diese Bauweise, und warum sie von der ersten Fassung abweicht** |
| `docs/01`–`03` | App-Registrierung, SharePoint, Dataverse einrichten |
| `docs/09-rechte-eintragen.md` | Zugriff freischalten — Kurzanleitung zu `AppPermissions` |
| `config/import-profile.dihag.json` | Echtes Profil, aus dem Flow-Export abgeleitet |

---

## Örtlich entwickeln

Es gibt keinen Entwicklungsserver — die Seite ist statisch:

```bash
python -m http.server 8080
```

Dann `http://localhost:8080/` aufrufen und dieselbe Adresse in der
Registrierung als Umleitungs-URI ergänzen. `localhost` ist ein sicherer
Kontext, deshalb funktioniert `crypto.subtle` dort trotz `http`.

Vor jedem Commit:

```bash
for f in js/*.js tests/*.mjs; do node --check "$f"; done && node tests/test-konsistenz.mjs
```

---

## Einrichtung

`setup-crm.ps1` legt alles an, was SharePoint-seitig gebraucht wird —
wiederholbar, Vorhandenes wird nicht angefasst:

```powershell
Install-Module Microsoft.Graph.Authentication -Scope CurrentUser
Connect-MgGraph -Scopes "Sites.Manage.All","Sites.ReadWrite.All" -UseDeviceCode
./setup-crm.ps1 -NurPruefen     # erst ansehen, was fehlt
./setup-crm.ps1                 # dann anlegen
```

`-UseDeviceCode` ist Pflicht, nicht Geschmack: ohne den Schalter geht die
Anmeldung ueber den Windows-Kontenmanager, und der bricht auf PowerShell 7.6
mit `Method not found: ...WithLogging(...)` ab — ein Versionskonflikt im
Graph-Modul, kein fehlendes Recht. Siehe [docs/02](docs/02-sharepoint-setup.md).

Vier Schritte: Statusspalten in der Quellbibliothek, Konfigurationssite
prüfen, die fünf `CRM_*`-Listen samt Spalten, Eintrag in `AppPermissions`.

Es reicht das Teilmodul `Microsoft.Graph.Authentication` (wenige MB) — das
Skript benutzt nur `Invoke-MgGraphRequest`. **Der Token der Azure CLI reicht
nicht:** er trägt keinen `Sites.*`-Scope, und Microsoft hat die CLI dafür
nicht vorautorisiert. Begründung in [`docs/02`](docs/02-sharepoint-setup.md).

Die Konfigurationssite ist angelegt und liegt unter
`https://dihag.sharepoint.com/teams/crm-integration` — nicht unter
`/sites/CRM-Integration`, siehe `docs/02`.

## Was zuerst

1. **`dataverseUrl` eintragen** (`js/config.js`) — bis dahin bleibt die
   Dataverse-Probe gesperrt
2. **SPA-Plattform und Umleitungs-URI** in der Registrierung (`docs/01`)
3. **DNS für `crm.dihag.de`**
4. **Befunde B1–B3 prüfen** (`docs/05`) — betrifft die laufende Testumgebung
5. **Alternativschlüssel an `opportunity`** anlegen (`docs/03`)
6. **SharePoint-Spalten und -Listen** anlegen (`docs/02`)
