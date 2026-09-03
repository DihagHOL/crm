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
        // Erst genau, dann ohne Rücksicht auf Gross- und Kleinschreibung.
        // „ja" und „Ja" doppelt einzutragen geht nicht: PowerShell liest
        // JSON-Schlüssel ohne Unterscheidung und bricht beim zweiten ab.
        let abbild = wz.werte[wert];
        if (abbild === undefined) {
          const k = String(wert).toLowerCase();
          const treffer = Object.keys(wz.werte).find(x => x.toLowerCase() === k);
          if (treffer !== undefined) abbild = wz.werte[treffer];
        }
        if (abbild !== undefined) wert = abbild;
        else if (wz.standard !== null && wz.standard !== undefined) wert = wz.standard;
        // Kein Abbild und kein Standard: den Wert lassen, wie er ist, und
        // warnen. Ein harter Fehler hiesse, dass eine einzige neue
        // Produktgruppe die ganze Zeile verwirft – dabei entscheidet gleich
        // darauf ohnehin der Verweis, ob der Wert etwas trifft.
        else warnungen.push({ zeile: zeile._zeile, spalte: z.sourceColumn,
          feld: z.targetField, wert,
          meldung: `Wert „${wert}" ist in ${CRM_CONFIG.listen.werte} nicht zugeordnet `
            + "– er wird unverändert verwendet" });
      }

      // Pflicht
      if (z.pflicht && leer(wert)) {
        fehler.push({ zeile: zeile._zeile, spalte: z.sourceColumn, feld: z.targetField,
          wert: roh, meldung: "Pflichtfeld ist leer" });
        continue;
      }

      /* Schlüsselwerte gehören in die URL, nicht in den Rumpf (Review A1)
         – aber nur, wenn über einen Alternativschlüssel adressiert wird.
         Gibt es keinen, wird über die GUID adressiert oder angelegt, und
         dann MUSS der Schlüssel in den Rumpf: sonst entsteht ein Kontakt
         ohne E-Mail-Adresse. `schluesselImRumpf` sagt, welcher Fall
         vorliegt; es steht am Schritt, nicht an der Zeile.              */
      if (z.istSchluessel) {
        if (leer(wert)) continue;
        if (KEY_VERBOTEN.test(String(wert)))
          fehler.push({ zeile: zeile._zeile, spalte: z.sourceColumn, feld: z.targetField,
            wert, meldung: "Schlüsselwert enthält ein Zeichen, das die Adresse "
              + "zerbricht (/ < > * % & : \\ ? +) – Review A2" });
        schluessel[z.targetField] = wert;
        if (!opt.schluesselImRumpf) continue;
        // sonst weiter unten wie ein gewöhnliches Feld
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
        // Aufgeloeste GUID schlaegt den Alternativschluessel: sie geht auch
        // ohne einen, sie macht eine getroffene Entscheidung bei
        // Mehrfachtreffern wirksam (ueber `dag_dihag_kdnr=47000004`
        // gebunden, sucht Dataverse selbst - und trifft dieselbe
        // Doppeldeutigkeit wieder), und nur mit ihr laesst sich
        // "unveraendert" feststellen: im Bestand steht eine GUID, keine
        // Kundennummer.
        // Mehrere Schlüsselfelder sind erlaubt (`a|b`); der Rückfallweg
        // über die Adresse nimmt das erste.
        const schlFelder = String(z.lookupKeyField || "")
          .split("|").map(t => t.trim()).filter(Boolean);
        const gesucht = GUID.test(String(wert)) ? String(wert)
          : opt.aufloesen?.(z.lookupEntitySet, schlFelder, wert);
        const aufgeloest = gesucht || null;

        /* Abgefragt und nicht vorhanden (`null`, nicht `undefined`)? Dann
           entscheidet `OnLookupFail`. Ohne diese Stelle bindet der Import
           an einen Datensatz, von dem er WEISS, dass es ihn nicht gibt –
           bei `dummy@dihag.com` genau das, was das Profil ausschliessen
           will: keine Sammeladresse, keine Verknüpfung (docs/06). */
        if (gesucht === null) {
          /* Abgefragt und nicht vorhanden – und ohne ausdrückliche Regel
             gilt: Feld leer lassen, Zeile schreiben.

             Der bisherige Rückfallweg band auf `/tabelle(feld='wert')`.
             Hat die Zieltabelle keinen Alternativschlüssel auf diesem Feld
             – und die wenigsten haben einen –, weist Dataverse die GANZE
             Zeile ab:

               0x80060888: The key in the request URI is not valid for
               resource 'Microsoft.Dynamics.CRM.cr570_technicalaudit_lookup'.

             Ein Verweis, den es nicht gibt, kostete so 29 vollständige
             Verkaufschancen. Jetzt kostet er ein Feld, und der Bericht sagt
             welches. Pflichtfelder bleiben ein Fehler.                   */
          if (!z.onLookupFail && !z.pflicht) {
            warnungen.push({ zeile: zeile._zeile, spalte: z.sourceColumn,
              feld: z.targetField, wert,
              meldung: `„${wert}" gibt es in ${z.lookupEntitySet} nicht – das Feld `
                + "bleibt leer, der Rest der Zeile wird geschrieben" });
            continue;
          }
          if (z.onLookupFail === "WarnAndSkipField") {
            warnungen.push({ zeile: zeile._zeile, spalte: z.sourceColumn,
              feld: z.targetField, wert,
              meldung: `In ${z.lookupEntitySet} nicht gefunden – das Feld bleibt leer, `
                + "der Rest der Zeile wird geschrieben" });
            continue;
          }
          if (z.onLookupFail === "Fail" || z.pflicht) {
            fehler.push({ zeile: zeile._zeile, spalte: z.sourceColumn,
              feld: z.targetField, wert,
              meldung: `In ${z.lookupEntitySet} nicht gefunden` });
            continue;
          }
        }

        const ziel = aufgeloest
          ? `/${z.lookupEntitySet}(${aufgeloest})`
          : `/${z.lookupEntitySet}(${schluesselTeil(schlFelder[0] || "id", wert)})`;

        // `@odata.bind` verlangt den Namen der NAVIGATIONSEIGENSCHAFT, nicht
        // den des Attributs. Bei Standardfeldern sind beide gleich, bei
        // selbst angelegten fast nie.
        const nav = opt.nav?.[z.targetField] || z.targetField;
        nutzlast[`${nav}@odata.bind`] = ziel;
        gesetzt.push(z.targetField);
        const bisher = bestand ? bestand[`_${z.targetField}_value`] : undefined;
        if (!bestand || bisher !== (aufgeloest ?? wert)) abweichung = true;
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
