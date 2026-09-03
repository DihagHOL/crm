"use strict";

/* Batch-Anfragen für die Dataverse Web API.

   Reine Textarbeit, bewusst ohne Netzzugriff – so ist der heikelste Teil
   unter Node testbar. Ein falsch zusammengesetzter Batch scheitert nämlich
   nicht mit einer Fehlermeldung, sondern mit einem `400` ohne Hinweis
   darauf, welche der 100 Zeilen schuld ist.

   ZWEI BETRIEBSARTEN, und der Unterschied ist entscheidend:

   · EIGENSTÄNDIGE ANFRAGEN (Standard). Jede Zeile steht für sich, zusammen
     mit `Prefer: odata.continue-on-error`. Eine kaputte Zeile lässt die
     anderen 99 durch und landet im Fehlerbericht.

   · CHANGESET (Ausnahme). Alles darin ist EINE Transaktion – scheitert ein
     Teil, wird alles zurückgerollt. Das wollen wir genau an einer Stelle:
     beim Ersetzen der Positionen einer Verkaufschance. Der Altflow löscht
     dort erst, wartet 60 Sekunden und legt dann neu an; bricht er
     dazwischen ab, sind die Positionen weg (Befund B3). Im Changeset kann
     das nicht passieren.                                                  */

const BATCH = (() => {

  const uuid = () => (crypto?.randomUUID?.() ||
    "x" + Math.random().toString(16).slice(2) + Date.now().toString(16));

  const CRLF = "\r\n";

  /**
   * Batch-Rumpf bauen.
   *
   * @param {Array} teile  Entweder einzelne Anfragen
   *   `{methode, url, koerper?, headers?}` oder ein Changeset
   *   `{changeset: [...Anfragen]}`.
   * @param {string} grenze Batch-Grenze ohne die führenden Bindestriche
   * @returns {string}
   */
  function baue(teile, grenze) {
    const z = [];
    let contentId = 1;

    for (const t of teile) {
      z.push(`--${grenze}`);
      if (t.changeset) {
        const cg = "changeset_" + uuid();
        z.push(`Content-Type: multipart/mixed; boundary=${cg}`, "");
        for (const a of t.changeset) {
          z.push(`--${cg}`);
          z.push("Content-Type: application/http",
                 "Content-Transfer-Encoding: binary",
                 `Content-ID: ${contentId++}`, "");
          z.push(...anfrage(a));
        }
        z.push(`--${cg}--`);
      } else {
        z.push("Content-Type: application/http",
               "Content-Transfer-Encoding: binary",
               `Content-ID: ${contentId++}`, "");
        z.push(...anfrage(t));
      }
    }
    z.push(`--${grenze}--`, "");
    return z.join(CRLF);
  }

  function anfrage(a) {
    const z = [`${a.methode} ${a.url} HTTP/1.1`];
    if (a.koerper !== undefined && a.koerper !== null)
      z.push("Content-Type: application/json;type=entry");
    for (const [k, v] of Object.entries(a.headers || {})) z.push(`${k}: ${v}`);
    z.push("");
    if (a.koerper !== undefined && a.koerper !== null)
      z.push(JSON.stringify(a.koerper), "");
    return z;
  }

  /**
   * Antwort auswerten.
   *
   * Die Reihenfolge der Teile entspricht der der Anfragen – darauf beruht
   * die Zuordnung zu den Zeilen. Ein Changeset liefert nur EINE Antwort,
   * wenn es scheitert, und je Teil eine, wenn es durchgeht.
   *
   * @returns {Array<{status:number, koerper:object|string|null, ort:string|null}>}
   */
  function lese(text) {
    if (!text) return [];
    const ergebnisse = [];
    // An jeder Zeile teilen, die mit -- beginnt. Der Name der Grenze wird
    // NICHT geraten: die Anfrage nennt sie `batch_…`, die Antwort aber
    // `batchresponse_…`, und Changesets kommen als `changesetresponse_…`
    // zurück. Wer den Namen vorhersagt, liest nur den ersten Teil.
    const bloecke = ("\r\n" + String(text)).split(/\r?\n--[^\r\n]*/);

    for (const b of bloecke) {
      const m = b.match(/HTTP\/1\.1 (\d{3})/);
      if (!m) continue;
      const status = Number(m[1]);
      const nachStatus = b.slice(b.indexOf(m[0]) + m[0].length);
      const ort = (nachStatus.match(/^OData-EntityId:\s*(.+)$/im) || [])[1]?.trim()
               || (nachStatus.match(/^Location:\s*(.+)$/im) || [])[1]?.trim() || null;

      // Rumpf: der Teil nach der ersten Leerzeile, die auf die Kopfzeilen folgt
      const trenn = nachStatus.search(/\r?\n\r?\n/);
      let koerper = null;
      if (trenn >= 0) {
        const roh = nachStatus.slice(trenn).trim();
        if (roh) {
          try { koerper = JSON.parse(roh); }
          catch { koerper = roh; }
        }
      }
      ergebnisse.push({ status, koerper, ort });
    }
    return ergebnisse;
  }

  /** Fehlertext aus einer Batch-Antwort, so lesbar wie möglich. */
  function fehlertext(a) {
    if (!a) return "keine Antwort";
    const k = a.koerper;
    if (k && typeof k === "object" && k.error)
      return `${k.error.code ? k.error.code + ": " : ""}${k.error.message}`;
    if (typeof k === "string" && k) return k.slice(0, 300);
    return `HTTP ${a.status}`;
  }

  /** Ist dieser Status ein Erfolg? Dataverse antwortet auf Upsert per PATCH
   *  mit 204, auf POST mit 201 oder 204. */
  const erfolg = s => s >= 200 && s < 300;

  return { baue, lese, fehlertext, erfolg, uuid, CRLF };
})();
