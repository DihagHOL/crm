/* Belegung im Ziel: zählt sie auch Verweise?
   -----------------------------------------
   Anlass: `new_dag_materialteuerungszuschlagmtzabsolut` trug 4 Werte von
   5000 Positionen, `new_dag_mtzabsolut` 2340. Der Import schrieb
   fehlerfrei in ein Feld, das niemand ansieht. Seitdem zählt die
   Zuordnung die Belegung im CRM — nur waren Verweise davon ausgenommen.

   Der Grund war ein stiller Fehler: auf `$select=ownerid` antwortet
   Dataverse nicht mit 400, sondern verwirft das $select und liefert den
   vollen Datensatz, in dem `ownerid` nicht vorkommt. Gezählt wurden null
   Treffer — nicht zu unterscheiden von „führt wirklich niemand".

   Getestet wird also: Verweise werden als `_feld_value` gelesen.        */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");

let fehler = 0;
const pruefe = (b, t) => { console.log(`  ${b ? "ok  " : "FEHL"}  ${t}`); if (!b) fehler++; };
const gleich = (a, b, t) => pruefe(JSON.stringify(a) === JSON.stringify(b),
  `${t}${JSON.stringify(a) === JSON.stringify(b) ? "" : `  (erwartet ${JSON.stringify(b)}, war ${JSON.stringify(a)})`}`);

/** DV-Modul mit einem fetch, der nach der Adresse entscheidet.
 *  `metaOk = false` stellt den Ausfall der Metadaten nach. */
function baueDV({ attribute, zeilen, metaOk = true }) {
  const gesehen = [];
  const g = {
    CRM_CONFIG: { dataverseUrl: "https://test.crm4.dynamics.com", apiVersion: "v9.2" },
    istOffen: () => false,
    AUTH: { getToken: async () => "token" },
    console,
    fetch: async (url) => {
      gesehen.push(String(url));
      const antwort = k => ({ ok: true, status: 200,
        headers: { get: () => null }, json: async () => k });
      if (url.includes("EntityDefinitions?")) {
        // 404 statt 500: ein Serverfehler liefe in die Wiederholung und
        // der Test wartete vier Mal fuenf Sekunden auf eine Antwort, die
        // absichtlich nie kommt.
        if (!metaOk) return { ok: false, status: 404, headers: { get: () => null },
          json: async () => ({ error: { message: "Metadaten weg" } }),
          text: async () => "Metadaten weg" };
        return antwort({ value: [{ LogicalName: "opportunity",
                                   EntitySetName: "opportunities" }] });
      }
      if (url.includes("/Attributes")) {
        return antwort({ value: Object.entries(attribute).map(([n, t]) =>
          ({ LogicalName: n, AttributeType: t,
             IsValidForCreate: true, IsValidForUpdate: true })) });
      }
      return antwort({ value: zeilen });
    }
  };
  const src = readFileSync(join(wurzel, "js/dataverse.js"), "utf8");
  const DV = new Function(...Object.keys(g), src + "; return DV;")(...Object.values(g));
  return { DV, gesehen };
}

const ATTR = {
  name: "String",
  ownerid: "Owner",
  customerid: "Customer",
  pricelevelid: "Lookup",
  new_dag_mtzabsolut: "Money"
};

console.log("\nVerweise werden als _feld_value gelesen");
{
  const { DV, gesehen } = baueDV({ attribute: ATTR, zeilen: [
    { name: "A", _ownerid_value: "u1", _pricelevelid_value: "p1", new_dag_mtzabsolut: 5 },
    { name: "B", _ownerid_value: "u2",                            new_dag_mtzabsolut: 0 },
    { name: "",  _ownerid_value: "u3" }
  ]});
  const r = await DV.belegung("opportunities",
    ["name", "ownerid", "pricelevelid", "new_dag_mtzabsolut"]);

  const abfrage = gesehen.find(u => u.includes("/opportunities?"));
  pruefe(abfrage.includes("_ownerid_value"), "ownerid wird als _ownerid_value abgefragt");
  pruefe(abfrage.includes("_pricelevelid_value"), "pricelevelid ebenso");
  pruefe(!/select=[^&]*[^_]ownerid[^_]/.test(abfrage), "der rohe Attributname steht nicht im $select");
  pruefe(abfrage.includes("name") && abfrage.includes("new_dag_mtzabsolut"),
    "Textfeld und Money-Feld bleiben unveraendert");

  gleich(r.gesamt, 3, "alle Zeilen gezaehlt");
  gleich(r.jeFeld.ownerid, 3, "Besitzer in allen drei Zeilen gefunden");
  gleich(r.jeFeld.pricelevelid, 1, "Preisliste nur in einer Zeile");
  gleich(r.jeFeld.name, 2, "leerer Text zaehlt nicht als belegt");
  gleich(r.jeFeld.new_dag_mtzabsolut, 2, "die Null zaehlt als Wert, nicht als leer");
}

console.log("\nDer Schluessel bleibt der Feldname aus dem Profil");
{
  /* Die Oberflaeche sucht die Zelle ueber `bel-<schritt>-<targetField>`.
     Kaeme die Zahl unter `_ownerid_value` zurueck, bliebe die Zelle leer
     und der Verweis saehe wieder ungeprueft aus. */
  const { DV } = baueDV({ attribute: ATTR, zeilen: [{ _ownerid_value: "u1" }] });
  const r = await DV.belegung("opportunities", ["ownerid"]);
  gleich(Object.keys(r.jeFeld), ["ownerid"], "Ergebnis traegt den Profilnamen");
}

console.log("\nSchon aufgeloeste Namen werden nicht doppelt verpackt");
{
  const { DV, gesehen } = baueDV({
    attribute: { ...ATTR, _ownerid_value: "Lookup" },
    zeilen: [{ _ownerid_value: "u1" }] });
  const r = await DV.belegung("opportunities", ["_ownerid_value"]);
  const abfrage = gesehen.find(u => u.includes("/opportunities?"));
  pruefe(!abfrage.includes("__ownerid_value_value"), "kein _ _ownerid_value _value");
  gleich(r.jeFeld._ownerid_value, 1, "Wert trotzdem gezaehlt");
}

console.log("\nOhne Metadaten wird gezaehlt statt abgebrochen");
{
  const { DV } = baueDV({ attribute: ATTR, zeilen: [{ name: "A" }], metaOk: false });
  const r = await DV.belegung("opportunities", ["name"]);
  gleich(r.jeFeld.name, 1, "Textfelder funktionieren auch ohne Metadaten");
}

console.log("\nLeere Feldliste kostet keinen Aufruf");
{
  const { DV, gesehen } = baueDV({ attribute: ATTR, zeilen: [] });
  const r = await DV.belegung("opportunities", [null, "", undefined]);
  gleich(r.gesamt, 0, "nichts gezaehlt");
  gleich(gesehen.length, 0, "kein einziger Aufruf");
}

console.log(fehler ? `\n${fehler} Pruefung(en) fehlgeschlagen.` : "\nAlle Pruefungen bestanden.");
process.exit(fehler ? 1 : 0);
