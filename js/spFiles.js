"use strict";

/* Quelldateien in der SharePoint-Bibliothek – auflisten, laden, markieren.

   Die Dateien werden NICHT hochgeladen. Sie liegen bereits dort, wo sie der
   Altflow abholt; die App listet sie auf, lädt die ausgewählte in den
   Arbeitsspeicher des Browsers und lässt das Original unangetastet liegen.

   Verschoben oder gelöscht wird auch nichts: ein Verschieben würde die
   Item-ID entwerten, auf die das Protokoll verweist.                      */

const SPFILES = (() => {

  const C = CRM_CONFIG;

  /* ── Auflisten ────────────────────────────────────────────────────── */

  /** Bibliothek auflösen. Wirft mit einer Meldung, die sagt, was zu tun ist –
   *  nicht mit „itemNotFound“. */
  async function bibliothek() {
    const id = await GRAPH.driveId(C.quellSite, C.quellDrive);
    if (!id) {
      const vorhanden = (await GRAPH.drives(C.quellSite)).map(d => d.name).join(", ");
      throw new Error(`Bibliothek „${C.quellDrive}“ auf ${C.quellSite} nicht gefunden. `
        + `Vorhanden: ${vorhanden || "keine"}. Wert quellDrive in js/config.js prüfen.`);
    }
    return id;
  }

  const KB = 1024;
  const groesse = b => b < KB ? `${b} B`
    : b < KB * KB ? `${(b / KB).toFixed(0)} KB`
    : `${(b / KB / KB).toFixed(1)} MB`;

  /** Alle Excel-Mappen im Quellordner, neueste zuerst.
   *
   *  Die Statusspalten aus der Bibliothek kommen über
   *  `$expand=listItem($expand=fields)` gleich mit – sonst bräuchte es je
   *  Datei einen zweiten Aufruf.
   *
   *  @returns {Promise<Array<{id,name,groesse,erstellt,geaendert,geaendertVon,
   *                           status,laufId,importiertAm,webUrl}>>} */
  async function liste() {
    const dId = await bibliothek();
    const kinder = await GRAPH.ordnerInhalt(dId, C.quellOrdner,
      "$expand=listItem($expand=fields)&$top=200");

    return kinder
      .filter(k => k.file && /\.xlsx?$/i.test(k.name))
      .map(k => {
        const f = k.listItem?.fields || {};
        return {
          id:            k.id,
          driveId:       dId,
          listItemId:    k.listItem?.id,
          name:          k.name,
          bytes:         k.size || 0,
          groesse:       groesse(k.size || 0),
          // Angelegt = EINGEGANGEN. Das Änderungsdatum taugt dafür nicht:
          // der Statusvermerk der Automatik fasst den Eintrag selbst an.
          erstellt:      k.createdDateTime || "",
          geaendert:     k.lastModifiedDateTime || "",
          geaendertVon:  k.lastModifiedBy?.user?.displayName || "",
          webUrl:        k.webUrl || "",
          // Leer heißt „Neu“: Bestandsdateien von vor der Einführung der
          // Spalten haben keinen Wert, und das ist kein Fehlerzustand.
          status:        f.ImportStatus || "Neu",
          laufId:        f.ImportRunId || "",
          importiertAm:  f.ImportedAt || ""
        };
      })
      .sort((a, b) => String(b.geaendert).localeCompare(String(a.geaendert)));
  }

  /* ── Laden ────────────────────────────────────────────────────────── */

  /** Dateiinhalt als ArrayBuffer.
   *
   *  ZWEISTUFIG, und das ist kein Umweg. Der naheliegende Weg
   *      GET /drives/{d}/items/{i}/content   mit Authorization-Header
   *  antwortet mit einer Weiterleitung auf einen Speicher-Host. `fetch` folgt
   *  ihr automatisch und schickt den Graph-Token an eine fremde Domäne mit.
   *  Das Ergebnis ist ein CORS- oder 401-Fehler, dessen Meldung in die Irre
   *  führt.
   *
   *  Richtig: Metadaten holen, dort steckt eine kurzlebige, bereits
   *  authentifizierte URL – die wird OHNE Authorization-Header abgerufen.
   *
   *  @param {{driveId:string, id:string}} datei
   *  @param {number} [timeoutMs] Abbruch nach dieser Zeit. Ein Ladevorgang,
   *    den man nicht stoppen kann, ist ein Fehler und kein Feature. */
  async function laden(datei, timeoutMs = 120000) {
    const item = await GRAPH.call(`/drives/${datei.driveId}/items/${datei.id}`);
    const url = item["@microsoft.graph.downloadUrl"];
    if (!url) throw new Error("Graph hat keine Download-Adresse geliefert – "
      + "möglicherweise fehlt das Leserecht auf die Datei.");

    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctl.signal });   // KEIN Authorization-Header
      if (!r.ok) throw new Error(`Datei konnte nicht geladen werden (HTTP ${r.status}).`);
      return await r.arrayBuffer();
    } catch (e) {
      if (e.name === "AbortError")
        throw new Error(`Laden nach ${Math.round(timeoutMs / 1000)} s abgebrochen.`);
      throw e;
    } finally {
      clearTimeout(t);
    }
  }

  /* ── Markieren ────────────────────────────────────────────────────── */

  /** Statusspalten am Bibliothekseintrag setzen. Wird nach dem Import
   *  gerufen (Phase 7). Ein fehlgeschlagener Statusvermerk darf den Lauf
   *  nicht nachträglich als gescheitert erscheinen lassen – der Aufrufer
   *  behandelt den Fehler als Warnung.
   *
   *  @param {object} datei aus liste()
   *  @param {{ImportStatus?:string, ImportRunId?:string, ImportedAt?:string}} felder */
  async function statusSetzen(datei, felder) {
    if (!datei.listItemId)
      throw new Error("Kein Bibliothekseintrag zur Datei – Status nicht setzbar.");
    return GRAPH.call(
      `/drives/${datei.driveId}/items/${datei.id}/listItem/fields`,
      { method: "PATCH", body: JSON.stringify(felder) });
  }

  return { liste, laden, statusSetzen, bibliothek };
})();
