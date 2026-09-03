/* Sammelabfragen der Auflösungsphase.
   ----------------------------------
   Anlass: Der erste echte Prüflauf brach mit HTTP 400 ab —

     'OpportunityProduct' entity doesn't contain attribute with
     Name = '_opportunityid_value'

   `Microsoft.Dynamics.CRM.In` kennt nur Attributnamen. Die OData-Schreibweise
   eines Verweises ist keiner. Gefiltert wird deshalb über `opportunityid`,
   gelesen und gruppiert weiterhin über `_opportunityid_value` — nur unter
   dem steht die GUID in der Antwort.

   Getestet wird beides: der gebaute Filter und der Rückfallweg, falls die
   Umgebung `In(...)` trotzdem abweist.                                     */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");

let fehler = 0;
const pruefe = (b, t) => { console.log(`  ${b ? "ok  " : "FEHL"}  ${t}`); if (!b) fehler++; };
const gleich = (a, b, t) => pruefe(JSON.stringify(a) === JSON.stringify(b),
  `${t}${JSON.stringify(a) === JSON.stringify(b) ? "" : `  (erwartet ${JSON.stringify(b)}, war ${JSON.stringify(a)})`}`);

/** AUFLOESUNG mit gestelltem DV. `antwort(pfad)` liefert die Zeilen oder
 *  wirft — so lässt sich auch ein 400 nachstellen. */
function baueAufloesung(antwort) {
  const gerufen = [];
  const g = {
    DV: {
      alle: async pfad => { gerufen.push(decodeURIComponent(pfad)); return antwort(pfad); },
      logischerName: async es => es.replace(/ies$/, "y").replace(/s$/, "")
    },
    EXCEL: { blatt: () => null },
    TRANSFORMS: { anwenden: w => ({ wert: w, unbekannt: [] }) },
    console
  };
  const src = readFileSync(join(wurzel, "js/aufloesung.js"), "utf8");
  const f = new Function(...Object.keys(g), src + "; return AUFLOESUNG;");
  return { A: f(...Object.values(g)), gerufen };
}

const G1 = "5deeb6d7-cc6a-f111-ab0d-000d3ad7f6b1";
const G2 = "b5730011-4d70-f111-ab0d-000d3ad7f6b1";

console.log("\nFeldname für den Filter");
{
  const { A } = baueAufloesung(() => []);
  gleich(A.filterFeld("_opportunityid_value"), "opportunityid",
    "Verweis wird auf den Attributnamen zurückgeführt");
  gleich(A.filterFeld("dag_dihag_kdnr"), "dag_dihag_kdnr",
    "gewöhnliches Feld bleibt, wie es ist");
  gleich(A.filterFeld("_value"), "_value",
    "kein Name zwischen den Unterstrichen – nichts zu ersetzen");
}

console.log("\nIn(...) filtert über das Attribut, gruppiert über den Alias");
{
  const zeilen = [
    { _opportunityid_value: G1, opportunityproductid: "p1" },
    { _opportunityid_value: G1, opportunityproductid: "p2" },
    { _opportunityid_value: G2, opportunityproductid: "p3" }
  ];
  const { A, gerufen } = baueAufloesung(() => zeilen);
  const m = await A.sammle("opportunityproducts", "_opportunityid_value",
    [G1, G2], "_opportunityid_value,opportunityproductid");

  pruefe(gerufen.length === 1, "eine Abfrage für zwei Werte, nicht zwei");
  pruefe(gerufen[0].includes("PropertyName='opportunityid'"),
    "gefiltert wird über den Attributnamen");
  pruefe(!gerufen[0].includes("PropertyName='_opportunityid_value'"),
    "die OData-Schreibweise steht NICHT im Filter – genau daran brach es ab");
  pruefe(gerufen[0].includes("$select=_opportunityid_value,opportunityproductid"),
    "gelesen wird weiterhin der Aliasname");
  gleich(m.get(G1).length, 2, "beide Positionen der ersten Chance");
  gleich(m.get(G2).length, 1, "eine Position der zweiten Chance");
}

console.log("\nRückfallweg bei HTTP 400");
{
  const zeilen = [{ _opportunityid_value: G1, opportunityproductid: "p1" }];
  const { A, gerufen } = baueAufloesung(pfad => {
    if (decodeURIComponent(pfad).includes("Microsoft.Dynamics.CRM.In")) {
      const e = new Error("entity doesn't contain attribute");
      e.status = 400;
      throw e;
    }
    return zeilen;
  });
  const m = await A.sammle("opportunityproducts", "_opportunityid_value",
    [G1], "_opportunityid_value");

  pruefe(gerufen.length === 2, "erst In(...), dann die eq-Kette");
  pruefe(gerufen[1].includes(`_opportunityid_value eq ${G1}`),
    "die Kette vergleicht über den Aliasnamen, GUID ohne Anführungszeichen");
  gleich(m.get(G1).length, 1, "das Ergebnis kommt trotzdem an");
}
{
  // Text muss in Anführungszeichen, GUIDs nicht. Beides falsch herum ergibt
  // wieder einen 400 – nur diesmal ohne Rückfallweg dahinter.
  const { A, gerufen } = baueAufloesung(pfad => {
    if (decodeURIComponent(pfad).includes("Microsoft.Dynamics.CRM.In")) {
      const e = new Error("abgelehnt"); e.status = 400; throw e;
    }
    return [];
  });
  await A.sammle("accounts", "dag_dihag_kdnr", ["99901016"], "dag_dihag_kdnr");
  pruefe(gerufen[1].includes("dag_dihag_kdnr eq '99901016'"),
    "Textwert steht in Anführungszeichen");
}
{
  // 429 ist keine falsch gebaute Abfrage, sondern Drosselung. Sie gehört
  // nach oben – der Rückfallweg würde sie nur verschleiern.
  const { A, gerufen } = baueAufloesung(() => {
    const e = new Error("Too Many Requests"); e.status = 429; throw e;
  });
  let geworfen = false;
  try { await A.sammle("accounts", "dag_dihag_kdnr", ["1"], "dag_dihag_kdnr"); }
  catch (e) { geworfen = e.status === 429; }
  pruefe(geworfen, "429 wird durchgereicht, nicht als Filterfehler behandelt");
  pruefe(gerufen.length === 1, "und nicht auf dem anderen Weg wiederholt");
}

console.log("\nBlockbildung");
{
  const { A, gerufen } = baueAufloesung(() => []);
  const werte = Array.from({ length: 250 }, (_, i) => String(i));
  await A.sammle("accounts", "dag_dihag_kdnr", werte, "dag_dihag_kdnr");
  gleich(gerufen.length, 3, "250 Werte ergeben drei Blöcke à 100");
}
{
  const { A, gerufen } = baueAufloesung(() => []);
  await A.sammle("accounts", "dag_dihag_kdnr",
    ["7", null, "", "7", undefined, "8"], "dag_dihag_kdnr");
  const f = gerufen[0];
  pruefe(f.includes("PropertyValues=['7','8']"),
    "leere Werte fliegen raus, doppelte werden einmal gefragt");
}

console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen.` : "\nAlle Prüfungen bestanden.");
process.exit(fehler ? 1 : 0);
