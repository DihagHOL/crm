"use strict";

/* Konfigurationslisten aus SharePoint – Importprofil und Feldzuordnung.

   Die Zuordnung liegt bewusst NICHT im Repo, sondern in SharePoint: sie ist
   Konfiguration, kein Programmcode, und wer sie ändert, soll das ohne
   Commit und ohne Deployment tun können (docs/02).

   Diese Datei liest sie. Geschrieben wird hier nichts – dafür gibt es die
   Listenoberfläche von SharePoint und `setup-crm.ps1 -ProfilLaden`.        */

const SPLISTEN = (() => {

  const C = CRM_CONFIG;

  /** Erwartete Spalten. Werden an GRAPH.listItems durchgereicht und
   *  aktivieren dort die Spaltennamen-Toleranz – SharePoint hängt beim
   *  Anlegen gern eine Ziffer an. */
  const SPALTEN_PROFIL = [
    "Title", "Step", "EntitySet", "SourceSheet", "MappingKey", "Mode",
    "OnMissingKey", "AlternateKey", "ParentField", "ReplaceScope",
    "BatchSize", "StopOnError", "SkipIfClosed", "SkipOnValues", "Active"
  ];

  const SPALTEN_MAPPING = [
    "Title", "MappingKey", "SourceColumn", "SourceSheet", "SourceLookupBy",
    "TargetField", "TargetType", "IsKey", "Required", "LookupEntitySet",
    "LookupKeyField", "OnLookupFail", "WritePolicy", "Transform",
    "DefaultValue", "MaxLength", "SortOrder", "Active"
  ];

  const zahl = v => (v === null || v === undefined || v === "") ? null : Number(v);

  /** Profil samt Zuordnungen.
   *
   *  @param {string} [profilName] Nur dieses Profil. Ohne Angabe: das erste,
   *    das gefunden wird.
   *  @returns {Promise<{name:string, schritte:object[],
   *                     zuordnungen:Object<string,object[]>,
   *                     profile:string[]}>}
   *  @throws wenn eine der Listen fehlt – mit einer Meldung, die sagt, was
   *    zu tun ist, statt „itemNotFound“. */
  async function profil(profilName) {
    const [pRows, mRows] = await Promise.all([
      GRAPH.listItems(C.konfigSite, C.listen.profile, SPALTEN_PROFIL),
      GRAPH.listItems(C.konfigSite, C.listen.mappings, SPALTEN_MAPPING)
    ]);

    if (!pRows || !mRows) {
      const fehlt = [!pRows && C.listen.profile, !mRows && C.listen.mappings]
        .filter(Boolean).join(" und ");
      throw new Error(`Liste ${fehlt} auf ${C.konfigSite} nicht gefunden oder `
        + "nicht lesbar. Anzulegen mit setup-crm.ps1, zu befüllen mit "
        + "setup-crm.ps1 -ProfilLaden.");
    }

    const profile = [...new Set(pRows.map(r => r.Title).filter(Boolean))];
    const name = profilName || profile[0] || "";

    const schritte = pRows
      .filter(r => r.Title === name)
      .map(r => ({
        step: zahl(r.Step),
        entitySet: r.EntitySet || "",
        sourceSheet: r.SourceSheet || "",
        mappingKey: r.MappingKey || "",
        mode: r.Mode || "",
        onMissingKey: r.OnMissingKey || "Fail",
        alternateKey: r.AlternateKey || "",
        parentField: r.ParentField || "",
        replaceScope: r.ReplaceScope || "",
        batchSize: zahl(r.BatchSize) ?? C.batchSize,
        stopOnError: r.StopOnError === true,
        skipIfClosed: r.SkipIfClosed === true,
        // Zeilen, die dieser Schritt auslassen soll, als JSON in einer
        // Spalte: {"Kontaktemail":["dummy@dihag.com"]}. Steht dort Unsinn,
        // wird das gemeldet statt still ignoriert – ein stillschweigend
        // verworfenes Skip legt Datensätze an, die niemand wollte.
        skipOnValues: (() => {
          if (!r.SkipOnValues) return null;
          try { return JSON.parse(r.SkipOnValues); }
          catch (e) {
            console.warn(`[Profil] SkipOnValues in Schritt ${r.Step} ist kein `
              + `gültiges JSON und wird übergangen: ${e.message}`);
            return null;
          }
        })(),
        aktiv: r.Active !== false
      }))
      // Die Reihenfolge steht im Profil, nicht im Code. Ohne diese Sortierung
      // liefe der Import in der Reihenfolge, in der SharePoint die Zeilen
      // zurückgibt – und die ist nicht zugesichert.
      .sort((a, b) => (a.step ?? 0) - (b.step ?? 0));

    const zuordnungen = {};
    for (const r of mRows) {
      const k = r.MappingKey;
      if (!k) continue;
      (zuordnungen[k] ||= []).push({
        // Ohne den Schlüssel des Zuordnungssatzes findet `MAPPING.baue`
        // die Wertzuordnungen nicht: es sucht unter `mappingKey|feld`, und
        // `undefined|feld` trifft nie. Die ganze Liste CRM_ValueMappings
        // war damit wirkungslos.
        mappingKey: k,
        titel: r.Title || "",
        sourceColumn: r.SourceColumn || "",
        sourceSheet: r.SourceSheet || "",
        sourceLookupBy: r.SourceLookupBy || "",
        targetField: r.TargetField || "",
        targetType: r.TargetType || "",
        istSchluessel: r.IsKey === true,
        pflicht: r.Required === true,
        lookupEntitySet: r.LookupEntitySet || "",
        lookupKeyField: r.LookupKeyField || "",
        onLookupFail: r.OnLookupFail || "",
        writePolicy: r.WritePolicy || "Always",
        transform: r.Transform || "",
        defaultValue: r.DefaultValue || "",
        maxLength: zahl(r.MaxLength),
        sortOrder: zahl(r.SortOrder) ?? 0,
        aktiv: r.Active !== false
      });
    }
    for (const k of Object.keys(zuordnungen))
      zuordnungen[k].sort((a, b) => a.sortOrder - b.sortOrder);

    return { name, profile, schritte, zuordnungen };
  }

  /** Wertzuordnungen („Deutschland“ → 100000001). Fehlt die Liste, ist das
   *  kein Fehler – sie wird erst gebraucht, wenn ein Auswahlfeld im Spiel
   *  ist. */
  async function werte() {
    const rows = await GRAPH.listItems(C.konfigSite, C.listen.werte,
      ["Title", "MappingKey", "TargetField", "SourceValue", "TargetValue",
       "IsDefault", "Active"]);
    if (!rows) return {};
    const out = {};
    for (const r of rows) {
      if (r.Active === false) continue;
      const k = `${r.MappingKey}|${r.TargetField}`;
      (out[k] ||= { werte: {}, standard: null });
      if (r.IsDefault === true) out[k].standard = r.TargetValue;
      out[k].werte[r.SourceValue] = r.TargetValue;
    }
    return out;
  }

  /* ── Protokoll (Phase 7) ─────────────────────────────────────────────
     Drei Ebenen: ein Eintrag je Lauf, eine Zeile je Fehler, und das
     Vollprotokoll als Datei. Kein Datensatz wird geschrieben, ohne dass er
     im Protokoll landet – auch die übersprungenen und gewarnten
     (Randbedingung 12).                                                   */

  /** Laufeintrag anlegen. @returns {Promise<string>} Listen-Item-ID */
  async function laufSchreiben(f) {
    const r = await GRAPH.addItem(C.konfigSite, C.listen.laeufe, {
      Title: f.laufId,
      ProfileName: f.profil,
      SourceFile: f.datei,
      SourceFileHash: f.hash || "",
      EnvironmentLabel: C.umgebung,
      StartedAt: f.start,
      FinishedAt: f.ende,
      Status: f.status,
      IsDryRun: !!f.pruefLauf,
      TotalRows: f.zeilen | 0,
      CreatedCount: f.angelegt | 0,
      UpdatedCount: f.aktualisiert | 0,
      UnchangedCount: f.unveraendert | 0,
      SkippedCount: f.uebersprungen | 0,
      FailedCount: f.fehlgeschlagen | 0,
      DurationSeconds: Math.round((f.dauerMs || 0) / 1000),
      StepSummary: JSON.stringify(f.jeSchritt || {})
    });
    return r.id;
  }

  /** Fehlerzeilen. Gedeckelt, damit ein Lauf mit 8.000 kaputten Zeilen
   *  nicht 8.000 Listeneinträge erzeugt – das Vollprotokoll hat sie alle. */
  async function fehlerSchreiben(laufId, eintraege, maxAnzahl = 200) {
    const teil = eintraege.slice(0, maxAnzahl);
    let n = 0;
    for (const e of teil) {
      try {
        await GRAPH.addItem(C.konfigSite, C.listen.fehler, {
          Title: laufId,
          RowNumber: e.zeile | 0,
          SheetName: e.blatt || "",
          EntitySet: e.entitySet || "",
          SourceKey: String(e.schluessel ?? ""),
          ErrorType: e.art || "API",
          HttpStatus: e.httpStatus | 0,
          ErrorCode: e.code || "",
          ErrorMessage: e.meldung || "",
          FieldName: e.feld || "",
          SourceValue: String(e.wert ?? ""),
          Resolved: false
        });
        n++;
      } catch { /* eine gescheiterte Fehlerzeile darf den Lauf nicht kippen */ }
    }
    return { geschrieben: n, ausgelassen: eintraege.length - teil.length };
  }

  /** Vollprotokoll als Datei.
   *
   *  ABWEICHUNG von docs/02: Dort ist es eine Anlage am Listeneintrag.
   *  Microsoft Graph kann Anlagen an SharePoint-Listeneinträgen aber nicht
   *  schreiben – das geht nur über die SharePoint-REST-API, und die
   *  braucht einen anderen Token. Deshalb liegt das Vollprotokoll als
   *  JSON-Datei in der Dokumentbibliothek der Konfigurationssite, und der
   *  Laufeintrag verweist darauf.
   *
   *  @returns {Promise<string|null>} Adresse der Datei */
  async function vollprotokoll(laufId, daten) {
    try {
      const sid = await GRAPH.siteId(C.konfigSite);
      const drive = (await GRAPH.call(`/sites/${sid}/drive`))?.id;
      if (!drive) return null;
      const pfad = `Protokolle/${laufId}.json`;
      const r = await GRAPH.call(
        `/drives/${drive}/root:/${encodeURI(pfad)}:/content`,
        { method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(daten, null, 2) });
      return r?.webUrl || null;
    } catch (e) {
      console.warn("[Protokoll] Vollprotokoll nicht geschrieben:", e.message);
      return null;   // ein fehlendes Vollprotokoll darf den Lauf nicht kippen
    }
  }

  return { profil, werte, laufSchreiben, fehlerSchreiben, vollprotokoll,
           SPALTEN_PROFIL, SPALTEN_MAPPING };
})();
