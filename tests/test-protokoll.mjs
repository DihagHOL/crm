/* Das Protokoll zurücklesen – welche Zeilen wurden ausgelassen, und warum?
   ------------------------------------------------------------------------
   Die Einzelzeilen stehen erst seit dem 24.09.2026 in CRM_ImportErrors. Für
   jeden Lauf davor liegt die Antwort im Vollprotokoll, das jeder Lauf seit
   jeher schreibt. Ohne Rückfallweg hiesse die Auskunft „nicht mehr
   feststellbar", obwohl die Daten seit Monaten auf der Platte liegen.    */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = f => readFileSync(join(wurzel, f), "utf8");

let fehler = 0;
const pruefe = (b, t) => { console.log(`  ${b ? "ok  " : "FEHL"}  ${t}`); if (!b) fehler++; };
const gleich = (a, b, t) => pruefe(JSON.stringify(a) === JSON.stringify(b),
  `${t}${JSON.stringify(a) === JSON.stringify(b) ? "" : `  (erwartet ${JSON.stringify(b)}, war ${JSON.stringify(a)})`}`);

/** SPLISTEN mit gestelltem GRAPH. `antwort(pfad)` entscheidet je Aufruf. */
function baue(antwort) {
  const gerufen = [];
  const g = {
    CRM_CONFIG: { konfigSite: "host:/teams/x", umgebung: "TEST",
                  listen: { profile: "P", mappings: "M", werte: "W",
                            laeufe: "R", fehler: "E" } },
    GRAPH: {
      siteId: async () => "SID",
      call: async (pfad, opts) => { gerufen.push(pfad); return antwort(pfad, opts); },
      addItem: async (site, liste, felder) => { gerufen.push(`ADD ${liste}`); return { id: "1", ...felder }; },
      listItems: async () => []
    },
    console
  };
  const S = new Function(...Object.keys(g), lies("js/spListen.js") + "; return SPLISTEN;")
    (...Object.values(g));
  return { S, gerufen };
}

console.log("\nDas Vollprotokoll eines Laufs zurücklesen");
{
  const inhalt = { lauf: { laufId: "L1" }, eintraege: [
    { aktion: "uebersprungen", zeile: 17, meldung: "Zeile wurde in einem früheren Schritt ausgeschlossen" },
    { aktion: "angelegt", zeile: 18 }
  ] };
  const { S, gerufen } = baue(pfad => {
    if (pfad.endsWith("/drive")) return { id: "DRV" };
    if (pfad.includes("Protokolle")) return inhalt;
    return null;
  });

  const v = await S.vollprotokollLesen("L1");
  gleich(v.eintraege.length, 2, "das Protokoll kommt zurück");
  pruefe(gerufen.some(p => p.includes("Protokolle/L1.json")),
    "gelesen wird der Pfad, unter dem der Lauf es geschrieben hat");
}

console.log("\nKein Vollprotokoll ist kein Fehler");
{
  const { S } = baue(pfad => {
    if (pfad.endsWith("/drive")) return { id: "DRV" };
    const e = new Error("Item not found"); e.status = 404; throw e;
  });
  gleich(await S.vollprotokollLesen("gibtsnicht"), null,
    "ein fehlendes Protokoll gibt null, keinen Absturz");
}
{
  // Alles andere als 404 muss durchschlagen: ein 403 als „gibt es nicht"
  // auszugeben, hiesse ein Rechteproblem als Datenlage zu verkaufen.
  const { S } = baue(pfad => {
    if (pfad.endsWith("/drive")) return { id: "DRV" };
    const e = new Error("Access denied"); e.status = 403; throw e;
  });
  let geworfen = false;
  try { await S.vollprotokollLesen("L1"); } catch { geworfen = true; }
  pruefe(geworfen, "ein 403 wird nicht als „gibt es nicht“ verkauft");
}

console.log("\nJede Zeile, die nicht im CRM landet – mit Grund");
{
  const { S, gerufen } = baue(() => null);
  const r = await S.zeilenSchreiben("L1", [
    { aktion: "fehlgeschlagen", zeile: 4, meldung: "HTTP 400", art: "API" },
    { aktion: "uebersprungen", zeile: 12, meldung: "Steht in SkipOnValues" },
    { aktion: "uebersprungen", zeile: 17, meldung: "in einem früheren Schritt ausgeschlossen" },
    { aktion: "angelegt", zeile: 2 },
    { aktion: "unveraendert", zeile: 3 }
  ]);
  gleich(r.geschrieben, 3, "geschrieben werden Fehler UND Übersprungene");
  gleich(r.jeArt, { fehlgeschlagen: 1, uebersprungen: 2, gewarnt: 0 },
    "nach Art gezählt – auch die dritte Art, die es seit dem 25.09.2026 gibt");
  pruefe(gerufen.filter(p => p === "ADD E").length === 3,
    "und zwar als drei Einträge in der Fehlerliste");

  // Deckel je Art: 500 Übersprungene dürfen die echten Fehler nicht verdrängen.
  const viele = Array.from({ length: 500 }, (_, i) => ({
    aktion: "uebersprungen", zeile: i, meldung: "immer dasselbe" }));
  const { S: S2 } = baue(() => null);
  const r2 = await S2.zeilenSchreiben("L2",
    [...viele, { aktion: "fehlgeschlagen", zeile: 1, meldung: "HTTP 400" }], 5);
  gleich(r2.jeArt, { fehlgeschlagen: 1, uebersprungen: 500, gewarnt: 0 },
    "gezählt werden alle");
  gleich(r2.geschrieben, 6, "geschrieben höchstens fünf je Art – der Fehler ist dabei");
  gleich(r2.ausgelassen, 495, "der Rest steht im Vollprotokoll");
}

{
  /* Die dritte Art: der Datensatz IST geschrieben, aber etwas daneben hat
     nicht geklappt – etwa die Notiz mit dem alten Statusgrund einer
     wiedereröffneten Chance. Weder Fehler noch Auslassung. */
  const { S, gerufen } = baue(() => null);
  const r = await S.zeilenSchreiben("L3", [
    { aktion: "gewarnt", zeile: 7, schluessel: "6428",
      meldung: "Wiedereröffnet, aber die Notiz liess sich nicht anlegen" },
    { aktion: "aktualisiert", zeile: 8 }
  ]);
  gleich(r.geschrieben, 1, "die Warnung landet im Protokoll");
  gleich(r.jeArt.gewarnt, 1, "und wird als eigene Art gezählt");
  pruefe(gerufen.filter(p => p === "ADD E").length === 1,
    "genau ein Eintrag – die geschriebene Zeile gehoert nicht dazu");
}

console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen.\n` : "\nAlle Prüfungen bestanden.\n");
process.exit(fehler ? 1 : 0);
