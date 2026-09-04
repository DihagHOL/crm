/* Konsistenzprüfung – läuft unter Node, ohne Browser.
   ---------------------------------------------------
   Die Seite wird ohne Build-Schritt ausgeliefert. Es gibt also keine Instanz,
   die auffällt, wenn ein <script> auf eine Datei zeigt, die es nicht gibt,
   oder wenn die Client-ID in js/config.js und in docs/01 auseinanderlaufen.
   Das macht dieser Test.                                                  */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = p => readFileSync(join(wurzel, p), "utf8");

let fehler = 0;
const pruefe = (bedingung, text) => {
  console.log(`  ${bedingung ? "ok  " : "FEHL"}  ${text}`);
  if (!bedingung) fehler++;
};

/* ── js/config.js einlesen ──────────────────────────────────────────
   Die Datei deklariert nur Konstanten und hängt an keiner Browser-API.
   Deshalb lässt sie sich hier direkt auswerten.                      */

const quelle = lies("js/config.js");
const { CRM_CONFIG, istOffen } =
  new Function(quelle + "; return { CRM_CONFIG, istOffen };")();

console.log("\nKonfiguration");
for (const k of ["tenantId", "clientId", "dataverseUrl", "quellSite", "quellDrive",
                 "konfigSite", "permSite", "permList", "appKey", "defaultRole"])
  pruefe(CRM_CONFIG[k] !== undefined && CRM_CONFIG[k] !== "", `CRM_CONFIG.${k} ist gesetzt`);

pruefe(/^[0-9a-f-]{36}$/.test(CRM_CONFIG.tenantId), "tenantId ist eine GUID");
pruefe(/^[0-9a-f-]{36}$/.test(CRM_CONFIG.clientId), "clientId ist eine GUID");
pruefe(CRM_CONFIG.defaultRole === "none",
  "defaultRole ist \"none\" – ein Werkzeug, das ins CRM schreibt, ist kein Portal");
pruefe(!CRM_CONFIG.scopes.some(s => s.includes("crm4.dynamics.com")),
  "scopes enthalten keinen Dataverse-Scope (ein Token gilt nur für eine Ressource)");

/* ── Ladereihenfolge in index.html ─────────────────────────────────── */

console.log("\nLadereihenfolge");
const html = lies("index.html");
const skripte = [...html.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map(m => m[1]);

pruefe(skripte.length > 0, "index.html bindet JavaScript ein");
for (const s of skripte) pruefe(existsSync(join(wurzel, s)), `${s} existiert`);

pruefe(skripte[0] === "js/config.js",
  "js/config.js wird zuerst geladen – alle übrigen Dateien werten CRM_CONFIG beim Laden aus");
pruefe(skripte[skripte.length - 1] === "js/app.js", "js/app.js wird zuletzt geladen");
pruefe(skripte.indexOf("js/auth.js") < skripte.indexOf("js/graph.js"),
  "auth.js vor graph.js");
pruefe(skripte.indexOf("js/graph.js") < skripte.indexOf("js/data.js"),
  "graph.js vor data.js");

/* ── Doku gegen Konfiguration ──────────────────────────────────────── */

/* Jede Datei unter js/ muss auch geladen werden. Eine, die niemand
   einbindet, faellt sonst erst auf, wenn jemand ihren Reiter oeffnet. */
const dateien = readdirSync(join(wurzel, "js")).filter(n => n.endsWith(".js")).sort();
for (const d of dateien)
  pruefe(skripte.includes("js/" + d), `js/${d} wird von index.html geladen`);

/* ── Reiter: Beschriftung und Darstellung ──────────────────────────── */

console.log("\nReiter");
const app = lies("js/app.js");
const schritteBlock = /const SCHRITTE = ([^;]+);/.exec(app);
pruefe(!!schritteBlock, "SCHRITTE steht in app.js");
const ids = [...schritteBlock[1].matchAll(/id:\s*"([^"]+)"/g)].map(m => m[1]);
pruefe(ids.length >= 6, `${ids.length} Reiter gefunden`);
// Ohne Regex: die Zeile in app.js lautet woertlich `if (id === "x") renderX();`
for (const id of ids)
  pruefe(app.includes(`id === "${id}") render`),
    `Reiter „${id}" hat eine Darstellungsfunktion – sonst bleibt er stumm`);

console.log("\nDokumentation");
const doc01 = lies("docs/01-entra-app-registration.md");
pruefe(doc01.includes(CRM_CONFIG.clientId),
  "clientId aus js/config.js steht auch in docs/01");

const cname = lies("CNAME").trim();
pruefe(/^[a-z0-9.-]+\.[a-z]{2,}$/.test(cname), `CNAME ist ein Domänenname (${cname})`);
pruefe(quelle.includes(cname),
  `CNAME-Domäne ${cname} ist in js/config.js als Umleitungs-URI vermerkt`);

/* ── Einrichtungsskript gegen die Konfiguration ────────────────────────
   Legt das Skript genau die Listen an, die die App später sucht? Ein
   Tippfehler auf einer der beiden Seiten fällt sonst erst auf, wenn die
   Liste angelegt ist und die App sie trotzdem nicht findet.            */

console.log("\nEinrichtungsskript");
const ps1 = lies("setup-crm.ps1");
for (const [zweck, name] of Object.entries(CRM_CONFIG.listen))
  pruefe(ps1.includes(`"${name}"`), `setup-crm.ps1 legt ${name} an (${zweck})`);
pruefe(ps1.includes(`"${CRM_CONFIG.permList}"`) || ps1.includes(CRM_CONFIG.permList),
  `setup-crm.ps1 kennt die Rechteliste ${CRM_CONFIG.permList}`);
pruefe(ps1.includes(CRM_CONFIG.quellDrive),
  `setup-crm.ps1 kennt die Quellbibliothek ${CRM_CONFIG.quellDrive}`);

/* ── Offene Punkte sichtbar halten ─────────────────────────────────── */

console.log("\nOffene Punkte");
const offen = Object.entries(CRM_CONFIG).filter(([, v]) => istOffen(v)).map(([k]) => k);
if (offen.length) {
  console.log(`  Hinweis  noch nicht geklärt: ${offen.join(", ")}`);
  console.log("           Das ist erlaubt und bricht den Test nicht – die App prüft");
  console.log("           darauf und sperrt die betroffenen Stellen (CLAUDE.md §13).");
}

console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen.\n` : "\nAlle Prüfungen bestanden.\n");
process.exit(fehler ? 1 : 0);
