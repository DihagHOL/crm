"use strict";

/* Der Prüflauf – was WÜRDE passieren.

   Er schreibt nichts. Er sagt vorher, was ein Import täte: wie viele
   Datensätze neu entstünden, wie viele sich änderten, wie viele gleich
   blieben, und was nicht durchginge.

   Das ist der Unterschied zum Altflow. Der schreibt und meldet danach
   „Bitte Denis anschreiben, damit er die Datenbank leert."               */

const PRUEFUNG = (() => {

  const leer = v => v === null || v === undefined || v === "";

  /** Zeile eines anderen Blattes finden – für Felder, deren Quelle woanders
   *  steht. `Mitarbeiter` liegt im Blatt Positionen, gehört aber an die
   *  Verkaufschance; je Opp-ID ist der Wert eindeutig (Datenanalyse §5). */
  function zusatzZeileFn(mappe) {
    const index = new Map();
    return (blattName, ueber, zeile) => {
      if (!blattName || !ueber) return null;
      const k = blattName + "|" + ueber;
      if (!index.has(k)) {
        const b = EXCEL.blatt(mappe, blattName);
        const m = new Map();
        for (const r of (b?.zeilen || [])) {
          const v = String(r[ueber] ?? "");
          if (v && !m.has(v)) m.set(v, r);     // erste Zeile je Schlüssel
        }
        index.set(k, m);
      }
      return index.get(k).get(String(zeile[ueber] ?? "")) || null;
    };
  }

  /**
   * @param {object} profil aus SPLISTEN.profil()
   * @param {object} mappe  aus EXCEL.lesen()
   * @param {object} aufl   aus AUFLOESUNG.fuer()
   * @param {object} [werte] Wertzuordnungen
   * @param {Map} [entscheidungen] Antworten auf Mehrfachtreffer
   * @returns {{schritte:object[], gesamt:object, fehler:object[], warnungen:object[]}}
   */
  function lauf(profil, mappe, aufl, werte = {}, entscheidungen = null) {
    const zusatzZeile = zusatzZeileFn(mappe);
    const schritte = [], alleFehler = [], alleWarnungen = [];
    const gesamt = { neu: 0, aktualisiert: 0, unveraendert: 0, uebersprungen: 0, fehler: 0 };

    for (const s of profil.schritte) {
      if (!s.aktiv) { schritte.push({ ...zaehler(), s, inaktiv: true }); continue; }

      const zu = profil.zuordnungen[s.mappingKey] || [];
      const blatt = EXCEL.blatt(mappe, s.sourceSheet);
      const z = zaehler();
      z.s = s;

      if (!blatt) {
        z.strukturfehler = `Blatt „${s.sourceSheet}" gibt es in der Datei nicht.`;
        schritte.push(z);
        continue;
      }
      z.zeilen = blatt.anzahl;

      const key = zu.find(k => k.aktiv && k.istSchluessel && k.targetField);

      for (const zeile of blatt.zeilen) {
        // Schlüsselwert
        let schluesselWert = null;
        if (key) {
          schluesselWert = TRANSFORMS.anwenden(zeile[key.sourceColumn], key.transform).wert;
          if (leer(schluesselWert)) {
            if (s.onMissingKey === "Skip") {
              z.uebersprungen++;
              alleWarnungen.push({ schritt: s.step, zeile: zeile._zeile,
                spalte: key.sourceColumn,
                meldung: "Schlüssel leer – Zeile wird in diesem Schritt übersprungen, "
                  + "die folgenden Schritte laufen weiter" });
            } else {
              z.fehler++;
              alleFehler.push({ schritt: s.step, zeile: zeile._zeile,
                spalte: key.sourceColumn, meldung: "Schlüsselwert fehlt" });
            }
            continue;
          }
        }

        // Bestand nachschlagen
        let bestand = null, mehrdeutig = false, entschieden = false;
        if (key && s.alternateKey) {
          const t = AUFLOESUNG.finde(aufl, s.entitySet, key.targetField,
                                     schluesselWert, entscheidungen);
          mehrdeutig = t.mehrdeutig;
          entschieden = t.entschieden;
          bestand = t.records[0] || null;
        }
        if (entschieden)
          alleWarnungen.push({ schritt: s.step, zeile: zeile._zeile,
            spalte: key.sourceColumn, wert: schluesselWert,
            meldung: "Mehrfachtreffer – es gilt der von Hand gewählte Datensatz. "
              + "Die Entscheidung steht im Protokoll." });

        if (mehrdeutig) {
          z.fehler++;
          alleFehler.push({ schritt: s.step, zeile: zeile._zeile, spalte: key.sourceColumn,
            wert: schluesselWert,
            meldung: `Mehrfachtreffer: ${schluesselWert} findet mehrere Datensätze. `
              + "Bitte oben unter „Offene Entscheidungen“ auswählen, welcher "
              + "gemeint ist – geraten wird nicht." });
          continue;
        }

        // Nur nachschlagen (Konten)
        if (s.mode === "LookupOnly") {
          if (!bestand) {
            z.fehler++;
            alleFehler.push({ schritt: s.step, zeile: zeile._zeile, spalte: key?.sourceColumn,
              wert: schluesselWert,
              meldung: `Nicht gefunden – diese Zeile wird in allen Folgeschritten `
                + "übersprungen, der Lauf geht weiter (Review B3)." });
          } else z.unveraendert++;
          continue;
        }

        // Geschlossene Verkaufschancen sind schreibgeschützt (Review A3)
        if (s.skipIfClosed && bestand && Number(bestand.statecode) !== 0) {
          z.uebersprungen++;
          alleWarnungen.push({ schritt: s.step, zeile: zeile._zeile,
            wert: schluesselWert,
            meldung: "Verkaufschance ist geschlossen und damit schreibgeschützt – "
              + "wird übersprungen, nicht automatisch wiedereröffnet" });
          continue;
        }

        const r = MAPPING.baue(zeile, zu, {
          modus: bestand ? "update" : "create",
          bestand, werte, zusatzZeile
        });

        for (const f of r.fehler) alleFehler.push({ schritt: s.step, ...f });
        for (const w of r.warnungen) alleWarnungen.push({ schritt: s.step, ...w });

        if (r.fehler.length) { z.fehler++; continue; }
        if (!bestand) z.neu++;
        else if (r.unveraendert) z.unveraendert++;
        else z.aktualisiert++;
      }

      for (const k of Object.keys(gesamt)) gesamt[k] += z[k];
      schritte.push(z);
    }

    return { schritte, gesamt, fehler: alleFehler, warnungen: alleWarnungen };
  }

  const zaehler = () => ({ neu: 0, aktualisiert: 0, unveraendert: 0,
                           uebersprungen: 0, fehler: 0, zeilen: 0 });

  /** Ein Satz für die Oberfläche. */
  const zusammenfassung = g =>
    `${g.neu} neu · ${g.aktualisiert} geändert · ${g.unveraendert} unverändert`
    + (g.uebersprungen ? ` · ${g.uebersprungen} übersprungen` : "")
    + (g.fehler ? ` · ${g.fehler} mit Fehler` : "");

  return { lauf, zusammenfassung };
})();
