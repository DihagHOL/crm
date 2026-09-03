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

  /** Ausgeschlossene Zeilen wiedererkennen.
   *
   *  Fällt eine Zeile in Schritt 10 durch, darf nichts mehr geschrieben
   *  werden, was an ihr hängt. Sie über den Schlüsselwert des Schrittes zu
   *  merken, geht nicht: Schritt 10 sucht über die Kundennummer, Schritt 20
   *  über die E-Mail, Schritt 30 über die Opp-ID.
   *
   *  Zwei Wege reichen:
   *  · innerhalb desselben Blattes die Zeilennummer,
   *  · blattübergreifend die Spalte, mit der ein Kindblatt an sein
   *    Elternblatt hängt (`Opp-ID` zwischen Anfragen und Positionen).
   *  Welche Spalte das ist, steht im Profil: die Quellspalte der Zuordnung,
   *  die auf `parentField` zeigt.
   *
   *  Prüflauf und Import benutzen denselben Verfolger. Zwei Fassungen
   *  desselben Gedankens wären zwei Fassungen, die auseinanderlaufen – und
   *  dann sagt der Prüflauf etwas anderes voraus, als der Import tut.    */
  function ausschluss(profil) {
    const zeilen = new Set();   // "Blatt|Zeilennummer"
    const links = new Set();    // "Spalte|Wert"
    const spalten = [...new Set(
      profil.schritte.flatMap(st => (profil.zuordnungen[st.mappingKey] || [])
        .filter(z => z.aktiv && st.parentField && z.targetField === st.parentField)
        .map(z => z.sourceColumn).filter(Boolean)))];

    return {
      spalten,
      merke(blatt, zeile) {
        zeilen.add(`${blatt}|${zeile._zeile}`);
        for (const sp of spalten)
          if (!leer(zeile[sp])) links.add(`${sp}|${String(zeile[sp])}`);
      },
      ist(blatt, zeile) {
        return zeilen.has(`${blatt}|${zeile._zeile}`)
          || spalten.some(sp => !leer(zeile[sp]) && links.has(`${sp}|${String(zeile[sp])}`));
      }
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
  /** Steht ein Wert der Zeile in `SkipOnValues` des Schrittes?
   *  @returns {{spalte:string, wert:*}|null} */
  function ausgelassen(s, zeile) {
    const regeln = s.skipOnValues;
    if (!regeln) return null;
    for (const [spalte, werte] of Object.entries(regeln)) {
      const v = zeile[spalte];
      if (leer(v)) continue;
      const liste = Array.isArray(werte) ? werte : [werte];
      if (liste.some(x => String(x).toLowerCase() === String(v).toLowerCase()))
        return { spalte, wert: v };
    }
    return null;
  }

  function lauf(profil, mappe, aufl, werte = {}, entscheidungen = null) {
    const zusatzZeile = zusatzZeileFn(mappe);
    /* Was ein früherer Schritt anlegt, gibt es beim Import – auch wenn
       Phase 0 es noch nicht kennt. Die Vorschau muss das mitrechnen, sonst
       meldet sie „Kontakt nicht gefunden, Feld bleibt leer" für genau die
       Kontakte, die Schritt 20 gerade anlegt. Der Importlauf tut dasselbe
       (`merkeNeu` in lauf.js) – nur mit der echten GUID. */
    const entstehen = new Set();
    const aufgeloestRoh = AUFLOESUNG.aufloeser(aufl, entscheidungen);
    const aufgeloest = (es, feld, wert) => {
      const r = aufgeloestRoh(es, feld, wert);
      if (r === null && entstehen.has(`${es}|${feld}|${wert}`)) return undefined;
      return r;
    };
    const aus = ausschluss(profil);
    const schritte = [], alleFehler = [], alleWarnungen = [], alleAusschluesse = [];
    const gesamt = { neu: 0, aktualisiert: 0, unveraendert: 0, uebersprungen: 0,
                     ausgeschlossen: 0, geloescht: 0, fehler: 0 };

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

      // Ein Alternativschlüssel, den es in Dataverse nicht gibt, macht
      // jede Zeile dieses Schrittes unschreibbar. Einmal melden, nicht
      // hundertmal – und den Import sperren.
      const skFehler = s.alternateKey
        && aufl.schluesselFehlt?.get(`${s.entitySet}|${s.alternateKey}`);
      if (skFehler) {
        z.strukturfehler = skFehler;
        z.fehler++;
        alleFehler.push({ schritt: s.step, feld: s.alternateKey, meldung: skFehler });
        schritte.push(z);
        for (const k of Object.keys(gesamt)) gesamt[k] += z[k];
        continue;
      }

      /* Spalten mit Quelle, aber ohne Zielfeld, sind Klartext für Meldungen
         und Vorschau – im Profil steht das bei `Firmaname` ausdrücklich so.
         Ohne sie steht im Fehlerbericht nur eine Kundennummer, und wer ihn
         liest, muss zurück in die Datei, um zu sehen, welche Firma gemeint
         ist (CLAUDE.md §14). */
      const klartextSpalten = zu
        .filter(k => k.aktiv && k.sourceColumn && !k.targetField)
        .map(k => k.sourceColumn);
      const klartext = zeile => klartextSpalten
        .map(sp => zeile[sp]).filter(v => !leer(v)).map(String).join(" · ");

      /* Nicht scharf geschaltete Modi zählen als übersprungen, nicht als
         „neu". Der Import überspringt sie (Win/Loss ist fachlich
         zurückgestellt) – die Vorschau muss dasselbe sagen, sonst kündigt
         sie Datensätze an, die nie entstehen. */
      if (s.mode === "CloseOpportunity") {
        z.uebersprungen = blatt.anzahl;
        alleWarnungen.push({ schritt: s.step,
          meldung: `Modus ${s.mode} ist nicht scharf geschaltet – `
            + `${blatt.anzahl} Zeile(n) werden übersprungen (fachlich offen).` });
        schritte.push(z);
        for (const k of Object.keys(gesamt)) gesamt[k] += z[k];
        continue;
      }

      /* Vertriebsphase setzen. Die Vorschau muss denselben Weg gehen wie
         der Import (`stufenAuftrag` in lauf.js): zwei Sprünge, und
         angelegt wird nichts. Rechnete sie anders, kündigte sie Änderungen
         an, die nie geschrieben werden — und das ist genau die Zusage, die
         der Prüflauf gibt. */
      if (s.mode === "SetStage") {
        const eltern = zu.find(x => x.aktiv && x.targetType === "Lookup"
                                    && x.targetField === s.parentField);
        const instanzen = eltern
          ? aufl.treffer?.get(`${s.entitySet}|_${s.parentField}_value`) : null;
        const eid = eltern ? aufl.idFelder?.get(eltern.lookupEntitySet) : null;

        /* Ohne aufgelösten Elternverweis gibt es keine Prozessinstanz zu
           finden. Das ist ein Konfigurationsfehler, keine Eigenschaft der
           Daten – und er gehört einmal in den Bericht, nicht stumm in die
           Spalte „übersprungen". */
        if (!eltern?.lookupEntitySet || !eltern.lookupKeyField) {
          z.uebersprungen = blatt.anzahl;
          alleWarnungen.push({ schritt: s.step,
            meldung: `Modus SetStage braucht einen aufgelösten Verweis auf `
              + `${s.parentField || "den Elterndatensatz"} – ohne ihn ist die `
              + `Prozessinstanz nicht zu finden. ${blatt.anzahl} Zeile(n) werden `
              + `übersprungen.` });
          schritte.push(z);
          for (const k of Object.keys(gesamt)) gesamt[k] += z[k];
          continue;
        }

        for (const zeile of blatt.zeilen) {
          if (aus.ist(s.sourceSheet, zeile)) { z.uebersprungen++; continue; }
          if (ausgelassen(s, zeile)) { z.uebersprungen++; continue; }

          const ew = TRANSFORMS.anwenden(zeile[eltern.sourceColumn], eltern.transform).wert;
          if (leer(ew)) { z.uebersprungen++; continue; }

          const et = AUFLOESUNG.finde(aufl, eltern.lookupEntitySet, eltern.lookupKeyField,
                                      ew, entscheidungen);
          const elternId = et.records[0] && eid ? et.records[0][eid] : null;
          const bestand = elternId
            ? instanzen?.get(AUFLOESUNG.vergleichbar(elternId))?.[0] || null : null;
          if (!bestand) {
            z.uebersprungen++;
            alleWarnungen.push({ schritt: s.step, zeile: zeile._zeile,
              spalte: eltern.sourceColumn, wert: ew, klartext: klartext(zeile),
              meldung: elternId
                ? "Keine Prozessinstanz vorhanden – die Phase kann nicht gesetzt werden"
                : `${eltern.lookupEntitySet} zu „${ew}“ nicht aufgelöst` });
            continue;
          }

          const r = MAPPING.baue(zeile, zu, {
            modus: "update", bestand, werte, zusatzZeile,
            nav: aufl.navigation?.get(s.entitySet),
            aufloesen: aufgeloest, schluesselImRumpf: false });

          for (const f of r.fehler) alleFehler.push({ schritt: s.step, ...f });
          for (const w of r.warnungen) alleWarnungen.push({ schritt: s.step, ...w });

          if (r.fehler.length) z.fehler++;
          else if (r.unveraendert) z.unveraendert++;
          else z.aktualisiert++;
        }

        schritte.push(z);
        for (const k of Object.keys(gesamt)) gesamt[k] += z[k];
        continue;
      }

      /* Ersetzen heisst löschen und neu anlegen. Ohne diese Zahl steht im
         Bericht „87 neu" und sonst nichts – und wer die Datei ein zweites
         Mal importiert, wundert sich zu Recht, warum nichts „unverändert"
         ist. Die alten Kinddatensätze hat Phase 0 bereits abgefragt. */
      if (s.mode === "ReplaceByParent" && s.parentField) {
        const alt = aufl.treffer?.get(`${s.entitySet}|_${s.parentField}_value`);
        if (alt) for (const rs of alt.values()) z.geloescht += rs.length;
      }

      const key = zu.find(k => k.aktiv && k.istSchluessel && k.targetField);

      for (const zeile of blatt.zeilen) {
        // Hängt die Zeile an einer, die schon ausgeschlossen ist? Dann
        // entsteht hier nichts – und die Vorschau darf sie auch nicht als
        // „neu" zählen, sonst sagt sie mehr voraus, als der Import tut.
        if (aus.ist(s.sourceSheet, zeile)) { z.uebersprungen++; continue; }

        // Ausdrücklich ausgelassene Werte (Sammeladresse dummy@dihag.com).
        // Kein Fehler und keine Warnung, sondern eine Regel aus dem Profil.
        const uebergangen = ausgelassen(s, zeile);
        if (uebergangen) {
          z.uebersprungen++;
          alleWarnungen.push({ schritt: s.step, zeile: zeile._zeile,
            spalte: uebergangen.spalte, wert: uebergangen.wert,
            meldung: "Steht in SkipOnValues – dieser Schritt lässt die Zeile aus" });
          continue;
        }

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

        // Bestand nachschlagen – auch ohne Alternativschlüssel. Ob der
        // Datensatz existiert, hängt nicht daran, wie er adressiert wird.
        let bestand = null, mehrdeutig = false, entschieden = false;
        if (key) {
          const t = AUFLOESUNG.finde(aufl, s.entitySet, key.targetField,
                                     schluesselWert, entscheidungen);
          mehrdeutig = t.mehrdeutig;
          entschieden = t.entschieden;
          bestand = t.records[0] || null;
        }
        if (entschieden)
          alleWarnungen.push({ schritt: s.step, zeile: zeile._zeile,
            spalte: key.sourceColumn, wert: schluesselWert, klartext: klartext(zeile),
            meldung: "Mehrfachtreffer – es gilt der von Hand gewählte Datensatz. "
              + "Die Entscheidung steht im Protokoll." });

        if (mehrdeutig) {
          z.fehler++;
          aus.merke(s.sourceSheet, zeile);
          alleFehler.push({ schritt: s.step, zeile: zeile._zeile, spalte: key.sourceColumn,
            wert: schluesselWert, klartext: klartext(zeile),
            meldung: `Mehrfachtreffer: ${schluesselWert} findet mehrere Datensätze. `
              + "Bitte oben unter „Offene Entscheidungen“ auswählen, welcher "
              + "gemeint ist – geraten wird nicht." });
          continue;
        }

        /* Nur nachschlagen (Konten).

           Ein Konto, das es nicht gibt, ist KEIN blockierender Fehler.
           Genau das war Befund B3: „Vorher hätte eine einzige unbekannte
           Nummer den ganzen Import verhindert." Die Zeile fällt aus allen
           Folgeschritten, der Lauf geht weiter — und weil sie ausdrücklich
           ausgewiesen und bestätigt wird, fällt sie niemandem hinten
           herunter (Randbedingung 12).                                     */
        if (s.mode === "LookupOnly") {
          if (!bestand) {
            z.ausgeschlossen++;
            aus.merke(s.sourceSheet, zeile);
            alleAusschluesse.push({ schritt: s.step, zeile: zeile._zeile,
              spalte: key?.sourceColumn, wert: schluesselWert, klartext: klartext(zeile),
              meldung: `In ${s.entitySet} nicht gefunden – diese Zeile wird in allen `
                + "Folgeschritten übersprungen, der Lauf geht weiter (Review B3)." });
          } else z.unveraendert++;
          continue;
        }

        // Geschlossene Verkaufschancen sind schreibgeschützt (Review A3)
        if (s.skipIfClosed && bestand && Number(bestand.statecode) !== 0) {
          z.uebersprungen++;
          alleWarnungen.push({ schritt: s.step, zeile: zeile._zeile,
            wert: schluesselWert, klartext: klartext(zeile),
            meldung: "Verkaufschance ist geschlossen und damit schreibgeschützt – "
              + "wird übersprungen, nicht automatisch wiedereröffnet" });
          continue;
        }

        const r = MAPPING.baue(zeile, zu, {
          modus: bestand ? "update" : "create",
          bestand, werte, zusatzZeile,
          nav: aufl.navigation?.get(s.entitySet),
          aufloesen: aufgeloest,
          schluesselImRumpf: !s.alternateKey
        });

        for (const f of r.fehler) alleFehler.push({ schritt: s.step, ...f });
        for (const w of r.warnungen) alleWarnungen.push({ schritt: s.step, ...w });

        if (r.fehler.length) { z.fehler++; continue; }
        if (!bestand) {
          z.neu++;
          if (key) entstehen.add(`${s.entitySet}|${key.targetField}|${schluesselWert}`);
        }
        else if (r.unveraendert) z.unveraendert++;
        else z.aktualisiert++;
      }

      for (const k of Object.keys(gesamt)) gesamt[k] += z[k];
      schritte.push(z);
    }

    return { schritte, gesamt, fehler: alleFehler, warnungen: alleWarnungen,
             ausschluesse: alleAusschluesse };
  }

  const zaehler = () => ({ neu: 0, aktualisiert: 0, unveraendert: 0, uebersprungen: 0,
                           ausgeschlossen: 0, geloescht: 0, fehler: 0, zeilen: 0 });

  /** Ein Satz für die Oberfläche. */
  const zusammenfassung = g =>
    `${g.neu} neu · ${g.aktualisiert} geändert · ${g.unveraendert} unverändert`
    + (g.uebersprungen ? ` · ${g.uebersprungen} übersprungen` : "")
    + (g.ausgeschlossen ? ` · ${g.ausgeschlossen} ausgeschlossen` : "")
    + (g.geloescht ? ` · ${g.geloescht} werden ersetzt` : "")
    + (g.fehler ? ` · ${g.fehler} mit Fehler` : "");

  return { lauf, zusammenfassung, ausschluss, ausgelassen };
})();
