/* Umwandlungen – die Stelle, an der aus einer Excel-Zelle ein CRM-Wert wird.
   -------------------------------------------------------------------------
   Hier entscheidet sich, ob 84,2 € als 84.2 oder als 842 im CRM landet und
   ob aus dem 01.03.2025 der 28.02.2025 wird. Beides fällt in der Oberfläche
   nicht auf, sondern erst in einer Auswertung Monate später.

   Die Fälle stammen aus docs/06 (echte Datei) und aus CLAUDE.md §7.       */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = new Function(readFileSync(join(wurzel, "js/transforms.js"), "utf8")
  + "; return TRANSFORMS;")();

let fehler = 0;
const pruefe = (b, t) => { console.log(`  ${b ? "ok  " : "FEHL"}  ${t}`); if (!b) fehler++; };
const w = (wert, kette) => T.anwenden(wert, kette).wert;
const gleich = (a, b, t) => pruefe(Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b),
  `${t}${Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b) ? "" : `  (erwartet ${JSON.stringify(b)}, war ${JSON.stringify(a)})`}`);

console.log("\nDeutsche Zahlen");
gleich(w("1.234,56", "decimal:de"), 1234.56, "Punkt ist Tausender, Komma ist Dezimal");
gleich(w("84,2", "decimal:de"), 84.2, "einfache Dezimalzahl");
gleich(w(84.2, "decimal:de"), 84.2, "Excel liefert oft schon eine Zahl – unverändert");
gleich(w("0", "decimal:de"), 0, "Null bleibt Null");
gleich(w("keine Zahl", "decimal:de"), "keine Zahl",
  "Unlesbares behält den Originalwert – die Validierung meldet es, statt still 0 zu schreiben");
gleich(w(null, "decimal:de"), null, "null bleibt null");

console.log("\nDatum");
gleich(w(new Date(2026, 2, 1), "date:auto"), "2026-03-01",
  "Date wird OHNE Zeitzonenumrechnung formatiert – sonst wird aus dem 01.03. der 28.02.");
gleich(w("15.11.2026", "date:auto"), "2026-11-15", "deutsches Datum");
gleich(w("1.3.2025", "date:auto"), "2025-03-01", "einstellige Tage und Monate");
gleich(w("2026-11-15", "date:auto"), "2026-11-15", "ISO bleibt ISO");
gleich(w("irgendwas", "date:auto"), "irgendwas", "Unlesbares bleibt stehen");

console.log("\nLeer, null und die Null");
gleich(w("", "empty2null"), null, "Leerstring wird null – sonst überschreibt er ein Feld mit \"\"");
gleich(w(0, "zero2null"), null, "0 bei den Maßen heißt \"nicht erfasst\" (Datenanalyse 8)");
gleich(w("0", "zero2null"), null, "auch die Text-Null");
gleich(w(120, "zero2null"), 120, "echte Werte bleiben");
gleich(w("", "zero2null"), "", "Leerstring ist keine Null – dafür ist empty2null da");

console.log("\nText");
gleich(w("  Erwin  ", "trim"), "Erwin", "Leerzeichen außen weg (65 von 72 Zeilen betroffen)");
gleich(w(" A.Meier@Kunde.DE ", "trim|lower"), "a.meier@kunde.de",
  "Kette: erst trimmen, dann kleinschreiben – Pflicht beim Schlüsselfeld E-Mail");
gleich(w("hans müller", "title"), "Hans Müller", "Titelschreibweise");
gleich(w("abcdefghij", "truncate:4"), "abcd", "harte Kürzung");
gleich(w("Nr. 4711-A", "digits"), "4711", "nur Ziffern");
gleich(w(6440, "digits"), 6440, "Zahl bleibt Zahl");

console.log("\nWahrheitswerte und Telefon");
gleich(w("ja", "bool:ja/nein"), true, "ja");
gleich(w("Nein", "bool:ja/nein"), false, "nein, Groß-/Kleinschreibung egal");
gleich(w("vielleicht", "bool:ja/nein"), "vielleicht", "Unbekanntes bleibt stehen statt false zu werden");
gleich(w("0221 12345", "phone:DE"), "+4922112345", "führende 0 wird +49");
gleich(w("0049 221 12345", "phone:DE"), "+4922112345", "00 wird +");

console.log("\nUnbekannte Regeln fallen auf");
{
  const r = T.anwenden("x", "trim|gibtsnicht|lower");
  gleich(r.wert, "x", "die bekannten Regeln laufen trotzdem");
  gleich(r.unbekannt, ["gibtsnicht"],
    "der Tippfehler wird gemeldet statt still zu wirken");
}
{
  const r = T.anwenden(" A ", "trim|lower");
  gleich(r.unbekannt, [], "saubere Kette meldet nichts");
}

console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen.\n` : "\nAlle Prüfungen bestanden.\n");
process.exit(fehler ? 1 : 0);
