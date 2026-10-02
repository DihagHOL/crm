/* Die Prozessmodelle gegen das Hausschema des RMS.
   ---------------------------------------------------------------------
   Die Regeln stehen nicht hier, sondern im RMS: `js/prozessschema.js`,
   Regeln R1–R10. Dieser Test prüft dieselben Regeln an den erzeugten
   Dateien, BEVOR sie dort landen — sonst merkt man einen Verstoss erst
   beim Import, wenn das Modell schon verteilt ist.

   Geprüft wird die ERZEUGTE Datei, nicht die Absicht im Generator. Ein
   Layoutfehler (Knoten ohne Form, Kante ins Leere) macht ein Modell
   unlesbar, ohne dass an der Quelle etwas falsch aussieht.           */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = f => readFileSync(join(wurzel, f), "utf8");

let fehler = 0;
const pruefe = (b, t) => { console.log(`  ${b ? "ok  " : "FEHL"}  ${t}`); if (!b) fehler++; };
const gleich = (a, b, t) => pruefe(JSON.stringify(a) === JSON.stringify(b),
  `${t}${JSON.stringify(a) === JSON.stringify(b) ? "" : `  (erwartet ${JSON.stringify(b)}, war ${JSON.stringify(a)})`}`);

/* ── Lesen: dieselben Ausdrücke wie der Prüfer im RMS ────────────────── */

const KNOTEN_RE = /<bpmn:(startEvent|endEvent|userTask|serviceTask|manualTask|task|scriptTask|sendTask|receiveTask|businessRuleTask|exclusiveGateway|parallelGateway|inclusiveGateway|intermediateCatchEvent|intermediateThrowEvent|subProcess|callActivity)\b([^>]*)>/g;
const attr = (roh, name) => (new RegExp(name + '="([^"]*)"').exec(roh || "") || [])[1] || "";

function lesen(xml) {
  const knoten = [];
  KNOTEN_RE.lastIndex = 0;
  let m;
  while ((m = KNOTEN_RE.exec(xml)))
    knoten.push({ typ: m[1], id: attr(m[2], "id"), name: attr(m[2], "name"),
                  roh: m[2] });
  const fluesse = [...xml.matchAll(/<bpmn:sequenceFlow\b([^>]*)>/g)].map(x => ({
    id: attr(x[1], "id"), von: attr(x[1], "sourceRef"),
    nach: attr(x[1], "targetRef"), name: attr(x[1], "name") }));
  const bahnen = [...xml.matchAll(/<bpmn:lane\b([^>]*)>([\s\S]*?)<\/bpmn:lane>/g)].map(x => ({
    id: attr(x[1], "id"), name: attr(x[1], "name"),
    knoten: [...x[2].matchAll(/<bpmn:flowNodeRef>([^<]+)<\/bpmn:flowNodeRef>/g)].map(y => y[1]) }));
  const doku = (xml.match(/<bpmn:documentation>([\s\S]*?)<\/bpmn:documentation>/) || [])[1] || "";
  return { knoten, fluesse, bahnen, doku };
}

const liste = JSON.parse(lies("docs/bpmn/modelle.json"));

console.log("\nDie Modell-Liste beschreibt, was da ist");
{
  gleich(liste.modelle.length, 4, "vier Modelle: Übernahme, Import, Freigabe, Eingang");
  pruefe(liste.rms.url === "https://rms.dihag.de",
    "sie zeigt auf das RMS — dort sind die Modelle führend");
  for (const m of liste.modelle)
    pruefe(existsSync(join(wurzel, m.datei)), `${m.key}: die Datei ${m.datei} liegt im Repository`);

  // Eine Aufrufaktivität zeigt auf ein Modell, das es gibt (R10).
  const kennungen = new Set(liste.modelle.map(m => m.kennung));
  gleich(kennungen.size, liste.modelle.length, "jede Prozess-Kennung kommt genau einmal vor");
  for (const m of liste.modelle)
    for (const u of m.unter)
      pruefe(liste.modelle.some(x => x.key === u), `${m.key} bindet „${u}" ein, und das Modell gibt es`);
}

for (const modell of liste.modelle) {
  const xml = lies(modell.datei);
  const { knoten, fluesse, bahnen, doku } = lesen(xml);
  console.log(`\n${modell.name}  (${modell.datei})`);

  /* R1 – genau ein Auslöser. Zwei Startpunkte heissen: es sind zwei Prozesse.
     Genau daran entscheidet sich, dass die Eingangsüberwachung ein eigenes
     Modell ist und kein Zweig im Hauptprozess. */
  gleich(knoten.filter(k => k.typ === "startEvent").length, 1, "R1 genau ein Auslöser");

  // R2 – mindestens ein Ergebnis, und jedes benannt.
  const enden = knoten.filter(k => k.typ === "endEvent");
  pruefe(enden.length >= 1, "R2 mindestens ein Ergebnis");
  pruefe(enden.every(k => k.name.trim()), "R2 jedes Ergebnis ist benannt");

  // R3 – keine nackte Aufgabe: jede ist Mensch, System oder Handgriff.
  pruefe(!knoten.some(k => k.typ === "task"), "R3 keine Aufgabe ohne Typ");
  pruefe(!knoten.some(k => ["scriptTask", "sendTask", "receiveTask", "businessRuleTask"]
    .includes(k.typ)), "R3 nur die drei Aufgabenarten des Hausschemas");

  // R4 – jeder Knoten liegt in genau einer Bahn, sonst hat „wer ist
  // zuständig" keine Antwort.
  const zuordnung = new Map();
  for (const b of bahnen) for (const id of b.knoten)
    zuordnung.set(id, (zuordnung.get(id) || 0) + 1);
  const ohneBahn = knoten.filter(k => !zuordnung.has(k.id)).map(k => k.id);
  gleich(ohneBahn, [], "R4 kein Knoten ohne Bahn");
  gleich([...zuordnung].filter(([, n]) => n > 1).map(([id]) => id), [],
    "R4 kein Knoten in zwei Bahnen");

  // R5 – Bahnen tragen Rollen, keine Personen. Eine Mailadresse ist der
  // häufigste Verstoss: „ticket@dihag.com" ist ein Postfach, die Rolle
  // heisst IT-Service Desk.
  pruefe(bahnen.every(b => b.name.trim()), "R5 jede Bahn ist benannt");
  pruefe(!bahnen.some(b => /@/.test(b.name)), "R5 keine Mailadresse als Bahn");

  // R6 – jede Entscheidung ist eine Frage mit beschrifteten Ausgängen.
  const tore = knoten.filter(k => k.typ === "exclusiveGateway");
  for (const t of tore) {
    const raus = fluesse.filter(f => f.von === t.id);
    pruefe(raus.length >= 2, `R6 „${t.name}" hat mindestens zwei Ausgänge`);
    pruefe(raus.every(f => f.name.trim()), `R6 jeder Ausgang von „${t.name}" ist beschriftet`);
    pruefe(/\?$/.test(t.name.trim()), `R6/R8 „${t.name}" ist eine Frage`);
  }

  // R7 – nichts hängt lose.
  const hatEin = new Set(fluesse.map(f => f.nach));
  const hatAus = new Set(fluesse.map(f => f.von));
  gleich(knoten.filter(k => k.typ !== "startEvent" && !hatEin.has(k.id)).map(k => k.id), [],
    "R7 jeder Knoten hat einen Eingang");
  gleich(knoten.filter(k => k.typ !== "endEvent" && !hatAus.has(k.id)).map(k => k.id), [],
    "R7 jeder Knoten hat einen Ausgang");

  // R8 – Aufgaben beginnen mit einem Verb; geprüft wird das Ende, weil im
  // Deutschen der Infinitiv hinten steht. „Rechnung prüfen", nicht
  // „Rechnungsprüfung".
  const aufgaben = knoten.filter(k => /Task$|callActivity/.test(k.typ));
  for (const a of aufgaben) {
    const nm = a.name.replace(/\s*\([^)]*\)\s*$/, "").trim();
    pruefe(/\w+e?n$/.test(nm) || /n$/.test(nm), `R8 „${a.name}" endet auf einem Verb`);
  }

  // R9 – der Prozess nennt mindestens eine Richtlinie, und zwar so, wie das
  // RMS es selbst schreibt. Ohne den Marker ginge die Verknüpfung beim
  // ersten Speichern im RMS verloren.
  const marker = (doku.match(/\[\[rms:policies=([^\]]+)\]\]/) || [])[1] || "";
  pruefe(marker.split(",").filter(Boolean).length >= 1, "R9 mindestens eine Richtlinie verknüpft");
  gleich(marker.split(",").filter(Boolean), modell.policies,
    "R9 die Liste in der Datei und die in modelle.json sind dieselbe");

  // R10 – ein Unterprozess wird eingebunden, nicht abgeschrieben.
  const aufrufe = knoten.filter(k => k.typ === "callActivity");
  gleich(aufrufe.length, modell.unter.length, "R10 so viele Aufrufe wie eingebundene Modelle");
  for (const a of aufrufe) {
    const ziel = attr(a.roh, "calledElement");
    pruefe(liste.modelle.some(m => m.kennung === ziel),
      `R10 „${a.name}" zeigt auf ein Modell, das es gibt (${ziel})`);
  }
  pruefe(!knoten.some(k => k.typ === "subProcess"),
    "R10 kein ausgeschriebener Unterprozess");

  /* ── Das Bild: jedes Element hat eine Form, jede Kante einen Verlauf ──
     Ein Modell ohne DI öffnet im RMS als leere Fläche. Das fällt sonst
     erst dort auf, und zwar dem, der es gerade braucht. */
  for (const k of knoten)
    pruefe(xml.includes(`bpmnElement="${k.id}"`), `Bild: „${k.name || k.id}" hat eine Form`);
  for (const f of fluesse)
    pruefe(xml.includes(`bpmnElement="${f.id}"`), `Bild: Kante ${f.id} hat einen Verlauf`);
  const formen = [...xml.matchAll(/<bpmndi:BPMNShape\b[^>]*bpmnElement="([^"]+)"/g)].map(x => x[1]);
  gleich(formen.length, new Set(formen).size, "Bild: keine doppelte Form");

  // Der Weg zurück in die Anwendung gehört in die Dokumentation – wer das
  // Modell im RMS öffnet, soll die Anwender-Ansicht finden.
  pruefe(doku.includes(`https://crm.dihag.de/prozess.html#${modell.tab}`),
    "die Dokumentation nennt die Anwender-Ansicht");
}

console.log("\nDie Seite zeigt, was die Liste nennt");
{
  const html = lies("prozess.html");

  /* Die Seite fuehrt KEINE eigene Liste der Modelle: Reiter, Namen und
     Dateipfade kommen aus modelle.json. Deshalb wird hier nicht nach
     Modellnamen gesucht, sondern danach, dass die Seite sie von dort
     nimmt - ein abgeschriebener Name waere beim naechsten Umbau falsch,
     ohne dass irgendetwas rot wird. */
  pruefe(html.includes("docs/bpmn/modelle.json"),
    "prozess.html liest die Modell-Liste statt eigene Namen zu führen");
  pruefe(html.includes("data-tab=") && html.includes(".haupt"),
    "prozess.html baut die Reiter aus den Hauptprozessen der Liste");
  pruefe(html.includes("m.datei"), "prozess.html lädt die Datei aus der Liste");
  pruefe(html.includes("?modell=") && html.includes("?richtlinie="),
    "prozess.html verlinkt Modell und Regelwerk im RMS");
  pruefe(html.includes("rms.dihag.de"), "prozess.html verweist auf das RMS");
  for (const id of new Set(liste.modelle.flatMap(m => m.policies)))
    pruefe(html.includes(`richtlinie=${id}`),
      `prozess.html verlinkt die Richtlinie ${id} im RMS`);
}

console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen.\n` : "\nAlle Prüfungen bestanden.\n");
process.exit(fehler ? 1 : 0);
