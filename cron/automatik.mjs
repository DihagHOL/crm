/* Automatischer Import – unbeaufsichtigter Lauf in GitHub Actions.
   ─────────────────────────────────────────────────────────────────────────
   Findet neue Mappen im Quellordner, prüft sie, importiert die
   unstrittigen und legt den Rest zur Freigabe vor. Schickt zum Schluss
   einen Bericht per Mail.

   DERSELBE CODE WIE IM BROWSER. Geprüft und geschrieben wird mit
   js/aufloesung.js, js/pruefung.js und js/lauf.js – Zeile für Zeile
   dieselben Dateien, die auch die Oberfläche lädt. Eine zweite
   Importlogik für den Cron wäre eine zweite Wahrheit; die erste
   Abweichung fiele erst auf, wenn die Zahlen auseinandergehen.

   Möglich wird das durch drei Attrappen: `AUTH` liefert statt eines
   angemeldeten Benutzers ein App-Token, `sessionStorage` ist eine Map, und
   `XLSX` kommt aus npm statt vom CDN. Mehr braucht es nicht – die Module
   fassen sonst nichts an, was es nur im Browser gibt.

   IDENTITÄT. Hier schreibt kein Mensch, sondern ein Anwendungsbenutzer in
   Dataverse. Das ist eine bewusste Abweichung von CLAUDE.md §11.3, wo
   steht, dass die App ausschliesslich mit user_impersonation arbeitet: für
   einen Lauf ohne angemeldete Person gibt es keine Alternative. Was der
   Anwendungsbenutzer darf, entscheidet seine Sicherheitsrolle im CRM –
   nicht dieses Skript.

   Umgebung (GitHub Secrets):
     TENANT_ID, CLIENT_ID, CLIENT_SECRET   – die Registrierung des Cron
   Optional:
     CRM_DATAVERSE_URL, CRM_UMGEBUNG       – andere Umgebung als js/config.js
     CRM_ERZWINGEN=1                       – Takt und Zeitfenster übergehen
     CRM_TROCKEN=1                         – prüfen und berichten, nicht schreiben
*/

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = p => readFileSync(join(WURZEL, p), "utf8");

const { TENANT_ID, CLIENT_ID, CLIENT_SECRET } = process.env;
const ERZWINGEN = process.env.CRM_ERZWINGEN === "1";
const TROCKEN   = process.env.CRM_TROCKEN === "1";

/* Noch nicht eingerichtet? Dann SAUBER aussteigen, nicht scheitern.
   Der Zeitplan läuft ab dem ersten Push alle 15 Minuten. Ein roter Lauf
   wäre dann viermal je Stunde eine Fehlermail für etwas, das niemand
   kaputt gemacht hat – und nach dem dritten Tag sieht keiner mehr hin.
   Die Zeile im Protokoll sagt trotzdem klar, was fehlt. */
if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
  const fehlt = [["TENANT_ID", TENANT_ID], ["CLIENT_ID", CLIENT_ID],
                 ["CLIENT_SECRET", CLIENT_SECRET]]
    .filter(([, v]) => !v).map(([k]) => k).join(", ");
  console.log(`Automatik ist noch nicht eingerichtet – es fehlen: ${fehlt}.`);
  console.log("Anleitung: docs/11-automatik.md. Bis dahin tut dieser Lauf nichts.");
  process.exit(0);
}

/* SheetJS erst JETZT laden, nach der Prüfung oben. Als fester Import ganz
   am Kopf bräche der Lauf schon an der fehlenden Abhängigkeit ab – also
   bevor die Zeile erscheint, die erklärt, dass nur die Einrichtung fehlt. */
const _xlsx = await import("xlsx").catch(() => null);
if (!_xlsx) {
  console.error("SheetJS fehlt. Im Workflow macht das `npm install --prefix cron`; "
    + "von Hand: cd cron && npm install");
  process.exit(1);
}
const XLSX = _xlsx.default ?? _xlsx;

/* ── Attrappe 1: Anmeldung ─────────────────────────────────────────────
   Client Credentials statt PKCE. Ein Token gilt immer für genau EINE
   Ressource – dieselbe Einschränkung wie im Browser, nur ohne
   Refresh-Token: bei Ablauf wird schlicht ein neues geholt. */

const _token = new Map();   // Ressource → { wert, gilt_bis }

const AUTH = {
  async getToken(ressource) {
    const jetzt = Date.now();
    const da = _token.get(ressource);
    if (da && da.bis - jetzt > 120000) return da.wert;

    const ziel = ressource === "graph"
      ? "https://graph.microsoft.com/.default"
      : (process.env.CRM_DATAVERSE_URL || basisUrl).replace(/\/+$/, "") + "/.default";

    const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        scope: ziel, grant_type: "client_credentials"
      })
    });
    const d = await r.json();
    if (!r.ok) {
      /* Die häufigsten zwei Fehler beim ersten Einrichten beim Namen
         nennen – „invalid_client" allein schickt niemanden an die
         richtige Stelle. */
      const hinweis = /AADSTS7000215/.test(d.error_description || "")
        ? " Das Secret stimmt nicht (oder ist abgelaufen)."
        : /AADSTS500011|AADSTS7000229/.test(d.error_description || "")
        ? " Für Dataverse fehlt der Anwendungsbenutzer: Power-Platform-Admin → "
          + "Umgebung → Einstellungen → Benutzer + Berechtigungen → Anwendungsbenutzer."
        : "";
      throw new Error(`Token für ${ressource} nicht erhalten (${r.status}): `
        + (d.error_description || JSON.stringify(d)).split("\n")[0] + hinweis);
    }
    _token.set(ressource, { wert: d.access_token, bis: jetzt + (d.expires_in || 3600) * 1000 });
    return d.access_token;
  }
};

/* ── Attrappe 2: sessionStorage ───────────────────────────────────────
   Die Module legen dort Metadaten ab (Site-IDs, Feldlisten). Im Cron
   lebt der Zwischenspeicher genau einen Lauf lang – das ist richtig so:
   ein Prozess, der stündlich neu startet, soll die Umgebung nicht aus
   einem Zwischenspeicher von gestern beurteilen. */

const _speicher = new Map();
const sessionStorage = {
  getItem: k => (_speicher.has(k) ? _speicher.get(k) : null),
  setItem: (k, v) => _speicher.set(k, String(v)),
  removeItem: k => _speicher.delete(k)
};

/* ── Die Module laden ─────────────────────────────────────────────────
   Alle in EINEN Geltungsbereich, damit sie sich gegenseitig sehen – so
   wie die <script>-Tags im Browser. */

const MODULE = ["config", "graph", "dataverse", "spFiles", "spListen", "excel",
                "transforms", "mapping", "aufloesung", "pruefung", "batch",
                "lauf", "automatik"];

// Wird von AUTH gelesen, bevor CRM_CONFIG existiert – deshalb vorab aus
// der Konfigurationsdatei gefischt statt aus dem Modul.
const basisUrl = (lies("js/config.js").match(/dataverseUrl:\s*"([^"]+)"/) || [])[1] || "";

const quelle = MODULE.map(n => lies(`js/${n}.js`)).join("\n;\n");
const bauen = new Function("AUTH", "sessionStorage", "XLSX", "console",
  quelle + `; return { CRM_CONFIG, GRAPH, DV, SPFILES, SPLISTEN, EXCEL,
    TRANSFORMS, MAPPING, AUFLOESUNG, PRUEFUNG, BATCH, LAUF, AUTOMATIK };`);

const { CRM_CONFIG, GRAPH, SPFILES, SPLISTEN, EXCEL, AUFLOESUNG, PRUEFUNG,
        LAUF, AUTOMATIK } = bauen(AUTH, sessionStorage, XLSX, console);

if (process.env.CRM_DATAVERSE_URL) CRM_CONFIG.dataverseUrl = process.env.CRM_DATAVERSE_URL;
if (process.env.CRM_UMGEBUNG)      CRM_CONFIG.umgebung     = process.env.CRM_UMGEBUNG;

/* ── Hilfen ───────────────────────────────────────────────────────────── */

const sagen = (...t) => console.log(...t);
const esc = t => String(t ?? "").replace(/[&<>]/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const zahlSatz = g => `${g.angelegt || 0} angelegt · ${g.aktualisiert || 0} geändert · `
  + `${g.unveraendert || 0} unverändert`
  + (g.geloescht ? ` · ${g.geloescht} ersetzt` : "")
  + (g.uebersprungen ? ` · ${g.uebersprungen} übersprungen` : "")
  + (g.fehlgeschlagen ? ` · <b>${g.fehlgeschlagen} fehlgeschlagen</b>` : "");

/** Protokoll schreiben – dieselben drei Ebenen wie in der Oberfläche:
 *  ein Eintrag je Lauf, eine Zeile je Fehler, das Vollprotokoll als Datei. */
async function protokollSchreiben(l, entscheidungen) {
  const jeSchritt = {};
  for (const e of l.eintraege)
    (jeSchritt[e.schritt] ||= {})[e.aktion] = (jeSchritt[e.schritt]?.[e.aktion] || 0) + 1;
  try {
    await SPLISTEN.laufSchreiben({
      laufId: l.laufId, profil: l.profil.name, datei: l.datei.name,
      start: l.beginn, ende: l.ende,
      status: l.gesamt.fehlgeschlagen ? "MitFehlern" : "Erfolgreich",
      zeilen: l.eintraege.length, ...l.gesamt, dauerMs: l.dauerMs, jeSchritt
    });
    await SPLISTEN.fehlerSchreiben(l.laufId,
      l.eintraege.filter(e => e.aktion === "fehlgeschlagen"));
    return await SPLISTEN.vollprotokoll(l.laufId, {
      lauf: { ...l, eintraege: undefined, profil: undefined },
      eintraege: l.eintraege,
      entscheidungen: [...(entscheidungen || new Map()).entries()],
      automatisch: true
    });
  } catch (e) {
    sagen("  ! Protokoll nicht geschrieben:", e.message);
    return null;
  }
}

/** Statusvermerk an der Quelldatei. Scheitert er, ist der Lauf trotzdem
 *  gültig – es ist ein Vermerk, kein Ergebnis. */
async function markieren(datei, felder) {
  try { await SPFILES.statusSetzen(datei, felder); return true; }
  catch (e) { sagen("  ! Datei nicht markiert:", e.message); return false; }
}

/* ── Der Lauf ─────────────────────────────────────────────────────────── */

(async () => {
  const beginn = Date.now();
  const { werte: e, ids } = await AUTOMATIK.einstellungen();

  const f = AUTOMATIK.faellig(e, new Date());
  sagen(`Automatik: ${f.grund}`);
  if (!f.ja && !ERZWINGEN) return;
  if (!f.ja) sagen("CRM_ERZWINGEN=1 – Takt und Zeitfenster werden übergangen.");

  const dateien = await SPFILES.liste();
  const vorgaenge = (await AUTOMATIK.freigaben()) || [];

  /* Was ist zu tun?
     · „Neu" (oder ohne Status) – noch nie angefasst.
     · „Wartet auf Freigabe" – nur, wenn inzwischen jemand freigegeben hat.
     Alles andere liegt zu Recht still: Importiert, Abgelehnt, und ein
     Fehlgeschlagen will angesehen werden, bevor es wiederholt wird. */
  const offeneFreigabe = new Map();
  for (const v of vorgaenge)
    if (v.Status === AUTOMATIK.FREI.frei && !offeneFreigabe.has(v.FileId))
      offeneFreigabe.set(v.FileId, v);

  const anstehend = dateien.filter(d =>
    !d.status || d.status === "Neu" || offeneFreigabe.has(d.id));

  const grenze = AUTOMATIK.zahl(e.MaxDateien, 3);
  const arbeit = anstehend.slice(0, grenze);
  sagen(`${dateien.length} Mappe(n) im Ordner, ${anstehend.length} anstehend, `
    + `${arbeit.length} in diesem Lauf.`);

  const abschnitte = [];

  if (anstehend.length > arbeit.length)
    abschnitte.push({ art: "hinweis", titel: `${anstehend.length - arbeit.length} `
      + "Datei(en) warten auf den nächsten Lauf",
      zeilen: [`Pro Lauf werden höchstens ${grenze} Dateien verarbeitet `
        + "(Einstellung <code>MaxDateien</code>)."] });

  // Profil und Wertzuordnungen gelten für alle Dateien – einmal laden.
  let profil = null, wz = {};
  if (arbeit.length) {
    profil = await SPLISTEN.profil();
    wz = await SPLISTEN.werte().catch(() => ({}));
    sagen(`Profil „${profil.name}": ${profil.schritte.length} Schritte, `
      + `zuletzt geladen ${profil.geladenAm || "unbekannt"}.`);
  }

  for (const datei of arbeit) {
    sagen(`\n── ${datei.name} (${datei.groesse})`);
    const vorgang = offeneFreigabe.get(datei.id) || null;
    const entscheidungen = vorgang ? AUTOMATIK.entscheidungenAus(vorgang) : new Map();
    if (vorgang) sagen(`  Freigabe vom ${vorgang.DecidedAt} durch ${vorgang.DecidedBy}`
      + ` – ${entscheidungen.size} Auswahl(en).`);

    try {
      const puffer = await SPFILES.laden(datei);
      const mappe = await EXCEL.lesen(puffer);
      const aufl = await AUFLOESUNG.fuer(profil, mappe, () => {}, wz);
      const bericht = PRUEFUNG.lauf(profil, mappe, aufl, wz, entscheidungen);
      const auto = AUFLOESUNG.automatischGeloest(aufl);
      const tor = AUTOMATIK.torschluss(bericht, aufl, entscheidungen, e);

      const vorschau = PRUEFUNG.zusammenfassung(bericht.gesamt);
      sagen(`  Prüflauf: ${vorschau}`);
      if (auto.length) sagen(`  ${auto.length} Mehrfachtreffer über die Aktiv-Regel gelöst.`);

      /* ── Halt: das gehört einem Menschen vorgelegt ── */
      if (!tor.frei) {
        sagen(`  → Freigabe nötig: ${tor.gruende.join(" | ")}`);
        const fragen = tor.offen.map(o => ({
          schluessel: o.schluessel, entitySet: o.entitySet, feld: o.feld,
          wert: String(o.wert), idFeld: o.idFeld,
          kandidaten: o.kandidaten.map(k => ({ id: k[o.idFeld], text: kandidatText(k, o) }))
        }));
        if (!TROCKEN) {
          await AUTOMATIK.freigabeAnlegen(datei, tor.gruende, fragen, null);
          await markieren(datei, { ImportStatus: "Wartet auf Freigabe" });
        }
        abschnitte.push({ art: "freigabe", titel: `${datei.name} – Freigabe nötig`,
          zeilen: [
            `Vorschau: ${esc(vorschau)}`,
            ...tor.gruende.map(g => `• ${esc(g)}`),
            fragen.length ? `<b>${fragen.length} Frage(n)</b> im Reiter „Automatik“ `
              + "beantworten; der nächste Lauf importiert dann von selbst." : ""
          ].filter(Boolean) });
        continue;
      }

      /* ── Nichts zu tun: trotzdem abhaken ── */
      if (!AUTOMATIK.hatArbeit(bericht.gesamt)) {
        sagen("  → nichts zu schreiben, Datei wird als importiert vermerkt.");
        if (!TROCKEN) await markieren(datei,
          { ImportStatus: "Importiert", ImportedAt: new Date().toISOString() });
        abschnitte.push({ art: "importiert", titel: `${datei.name} – keine Änderung`,
          zeilen: [`Alle ${bericht.gesamt.unveraendert} Zeilen stehen schon so im CRM.`] });
        continue;
      }

      if (TROCKEN) {
        sagen("  → CRM_TROCKEN=1: es wird nichts geschrieben.");
        abschnitte.push({ art: "hinweis", titel: `${datei.name} – Probelauf`,
          zeilen: [`Würde schreiben: ${esc(vorschau)}`] });
        continue;
      }

      /* ── Import ── */
      const laufId = crypto.randomUUID();
      const start = new Date().toISOString();
      const ergebnis = await LAUF.ausfuehren(
        { profil, mappe, aufl, werte: wz, entscheidungen },
        { onFortschritt: p => process.stdout.write(`\r  ${p.text.slice(0, 90)}   `) });
      process.stdout.write("\n");

      const l = { ...ergebnis, laufId, beginn: start, ende: new Date().toISOString(),
                  datei, profil };
      const url = await protokollSchreiben(l, entscheidungen);
      await markieren(datei, {
        ImportStatus: l.gesamt.fehlgeschlagen ? "Fehlgeschlagen" : "Importiert",
        ImportRunId: laufId, ImportedAt: l.ende
      });
      if (vorgang)
        await GRAPH.updateItem(CRM_CONFIG.konfigSite, CRM_CONFIG.listen.freigaben,
          vorgang.id, { Status: AUTOMATIK.FREI.erledigt, RunId: laufId });

      sagen(`  → ${zahlSatz(l.gesamt).replace(/<\/?b>/g, "")}`);
      const warn = AUTOMATIK.warnungsGruppen(bericht.warnungen);
      abschnitte.push({
        art: l.gesamt.fehlgeschlagen ? "fehler" : "importiert",
        titel: `${datei.name} – importiert`,
        zeilen: [
          zahlSatz(l.gesamt),
          `Dauer ${Math.round(l.dauerMs / 1000)} s · Lauf-ID <code>${esc(laufId)}</code>`
            + (url ? ` · <a href="${esc(url)}">Vollprotokoll</a>` : ""),
          ...(auto.length ? [`${auto.length} Mehrfachtreffer ohne Rückfrage gelöst `
            + "(genau ein aktiver Datensatz je Wert)."] : []),
          ...warn.slice(0, 5).map(w => `⚠ ${w.anzahl}× ${esc(w.meldung)}`
            + (w.werte.size ? ` <i>(${esc([...w.werte].join(", "))})</i>` : "")),
          ...(warn.length > 5 ? [`… und ${warn.length - 5} weitere Warnungsarten.`] : [])
        ] });
    } catch (fehler) {
      sagen(`  ! ${fehler.message}`);
      /* „Fehlgeschlagen" heisst auch: die Automatik fasst die Datei nicht
         wieder an. Das ist Absicht – eine Datei, die stündlich scheitert,
         schickt sonst stündlich eine Mail. Der Weg zurück gehört deshalb
         in den Bericht. */
      abschnitte.push({ art: "fehler", titel: `${datei.name} – abgebrochen`,
        zeilen: [esc(fehler.detail || fehler.message),
          "Zum Wiederholen in der Bibliothek den <i>Importstatus</i> auf "
          + "<b>Neu</b> zurücksetzen."] });
      if (!TROCKEN) await markieren(datei, { ImportStatus: "Fehlgeschlagen" });
    }
  }

  /* ── Abschluss ── */
  if (!TROCKEN) await AUTOMATIK.einstellungSetzen("LetzterLauf",
    new Date().toISOString(), ids).catch(er => sagen("! LetzterLauf:", er.message));

  if (!abschnitte.length) {
    sagen("\nNichts zu tun – keine Mail.");
    return;
  }

  const { betreff, html } = AUTOMATIK.bericht(abschnitte,
    { appUrl: "https://crm.dihag.de/" });
  try {
    await AUTOMATIK.mailSenden(e.Absender, e.Empfaenger, betreff, html);
    sagen(`\nBericht an ${e.Empfaenger}: ${betreff}`);
  } catch (er) {
    sagen(`\n! Bericht NICHT versendet: ${er.message}`);
    sagen(betreff);
    process.exitCode = 1;   // sichtbar in Actions – ein stiller Lauf wäre schlimmer
  }
  sagen(`Gesamtdauer ${Math.round((Date.now() - beginn) / 1000)} s.`);
})().catch(e => {
  console.error("\nAbbruch:", e.stack || e.message);
  process.exit(1);
});

/** Ein Kandidat muss unterscheidbar sein, sonst hilft die Auswahl nicht.
 *  Gekürzte Fassung dessen, was die Oberfläche zeigt. */
function kandidatText(k, o) {
  const teile = [];
  for (const feld of ["fullname", "name", "emailaddress1", "internalemailaddress",
                      "dag_dihag_kdnr", "new_dagextopid", "accountnumber"]) {
    if (k[feld] != null && String(k[feld]) !== String(o.wert)) teile.push(`${k[feld]}`);
  }
  if (k.statecode != null) teile.push(Number(k.statecode) === 0 ? "aktiv" : "inaktiv");
  if (k.isdisabled != null) teile.push(k.isdisabled ? "deaktiviert" : "aktiv");
  teile.push(String(k[o.idFeld] || "").slice(0, 8));
  return teile.join(" · ");
}
