/* Dublettenprüfung der Schlüsselfelder.
   -------------------------------------
   Anlass steht in docs/05: Der Altflow hat am 04.06.2026 durch eine
   verschachtelte Schleife 76 Verkaufschancen doppelt angelegt. Aufgefallen
   ist das erst Wochen später, als der Alternativschlüssel nicht anlegbar
   war. Seitdem prüft die App das selbst — und diese Prüfung muss stimmen,
   sonst wiegt sie nur in Sicherheit.

   Getestet wird DV.dubletten() mit gestelltem fetch, inklusive Paginierung
   und dem Deckel gegen einen Vollscan.                                    */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");

let fehler = 0;
const pruefe = (b, t) => { console.log(`  ${b ? "ok  " : "FEHL"}  ${t}`); if (!b) fehler++; };
const gleich = (a, b, t) => pruefe(JSON.stringify(a) === JSON.stringify(b),
  `${t}${JSON.stringify(a) === JSON.stringify(b) ? "" : `  (erwartet ${JSON.stringify(b)}, war ${JSON.stringify(a)})`}`);

/** Baut ein DV-Modul mit gestellten Antwortseiten. */
function baueDV(seiten) {
  let i = 0;
  const g = {
    CRM_CONFIG: { dataverseUrl: "https://test.crm4.dynamics.com", apiVersion: "v9.2" },
    istOffen: () => false,
    AUTH: { getToken: async () => "token" },
    console,
    fetch: async () => {
      const s = seiten[Math.min(i++, seiten.length - 1)];
      return {
        ok: true, status: 200,
        headers: { get: () => null },
        json: async () => s
      };
    }
  };
  const src = readFileSync(join(wurzel, "js/dataverse.js"), "utf8");
  const f = new Function(...Object.keys(g), src + "; return DV;");
  return f(...Object.values(g));
}

const s = (werte, next) => ({
  value: werte.map(v => ({ new_dagextopid: v })),
  ...(next ? { "@odata.nextLink": next } : {})
});

console.log("\nZählung");
{
  const DV = baueDV([s([1, 2, 3, 4])]);
  const r = await DV.dubletten("opportunities", "new_dagextopid");
  gleich(r.gesamt, 4, "alle Zeilen gezählt");
  gleich(r.verschieden, 4, "verschiedene Werte gezählt");
  gleich(r.dubletten, [], "keine Dubletten bei eindeutigen Werten");
  pruefe(r.vollstaendig === true, "Ergebnis als vollständig gemeldet");
}
{
  const DV = baueDV([s([7281, 6918, 7281, 7187, 7281, 6918])]);
  const r = await DV.dubletten("opportunities", "new_dagextopid");
  gleich(r.gesamt, 6, "alle Zeilen gezählt");
  gleich(r.verschieden, 3, "drei verschiedene Werte");
  gleich(r.dubletten, [{ wert: 7281, anzahl: 3 }, { wert: 6918, anzahl: 2 }],
    "Dubletten absteigend nach Häufigkeit – der schlimmste Fall zuerst");
}

console.log("\nPaginierung");
{
  const DV = baueDV([s([1, 2], "https://weiter"), s([2, 3])]);
  const r = await DV.dubletten("opportunities", "new_dagextopid");
  gleich(r.gesamt, 4, "zweite Seite wird mitgelesen");
  gleich(r.dubletten, [{ wert: 2, anzahl: 2 }],
    "Dublette über Seitengrenze hinweg erkannt – der Fall, den man leicht übersieht");
}
{
  // Endlos weiterverweisende Seiten: der Deckel muss greifen UND das
  // Ergebnis als unvollständig markieren. Ein still abgeschnittenes
  // Ergebnis wäre schlimmer als ein langsames.
  const DV = baueDV([s([1], "https://weiter")]);
  const r = await DV.dubletten("opportunities", "new_dagextopid");
  pruefe(r.gesamt === 20, `Deckel bei 20 Seiten greift (gelesen: ${r.gesamt})`);
  pruefe(r.vollstaendig === false, "abgeschnittenes Ergebnis wird als unvollständig gemeldet");
}

console.log("\nLeere und fehlende Werte");
{
  const DV = baueDV([{ value: [
    { new_dagextopid: 5 }, { new_dagextopid: null },
    { new_dagextopid: 5 }, {} ] }]);
  const r = await DV.dubletten("opportunities", "new_dagextopid");
  gleich(r.verschieden, 1, "null und fehlende Felder zählen nicht als Wert");
  gleich(r.dubletten, [{ wert: 5, anzahl: 2 }], "echte Dublette trotzdem erkannt");
}

console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen.\n` : "\nAlle Prüfungen bestanden.\n");
process.exit(fehler ? 1 : 0);
