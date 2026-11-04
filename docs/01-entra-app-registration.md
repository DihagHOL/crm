# App-Registrierung konfigurieren

Die Registrierung **DIHAG CRM Schnittstelle** existiert bereits. Sie muss nur
noch für den SPA-Betrieb ergänzt werden.

| | |
|---|---|
| Anzeigename | DIHAG CRM Schnittstelle |
| Anwendungs-ID (Client) | `b6078457-e2ab-41e7-91a1-b49dfaf9d532` |
| Objekt-ID | `b792a75b-0937-4107-9b45-5c7d2de2e8ce` |
| Verzeichnis-ID (Mandant) | `fdb70646-023a-403b-a4b9-1f474a935123` |

Client-ID und Mandanten-ID sind keine Geheimnisse. Sie stehen bei jedem
OAuth-Vorgang in der Adresszeile des Browsers und dürfen im öffentlichen Repo
liegen. Ein Client Secret darf das nicht — und wird hier auch nicht gebraucht.

---

## 1. Plattform: Single-Page-Anwendung

Portal ▸ App-Registrierungen ▸ *DIHAG CRM Schnittstelle* ▸ **Authentifizierung**

Falls noch keine Plattform hinterlegt ist: *Plattform hinzufügen* ▸
**Einzelseitenanwendung**.

Falls schon eine Plattform vom Typ *Web* existiert: **nicht** dort eintragen.
Der Typ entscheidet über den erlaubten Flow. Eine Web-Plattform erwartet ein
Secret und lehnt PKCE-Anfragen aus dem Browser ab. Eine bestehende
Web-Plattform kann bleiben, wenn sie anderweitig genutzt wird — die
SPA-Plattform kommt zusätzlich dazu.

### Umleitungs-URIs

```
https://dihaghol.github.io/crm/
http://localhost:5173/
```

Die erste mit **Schrägstrich am Ende**. Entra vergleicht die URI zeichengenau;
`…/crm` und `…/crm/` sind zwei verschiedene Werte und der falsche liefert
`AADSTS50011`.

Die zweite ist die Vite-Entwicklungsadresse. `http` ist bei `localhost`
zulässig, sonst nirgends.

### Weitere Schalter

- Implizite Genehmigung (Zugriffstoken / ID-Token): **beide aus.**
  MSAL v5 nutzt ausschließlich Auth-Code + PKCE. Die Haken sind ein Relikt
  und ein Sicherheitsrisiko.
- Öffentliche Clientflows zulassen: **Nein** (außer PnP-PowerShell soll die
  Registrierung mitbenutzen, siehe unten).
- Kontotypen: **Nur Konten in diesem Organisationsverzeichnis.**

---

## 2. API-Berechtigungen

**Dynamics CRM** (Registerkarte *Von meiner Organisation verwendete APIs*,
Suche nach `Dynamics CRM`):

| Berechtigung | Typ |
|---|---|
| `user_impersonation` | Delegiert |

Damit handelt die App im Namen des angemeldeten Benutzers. Dessen
CRM-Sicherheitsrolle bleibt maßgeblich — wer keine Konten anlegen darf, kann
es auch über diese App nicht. Genau so soll es sein.

**Microsoft Graph:**

| Berechtigung | Typ | Zustimmung |
|---|---|---|
| `User.Read` | Delegiert | Benutzer genügt |
| `Sites.ReadWrite.All` | Delegiert | **Administrator erforderlich** |

Graph wird nur für die SharePoint-Listen gebraucht. Wenn die Zustimmung für
`Sites.ReadWrite.All` nicht kommt: Alternativen stehen in
`02-sharepoint-setup.md`, Schritt 6.

Anschließend **Administratorzustimmung erteilen** und prüfen, dass in der
Spalte *Status* überall ein grüner Haken steht. Ohne den erscheint beim ersten
Login ein Zustimmungsdialog, den ein normaler Benutzer nicht bestätigen kann,
und der Login bricht ab.

---

### Stand am 02.09.2026 — und warum Dataverse noch nicht geht

Ausgelesen aus der Registrierung:

| | |
|---|---|
| SPA-Umleitungs-URIs | `https://crm.dihag.de`, `https://dihaghol.github.io/crm/` ✅ |
| Deklarierte Berechtigungen | nur **Graph `User.Read`** |
| Tatsächlich erteilte Zustimmung | Graph: `User.Read Sites.ReadWrite.All offline_access`, tenantweit (`AllPrincipals`) |
| Dataverse | **keine Zustimmung** — der Dienstprinzipal „Dataverse“ existiert im Tenant, diese App hat aber keinen Zugriff darauf |

`Sites.ReadWrite.All` funktioniert, obwohl es nicht deklariert ist: Entra
erlaubt Zustimmung zu Scopes, die nicht statisch an der Registrierung stehen,
und jemand hat sie tenantweit erteilt.

**Für Dataverse geht das nicht auf demselben Weg.** Die App holt das
Dataverse-Token über `grant_type=refresh_token` — und ein Refresh-Token-Austausch
kann keine Zustimmung erzeugen. Er scheitert mit `AADSTS65001`, solange für
`user_impersonation` keine Zustimmung vorliegt. Genau das meldet der
Selbsttest.

Zwei Wege:

1. **Selbst zustimmen.** Auf der Startseite steht bei der fehlgeschlagenen
   Prüfung der Knopf **„Zustimmung erteilen“**. Er startet eine Anmeldung mit
   `prompt=consent` für den Dataverse-Scope. Reicht, wenn der Tenant
   Benutzerzustimmung für diese API erlaubt — und ändert nichts für andere.
2. **Sauber an der Registrierung nachziehen**, wie oben beschrieben. Damit
   steht die Berechtigung dort, wo man sie sucht, und gilt für alle:

```bash
az ad app permission add --id b6078457-e2ab-41e7-91a1-b49dfaf9d532 \
  --api 00000007-0000-0000-c000-000000000000 \
  --api-permissions 78ce3f0f-a1ce-49c2-8cde-64b5c0896db4=Scope
az ad app permission admin-consent --id b6078457-e2ab-41e7-91a1-b49dfaf9d532
```

### ⚠️ Fallstrick: `admin-consent` entzieht, was nicht deklariert ist

Genau das ist am 02.09.2026 passiert und kostete eine Runde.

`az ad app permission admin-consent` erteilt **exakt das, was in
`requiredResourceAccess` an der Registrierung steht** — und ersetzt damit die
bestehende Zustimmung, statt sie zu ergänzen. Vorher waren für Graph
`User.Read`, `Sites.ReadWrite.All` und `offline_access` zugestimmt, deklariert
war aber nur `User.Read`. Nach dem Befehl:

| | vorher | nach `admin-consent` |
|---|---|---|
| Graph | `User.Read Sites.ReadWrite.All offline_access` | **nur `User.Read`** |
| Dataverse | keine | `user_impersonation` ✅ |

Zwei Folgen, beide unangenehm:

- **`offline_access` weg ⇒ kein Refresh-Token.** Damit fällt der ganze
  Mechanismus für die zweite Ressource aus — das Dataverse-Token wird über den
  Refresh-Token geholt. Die Zustimmung für Dataverse allein nützt nichts.
- **`Sites.ReadWrite.All` weg ⇒ kein SharePoint.** Rechteliste, Dateiliste,
  Konfigurationslisten: alle nicht mehr lesbar.

**Regel daraus: erst deklarieren, dann zustimmen.** Nie umgekehrt, und nie
`admin-consent` auf eine Registrierung, deren Deklaration unvollständig ist.

Deklariert sind seit dem 02.09.2026 alle vier Berechtigungen. Damit erteilt
der folgende Befehl sie vollständig und der Fehler wiederholt sich nicht:

```bash
az ad app permission admin-consent --id b6078457-e2ab-41e7-91a1-b49dfaf9d532
```

Danach prüfen — es müssen zwei Zeilen mit allen vier Scopes erscheinen:

```bash
az rest --method GET --url "https://graph.microsoft.com/v1.0/oauth2PermissionGrants?\$filter=clientId eq 'b47d7286-816a-46e1-bfa9-f281126155d9'" --query "value[].{typ:consentType, scopes:scope}" -o table
```

**Kleinigkeit:** Die erste Umleitungs-URI steht ohne Schrägstrich am Ende
(`https://crm.dihag.de`). Bei leerem Pfad normalisiert Entra das, deshalb
funktioniert die Anmeldung. Wer die Adresse je um einen Pfad ergänzt, muss
den Schrägstrich mitdenken.

---

## 3. Voraussetzungen im CRM

Die App-Registrierung allein reicht nicht:

1. Der anmeldende Benutzer braucht eine **Dynamics-365-Lizenz** und muss im
   Ziel-Environment als Benutzer aktiviert sein.
2. Er braucht eine **Sicherheitsrolle** mit Anlage- und Schreibrechten auf den
   Zieltabellen.
3. Das Environment darf **kein Zugriffskontroll-Limit auf IP-Bereiche** haben,
   das GitHub-Pages-Aufrufe ausschließt. Falls im Tenant eine bedingte
   Zugriffsrichtlinie für nicht verwaltete Geräte greift, muss das vorher
   geklärt werden.

Punkt 3 ist der häufigste stille Blocker. Er zeigt sich als CORS-Fehler in der
Browser-Konsole, obwohl mit CORS alles in Ordnung ist.

---

## 4. Funktionsprobe

Nach Phase 2 der Umsetzung:

```
GET https://<org>.crm4.dynamics.com/api/data/v9.2/WhoAmI
Authorization: Bearer <Token>
```

Erwartet wird `UserId`, `BusinessUnitId`, `OrganizationId`.

| Antwort | Ursache |
|---|---|
| `200` | alles korrekt |
| `401` | Token für falsche Ressource — Scope prüfen |
| `403` | Benutzer nicht im Environment oder ohne Rolle |
| CORS-Fehler in der Konsole | Umleitungs-URI oder Plattformtyp falsch, oder bedingter Zugriff |

Der Scope lautet `https://<org>.crm4.dynamics.com/user_impersonation` — mit der
Organisations-URL, **nicht** mit `https://dynamics.crm.com` oder ähnlichem.
Der Ressourcenbezeichner ist umgebungsspezifisch.

---

## 5. Optional: PnP PowerShell mitbenutzen

Nur nötig, wenn die SharePoint-Listen per Skript statt per Klick entstehen
sollen. Dann zusätzlich:

- Plattform **Mobile Geräte und Desktopanwendungen** mit `http://localhost`
- *Öffentliche Clientflows zulassen*: **Ja**
- Graph-Berechtigung `Sites.FullControl.All` oder SharePoint-Berechtigung
  `AllSites.FullControl`, jeweils delegiert

```powershell
Connect-PnPOnline -Url "https://<tenant>.sharepoint.com/sites/CRM-Integration" `
                  -ClientId "b6078457-e2ab-41e7-91a1-b49dfaf9d532" `
                  -Interactive
```

Wenn das Skript nicht benutzt wird, diesen Abschnitt überspringen und
*Öffentliche Clientflows* ausgeschaltet lassen. Weniger Angriffsfläche.
