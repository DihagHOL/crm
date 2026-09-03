/* Batch-Aufbau und -Auswertung.
   -----------------------------
   Ein falsch zusammengesetzter Batch scheitert nicht mit einer nützlichen
   Meldung, sondern mit einem 400 ohne Hinweis darauf, welche der 100 Zeilen
   schuld ist. Deshalb wird das Format hier geprüft, nicht im Betrieb.     */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { webcrypto } from "node:crypto";

const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");
const g = { crypto: webcrypto, console };
const BATCH = new Function(...Object.keys(g),
  readFileSync(join(wurzel, "js/batch.js"), "utf8") + "; return BATCH;")(...Object.values(g));

let fehler = 0;
const pruefe = (b, t) => { console.log(`  ${b ? "ok  " : "FEHL"}  ${t}`); if (!b) fehler++; };
const gleich = (a, b, t) => pruefe(JSON.stringify(a) === JSON.stringify(b),
  `${t}${JSON.stringify(a) === JSON.stringify(b) ? "" : `  (erwartet ${JSON.stringify(b)}, war ${JSON.stringify(a)})`}`);

console.log("\nAufbau: eigenständige Anfragen");
{
  const s = BATCH.baue([
    { methode: "PATCH", url: "https://x/api/data/v9.2/accounts(dag_dihag_kdnr=1)",
      koerper: { name: "A" } },
    { methode: "POST", url: "https://x/api/data/v9.2/contacts", koerper: { lastname: "B" } }
  ], "batch_TEST");

  pruefe(s.startsWith("--batch_TEST\r\n"), "beginnt mit der Grenze");
  pruefe(s.endsWith("--batch_TEST--\r\n"), "endet mit der Schlussgrenze");
  pruefe(/\r\n/.test(s) && !/[^\r]\n/.test(s), "durchgehend CRLF – LF allein wird abgelehnt");
  gleich((s.match(/Content-Type: application\/http/g) || []).length, 2, "zwei Teile");
  pruefe(/PATCH https:\/\/x\/api\/data\/v9\.2\/accounts\(dag_dihag_kdnr=1\) HTTP\/1\.1/.test(s),
    "Methode, Adresse und Protokollversion in einer Zeile");
  pruefe(/Content-ID: 1[\s\S]*Content-ID: 2/.test(s), "Content-ID wird hochgezählt");
  pruefe(s.includes('{"name":"A"}'), "Rumpf als JSON");
}

console.log("\nAufbau: Changeset (die Ausnahme, Befund B3)");
{
  const s = BATCH.baue([
    { changeset: [
      { methode: "DELETE", url: "https://x/api/data/v9.2/opportunityproducts(aaa)" },
      { methode: "POST", url: "https://x/api/data/v9.2/opportunityproducts",
        koerper: { lineitemnumber: 1 } }
    ] }
  ], "batch_TEST");

  pruefe(/Content-Type: multipart\/mixed; boundary=changeset_/.test(s),
    "verschachtelte Grenze für die Transaktion");
  pruefe(/--changeset_[^\s]+--/.test(s), "Changeset wird geschlossen");
  gleich((s.match(/HTTP\/1\.1/g) || []).length, 2, "beide Anfragen im selben Changeset");
  pruefe(s.indexOf("DELETE") < s.indexOf("POST"),
    "erst löschen, dann anlegen – und das atomar, sonst sind die Positionen weg");
}
{
  const s = BATCH.baue([{ methode: "DELETE", url: "https://x/a(1)" }], "b");
  pruefe(!s.includes("Content-Type: application/json"),
    "DELETE ohne Rumpf bekommt keinen Content-Type");
}

console.log("\nAuswertung");
{
  const antwort = [
    "--batchresponse_1", "Content-Type: application/http", "", "HTTP/1.1 204 No Content",
    "OData-Version: 4.0", "", "",
    "--batchresponse_1", "Content-Type: application/http", "", "HTTP/1.1 201 Created",
    "OData-EntityId: https://x/api/data/v9.2/contacts(1111)", "", "",
    "--batchresponse_1", "Content-Type: application/http", "", "HTTP/1.1 400 Bad Request",
    "Content-Type: application/json", "",
    '{"error":{"code":"0x80040265","message":"Feld zu lang"}}', "",
    "--batchresponse_1--"
  ].join("\r\n");

  const r = BATCH.lese(antwort);
  gleich(r.length, 3, "drei Antworten, in der Reihenfolge der Anfragen");
  gleich(r.map(x => x.status), [204, 201, 400], "Statuscodes");
  gleich(r[1].ort, "https://x/api/data/v9.2/contacts(1111)",
    "die Adresse des neuen Datensatzes – ohne sie kein Protokolleintrag");
  gleich(BATCH.fehlertext(r[2]), "0x80040265: Feld zu lang",
    "der Fehlertext kommt aus dem Rumpf, nicht nur der Statuscode");
  pruefe(BATCH.erfolg(204) && BATCH.erfolg(201) && !BATCH.erfolg(400),
    "204 und 201 sind Erfolg – Upsert per PATCH antwortet mit 204");
}
{
  const r = BATCH.lese("");
  gleich(r, [], "leere Antwort ergibt keine Ergebnisse statt eines Absturzes");
}
{
  // Changeset-Antworten sind verschachtelt – die Teile darin müssen einzeln
  // erkannt werden, sonst zeigt jeder Protokolleintrag auf die falsche Zeile.
  const antwort = [
    "--batchresponse_1",
    "Content-Type: multipart/mixed; boundary=changesetresponse_9", "",
    "--changesetresponse_9", "Content-Type: application/http", "", "HTTP/1.1 204 No Content", "", "",
    "--changesetresponse_9", "Content-Type: application/http", "", "HTTP/1.1 204 No Content", "", "",
    "--changesetresponse_9--",
    "--batchresponse_1--"
  ].join("\r\n");
  gleich(BATCH.lese(antwort).map(x => x.status), [204, 204],
    "beide Teile eines Changesets werden einzeln gelesen");
}

console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen.\n` : "\nAlle Prüfungen bestanden.\n");
process.exit(fehler ? 1 : 0);
