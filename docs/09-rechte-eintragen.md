# Zugriff freischalten — `AppPermissions`

Kurzanleitung. Wer die CRM-Schnittstelle benutzen darf, steht in der
**bestehenden** zentralen Rechteliste — dieselbe, die `rundumdenjob`,
`powerbi` und `umfrage1` schon nutzen.

```
https://dihag.sharepoint.com/sites/IT  ▸  Liste  AppPermissions
```

**Es sind keine neuen Spalten anzulegen.** Die Liste hat alles, was gebraucht
wird; es kommen nur Zeilen dazu. Der App-Schlüssel `crm` grenzt sie von den
übrigen Apps ab.

---

## Die Felder

Drei sind Pflicht, drei optional.

| Feld | Pflicht | Was hinein gehört |
|---|---|---|
| `Title` | ja | Die E-Mail-Adresse. Ist bei euch als „Konto“ beschriftet. |
| `UserEmail` | **ja** | Anmeldeadresse, **klein geschrieben** — z. B. `fachbereich@dihag.com`. Danach wird abgeglichen. |
| `App` | **ja** | `crm`. `*` würde für alle Apps gelten — dafür ist hier keiner gedacht. |
| `Role` | **ja** | `viewer`, `editor` oder `admin`. Siehe Tabelle unten. |
| `UserDisplayName` | nein | Klarname, nur zur Anzeige |
| `Notes` | nein | Warum die Rolle vergeben wurde. Bei einem Werkzeug, das ins CRM schreibt, lohnt sich das. |
| `Werke` | nein | Wird von dieser App **nicht** ausgewertet. Leer lassen. |

`UserEmail`, `App` und `Role` sind Textspalten, keine Auswahlfelder — ein
neuer App-Schlüssel kommt deshalb ohne Spaltenumbau dazu.

---

## Die Rollen

| Rolle | Darf |
|---|---|
| *kein Eintrag* | **nichts.** Kein-Zugriff-Schirm mit Knopf „Freigabe anfragen“ |
| `viewer` | Läufe und Protokolle ansehen |
| `editor` | Prüflauf starten **und Import ausführen** |
| `admin` | zusätzlich Profile und Feldzuordnungen bearbeiten |

Der Unterschied zu `rundumdenjob` ist die Standardrolle: dort sieht jede
Person im Tenant das Portal als `viewer`, hier kommt ohne Eintrag niemand
hinein (`defaultRole: "none"` in `js/config.js`).

**Die eigentliche Entscheidung steckt in `editor`.** Wer diese Rolle hat,
kann Daten ins CRM schreiben. Das ist die offene Prozessfrage aus
`CLAUDE.md` §13: Legt die Fachabteilung weiterhin nur die Datei ab und
jemand aus der IT startet den Import — dann bekommt nur die IT `editor`.
Oder startet die Fachabteilung selbst.

---

## Beispielzeilen

| Title | UserEmail | App | Role | Notes |
|---|---|---|---|---|
| fachbereich@dihag.com | `fachbereich@dihag.com` | `crm` | `editor` | Startet den wöchentlichen Import |
| fedorov@dihag.com | `fedorov@dihag.com` | `crm` | `admin` | Betreuung der Schnittstelle |
| mitlesend@dihag.com | `mitlesend@dihag.com` | `crm` | `viewer` | Sieht Läufe und Protokolle |

---

## Zwei Punkte, an denen es sonst still schiefgeht

**Lesezugriff auf die Liste.** Jede Person, die die App benutzt, muss
`AppPermissions` **lesen** dürfen. Kann sie das nicht, sieht sie den
Kein-Zugriff-Schirm — und zwar mit derselben Meldung wie jemand ohne
Eintrag. Der Grund steht dann aber im Klartext darunter; die Startseite
zeigt ihn im Selbsttest ebenfalls an.

**Änderungen wirken nicht sofort.** Die Rolle wird beim Anmelden einmal
gelesen. Wer schon angemeldet ist, behält die alte Rolle. Auf der Startseite
gibt es dafür **🔄 Rolle neu einlesen**; sonst genügt ein Neuladen.

---

## Solange nichts eingetragen ist

`js/config.js` führt unter `hauptAdmins` zwei Adressen, die immer `admin`
sind — `administrator@dihag.com` und `fedorov@dihag.com`. Ohne sie käme beim
ersten Aufruf niemand hinein, weil die Liste noch keinen `crm`-Eintrag hat.

Sobald die Einträge stehen, gehört `fedorov@dihag.com` dort wieder heraus und
stattdessen als normale Zeile in die Liste. Ein fest verdrahteter Zugang, den
niemand in der Rechteliste sieht, ist genau die Sorte Sonderfall, die man
später sucht.

---

## Und die fünf `CRM_*`-Listen?

Das sind andere Listen — Steuerung und Protokoll, auf einer eigenen Site
`CRM-Integration`. Sie existieren noch nicht; der Selbsttest meldet das.
Ihre Spalten stehen vollständig in [`02-sharepoint-setup.md`](02-sharepoint-setup.md),
Teil B. Gebraucht werden sie erst ab Phase 4 — für die Anmeldung und den
Zugriff sind sie nicht nötig.
