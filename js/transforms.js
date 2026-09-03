"use strict";

/* Umwandlungen – aus einem Zellwert wird ein Wert für Dataverse.

   Die Kette steht je Feld in `CRM_FieldMappings.Transform`, mit `|` getrennt
   und von links nach rechts angewandt: `trim|lower|empty2null`.

   Drei Dinge, die hier bewusst unterschieden werden:

   · LEERSTRING, NULL UND NICHT-GESENDET sind drei verschiedene Ergebnisse.
     Ein Leerstring überschreibt in Dataverse ein befülltes Feld mit "",
     `null` löscht es explizit, und ein nicht mitgesendetes Feld bleibt
     unangetastet. Bei einem Update entscheidet das darüber, ob gepflegte
     CRM-Daten überleben.

   · DIE 0 IST NICHT IMMER EINE ZAHL. Bei den Maßen bedeutet sie „nicht
     erfasst" – nur 9 von 206 Zeilen haben Werte ungleich 0. Ohne
     `zero2null` stünden im CRM 197 Bauteile mit 0 mm Kantenlänge
     (Datenanalyse §8).

   · EXCEL LIEFERT SCHON TYPEN. Mit `cellDates` kommen Datumsangaben als
     Date, Zahlen als Number. Die Umwandlungen müssen damit umgehen, statt
     alles als Text zu behandeln.                                          */

const TRANSFORMS = (() => {

  const leer = v => v === null || v === undefined || v === "";
  const text = v => v instanceof Date ? v.toISOString() : String(v);

  /** Deutsche Zahl nach JS-Zahl. „1.234,56" → 1234.56
   *  Punkt ist Tausendertrenner, Komma ist Dezimaltrenner – die Umkehrung
   *  der JS-Konvention, deshalb ist `parseFloat` hier falsch. */
  function dezimalDE(v) {
    if (leer(v)) return v;
    if (typeof v === "number") return v;         // Excel liefert oft schon Zahlen
    const s = String(v).trim().replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
    const n = Number(s);
    return Number.isNaN(n) ? v : n;              // unlesbar? Original behalten,
  }                                              // die Validierung meldet es

  /** Datum nach ISO-8601 (nur Datum, ohne Zeitzonenverschiebung).
   *  `Date` kommt aus SheetJS mit `cellDates`, Text aus unsauberen Mappen. */
  function datum(v, muster) {
    if (leer(v)) return v;
    if (v instanceof Date) {
      if (Number.isNaN(v.getTime())) return v;
      // Nicht toISOString: das rechnet in UTC um und macht aus dem
      // 01.03. je nach Zeitzone den 28.02.
      const p = n => String(n).padStart(2, "0");
      return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
    }
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})$/);
    if (m) {
      let [, t, mo, j] = m;
      if (j.length === 2) j = (Number(j) > 70 ? "19" : "20") + j;
      return `${j}-${mo.padStart(2, "0")}-${t.padStart(2, "0")}`;
    }
    return v;                                    // unlesbar? Validierung meldet es
  }

  const REGELN = {
    trim:       v => leer(v) ? v : (typeof v === "string" ? v.trim() : v),
    upper:      v => leer(v) ? v : text(v).toUpperCase(),
    lower:      v => leer(v) ? v : text(v).toLowerCase(),
    title:      v => leer(v) ? v : text(v).replace(/\S+/g,
                    w => w[0].toUpperCase() + w.slice(1).toLowerCase()),
    digits:     v => leer(v) ? v : (typeof v === "number" ? v
                    : text(v).replace(/[^\d]/g, "")),
    empty2null: v => (v === "" || v === undefined) ? null : v,
    // Nur die echte Null, nicht "0,0" und nicht ein leerer Wert.
    zero2null:  v => (v === 0 || v === "0" || dezimalDE(v) === 0) ? null : v,
    "decimal:de": dezimalDE,
    "date:auto":  v => datum(v)
  };

  /** Umwandlung mit Argument, z. B. `truncate:100` oder `bool:ja/nein`. */
  function mitArgument(name, arg) {
    if (name === "truncate") {
      const n = Number(arg);
      return v => (leer(v) || !Number.isFinite(n)) ? v : text(v).slice(0, n);
    }
    if (name === "bool") {
      const [wahr, falsch] = String(arg || "ja/nein").split("/");
      return v => {
        if (leer(v)) return v;
        const s = text(v).trim().toLowerCase();
        if (s === String(wahr).toLowerCase()) return true;
        if (s === String(falsch).toLowerCase()) return false;
        if (["true", "1", "x", "yes"].includes(s)) return true;
        if (["false", "0", "no"].includes(s)) return false;
        return v;
      };
    }
    if (name === "phone") {
      // Nur DE. Andere Länder würden eine Bibliothek brauchen, und die
      // holen wir uns für dieses eine Feld nicht ins Haus.
      return v => {
        if (leer(v)) return v;
        let s = text(v).replace(/[^\d+]/g, "");
        if (s.startsWith("00")) s = "+" + s.slice(2);
        else if (s.startsWith("0")) s = "+49" + s.slice(1);
        return s;
      };
    }
    if (name === "date") return v => datum(v, arg);
    if (name === "decimal") return dezimalDE;
    return null;
  }

  /** Eine Kette anwenden.
   *  @param {*} wert
   *  @param {string} kette z. B. "trim|lower|empty2null"
   *  @returns {{wert:*, unbekannt:string[]}} `unbekannt` nennt Regeln, die es
   *    nicht gibt – ein Tippfehler in der Zuordnung soll auffallen und nicht
   *    stillschweigend nichts tun. */
  function anwenden(wert, kette) {
    const unbekannt = [];
    if (!kette) return { wert, unbekannt };
    for (const roh of String(kette).split("|")) {
      const name = roh.trim();
      if (!name) continue;
      if (REGELN[name]) { wert = REGELN[name](wert); continue; }
      const [basis, ...rest] = name.split(":");
      const f = mitArgument(basis, rest.join(":"));
      if (f) wert = f(wert);
      else unbekannt.push(name);
    }
    return { wert, unbekannt };
  }

  /** Alle bekannten Regelnamen – für die Prüfung der Konfiguration. */
  const bekannt = () => [...Object.keys(REGELN),
    "truncate:n", "bool:ja/nein", "phone:DE", "date:TT.MM.JJJJ", "decimal:de"];

  return { anwenden, bekannt, dezimalDE, datum };
})();
