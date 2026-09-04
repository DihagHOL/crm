/* Der Prüflauf – stuft jede Zeile ein, bevor irgendetwas geschrieben wird.
   -----------------------------------------------------------------------
   Geprüft werden die fünf Ausgänge einer Zeile: neu, geändert, unverändert,
   übersprungen, Fehler. Sie sind die Grundlage für die einzige Aussage, die
   ein Prüflauf haben muss — „12 neu, 57 geändert, 3 unverändert".         */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = f => readFileSync(join(wurzel, f), "utf8");

const g = { CRM_CONFIG: { listen: { werte: "CRM_ValueMappings" } }, console, document: undefined };
const [EXCEL, TRANSFORMS, MAPPING, AUFLOESUNG, PRUEFUNG] = new Function(...Object.keys(g),
  lies("js/excel.js") + "\n" + lies("js/transforms.js") + "\n" + lies("js/mapping.js")
  + "\n" + lies("js/aufloesung.js") + "\n" + lies("js/pruefung.js")
  + "; return [EXCEL, TRANSFORMS, MAPPING, AUFLOESUNG, PRUEFUNG];"
)(...Object.values(g));

let fehler = 0;
const pruefe = (b, t) => { console.log(`  ${b ? "ok  " : "FEHL"}  ${t}`); if (!b) fehler++; };
const gleich = (a, b, t) => pruefe(JSON.stringify(a) === JSON.stringify(b),
  `${t}${JSON.stringify(a) === JSON.stringify(b) ? "" : `  (erwartet ${JSON.stringify(b)}, war ${JSON.stringify(a)})`}`);

/* ── Kulisse: eine Mappe, ein Profil, eine Auflösung ─────────────────── */

const mappe = { blaetter: [EXCEL.blattAus("Anfragen", [
  ["Opp-ID", "Thema", "Umsatz"],
  [6440, "Bestand unverändert", 150000],   // Zeile 2
  [6441, "Bestand geändert",    999],      // Zeile 3
  [7000, "gibt es noch nicht",  500],      // Zeile 4
  [6442, "geschlossen",         100],      // Zeile 5
  [6443, "mehrdeutig",          100],      // Zeile 6
  [null, "ohne Schluessel",     100]       // Zeile 7
])] };

const zuordnungen = {
  OPP: [
    { aktiv: true, sourceColumn: "Opp-ID", targetField: "new_dagextopid",
      targetType: "Int", istSchluessel: true, writePolicy: "Always" },
    { aktiv: true, sourceColumn: "Thema", targetField: "name",
      targetType: "String", writePolicy: "Always" },
    { aktiv: true, sourceColumn: "Umsatz", targetField: "estimatedvalue",
      targetType: "Decimal", writePolicy: "Always" }
  ]
};

const schritt = (o = {}) => ({
  step: 30, entitySet: "opportunities", sourceSheet: "Anfragen", mappingKey: "OPP",
  mode: "Upsert", onMissingKey: "Fail", alternateKey: "new_dagextopid",
  aktiv: true, skipIfClosed: true, ...o
});

/** Auflösung von Hand bauen – so, wie AUFLOESUNG.fuer sie liefern würde. */
function aufloesung(eintraege) {
  const m = new Map();
  for (const [wert, records] of Object.entries(eintraege)) m.set(wert, records);
  return { treffer: new Map([["opportunities|new_dagextopid", m]]), abfragen: [] };
}

const aufl = aufloesung({
  "6440": [{ new_dagextopid: 6440, statecode: 0, name: "Bestand unverändert", estimatedvalue: 150000 }],
  "6441": [{ new_dagextopid: 6441, statecode: 0, name: "alter Name", estimatedvalue: 1 }],
  "6442": [{ new_dagextopid: 6442, statecode: 2, name: "geschlossen", estimatedvalue: 100 }],
  "6443": [{ new_dagextopid: 6443, statecode: 0 }, { new_dagextopid: 6443, statecode: 0 }]
});

/* ── Einstufung ──────────────────────────────────────────────────────── */

console.log("\nDie fünf Ausgänge einer Zeile");
{
  const r = PRUEFUNG.lauf({ schritte: [schritt()], zuordnungen }, mappe, aufl);
  const z = r.schritte[0];
  gleich(z.unveraendert, 1, "gleicher Bestand → unverändert (Zeile 2)");
  gleich(z.aktualisiert, 1, "abweichender Bestand → geändert (Zeile 3)");
  gleich(z.neu, 1, "kein Bestand → neu (Zeile 4)");
  gleich(z.uebersprungen, 1, "geschlossene Chance → übersprungen (Zeile 5)");
  gleich(z.fehler, 2, "Mehrfachtreffer und fehlender Schlüssel → Fehler (Zeilen 6, 7)");
  gleich(PRUEFUNG.zusammenfassung(r.gesamt),
    "1 neu · 1 geändert · 1 unverändert · 1 übersprungen · 2 mit Fehler",
    "die Zusammenfassung ist der Satz, um den es geht");
}

console.log("\nGeschlossene Verkaufschancen (Review A3)");
{
  const r = PRUEFUNG.lauf({ schritte: [schritt()], zuordnungen }, mappe, aufl);
  const w = r.warnungen.find(x => /geschlossen/.test(x.meldung));
  pruefe(!!w, "die Übersprungene wird als Warnung gemeldet, nicht verschwiegen");
  pruefe(/nicht automatisch wiedereröffnet/.test(w.meldung),
    "und die Meldung sagt, dass NICHT wiedereröffnet wird – das wäre eine fachliche Entscheidung");
}
{
  const r = PRUEFUNG.lauf({ schritte: [schritt({ skipIfClosed: false })], zuordnungen }, mappe, aufl);
  gleich(r.schritte[0].uebersprungen, 0, "ohne SkipIfClosed wird nicht übersprungen");
}

console.log("\nMehrfachtreffer");
{
  const r = PRUEFUNG.lauf({ schritte: [schritt()], zuordnungen }, mappe, aufl);
  const f = r.fehler.find(x => /Mehrfachtreffer/.test(x.meldung));
  pruefe(!!f && f.zeile === 6,
    "Mehrfachtreffer wird als Fehler gemeldet und nennt die Excel-Zeile");
  pruefe(/geraten wird nicht/.test(f.meldung),
    "es wird nicht der erste genommen – genau das tut der Altflow mit $top:1");
}

console.log("\nFehlender Schlüssel: Fail gegen Skip");
{
  const fail = PRUEFUNG.lauf({ schritte: [schritt({ onMissingKey: "Fail" })], zuordnungen }, mappe, aufl);
  pruefe(fail.schritte[0].fehler === 2, "Fail: die Zeile ohne Schlüssel ist ein Fehler");

  const skip = PRUEFUNG.lauf({ schritte: [schritt({ onMissingKey: "Skip" })], zuordnungen }, mappe, aufl);
  gleich(skip.schritte[0].fehler, 1, "Skip: nur noch der Mehrfachtreffer ist ein Fehler");
  gleich(skip.schritte[0].uebersprungen, 2, "die Zeile ohne Schlüssel wird übersprungen");
  pruefe(skip.warnungen.some(w => /folgenden Schritte laufen weiter/.test(w.meldung)),
    "und die Warnung sagt, dass die Folgeschritte weiterlaufen");
}

console.log("\nLookupOnly – Konten werden nie angelegt");
{
  const s = schritt({ step: 10, entitySet: "opportunities", mode: "LookupOnly" });
  const r = PRUEFUNG.lauf({ schritte: [s], zuordnungen }, mappe, aufl);
  gleich(r.schritte[0].neu, 0, "LookupOnly legt nichts an");
  const f = r.ausschluesse.find(x => /nicht gefunden/.test(x.meldung));
  pruefe(!!f && f.zeile === 4, "der unbekannte Schlüssel wird gemeldet");
  pruefe(/der Lauf geht weiter/.test(f.meldung),
    "und zwar zeilenweise – eine unbekannte Nummer bricht nicht den ganzen Import ab (Review B3)");
  gleich(f.wert, 7000, "der gesuchte Wert steht dabei – bei „nicht gefunden\" IST er die Information");

  // Der Kern von Review B3: Ein nicht gefundener Datensatz ist ein
  // Ausschluss, KEIN Fehler. Zählte er als Fehler, bliebe der Import
  // gesperrt – und eine einzige unbekannte Nummer verhinderte wieder den
  // ganzen Lauf, genau wie beim Altflow.
  pruefe(!r.fehler.some(x => /nicht gefunden/.test(x.meldung)),
    "er steht NICHT in der Fehlerliste");
  gleich(r.schritte[0].ausgeschlossen, 1, "er zählt als ausgeschlossen");
}
{
  // Die Probe aufs Exempel: eine Mappe, deren einziges Problem eine
  // unbekannte Nummer ist. Sie darf den Import nicht sperren.
  const eine = { blaetter: [EXCEL.blattAus("Anfragen", [
    ["Opp-ID", "Thema", "Umsatz"],
    [6440, "geht durch",       150000],
    [7000, "gibt es nicht",    500]
  ])] };
  const s = schritt({ step: 10, entitySet: "opportunities", mode: "LookupOnly" });
  const r = PRUEFUNG.lauf({ schritte: [s], zuordnungen }, eine, aufl);
  gleich(r.gesamt.ausgeschlossen, 1, "eine Zeile fällt raus");
  gleich(r.gesamt.unveraendert, 1, "die andere läuft durch");
  gleich(r.gesamt.fehler, 0,
    "und der Import bleibt offen – eine unbekannte Nummer verhindert ihn nicht mehr (Review B3)");
}
{
  // Eine Spalte mit Quelle, aber ohne Zielfeld, ist Klartext für Meldungen.
  // Ohne sie steht im Bericht nur eine Nummer, und wer ihn liest, muss
  // zurück in die Datei, um zu sehen, welcher Fall gemeint ist.
  const zuMitKlartext = { OPP: [...zuordnungen.OPP,
    { aktiv: true, sourceColumn: "Thema", targetField: null, targetType: "String" }] };
  const s = schritt({ step: 10, mode: "LookupOnly" });
  const r = PRUEFUNG.lauf({ schritte: [s], zuordnungen: zuMitKlartext }, mappe, aufl);
  const f = r.ausschluesse.find(x => /nicht gefunden/.test(x.meldung));
  gleich(f.klartext, "gibt es noch nicht", "der Klartext der Zeile steht dabei");
}

console.log("\nAusschluss wirkt in den Folgeschritten");
{
  /* Der Kern von Review B3 - und die Probe darauf, dass die Vorschau
     stimmt: Faellt eine Zeile in Schritt 10 durch, darf der Prueflauf sie
     in Schritt 30 nicht als "neu" zaehlen. Taete er es, sagte er mehr
     voraus, als der Import tut, und die Zahl auf dem Schirm waere eine
     Luege. */
  const mappe2 = { blaetter: [
    EXCEL.blattAus("Anfragen", [
      ["Opp-ID", "Thema", "Umsatz"],
      [6440, "geht durch",    150000],
      [7000, "gibt es nicht", 500]
    ]),
    EXCEL.blattAus("Positionen", [
      ["Opp-ID", "Thema", "Umsatz"],
      [6440, "Position A", 10],
      [7000, "Position B", 20]
    ])
  ] };

  const kind = [
    { aktiv: true, sourceColumn: "Opp-ID", targetField: "opportunityid",
      targetType: "Lookup", lookupEntitySet: "opportunities",
      lookupKeyField: "new_dagextopid", writePolicy: "Always" },
    { aktiv: true, sourceColumn: "Thema", targetField: "name",
      targetType: "String", writePolicy: "Always" }
  ];

  const profil = {
    schritte: [
      schritt({ step: 10, mode: "LookupOnly" }),
      schritt({ step: 30, mode: "Upsert" }),
      schritt({ step: 40, sourceSheet: "Positionen", mappingKey: "KIND",
                mode: "ReplaceByParent", parentField: "opportunityid",
                alternateKey: "" })
    ],
    zuordnungen: { ...zuordnungen, KIND: kind }
  };

  const r = PRUEFUNG.lauf(profil, mappe2, aufl);
  const [s10, s30, s40] = r.schritte;

  gleich(s10.ausgeschlossen, 1, "Schritt 10 schliesst die unbekannte Zeile aus");
  gleich(s30.neu, 0, "Schritt 30 legt fuer sie NICHTS an");
  gleich(s30.uebersprungen, 1, "sondern ueberspringt sie");
  gleich(s30.aktualisiert, 1, "die andere Zeile laeuft durch");
  gleich(s40.uebersprungen, 1,
    "auch im Kindblatt - die Position haengt ueber Opp-ID an der ausgeschlossenen Zeile");
  gleich(s40.neu, 1, "die Position der guten Zeile entsteht");
  gleich(r.gesamt.fehler, 0, "und nichts davon sperrt den Import");
}

console.log("\nMehrfachtreffer entscheiden statt raten");
{
  // Die Auflösung muss das Id-Feld kennen, sonst ist ein Kandidat nicht
  // benennbar. Genau dafür wird es beim Auflösen mitgeholt.
  const auflMitId = {
    idFelder: new Map([["opportunities", "opportunityid"]]),
    abfragen: [{ entitySet: "opportunities", feld: "new_dagextopid",
                 mehrdeutig: [{ wert: "6443", anzahl: 2 }] }],
    treffer: new Map([["opportunities|new_dagextopid", new Map([
      ["6440", [{ new_dagextopid: 6440, statecode: 0, name: "Bestand unverändert", estimatedvalue: 150000 }]],
      ["6441", [{ new_dagextopid: 6441, statecode: 0, name: "alter Name", estimatedvalue: 1 }]],
      ["6442", [{ new_dagextopid: 6442, statecode: 2 }]],
      ["6443", [{ opportunityid: "aaa", new_dagextopid: 6443, statecode: 0, name: "Variante A" },
                { opportunityid: "bbb", new_dagextopid: 6443, statecode: 0, name: "Variante B" }]]
    ])]])
  };

  const offen = AUFLOESUNG.offeneEntscheidungen(auflMitId, new Map());
  gleich(offen.length, 1, "eine offene Entscheidung");
  gleich(offen[0].kandidaten.length, 2, "mit beiden Kandidaten zur Auswahl");
  gleich(offen[0].idFeld, "opportunityid",
    "das Id-Feld kommt aus der Auflösung, nicht aus dem Mengennamen");

  const ohne = PRUEFUNG.lauf({ schritte: [schritt()], zuordnungen }, mappe, auflMitId);
  pruefe(ohne.fehler.some(f => /Mehrfachtreffer/.test(f.meldung)),
    "ohne Entscheidung bleibt es ein Fehler");

  const mit = new Map([["opportunities|new_dagextopid|6443", "bbb"]]);
  const r = PRUEFUNG.lauf({ schritte: [schritt()], zuordnungen }, mappe, auflMitId, {}, mit);
  pruefe(!r.fehler.some(f => /Mehrfachtreffer/.test(f.meldung)),
    "mit Entscheidung ist der Fehler weg");
  pruefe(r.warnungen.some(w => /von Hand gewählte/.test(w.meldung)),
    "aber die Entscheidung wird protokolliert – sie verschwindet nicht spurlos");
  gleich(AUFLOESUNG.offeneEntscheidungen(auflMitId, mit).length, 0,
    "und gilt danach als beantwortet");

  const falsch = new Map([["opportunities|new_dagextopid|6443", "gibtsnicht"]]);
  const rf = PRUEFUNG.lauf({ schritte: [schritt()], zuordnungen }, mappe, auflMitId, {}, falsch);
  pruefe(rf.fehler.some(f => /Mehrfachtreffer/.test(f.meldung)),
    "eine Entscheidung auf einen unbekannten Datensatz zählt nicht – lieber Fehler als falsch");
}

console.log("\nStrukturfehler");
{
  const r = PRUEFUNG.lauf({ schritte: [schritt({ sourceSheet: "Gibtsnicht" })], zuordnungen }, mappe, aufl);
  pruefe(/gibt es in der Datei nicht/.test(r.schritte[0].strukturfehler || ""),
    "ein fehlendes Blatt wird als Strukturfehler gemeldet, nicht je Zeile");
}
{
  const r = PRUEFUNG.lauf({ schritte: [schritt({ aktiv: false })], zuordnungen }, mappe, aufl);
  pruefe(r.schritte[0].inaktiv === true && r.gesamt.neu === 0,
    "inaktive Schritte werden nicht gerechnet");
}

console.log("\nSkipOnValues - ausdruecklich ausgelassene Werte");
{
  /* Die Sammeladresse dummy@dihag.com soll keinen Kontakt erzeugen
     (docs/06). Ohne diese Regel legt der Import sie an wie jede andere -
     und verknuepft fremde Anfragen mit demselben Kontakt. */
  const m = { blaetter: [EXCEL.blattAus("Anfragen", [
    ["Opp-ID", "Thema", "Umsatz"],
    [6440, "normal",  150000],
    [6441, "sammel",  1]
  ])] };
  const s = schritt({ skipOnValues: { Thema: ["SAMMEL"] } });
  const r = PRUEFUNG.lauf({ schritte: [s], zuordnungen }, m, aufl);

  gleich(r.schritte[0].uebersprungen, 1, "die Zeile mit dem Wert wird ausgelassen");
  pruefe(r.warnungen.some(w => /SkipOnValues/.test(w.meldung)),
    "und das steht als Warnung im Bericht, nicht als stiller Verlust");
  gleich(r.gesamt.fehler, 0, "ein Auslassen ist kein Fehler");
  pruefe(!r.warnungen.some(w => w.zeile === 2 && /SkipOnValues/.test(w.meldung)),
    "die andere Zeile bleibt unberuehrt");
}

console.log("\nNicht scharf geschaltete Modi");
{
  /* Win/Loss ist fachlich zurueckgestellt: der Import ueberspringt
     CloseOpportunity. Zaehlte die Vorschau die Zeilen als "neu", kuendigte
     sie Datensaetze an, die nie entstehen - im echten Lauf waren das drei
     Dutzend. */
  const r = PRUEFUNG.lauf(
    { schritte: [schritt({ step: 60, mode: "CloseOpportunity" })], zuordnungen },
    mappe, aufl);
  gleich(r.schritte[0].neu, 0, "CloseOpportunity kuendigt nichts an");
  gleich(r.schritte[0].uebersprungen, 6, "sondern zaehlt alle Zeilen als uebersprungen");
  pruefe(r.warnungen.some(w => /nicht scharf geschaltet/.test(w.meldung)),
    "und sagt im Bericht, warum");
}

console.log("\nSetStage ohne Elternverweis");
{
  /* SetStage findet die Prozessinstanz ueber den Elternverweis. Fehlt er
     in der Konfiguration, ist keine Instanz zu finden - ein
     Konfigurationsfehler, der einmal in den Bericht gehoert und nicht
     stumm in die Spalte "uebersprungen". */
  const r = PRUEFUNG.lauf(
    { schritte: [schritt({ step: 50, mode: "SetStage" })], zuordnungen }, mappe, aufl);
  gleich(r.schritte[0].neu, 0, "SetStage legt nie etwas an");
  gleich(r.schritte[0].uebersprungen, 6, "ohne Elternverweis bleibt jede Zeile liegen");
  pruefe(r.warnungen.some(w => /SetStage braucht einen aufgelösten Verweis/.test(w.meldung)),
    "und der Bericht nennt den Grund");
}

console.log("\nErsetzen: die Vorschau sagt, was weggeraeumt wird");
{
  /* Beim zweiten Import derselben Datei stand im Bericht "87 neu" und
     nichts "unveraendert" - richtig, aber ohne Erklaerung irritierend. Der
     Bericht nennt jetzt die Zahl der Positionen, die dafuer weichen. */
  const m = { blaetter: [EXCEL.blattAus("Positionen", [
    ["Opp-ID", "Thema", "Umsatz"], [6440, "Position", 1]
  ])] };
  const auflMitKindern = {
    treffer: new Map([
      ["opportunities|new_dagextopid", aufl.treffer.get("opportunities|new_dagextopid")],
      ["opportunityproducts|_opportunityid_value", new Map([
        ["p-1", [{ x: 1 }, { x: 2 }]],
        ["p-2", [{ x: 3 }]]
      ])]
    ]),
    abfragen: [], idFelder: new Map()
  };
  const s = schritt({ step: 40, entitySet: "opportunityproducts",
    sourceSheet: "Positionen", mode: "ReplaceByParent",
    parentField: "opportunityid", alternateKey: "" });
  const r = PRUEFUNG.lauf({ schritte: [s], zuordnungen }, m, auflMitKindern);

  gleich(r.schritte[0].geloescht, 3, "drei vorhandene Positionen weichen");
  gleich(r.gesamt.geloescht, 3, "und stehen in der Bilanz");
  pruefe(/werden ersetzt/.test(PRUEFUNG.zusammenfassung(r.gesamt)),
    "der Satz sagt es auch");
}

console.log("\nUneindeutige Spalten aus einem anderen Blatt");
{
  /* Status, Preisliste und Mitarbeiter stehen im Blatt Positionen, gehoeren
     aber an die Verkaufschance. Der Import nimmt die erste passende Zeile -
     und sagte nichts, wenn die zweite etwas anderes sagt. Damit entscheidet
     die Zeilenreihenfolge einer Excel-Mappe ueber einen CRM-Wert. */
  const m = { blaetter: [EXCEL.blattAus("Positionen", [
    ["Opp-ID", "Status", "Preisliste"],
    [6440, "Check Feasibility", "Standard"],
    [6440, "Win",               "Standard"],   // Status uneindeutig
    [6441, "Win",               "Standard"],
    [6441, "Win",               ""],           // leer zaehlt nicht als Abweichung
    [6442, "Win",               "Standard"]
  ])] };
  const zu = [
    { aktiv: true, sourceColumn: "Status", sourceSheet: "Positionen",
      sourceLookupBy: "Opp-ID", targetField: "activestageid" },
    { aktiv: true, sourceColumn: "Preisliste", sourceSheet: "Positionen",
      sourceLookupBy: "Opp-ID", targetField: "pricelevelid" },
    // Ohne sourceSheet ist nichts zu vergleichen.
    { aktiv: true, sourceColumn: "Status", targetField: "irgendwas" }
  ];

  const f = PRUEFUNG.zusatzKonflikte(m, zu);
  gleich(f.length, 1, "nur die wirklich uneindeutige Spalte wird gemeldet");
  gleich(f[0].spalte, "Status", "und zwar Status");
  gleich(f[0].faelle.length, 1, "ein betroffener Schluessel");
  gleich(f[0].faelle[0].schluessel, "6440", "6440 - dort widersprechen sich die Zeilen");
  gleich(f[0].faelle[0].werte.sort(), ["Check Feasibility", "Win"],
    "beide Werte stehen in der Meldung, nicht nur der gewaehlte");

  const inaktiv = PRUEFUNG.zusatzKonflikte(m,
    zu.map(x => ({ ...x, aktiv: false })));
  gleich(inaktiv.length, 0, "inaktive Zuordnungen erzeugen keine Warnung");
}

console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen.\n` : "\nAlle Prüfungen bestanden.\n");
process.exit(fehler ? 1 : 0);
