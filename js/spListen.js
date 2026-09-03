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
    "BatchSize", "StopOnError", "SkipIfClosed", "Active"
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

  return { profil, werte, SPALTEN_PROFIL, SPALTEN_MAPPING };
})();
