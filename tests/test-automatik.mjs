/* Automatik – die drei Entscheidungen, die ohne Menschen fallen.
   ---------------------------------------------------------------------
   Geprüft wird hier auch etwas, das kein anderer Test abdeckt: dass sich
   ALLE Module kopflos laden lassen. Der Cron lädt genau dieselben Dateien
   wie der Browser; greift eine davon künftig auf `document` oder `window`
   zu, bricht der nächtliche Lauf – und niemand merkt es, bis eine Datei
   liegenbleibt. Dieser Test merkt es beim Push.                         */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = f => readFileSync(join(wurzel, f), "utf8");

let fehler = 0;
const pruefe = (b, t) => { console.log(`  ${b ? "ok  " : "FEHL"}  ${t}`); if (!b) fehler++; };
const gleich = (a, b, t) => pruefe(JSON.stringify(a) === JSON.stringify(b),
  `${t}${JSON.stringify(a) === JSON.stringify(b) ? "" : `  (erwartet ${JSON.stringify(b)}, war ${JSON.stringify(a)})`}`);

/* ── Alle Module in einem Geltungsbereich, wie im Cron ───────────────── */

const MODULE = ["config", "graph", "dataverse", "spFiles", "spListen", "excel",
                "transforms", "mapping", "aufloesung", "pruefung", "batch",
                "lauf", "automatik"];

function ladeAlles(zusatz = {}) {
  const speicher = new Map();
  const ss = {
    getItem: k => (speicher.has(k) ? speicher.get(k) : null),
    setItem: (k, v) => speicher.set(k, String(v)),
    removeItem: k => speicher.delete(k)
  };
  const quelle = MODULE.map(n => lies(`js/${n}.js`)).join("\n;\n");
  const f = new Function("AUTH", "sessionStorage", "XLSX", "console", "GRAPH_TEST",
    quelle + `; if (typeof GRAPH_TEST === "object" && GRAPH_TEST)
        for (const [k, v] of Object.entries(GRAPH_TEST)) GRAPH[k] = v;
      return { CRM_CONFIG, GRAPH, DV, SPFILES, SPLISTEN, EXCEL, TRANSFORMS,
               MAPPING, AUFLOESUNG, PRUEFUNG, BATCH, LAUF, AUTOMATIK };`);
  return f({ getToken: async () => "token" }, ss, {}, console, zusatz);
}

console.log("\nDer Cron lädt dieselben Dateien wie der Browser");
{
  const m = ladeAlles();
  for (const name of ["CRM_CONFIG", "GRAPH", "DV", "SPFILES", "SPLISTEN", "EXCEL",
                      "TRANSFORMS", "MAPPING", "AUFLOESUNG", "PRUEFUNG", "BATCH",
                      "LAUF", "AUTOMATIK"])
    pruefe(m[name] && typeof m[name] === "object", `${name} steht bereit`);

  /* Kein Modul darf beim LADEN nach document/window greifen. Innerhalb
     einer Funktion ist es erlaubt (js/excel.js lädt SheetJS so nach) –
     beim Laden nicht, sonst startet der Cron gar nicht erst. */
  pruefe(true, "kein Modul fasst beim Laden document oder window an");
}

console.log("\nLäuft die Automatik gerade?");
{
  const { AUTOMATIK: A } = ladeAlles();
  const S = { ...A.STANDARD, Aktiv: "ja" };
  // Mittwoch, 23.09.2026, 11:30 deutscher Zeit (09:30 UTC, Sommerzeit).
  const mittwochs = new Date("2026-09-23T09:30:00Z");

  gleich(A.deutscheZeit(mittwochs), { stunde: 11, tag: "Mi" },
    "gerechnet wird in deutscher Zeit, nicht in UTC");
  gleich(A.deutscheZeit(new Date("2026-01-14T09:30:00Z")), { stunde: 10, tag: "Mi" },
    "und im Winter eine Stunde anders – deshalb nicht fest verdrahtet");

  pruefe(A.faellig(S, mittwochs).ja, "eingeschaltet, Werktag, im Fenster → fällig");
  pruefe(!A.faellig({ ...S, Aktiv: "nein" }, mittwochs).ja, "ausgeschaltet → nichts");
  pruefe(!A.faellig(S, new Date("2026-09-26T09:30:00Z")).ja, "Samstag ist nicht Mo-Fr");
  pruefe(A.faellig({ ...S, Wochentage: "täglich" }, new Date("2026-09-26T09:30:00Z")).ja,
    "„täglich“ schliesst das Wochenende ein");
  pruefe(A.faellig({ ...S, Wochentage: "Mo,Mi,Fr" }, mittwochs).ja,
    "eine Aufzählung wird verstanden");
  pruefe(!A.faellig({ ...S, Wochentage: "Mo,Di" }, mittwochs).ja,
    "und schliesst den Mittwoch dann aus");
  pruefe(!A.faellig(S, new Date("2026-09-23T03:00:00Z")).ja,
    "5 Uhr liegt vor dem Fenster ab 6");
  pruefe(!A.faellig(S, new Date("2026-09-23T20:00:00Z")).ja,
    "22 Uhr liegt dahinter");

  // Takt: der Cron sieht alle 15 Minuten nach, arbeiten soll er seltener.
  const vor30 = new Date(mittwochs.getTime() - 30 * 60000).toISOString();
  pruefe(!A.faellig({ ...S, LetzterLauf: vor30 }, mittwochs).ja,
    "vor 30 min gelaufen, Takt 60 → noch nicht");
  pruefe(A.faellig({ ...S, LetzterLauf: vor30, TaktMinuten: "15" }, mittwochs).ja,
    "bei Takt 15 schon");
  pruefe(A.faellig({ ...S, LetzterLauf: "" }, mittwochs).ja,
    "leerer LetzterLauf erzwingt den nächsten Lauf – von Hand leerbar");
  pruefe(A.faellig({ ...S, LetzterLauf: "unsinn" }, mittwochs).ja,
    "ein unlesbarer Zeitstempel darf die Automatik nicht anhalten");

  // Jede Antwort trägt einen Grund. Ein Cron, der still nichts tut, ist von
  // einem kaputten Cron nicht zu unterscheiden.
  for (const w of [S, { ...S, Aktiv: "nein" }, { ...S, LetzterLauf: vor30 }])
    pruefe(A.faellig(w, mittwochs).grund.length > 10, "die Antwort nennt einen Grund");
}

console.log("\nDas Tor zum Import");
{
  const { AUTOMATIK: A } = ladeAlles();
  const sauber = { fehler: [], warnungen: [], schritte: [], gesamt: {} };
  const aufl = { abfragen: [], treffer: new Map() };

  pruefe(A.torschluss(sauber, aufl, new Map(), A.STANDARD).frei,
    "nichts zu fragen → Import ohne Freigabe");

  const mitFehler = { ...sauber, fehler: [{ meldung: "Schlüssel fehlt" }] };
  const t1 = A.torschluss(mitFehler, aufl, new Map(), A.STANDARD);
  pruefe(!t1.frei && /Schlüssel fehlt/.test(t1.gruende.join()),
    "ein Fehler im Prüflauf hält an und nennt den Grund");

  const struktur = { ...sauber, schritte: [{ strukturfehler: "Blatt „Positionen“ fehlt." }] };
  pruefe(!A.torschluss(struktur, aufl, new Map(), A.STANDARD).frei,
    "ein fehlendes Blatt hält an");

  const mitWarnung = { ...sauber, warnungen: [{ meldung: "Besitzer nicht gefunden" }] };
  pruefe(A.torschluss(mitWarnung, aufl, new Map(), A.STANDARD).frei,
    "eine Warnung hält standardmässig NICHT an – sonst wartet jede Datei");
  pruefe(!A.torschluss(mitWarnung, aufl, new Map(),
    { ...A.STANDARD, WarnungenBlockieren: "ja" }).frei,
    "wer das anders will, stellt es um");

  // Mehrdeutigkeit: genau der Fall, für den es die Freigabe gibt.
  const auflOffen = {
    abfragen: [{ entitySet: "accounts", feld: "name",
                 mehrdeutig: [{ wert: "Doppel GmbH", anzahl: 2 }], automatisch: [] }],
    treffer: new Map([["accounts|name", new Map([["doppel gmbh",
      [{ accountid: "a", statecode: 0 }, { accountid: "b", statecode: 0 }]]])]]),
    zustandsFelder: new Map([["accounts", "statecode"]])
  };
  const t2 = A.torschluss(sauber, auflOffen, new Map(), A.STANDARD);
  pruefe(!t2.frei, "eine offene Mehrdeutigkeit hält an");
  gleich(t2.offen.length, 1, "und wird als Frage weitergereicht");

  gleich(A.hatArbeit({ neu: 0, aktualisiert: 0, geloescht: 0 }), false,
    "nichts zu tun ist keine Arbeit");
  gleich(A.hatArbeit({ neu: 0, aktualisiert: 0, geloescht: 3 }), true,
    "ersetzte Positionen zählen mit");
}

console.log("\nDer Bericht");
{
  const { AUTOMATIK: A } = ladeAlles();
  const r = A.bericht([
    { art: "importiert", titel: "Anfragen.xlsx – importiert", zeilen: ["12 angelegt"] },
    { art: "freigabe", titel: "Alt.xlsx – Freigabe nötig", zeilen: ["2 offene Fragen"] }
  ], { appUrl: "https://crm.dihag.de/" });

  pruefe(/1 importiert/.test(r.betreff) && /1 wartet auf Freigabe/.test(r.betreff),
    "der Betreff sagt das Ergebnis, ohne dass man die Mail öffnet");
  pruefe(/TEST/.test(r.betreff), "und nennt die Umgebung – TEST und PROD sehen gleich aus");
  pruefe(/crm\.dihag\.de/.test(r.html), "der Weg ins Werkzeug steht drin");

  gleich(A.bericht([]).betreff, "CRM-Import TEST: nichts zu tun",
    "auch der leere Fall hat einen lesbaren Betreff");

  // 108-mal dieselbe Warnung ist EINE Zeile mit einer Zahl davor.
  const viele = Array.from({ length: 108 }, (_, i) => ({
    feld: "ownerid", meldung: "In systemusers nicht gefunden", wert: `u${i % 3}@dihag.com` }));
  const g = A.warnungsGruppen([...viele, { feld: "x", meldung: "anderes" }]);
  gleich(g.length, 2, "gleichartige Warnungen werden zusammengefasst");
  gleich(g[0].anzahl, 108, "mit ihrer Anzahl");
  pruefe(g[0].werte.size <= 5, "und höchstens fünf Beispielwerten");
}

console.log("\nEntscheidungen aus einem freigegebenen Vorgang");
{
  const { AUTOMATIK: A } = ladeAlles();
  const m = A.entscheidungenAus({ Decisions: '{"accounts|name|doppel gmbh":"guid-1"}' });
  gleich(m.get("accounts|name|doppel gmbh"), "guid-1", "die Auswahl kommt als Map zurück");
  gleich(A.entscheidungenAus({ Decisions: "{kaputt" }).size, 0,
    "kaputtes JSON heisst keine Entscheidung, nicht Absturz");
  gleich(A.entscheidungenAus(null).size, 0, "und ein fehlender Vorgang auch nicht");
}

console.log("\nStichtag — der Quellordner ist ein Archiv, kein Eingang");
{
  /* Am 23.09.2026 lagen im Ordner 71 Mappen zurück bis Mai 2025, 66 davon
     ohne Importvermerk. Ohne Stichtag hätte der erste eingeschaltete Lauf
     begonnen, sechzehn Monate Altbestand nachzuimportieren — jede Datei
     mit dem Stand von damals über dem Stand von heute. */
  const { AUTOMATIK: A } = ladeAlles();
  const S = { ...A.STANDARD, AbDatum: "2026-09-23" };

  pruefe(!A.nachStichtag("2026-08-13T10:00:00Z", S), "eine Mappe von August bleibt liegen");
  pruefe(A.nachStichtag("2026-09-23T05:00:00Z", S), "eine von heute wird genommen");
  pruefe(A.nachStichtag("2026-09-24T05:00:00Z", S), "eine von morgen erst recht");
  pruefe(A.nachStichtag("2025-05-01T00:00:00Z", A.STANDARD),
    "ohne Stichtag zählt jede — wer den Altbestand will, soll ihn bekommen");
  pruefe(A.nachStichtag("2025-05-01T00:00:00Z", { ...S, AbDatum: "übermorgen" }),
    "ein unlesbarer Stichtag sperrt nicht aus, sonst bliebe alles liegen");
  pruefe(A.nachStichtag("", S),
    "ohne Änderungsdatum wird geprüft statt stillschweigend übersprungen");
}

console.log("\nDerselbe Grund steht einmal da, nicht fünfmal");
{
  /* „Blatt ‚Anfragen‘ gibt es in der Datei nicht" meldet jeder Schritt
     einzeln. Im echten Probelauf standen fünf gleiche Sätze in einer
     Zeile — lesbar ist das nicht. */
  const { AUTOMATIK: A } = ladeAlles();
  const t = A.torschluss(
    { fehler: [], warnungen: [], schritte: [
      { strukturfehler: "Blatt „Anfragen“ gibt es in der Datei nicht." },
      { strukturfehler: "Blatt „Anfragen“ gibt es in der Datei nicht." },
      { strukturfehler: "Blatt „Positionen“ gibt es in der Datei nicht." }] },
    { abfragen: [], treffer: new Map() }, new Map(), A.STANDARD);
  gleich(t.gruende.length, 2, "aus drei Meldungen werden zwei Gründe");
  pruefe(!t.frei, "und angehalten wird trotzdem");
}

console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen.\n` : "\nAlle Prüfungen bestanden.\n");
process.exit(fehler ? 1 : 0);
