"use strict";

/* Arbeitsmappe lesen – SheetJS-Kapsel.

   Zwei Dinge macht diese Datei, die der Altflow nicht macht und die ihn
   Daten kosten:

   1. KOPFZEILEN NORMALISIEREN. In der echten Datei heißen zwei Spalten
      „Breite (mm) “ und „Höhe (mm) “ – mit Leerzeichen am Ende. Ein exakter
      Vergleich träfe nie, und der Wert ginge stillschweigend verloren
      (Datenanalyse §2, Randbedingung 11). Die Zuordnung arbeitet deshalb
      gegen die normalisierte Fassung, und der Prüfbericht meldet, welche
      Kopfzeile angefasst werden musste – dann weiß man, dass die Vorlage
      unsauber ist, ohne dass der Import daran scheitert.

   2. DIE ECHTE EXCEL-ZEILENNUMMER MITFÜHREN. Jede Zeile trägt `_zeile` –
      die Nummer, wie sie in Excel links steht, inklusive Kopfzeile. Nicht
      den nullbasierten Index. „Fehler bei Datensatz 4711“ hilft niemandem,
      wenn in der Datei Zeile 4713 steht.                                  */

const EXCEL = (() => {

  /* ── SheetJS bei Bedarf nachladen ─────────────────────────────────────
     Rund 900 KB, die beim Start niemand braucht. Version fest gepinnt –
     dasselbe Muster wie in bedarfsanfrage.                              */

  /* Vom Hersteller, nicht von npm. Das npm-Paket `xlsx` wird nicht mehr
     gepflegt und steht bei 0.18.5; darauf liegen zwei geprüfte Meldungen:
     CVE-2023-30533 (Prototype Pollution **beim Lesen fremder Dateien**,
     behoben in 0.19.3) und CVE-2024-22363 (ReDoS, behoben in 0.20.2).
     Genau das Gefährliche tut diese App: sie liest fremde Dateien. Die
     behobenen Fassungen gibt es nur auf cdn.sheetjs.com, und dort ist
     0.20.3 die neueste (nachgesehen am 04.11.2026). */
  const CDN = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";

  /* Bytegenau festgenagelt, nicht nur die Versionsnummer.
     Eine gepinnte Version sagt, WAS geladen werden soll; sie sagt nicht,
     dass es das auch ist. Ohne `integrity` liefert jede Änderung am CDN
     beliebiges Skript in den Origin dieser App — und dort liegen die Token
     für Graph und Dataverse (§11). Mit `integrity` verwirft der Browser die
     Datei, wenn sie nicht genau diese ist, und die Oberfläche meldet
     stattdessen einen Ladefehler.

     Gerechnet am 04.11.2026 über die 951.904 Bytes von xlsx 0.20.3, zweimal
     unabhängig abgerufen. Wer die Version wechselt, muss den Hash neu
     rechnen, sonst lädt der Browser gar nichts mehr:
       curl -sL <URL> | openssl dgst -sha384 -binary | openssl base64 -A   */
  const CDN_HASH = "sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT";
  let _laden = null;

  function ensureSheetJS() {
    if (typeof XLSX !== "undefined") return Promise.resolve();
    if (_laden) return _laden;
    _laden = new Promise((ok, fehl) => {
      const s = document.createElement("script");
      s.src = CDN;
      s.integrity = CDN_HASH;
      s.crossOrigin = "anonymous";   // ohne CORS prueft der Browser nicht
      s.onload = () => ok();
      s.onerror = () => {
        _laden = null;
        fehl(new Error("SheetJS konnte nicht geladen werden. Ohne die Bibliothek "
          + "lässt sich keine Excel-Datei öffnen – Netzwerk oder Inhaltsrichtlinie prüfen."));
      };
      document.head.appendChild(s);
    });
    return _laden;
  }

  /* ── Kopfzeilen ───────────────────────────────────────────────────── */

  /** Außen trimmen, innen Mehrfach-Leerzeichen zusammenziehen, geschützte
   *  Leerzeichen wie normale behandeln. Groß-/Kleinschreibung bleibt: die
   *  Zuordnung soll lesbar bleiben, und in der Praxis weicht sie nicht ab. */
  const normKopf = s => String(s ?? "")
    .replace(/\u00A0/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  /* ── Lesen ────────────────────────────────────────────────────────── */

  /**
   * @param {ArrayBuffer} buffer
   * @returns {Promise<{blaetter: Array<{
   *   name: string,
   *   kopfzeilen: string[],
   *   normalisiert: Array<{roh:string, normal:string}>,
   *   doppelt: string[],
   *   zeilen: Array<object>,
   *   anzahl: number
   * }>}>}
   */
  /** Ein Blatt aus der Rohform (Array von Zeilen-Arrays, wie SheetJS sie mit
   *  `header: 1` liefert). Bewusst ohne SheetJS und ohne Browser – so lässt
   *  sich der heikelste Teil unter Node testen (tests/test-excel.mjs). */
  function blattAus(name, roh) {
    if (!roh || !roh.length)
      return { name, kopfzeilen: [], normalisiert: [], doppelt: [], zeilen: [], anzahl: 0 };

    const kopfRoh = (roh[0] || []).map(v => String(v ?? ""));
    const kopf = kopfRoh.map(normKopf);

    // Welche Kopfzeile musste angefasst werden? Gehört in den Prüfbericht.
    const normalisiert = [];
    kopfRoh.forEach((r, i) => {
      if (r !== kopf[i] && kopf[i]) normalisiert.push({ roh: r, normal: kopf[i] });
    });

    // Zwei gleich benannte Spalten: die zweite überschriebe die erste
    // stillschweigend. Lieber melden.
    const gesehen = new Set(), doppelt = [];
    for (const k of kopf) {
      if (!k) continue;
      if (gesehen.has(k) && !doppelt.includes(k)) doppelt.push(k);
      gesehen.add(k);
    }

    const zeilen = [];
    for (let i = 1; i < roh.length; i++) {
      const r = roh[i] || [];
      // Vollständig leere Zeilen überspringen – aber die Zeilennummer NICHT
      // verschieben. Sonst zeigt der Fehlerbericht auf die falsche Zeile,
      // und das ist der Fehler, der Fachanwender am meisten Zeit kostet.
      if (r.every(v => v === null || v === undefined || v === "")) continue;
      const o = { _zeile: i + 1 };   // +1: die Kopfzeile ist Excel-Zeile 1
      kopf.forEach((k, s) => { if (k) o[k] = r[s] ?? null; });
      zeilen.push(o);
    }

    return { name, kopfzeilen: kopf.filter(Boolean), normalisiert, doppelt,
             zeilen, anzahl: zeilen.length };
  }

  async function lesen(buffer) {
    await ensureSheetJS();

    // cellDates: Excel-Datumsserienzahlen kommen als Date zurück, nicht als
    // 45678. Ohne das landet im CRM eine Zahl.
    const wb = XLSX.read(buffer, { type: "array", cellDates: true });

    // blankrows: true ist wichtig – nur dann bleibt eine leere Zeile im
    // Array erhalten und die Zeilennummern der folgenden stimmen weiter.
    const blaetter = wb.SheetNames.map(name => blattAus(name,
      XLSX.utils.sheet_to_json(wb.Sheets[name], {
        header: 1, raw: true, defval: null, blankrows: true
      })));

    return { blaetter };
  }

  /** Blatt nach Namen, ohne Rücksicht auf Groß-/Kleinschreibung. */
  const blatt = (mappe, name) =>
    mappe.blaetter.find(b => b.name.toLowerCase() === String(name).toLowerCase()) || null;

  return { lesen, blatt, blattAus, ensureSheetJS, normKopf };
})();
