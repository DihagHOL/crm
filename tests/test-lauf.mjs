/* Der Importlauf – neu angelegte Elterndatensätze.
   ------------------------------------------------
   Anlass: Der erste echte Lauf kündigte 156 Neuanlagen an und legte 66 an;
   79 Zeilen schlugen fehl. Ursache war weder das Ziel noch die Datei,
   sondern die Reihenfolge:

     Phase 0 fragt VOR dem Lauf ab. Was Schritt 30 anlegt, steht dort also
     nicht — und Schritt 40 sucht den Elterndatensatz genau dort. Die
     Positionen jeder NEUEN Verkaufschance scheiterten mit
     „Elterndatensatz nicht aufgeloest". Bestandschancen gingen durch.

   Ein Fehler, der mit der Zahl der Neuanlagen wächst und den der Prüflauf
   nicht sehen kann. Deshalb steht er hier.                               */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");

let fehler = 0;
const pruefe = (b, t) => { console.log(`  ${b ? "ok  " : "FEHL"}  ${t}`); if (!b) fehler++; };
const gleich = (a, b, t) => pruefe(JSON.stringify(a) === JSON.stringify(b),
  `${t}${JSON.stringify(a) === JSON.stringify(b) ? "" : `  (erwartet ${JSON.stringify(b)}, war ${JSON.stringify(a)})`}`);

const quelle = n => readFileSync(join(wurzel, "js", n), "utf8");

/** Alle beteiligten Module echt laden – gestellt sind nur Netz und Token. */
function baueLauf(antwortFuer) {
  const gesendet = [];
  const g = {
    CRM_CONFIG: { batchSize: 100, maxParallel: 4, apiVersion: "v9.2",
                  listen: { werte: "CRM_ValueMappings" } },
    istOffen: () => false,
    AUTH: { getToken: async () => "token" },
    DV: { basis: () => "https://test.crm4.dynamics.com/api/data/v9.2",
          alle: async () => [], logischerName: async es => es.replace(/s$/, "") },
    console,
    setTimeout,
    crypto: { randomUUID: () => "11111111-2222-3333-4444-555555555555" },
    fetch: async (url, opt) => {
      gesendet.push({ url: String(url), koerper: String(opt.body) });
      const text = antwortFuer(String(opt.body));
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => text };
    }
  };
  const src = ["excel.js", "transforms.js", "mapping.js", "aufloesung.js",
               "pruefung.js", "batch.js", "lauf.js"].map(quelle).join("\n");
  const f = new Function(...Object.keys(g), src + "; return { LAUF, EXCEL };");
  return { ...f(...Object.values(g)), gesendet };
}

/** Batch-Antwort bauen: je Anfrage ein Teil. */
function antwort(teile) {
  const CRLF = String.fromCharCode(13, 10);
  const z = [];
  for (const t of teile) {
    z.push("--batchresponse_1", "Content-Type: application/http", "");
    z.push(`HTTP/1.1 ${t.status} ok`);
    if (t.ort) z.push("OData-EntityId: " + t.ort);
    z.push("Content-Type: application/json", "");
    if (t.koerper) z.push(JSON.stringify(t.koerper));
  }
  z.push("--batchresponse_1--", "");
  return z.join(CRLF);
}

const GUID_ALT = "aaaaaaaa-0000-0000-0000-000000000001";
const GUID_NEU = "bbbbbbbb-0000-0000-0000-000000000002";

/* Zwei Anfragen: 6440 gibt es schon, 6441 nicht. Je eine Position. */
function kulisse(EXCEL) {
  const mappe = { blaetter: [
    EXCEL.blattAus("Anfragen", [
      ["Opp-ID", "Thema"],
      [6440, "Bestand"],
      [6441, "ganz neu"]
    ]),
    EXCEL.blattAus("Positionen", [
      ["Opp-ID", "Position"],
      [6440, "zur Bestandschance"],
      [6441, "zur neuen Chance"]
    ])
  ] };

  const zuordnungen = {
    OPP: [
      { aktiv: true, sourceColumn: "Opp-ID", targetField: "new_dagextopid",
        targetType: "Int", istSchluessel: true, writePolicy: "Always" },
      { aktiv: true, sourceColumn: "Thema", targetField: "name",
        targetType: "String", writePolicy: "Always" }
    ],
    POS: [
      { aktiv: true, sourceColumn: "Opp-ID", targetField: "opportunityid",
        targetType: "Lookup", lookupEntitySet: "opportunities",
        lookupKeyField: "new_dagextopid", writePolicy: "Always" },
      { aktiv: true, sourceColumn: "Position", targetField: "name",
        targetType: "String", writePolicy: "Always" }
    ]
  };

  const profil = { name: "T", zuordnungen, schritte: [
    { step: 30, entitySet: "opportunities", sourceSheet: "Anfragen",
      mappingKey: "OPP", mode: "Upsert", alternateKey: "new_dagextopid", aktiv: true },
    { step: 40, entitySet: "opportunityproducts", sourceSheet: "Positionen",
      mappingKey: "POS", mode: "ReplaceByParent", parentField: "opportunityid",
      aktiv: true }
  ] };

  // Phase 0, wie sie VOR dem Lauf aussieht: nur 6440 ist bekannt.
  const aufl = {
    treffer: new Map([
      ["opportunities|new_dagextopid", new Map([
        ["6440", [{ new_dagextopid: 6440, opportunityid: GUID_ALT, statecode: 0, name: "alt" }]]
      ])],
      ["opportunityproducts|_opportunityid_value", new Map()]
    ]),
    abfragen: [],
    idFelder: new Map([["opportunities", "opportunityid"],
                       ["opportunityproducts", "opportunityproductid"]])
  };

  return { mappe, profil, aufl };
}

console.log("\nPositionen zu einer im selben Lauf angelegten Verkaufschance");
{
  const { LAUF, EXCEL, gesendet } = baueLauf(koerper =>
    koerper.includes("/opportunityproducts")
      ? antwort([{ status: 204 }, { status: 204 }])
      // Schritt 30: die neue Chance bekommt eine GUID zurück, so wie
      // Dataverse sie in OData-EntityId liefert.
      : antwort([{ status: 204 },
                 { status: 204, ort: `https://x/opportunities(${GUID_NEU})` }]));

  const k = kulisse(EXCEL);
  const e = await LAUF.ausfuehren({ profil: k.profil, mappe: k.mappe, aufl: k.aufl,
                                    werte: {}, entscheidungen: null });

  const pos = e.eintraege.filter(x => x.schritt === 40);
  gleich(pos.filter(x => x.aktion === "fehlgeschlagen").length, 0,
    "keine Position scheitert an einem nicht aufgeloesten Elterndatensatz");
  gleich(pos.filter(x => x.aktion === "angelegt").length, 2,
    "beide Positionen entstehen - auch die zur neuen Chance");
  gleich(e.gesamt.angelegt, 3, "eine Chance und zwei Positionen");

  const batch40 = gesendet.find(s => s.koerper.includes("/opportunityproducts"));
  pruefe(batch40.koerper.includes("new_dagextopid=6441"),
    "die neue Chance wird ueber ihren Alternativschluessel gebunden");
}

console.log("\nOhne OData-EntityId geht es trotzdem weiter");
{
  /* Nicht jede Antwort traegt die GUID. Fuer einen eben angelegten
     Elterndatensatz braucht es sie auch nicht: es gibt nichts zu loeschen,
     und gebunden wird ueber den Alternativschluessel. */
  const { LAUF, EXCEL } = baueLauf(() => antwort([{ status: 204 }, { status: 204 }]));
  const k = kulisse(EXCEL);
  const e = await LAUF.ausfuehren({ profil: k.profil, mappe: k.mappe, aufl: k.aufl,
                                    werte: {}, entscheidungen: null });
  gleich(e.eintraege.filter(x => x.schritt === 40 && x.aktion === "fehlgeschlagen").length, 0,
    "auch ohne zurueckgemeldete GUID scheitert nichts");
}

console.log("\nEin Elterndatensatz, den es wirklich nicht gibt, bleibt ein Fehler");
{
  const { LAUF, EXCEL } = baueLauf(() => antwort([{ status: 204 }, { status: 204 }]));
  const k = kulisse(EXCEL);
  // Schritt 30 abschalten: dann entsteht 6441 nie, und die Position dazu
  // haengt an nichts. Das darf nicht stillschweigend durchgehen.
  k.profil.schritte[0].aktiv = false;

  const e = await LAUF.ausfuehren({ profil: k.profil, mappe: k.mappe, aufl: k.aufl,
                                    werte: {}, entscheidungen: null });
  const schlecht = e.eintraege.filter(x => x.aktion === "fehlgeschlagen");
  gleich(schlecht.length, 1, "genau eine Position scheitert");
  pruefe(/nicht aufgeloest/.test(schlecht[0].meldung || ""),
    "und zwar mit der Begruendung, dass der Elterndatensatz fehlt");
}

console.log(fehler ? `\n${fehler} Pruefung(en) fehlgeschlagen.` : "\nAlle Pruefungen bestanden.");
process.exit(fehler ? 1 : 0);
