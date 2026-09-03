"use strict";

/* Phase 0 – auflösen, bevor irgendetwas geschrieben wird.

   Ohne diese Phase funktionieren drei Dinge nicht (CLAUDE.md §8):

   1. Der Prüflauf kann nicht sagen, was passieren wird. „12 neu, 60
      Aktualisierungen, 3 Konflikte" ist die einzig nützliche Aussage eines
      Prüflaufs – und ohne vorherige Abfrage nicht möglich.
   2. Das Protokoll kann `angelegt` nicht von `aktualisiert` unterscheiden.
      Dataverse antwortet auf einen Upsert per PATCH immer mit 204,
      unabhängig davon, was passiert ist.
   3. `unveraendert` ist überhaupt nicht feststellbar.

   Gearbeitet wird mit Sammelabfragen über `Microsoft.Dynamics.CRM.In`, in
   Blöcken wegen der Adresslänge – nicht mit einem Aufruf je Zeile. Der
   Altflow braucht für 300 Zeilen rund 600 Einzelabfragen; hier sind es
   weniger als zehn.                                                       */

const AUFLOESUNG = (() => {

  /** Werte je Abfrage. 100 ist konservativ: die Adresse bleibt weit unter
   *  jeder Längengrenze, und mehr Blöcke kosten kaum etwas. */
  const BLOCK = 100;

  const leer = v => v === null || v === undefined || v === "";
  const schluessel = (entitySet, feld) => `${entitySet}|${feld}`;

  /** Werte in Blöcken abfragen und nach dem Schlüsselfeld gruppieren.
   *  Mehrfachtreffer werden NICHT auf den ersten reduziert – genau das tut
   *  der Altflow mit `$top: 1`, und genau deshalb schreibt er bei doppelten
   *  Kundennummern auf das falsche Konto.
   *  @returns {Promise<Map<*, object[]>>} */
  async function sammle(entitySet, feld, werte, select) {
    const treffer = new Map();
    const liste = [...new Set(werte.filter(v => !leer(v)).map(v => String(v)))];
    for (let i = 0; i < liste.length; i += BLOCK) {
      const teil = liste.slice(i, i + BLOCK)
        .map(v => `'${String(v).replace(/'/g, "''")}'`).join(",");
      const filter = `Microsoft.Dynamics.CRM.In(PropertyName='${feld}',PropertyValues=[${teil}])`;
      const rows = await DV.alle(
        `/${entitySet}?$select=${encodeURIComponent(select)}`
        + `&$filter=${encodeURIComponent(filter)}`);
      for (const r of rows) {
        const k = String(r[feld]);
        if (!treffer.has(k)) treffer.set(k, []);
        treffer.get(k).push(r);
      }
    }
    return treffer;
  }

  /** Welche Felder braucht der Vergleich? Alle, die der Import schreiben
   *  will – sonst ist „unverändert" nicht feststellbar (CLAUDE.md §8). */
  function vergleichsFelder(zuordnungen, primaerFeld) {
    const s = new Set([primaerFeld, "statecode", "statuscode"]);
    for (const z of zuordnungen) {
      if (!z.aktiv || !z.targetField || z.targetField.startsWith("KLAEREN")) continue;
      s.add(z.targetType === "Lookup" ? `_${z.targetField}_value` : z.targetField);
    }
    return [...s];
  }

  /**
   * Alles auflösen, was das Profil für die geladene Mappe braucht.
   *
   * @param {object} profil aus SPLISTEN.profil()
   * @param {object} mappe  aus EXCEL.lesen()
   * @param {function} [fortschritt] wird je Abfrage mit einem Text gerufen
   * @returns {Promise<{treffer:Map, abfragen:object[]}>}
   */
  async function fuer(profil, mappe, fortschritt = () => {}) {
    const treffer = new Map();      // "entitySet|feld" → Map(wert → records)
    const abfragen = [];

    /** Eine Abfrage vorbereiten, ausführen und protokollieren. */
    async function frage(entitySet, feld, werte, select, zweck) {
      const gesucht = new Set(werte.filter(v => !leer(v)).map(v => String(v)));
      if (!gesucht.size) return;
      const k = schluessel(entitySet, feld);
      if (treffer.has(k)) return;   // dieselbe Abfrage nicht zweimal
      fortschritt(`${entitySet} über ${feld} (${gesucht.size} Werte) …`);
      const m = await sammle(entitySet, feld, [...gesucht], select);
      treffer.set(k, m);
      const mehrdeutig = [...m.entries()].filter(([, v]) => v.length > 1);
      abfragen.push({
        entitySet, feld, zweck,
        gesucht: gesucht.size,
        gefunden: m.size,
        fehlend: [...gesucht].filter(v => !m.has(v)),
        mehrdeutig: mehrdeutig.map(([wert, v]) => ({ wert, anzahl: v.length }))
      });
    }

    for (const s of profil.schritte) {
      if (!s.aktiv) continue;
      const zu = profil.zuordnungen[s.mappingKey] || [];
      const blatt = EXCEL.blatt(mappe, s.sourceSheet);
      if (!blatt) continue;

      // 1. Der eigene Schlüssel – existiert der Datensatz schon?
      const key = zu.find(z => z.aktiv && z.istSchluessel && z.targetField);
      if (key && s.alternateKey) {
        const werte = blatt.zeilen.map(r => {
          const t = TRANSFORMS.anwenden(r[key.sourceColumn], key.transform);
          return t.wert;
        });
        await frage(s.entitySet, key.targetField, werte,
          vergleichsFelder(zu, key.targetField).join(","),
          `Schritt ${s.step}: existiert der Datensatz schon?`);
      }

      // 2. Alle Lookups – auf welche GUID zeigen sie?
      for (const z of zu) {
        if (!z.aktiv || z.targetType !== "Lookup") continue;
        if (!z.lookupEntitySet || !z.lookupKeyField) continue;
        if (z.targetField?.startsWith("KLAEREN")) continue;
        const quellBlatt = z.sourceSheet ? EXCEL.blatt(mappe, z.sourceSheet) : blatt;
        if (!quellBlatt) continue;
        const werte = z.sourceColumn
          ? quellBlatt.zeilen.map(r => TRANSFORMS.anwenden(r[z.sourceColumn], z.transform).wert)
          : [z.defaultValue];
        await frage(z.lookupEntitySet, z.lookupKeyField, werte,
          `${z.lookupKeyField}`, `Schritt ${s.step}: Verweis ${z.targetField}`);
      }
    }

    return { treffer, abfragen };
  }

  /** Treffer nachschlagen.
   *  @returns {{records:object[], mehrdeutig:boolean, fehlt:boolean}} */
  function finde(aufl, entitySet, feld, wert) {
    const m = aufl.treffer.get(schluessel(entitySet, feld));
    if (!m) return { records: [], mehrdeutig: false, fehlt: true };
    const r = m.get(String(wert)) || [];
    return { records: r, mehrdeutig: r.length > 1, fehlt: r.length === 0 };
  }

  return { fuer, finde, sammle, vergleichsFelder, BLOCK };
})();
