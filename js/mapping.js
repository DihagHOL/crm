"use strict";

/* Aus einer Zeile wird eine Nutzlast für Dataverse.

   Vier Regeln, die hier eingebaut sind und die den Altflow von einem
   Abgleich unterscheiden:

   1. SCHLÜSSELWERTE GEHÖREN NUR IN DIE URL, nicht zusätzlich in den Rumpf.
      Microsoft dokumentiert das ausdrücklich; ein mitgesendeter
      Schlüsselwert lässt den Upsert scheitern (Review A1).

   2. SONDERZEICHEN BRECHEN SCHLÜSSEL-URLS. Enthält ein Schlüsselwert eines
      der Zeichen / < > * % & : \ ? + , funktionieren GET, PATCH und Upsert
      nicht. Das betrifft vor allem das + in E-Mail-Adressen (Review A2).
      Deshalb wird es hier beanstandet, bevor der Aufruf rausgeht.

   3. SCHREIBRICHTLINIE JE FELD. Ohne die Unterscheidung zwischen „bei jeder
      Aktualisierung" und „nur beim Anlegen" ist der Import kein Abgleich,
      sondern ein Überschreiben der CRM-Pflege (Review B2). Hat ein
      Vertriebler die Chance übernommen, holt sie der nächste Lauf sonst
      zurück.

   4. UNVERÄNDERT IST EIN EIGENES ERGEBNIS. Wer nichts ändert, soll das auch
      melden – sonst sieht ein Lauf, der nichts getan hat, aus wie einer, der
      nicht gelaufen ist.                                                   */

const MAPPING = (() => {

  const leer = v => v === null || v === undefined || v === "";

  /** Zeichen, die eine Schlüssel-URL zerbrechen (Review A2). */
  const KEY_VERBOTEN = /[\/<>*%&:\\?+]/;

  /** Einfache Anführungszeichen verdoppeln – ein Firmenname wie
   *  „O'Brien GmbH" als Schlüssel bricht sonst die URL auf. */
  const escape = s => String(s).replace(/'/g, "''");

  /** Wert für einen Alternativschlüssel in der URL. Zahlen ohne
   *  Anführungszeichen, alles andere mit. */
  const schluesselTeil = (feld, wert) =>
    typeof wert === "number" || /^-?\d+$/.test(String(wert))
      ? `${feld}=${wert}`
      : `${feld}='${encodeURIComponent(escape(wert))}'`;

  const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  /** Typumwandlung nach der Umwandlungskette.
   *  @returns {{wert:*, fehler:string|null}} */
  function typisieren(wert, typ) {
    if (leer(wert)) return { wert: wert === "" ? null : wert, fehler: null };
    switch (typ) {
      case "Int": {
        const n = Number(wert);
        if (!Number.isFinite(n)) return { wert: null, fehler: `„${wert}" ist keine Zahl` };
        if (!Number.isInteger(n)) return { wert: Math.round(n),
          fehler: null };   // gerundet, nicht abgewiesen – das ist gutartig
        return { wert: n, fehler: null };
      }
      case "Decimal":
      case "Money": {
        const n = Number(wert);
        return Number.isFinite(n) ? { wert: n, fehler: null }
                                  : { wert: null, fehler: `„${wert}" ist keine Zahl` };
      }
      case "Boolean":
        if (typeof wert === "boolean") return { wert, fehler: null };
        return { wert: null, fehler: `„${wert}" ist kein Ja/Nein-Wert` };
      case "DateTime": {
        const s = String(wert);
        return /^\d{4}-\d{2}-\d{2}/.test(s)
          ? { wert: s, fehler: null }
          : { wert: null, fehler: `„${wert}" ist kein Datum (erwartet JJJJ-MM-TT)` };
      }
      default:
        return { wert: wert instanceof Date ? wert.toISOString() : String(wert), fehler: null };
    }
  }

  /**
   * Nutzlast für einen Datensatz bauen.
   *
   * @param {object} zeile        Zeilenobjekt aus EXCEL.lesen (mit `_zeile`)
   * @param {object[]} zuordnungen aus SPLISTEN.profil()
   * @param {object} [opt]
   * @param {"create"|"update"} [opt.modus]  steuert die Schreibrichtlinie
   * @param {object} [opt.bestand]  aktuelle CRM-Werte, für OnlyIfEmpty und
   *                                den Vergleich auf „unverändert"
   * @param {Object<string,object>} [opt.werte] Wertzuordnungen je
   *                                `MappingKey|TargetField`
   * @param {function} [opt.zusatzZeile] liefert die Zeile eines anderen
   *                                Blattes (für SourceSheet/SourceLookupBy)
   * @returns {{nutzlast:object, schluessel:object, felder:string[],
   *            fehler:object[], warnungen:object[], unveraendert:boolean}}
   */
  function baue(zeile, zuordnungen, opt = {}) {
    const modus = opt.modus || "create";
    const bestand = opt.bestand || null;
    const nutzlast = {}, schluessel = {}, fehler = [], warnungen = [];
    const gesetzt = [];
    let abweichung = false;

    for (const z of zuordnungen) {
      if (!z.aktiv) continue;
      if (!z.targetField || z.targetField.startsWith("KLAEREN")) continue;

      // Quellwert – ggf. aus einem anderen Blatt (z. B. Mitarbeiter steht
      // im Blatt Positionen, gehört aber an die Verkaufschance).
      let roh;
      if (z.sourceColumn) {
        const quelle = (z.sourceSheet && opt.zusatzZeile)
          ? opt.zusatzZeile(z.sourceSheet, z.sourceLookupBy, zeile)
          : zeile;
        roh = quelle ? quelle[z.sourceColumn] : undefined;
      } else {
        roh = z.defaultValue;     // Feld ohne Quellspalte, z. B. Währung
      }
      if (leer(roh) && !leer(z.defaultValue)) roh = z.defaultValue;

      // Umwandlungskette
      const t = TRANSFORMS.anwenden(roh, z.transform);
      for (const u of t.unbekannt)
        warnungen.push({ zeile: zeile._zeile, spalte: z.sourceColumn, feld: z.targetField,
          meldung: `Unbekannte Umwandlung „${u}" – wird übergangen. Tippfehler in der Zuordnung?` });
      let wert = t.wert;

      // Wertzuordnung (Auswahlfelder)
      const wz = opt.werte?.[`${z.mappingKey}|${z.targetField}`];
      if (wz && !leer(wert)) {
        const abbild = wz.werte[wert];
        if (abbild !== undefined) wert = abbild;
        else if (wz.standard !== null && wz.standard !== undefined) wert = wz.standard;
        else fehler.push({ zeile: zeile._zeile, spalte: z.sourceColumn, feld: z.targetField,
          wert, meldung: `Wert „${wert}" ist in ${CRM_CONFIG.listen.werte} nicht zugeordnet` });
      }

      // Pflicht
      if (z.pflicht && leer(wert)) {
        fehler.push({ zeile: zeile._zeile, spalte: z.sourceColumn, feld: z.targetField,
          wert: roh, meldung: "Pflichtfeld ist leer" });
        continue;
      }

      // Schlüsselwerte: nur in die URL, nie in den Rumpf (Review A1)
      if (z.istSchluessel) {
        if (!leer(wert)) {
          if (KEY_VERBOTEN.test(String(wert)))
            fehler.push({ zeile: zeile._zeile, spalte: z.sourceColumn, feld: z.targetField,
              wert, meldung: "Schlüsselwert enthält ein Zeichen, das die Adresse "
                + "zerbricht (/ < > * % & : \\ ? +) – Review A2" });
          schluessel[z.targetField] = wert;
        }
        continue;
      }

      if (leer(wert) && leer(z.defaultValue)) continue;

      // Schreibrichtlinie
      const richtlinie = z.writePolicy || "Always";
      if (modus === "update") {
        if (richtlinie === "OnCreateOnly") continue;
        if (richtlinie === "OnlyIfEmpty" && bestand && !leer(bestand[z.targetField])) continue;
      }

      // Lookup oder Skalar
      if (z.targetType === "Lookup") {
        if (!z.lookupEntitySet) {
          fehler.push({ zeile: zeile._zeile, spalte: z.sourceColumn, feld: z.targetField,
            wert, meldung: "Lookup ohne Zieltabelle in der Zuordnung" });
          continue;
        }
        const ziel = GUID.test(String(wert))
          ? `/${z.lookupEntitySet}(${wert})`
          : `/${z.lookupEntitySet}(${schluesselTeil(z.lookupKeyField || "id", wert)})`;
        nutzlast[`${z.targetField}@odata.bind`] = ziel;
        gesetzt.push(z.targetField);
        if (!bestand || bestand[`_${z.targetField}_value`] !== wert) abweichung = true;
        continue;
      }

      const ty = typisieren(wert, z.targetType);
      if (ty.fehler) {
        fehler.push({ zeile: zeile._zeile, spalte: z.sourceColumn, feld: z.targetField,
          wert: roh, meldung: ty.fehler });
        continue;
      }
      wert = ty.wert;

      if (z.maxLength && typeof wert === "string" && wert.length > z.maxLength) {
        fehler.push({ zeile: zeile._zeile, spalte: z.sourceColumn, feld: z.targetField,
          wert, meldung: `${wert.length} Zeichen, erlaubt sind ${z.maxLength}. `
            + "Dataverse kürzt nicht, sondern lehnt den Datensatz ab." });
        continue;
      }

      nutzlast[z.targetField] = wert;
      gesetzt.push(z.targetField);
      if (!bestand || bestand[z.targetField] !== wert) abweichung = true;
    }

    return { nutzlast, schluessel, felder: gesetzt, fehler, warnungen,
             unveraendert: !!bestand && !abweichung };
  }

  /** Adressteil für den Upsert: `accounts(dag_dihag_kdnr=10042)`. */
  function schluesselAdresse(entitySet, schluessel) {
    const teile = Object.entries(schluessel).map(([f, v]) => schluesselTeil(f, v));
    return teile.length ? `${entitySet}(${teile.join(",")})` : null;
  }

  return { baue, schluesselAdresse, schluesselTeil, KEY_VERBOTEN };
})();
