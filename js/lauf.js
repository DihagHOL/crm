"use strict";

/* Der Import – Phase 6.

   Er läuft in der Reihenfolge des Profils, in Stapeln, mit Drosselung und
   jederzeit abbrechbar. Jeder Datensatz landet im Protokoll, auch die
   übersprungenen und gewarnten (Randbedingung 12).

   DREI DINGE, DIE DEN UNTERSCHIED ZUM ALTFLOW AUSMACHEN

   · Eine Zeile, die in Schritt 10 kein Konto findet, wird in ALLEN
     Folgeschritten übersprungen – zeilenweise, nicht laufweise. Eine
     einzige unbekannte Kundennummer darf nicht 71 gute Anfragen mitreißen
     (Review B3).

   · Positionen werden je Verkaufschance in EINEM Changeset ersetzt: erst
     löschen, dann anlegen, atomar. Der Altflow löscht, wartet 60 Sekunden
     und legt dann an; bricht er dazwischen ab, sind die Positionen weg
     (Befund B3).

   · Bei Zeitüberschreitung oder 5xx auf ein POST wird NICHT blind
     wiederholt. Die Anfrage kann angekommen sein und nur die Antwort
     verloren gegangen – eine Wiederholung legte den Datensatz ein zweites
     Mal an (Review B5).                                                    */

const LAUF = (() => {

  const leer = v => v === null || v === undefined || v === "";
  const GUID_ROH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const warte = ms => new Promise(r => setTimeout(r, ms));

  /**
   * @param {object} k Kontext: profil, mappe, aufl, werte, entscheidungen
   * @param {object} [opt] onFortschritt, onEintrag, signal (AbortSignal)
   * @returns {Promise<{eintraege:object[], gesamt:object, gedrosselt:number,
   *                    abgebrochen:boolean, dauerMs:number}>}
   */
  async function ausfuehren(k, opt = {}) {
    const t0 = Date.now();
    const melde = opt.onFortschritt || (() => {});
    const eintrag = opt.onEintrag || (() => {});
    const signal = opt.signal;

    const basis = DV.basis();
    const eintraege = [];
    const gesamt = { angelegt: 0, aktualisiert: 0, unveraendert: 0,
                     uebersprungen: 0, fehlgeschlagen: 0 };
    /* Ausgeschlossene Zeilen – derselbe Verfolger wie im Prüflauf.
       Zwei Fassungen desselben Gedankens laufen auseinander, und dann sagt
       der Prüflauf etwas anderes voraus, als hier geschieht. */
    const aus = PRUEFUNG.ausschluss(k.profil);
    let gedrosselt = 0, abgebrochen = false;

    // Drosselung: mit maßvoller Parallelität starten. Große Stapel sind
    // nicht schneller – die Ausführungszeitgrenze schlägt zuerst zu.
    let parallel = Math.max(1, CRM_CONFIG.maxParallel || 4);
    let folge429 = 0;

    const notiere = e => { eintraege.push(e); eintrag(e); gesamt[e.aktion] = (gesamt[e.aktion] || 0) + 1; };

    /** Neu angelegte Datensätze in die Auflösung nachtragen.
     *
     *  Phase 0 fragt VOR dem Lauf ab. Was Schritt 30 gerade anlegt, steht
     *  dort also nicht – und Schritt 40 sucht den Elterndatensatz genau
     *  dort. Ohne diesen Nachtrag scheitern die Positionen jeder NEUEN
     *  Verkaufschance mit „Elterndatensatz nicht aufgelöst", also
     *  ausgerechnet da, wo der Import gebraucht wird. Bestandschancen gehen
     *  durch, neue nicht: ein Fehler, der mit der Zahl der Neuanlagen
     *  wächst und im Prüflauf nicht sichtbar ist.
     *
     *  Die GUID steht in der Batch-Antwort (`OData-EntityId`) und liegt am
     *  Protokolleintrag als `dataverseId`. */
    const neuAngelegt = new Set();     // "entitySet|feld|wert"
    const istNeu = (es, feld, wert) => neuAngelegt.has(`${es}|${feld}|${wert}`);

    /** Auflöser mit Gedächtnis: Was ein früherer Schritt in DIESEM Lauf
     *  angelegt hat, gilt als vorhanden – auch wenn Phase 0 es nicht kennt
     *  und die Antwort keine GUID mitgebracht hat. Sonst liesse der Import
     *  das Verweisfeld leer, weil er den Datensatz nicht findet, den er
     *  eine Sekunde vorher selbst angelegt hat. Der Prüflauf rechnet
     *  genauso (`entstehen` in pruefung.js). */
    const aufgeloest = (es, feld, wert) => {
      const r = aufgeloestRoh(es, feld, wert);
      if (r === null && istNeu(es, feld, String(wert))) return undefined;
      return r;
    };

    function merkeNeu(s, key, n) {
      if (n.aktion !== "angelegt" || !key?.targetField || leer(n.schluessel)) return;
      const wert = String(n.schluessel);
      neuAngelegt.add(`${s.entitySet}|${key.targetField}|${wert}`);

      // Die GUID steht in `OData-EntityId`. Fehlt sie, bleibt der Datensatz
      // trotzdem als „in diesem Lauf angelegt" vermerkt – für einen eben
      // angelegten Elterndatensatz braucht es keine GUID: es gibt nichts zu
      // löschen, und gebunden wird über den Alternativschlüssel.
      // Ohne echte GUID kein Eintrag in die Auflösung: `neuAngelegt` oben
      // reicht, damit Folgeschritte über den Alternativschlüssel binden.
      if (!n.dataverseId) return;
      const idF = AUFLOESUNG.idFeld(k.aufl, s.entitySet);
      const sl = `${s.entitySet}|${key.targetField}`;
      if (!k.aufl.treffer.has(sl)) k.aufl.treffer.set(sl, new Map());
      const m = k.aufl.treffer.get(sl);
      if (m.has(wert)) return;
      m.set(wert, [{ [key.targetField]: n.schluessel, [idF]: n.dataverseId, statecode: 0 }]);
    }

    const zusatzZeile = zusatzZeileFn(k.mappe);
    const aufgeloestRoh = AUFLOESUNG.aufloeser(k.aufl, k.entscheidungen);

    for (const s of k.profil.schritte) {
      if (signal?.aborted) { abgebrochen = true; break; }
      if (!s.aktiv) continue;

      const zu = k.profil.zuordnungen[s.mappingKey] || [];
      const blatt = EXCEL.blatt(k.mappe, s.sourceSheet);
      if (!blatt) continue;
      melde({ schritt: s.step, text: `Schritt ${s.step} · ${s.entitySet}` });

      if (s.mode === "SetStage" || s.mode === "CloseOpportunity") {
        // Bewusst nicht gebaut: Win/Loss werden vorerst nicht importiert,
        // und ohne zugeordnete Status-Spalte gibt es keine Phase zu setzen.
        for (const zeile of blatt.zeilen)
          notiere({ schritt: s.step, entitySet: s.entitySet, zeile: zeile._zeile,
            aktion: "uebersprungen",
            meldung: `Modus ${s.mode} ist nicht scharf geschaltet (fachlich offen).` });
        continue;
      }

      const auftraege = [];
      const key = zu.find(z => z.aktiv && z.istSchluessel && z.targetField);

      for (const zeile of blatt.zeilen) {
        const sw = key ? TRANSFORMS.anwenden(zeile[key.sourceColumn], key.transform).wert : null;

        const uebergangen = PRUEFUNG.ausgelassen(s, zeile);
        if (uebergangen) {
          notiere({ schritt: s.step, entitySet: s.entitySet, zeile: zeile._zeile,
            aktion: "uebersprungen",
            meldung: `${uebergangen.spalte} = „${uebergangen.wert}“ steht in SkipOnValues` });
          continue;
        }

        if (key && leer(sw)) {
          notiere({ schritt: s.step, entitySet: s.entitySet, zeile: zeile._zeile,
            aktion: "uebersprungen", meldung: "Schlüsselwert fehlt" });
          continue;
        }
        if (aus.ist(s.sourceSheet, zeile)) {
          notiere({ schritt: s.step, entitySet: s.entitySet, zeile: zeile._zeile,
            schluessel: sw, aktion: "uebersprungen",
            meldung: "Zeile wurde in einem früheren Schritt ausgeschlossen" });
          continue;
        }

        // Auch ohne Alternativschlüssel nachschlagen: ob der Datensatz
        // existiert, hängt nicht daran, wie er adressiert wird.
        const t = key
          ? AUFLOESUNG.finde(k.aufl, s.entitySet, key.targetField, sw, k.entscheidungen)
          : { records: [], mehrdeutig: false };
        const bestand = t.records[0] || null;

        if (t.mehrdeutig) {
          aus.merke(s.sourceSheet, zeile);
          notiere({ schritt: s.step, entitySet: s.entitySet, zeile: zeile._zeile,
            schluessel: sw, aktion: "fehlgeschlagen",
            meldung: "Mehrfachtreffer ohne Entscheidung" });
          continue;
        }

        if (s.mode === "LookupOnly") {
          if (!bestand) {
            aus.merke(s.sourceSheet, zeile);
            // „übersprungen", nicht „fehlgeschlagen": Der Lauf hat hier
            // nichts versucht und ist an nichts gescheitert. Er hat eine
            // Zeile bewusst ausgelassen, die im Prüflauf ausgewiesen und
            // bestätigt wurde.
            notiere({ schritt: s.step, entitySet: s.entitySet, zeile: zeile._zeile,
              schluessel: sw, aktion: "uebersprungen",
              meldung: "Nicht gefunden – Zeile wird in allen Folgeschritten übersprungen" });
          } else {
            notiere({ schritt: s.step, entitySet: s.entitySet, zeile: zeile._zeile,
              schluessel: sw, aktion: "unveraendert", meldung: "aufgelöst" });
          }
          continue;
        }

        if (s.skipIfClosed && bestand && Number(bestand.statecode) !== 0) {
          notiere({ schritt: s.step, entitySet: s.entitySet, zeile: zeile._zeile,
            schluessel: sw, aktion: "uebersprungen",
            meldung: "geschlossen und damit schreibgeschützt" });
          continue;
        }

        const r = MAPPING.baue(zeile, zu, {
          modus: bestand ? "update" : "create", bestand, werte: k.werte, zusatzZeile,
          nav: k.aufl.navigation?.get(s.entitySet),
          aufloesen: aufgeloest,
          schluesselImRumpf: !s.alternateKey });

        if (r.fehler.length) {
          notiere({ schritt: s.step, entitySet: s.entitySet, zeile: zeile._zeile,
            schluessel: sw, aktion: "fehlgeschlagen",
            meldung: r.fehler.map(f => f.meldung).join(" · ") });
          continue;
        }
        if (r.unveraendert) {
          notiere({ schritt: s.step, entitySet: s.entitySet, zeile: zeile._zeile,
            schluessel: sw, aktion: "unveraendert",
            ...(r.warnungen.length ? { warnungen: r.warnungen.map(w => w.meldung) } : {}) });
          continue;
        }

        const auftrag = { zeile, sw, bestand, nutzlast: r.nutzlast, felder: r.felder,
                          warnungen: r.warnungen,
                          schritt: s, zuordnungen: zu,
                          eigeneId: bestand ? bestand[AUFLOESUNG.idFeld(k.aufl, s.entitySet)] : null };

        // Beim Ersetzen: welcher Elterndatensatz, und was haengt heute dran?
        if (s.mode === "ReplaceByParent" && s.parentField) {
          const ez = zu.find(x => x.aktiv && x.targetField === s.parentField
                                  && x.targetType === "Lookup");
          if (ez) {
            const ew = TRANSFORMS.anwenden(zeile[ez.sourceColumn], ez.transform).wert;
            const et = AUFLOESUNG.finde(k.aufl, ez.lookupEntitySet, ez.lookupKeyField,
                                        ew, k.entscheidungen);
            const eid = k.aufl.idFelder?.get(ez.lookupEntitySet);
            auftrag.elternSchluessel = ew;
            auftrag.elternId = et.records[0] && eid ? et.records[0][eid] : null;
            // Ohne GUID geht es weiter, WENN der Elterndatensatz in diesem
            // Lauf entstanden ist: dann gibt es keine alten Kinder zu
            // löschen, und die Bindung läuft ohnehin über den
            // Alternativschlüssel. Sonst ist es ein echter Fehler.
            if (!auftrag.elternId && !istNeu(ez.lookupEntitySet, ez.lookupKeyField, String(ew))) {
              notiere({ schritt: s.step, entitySet: s.entitySet, zeile: zeile._zeile,
                schluessel: sw, aktion: "fehlgeschlagen",
                meldung: `Elterndatensatz ${ez.lookupEntitySet} zu „${ew}“ nicht aufgeloest` });
              continue;
            }
          }
        }

        auftraege.push(auftrag);
      }

      if (!auftraege.length) continue;

      // ── In Stapel schneiden ────────────────────────────────────────
      const groesse = s.batchSize || CRM_CONFIG.batchSize || 100;
      const stapel = [];
      if (s.mode === "ReplaceByParent") {
        // Je Elterndatensatz ein Changeset. Mehrere Changesets dürfen in
        // denselben Batch, aber ein Changeset darf nie geteilt werden.
        const proEltern = new Map();
        for (const a of auftraege) {
          // Je Elterndatensatz ein Changeset – auch wenn nur sein
          // Schlüssel bekannt ist. Alle GUID-losen in einen Topf zu werfen
          // hiesse: eine kaputte Position rollt fremde mit zurück.
          const p = a.elternId ? String(a.elternId)
                  : a.elternSchluessel != null ? "schluessel:" + a.elternSchluessel
                  : String(a.sw);
          if (!proEltern.has(p)) proEltern.set(p, []);
          proEltern.get(p).push(a);
        }
        let aktuell = [];
        for (const [eltern, gruppe] of proEltern) {
          aktuell.push({ eltern, gruppe });
          if (aktuell.length >= 20) { stapel.push(aktuell); aktuell = []; }
        }
        if (aktuell.length) stapel.push(aktuell);
      } else {
        for (let i = 0; i < auftraege.length; i += groesse)
          stapel.push(auftraege.slice(i, i + groesse));
      }

      // ── Stapel senden ──────────────────────────────────────────────
      let i = 0;
      while (i < stapel.length) {
        if (signal?.aborted) { abgebrochen = true; break; }
        const gleichzeitig = stapel.slice(i, i + parallel);
        melde({ schritt: s.step,
          text: `Schritt ${s.step} · Stapel ${i + 1}–${i + gleichzeitig.length} von ${stapel.length}` });

        const ergebnisse = await Promise.all(gleichzeitig.map(st =>
          sendeStapel(st, s, basis, signal, k)));

        for (const e of ergebnisse) {
          if (e.gedrosselt) { gedrosselt += e.gedrosselt; folge429 += e.gedrosselt; }
          else folge429 = 0;
          for (const n of e.eintraege) { notiere(n); merkeNeu(s, key, n); }
        }

        if (folge429 >= 3 && parallel > 1) {
          parallel = 1;
          melde({ schritt: s.step, text: "Drei Drosselungen in Folge – Parallelität auf 1 gesenkt." });
        } else if (ergebnisse.some(e => e.gedrosselt) && parallel > 1) {
          parallel = Math.max(1, Math.floor(parallel / 2));
        }
        i += gleichzeitig.length;
      }
      if (abgebrochen) break;
    }

    return { eintraege, gesamt, gedrosselt, abgebrochen,
             dauerMs: Date.now() - t0, parallelAmEnde: parallel };
  }

  /** Einen Stapel als Batch senden, mit Wiederholung nach `Retry-After`. */
  async function sendeStapel(stapel, s, basis, signal, kontext, versuch = 0) {
    const istChangeset = s.mode === "ReplaceByParent";
    const teile = [];
    const zuordnung = [];   // Antwortindex → Auftrag

    if (istChangeset) {
      for (const { eltern, gruppe } of stapel) {
        const cs = [];
        // Erst die alten Positionen weg, dann die neuen – im selben
        // Changeset, damit dazwischen nichts schiefgehen kann.
        const alt = alteKinder(kontext, s, eltern);
        for (const p of alt) {
          cs.push({ methode: "DELETE", url: `${basis}/${s.entitySet}(${p})` });
          zuordnung.push({ art: "delete" });
        }
        for (const a of gruppe) {
          cs.push({ methode: "POST", url: `${basis}/${s.entitySet}`, koerper: a.nutzlast });
          zuordnung.push({ art: "post", auftrag: a });
        }
        teile.push({ changeset: cs });
      }
    } else {
      for (const a of stapel) {
        /* Wie wird der Datensatz adressiert? Drei Fälle, und der mittlere
           hat 29 Kontakte gekostet:

           · Bekannt (Phase 0 hat ihn gefunden) → über seine GUID. Die geht
             immer, auch ohne Alternativschlüssel, und ist eindeutig.
           · Unbekannt, aber der Schritt hat einen Alternativschlüssel →
             Upsert über die Schlüsseladresse. Dataverse legt an.
           · Unbekannt, kein Alternativschlüssel → POST. Der Schlüsselwert
             steht dann im Rumpf (`schluesselImRumpf`), sonst entstünde ein
             Kontakt ohne E-Mail-Adresse.

           Vorher wurde bei `Upsert` IMMER die Schlüsseladresse gebaut, auch
           wenn die Tabelle gar keinen Alternativschlüssel hat. Dataverse
           antwortet darauf mit 0x80060888 – „The key in the request URI is
           not valid" – und zwar für jede einzelne Zeile.                */
        const adresse = a.eigeneId
          ? `${s.entitySet}(${a.eigeneId})`
          : (s.alternateKey && (s.mode === "Upsert" || s.mode === "Update"))
            ? MAPPING.schluesselAdresse(s.entitySet, { [schluesselFeld(a)]: a.sw })
            : null;

        if (!adresse || s.mode === "Create") {
          const headers = {};
          if (s.mode === "Create") headers["If-None-Match"] = "*";
          teile.push({ methode: "POST", url: `${basis}/${s.entitySet}`,
                       koerper: a.nutzlast, headers });
        } else {
          const headers = {};
          if (s.mode === "Update") headers["If-Match"] = "*";
          teile.push({ methode: "PATCH", url: `${basis}/${adresse}`,
                       koerper: a.nutzlast, headers });
        }
        zuordnung.push({ art: a.bestand ? "update" : "create", auftrag: a });
      }
    }

    const grenze = "batch_" + BATCH.uuid();
    let antwort, text;
    try {
      antwort = await fetch(`${basis}/$batch`, {
        method: "POST", signal,
        headers: {
          Authorization: "Bearer " + await AUTH.getToken("dataverse"),
          "Content-Type": `multipart/mixed; boundary=${grenze}`,
          Accept: "application/json",
          // Eine kaputte Zeile darf die anderen 99 nicht mitreißen.
          Prefer: "odata.continue-on-error"
        },
        body: BATCH.baue(teile, grenze)
      });
      text = await antwort.text();
    } catch (e) {
      if (e.name === "AbortError")
        return { eintraege: [], gedrosselt: 0 };
      return { gedrosselt: 0, eintraege: zuordnung.filter(z => z.auftrag).map(z =>
        protokoll(z, s, 0, "Netzfehler: " + e.message)) };
    }

    // Drosselung: exakt `Retry-After` warten, nie mit festem Sleep.
    if (antwort.status === 429 || antwort.status === 503) {
      if (versuch >= 5) {
        return { gedrosselt: 1, eintraege: zuordnung.filter(z => z.auftrag).map(z =>
          protokoll(z, s, antwort.status, "Nach 5 Versuchen weiterhin gedrosselt")) };
      }
      const sek = Number(antwort.headers.get("Retry-After")) || 10;
      await warte(sek * 1000);
      const w = await sendeStapel(stapel, s, basis, signal, kontext, versuch + 1);
      return { ...w, gedrosselt: (w.gedrosselt || 0) + 1 };
    }

    const teilAntworten = BATCH.lese(text);
    const eintraege = [];
    for (let n = 0; n < zuordnung.length; n++) {
      const z = zuordnung[n];
      if (!z.auftrag) continue;                 // DELETE im Changeset
      const a = teilAntworten[n];
      if (!a) { eintraege.push(protokoll(z, s, 0, "Keine Antwort im Batch")); continue; }
      eintraege.push(BATCH.erfolg(a.status)
        ? protokoll(z, s, a.status, null, a.ort)
        : protokoll(z, s, a.status, BATCH.fehlertext(a)));
    }
    return { gedrosselt: 0, eintraege };
  }

  /** Die heute vorhandenen Kinddatensätze eines Elterndatensatzes – aus
   *  Phase 0, nicht aus einer zusätzlichen Abfrage. */
  function alteKinder(k, s, elternId) {
    // Kein GUID, sondern ein Gruppenname: der Elterndatensatz ist in diesem
    // Lauf entstanden, es kann nichts daran hängen.
    if (String(elternId).startsWith("schluessel:")) return [];
    const t = AUFLOESUNG.finde(k.aufl, s.entitySet, `_${s.parentField}_value`, elternId);
    const idF = k.aufl.idFelder?.get(s.entitySet);
    return idF ? t.records.map(r => r[idF]).filter(Boolean) : [];
  }

  const schluesselFeld = a =>
    a.zuordnungen.find(z => z.aktiv && z.istSchluessel && z.targetField)?.targetField;

  function protokoll(z, s, status, fehler, ort) {
    const a = z.auftrag;
    const e = {
      schritt: s.step, entitySet: s.entitySet, zeile: a.zeile._zeile,
      schluessel: a.sw, felder: a.felder, httpStatus: status,
      aktion: fehler ? "fehlgeschlagen"
            : z.art === "update" ? "aktualisiert" : "angelegt"
    };
    if (fehler) e.meldung = fehler;

    /* Warnungen gehören ins Protokoll, nicht nur in den Prüfbericht.
       Randbedingung 12: kein Datensatz wird geschrieben, ohne dass er im
       Protokoll landet – auch gewarnte. Im ersten sauberen Lauf blieben
       vier Felder ungeschrieben (`ownerid`, beide cr570-Verweise), und im
       Protokoll stand davon nichts. Genau so verliert der Altflow die
       Zeichnungsnummer. */
    if (a.warnungen?.length) e.warnungen = a.warnungen.map(w => w.meldung);
    /* Bei einer Anlage über den Alternativschlüssel gibt Dataverse die
       SCHLÜSSELADRESSE zurück (`opportunities(new_dagextopid=7414)`), nicht
       die GUID. Beides als `dataverseId` zu führen, behauptet eine
       Datensatz-ID, die keine ist. Getrennt halten. */
    if (ort) {
      const teil = (String(ort).match(/\(([^)]+)\)\s*$/) || [])[1] || String(ort);
      if (GUID_ROH.test(teil)) e.dataverseId = teil;
      else e.schluesselAdresse = teil;
    }
    // Nur die Felder, die sich tatsächlich ändern – das ist die einzige
    // Möglichkeit, eine Änderung im Nachhinein zu beurteilen.
    if (z.art === "update" && a.bestand) {
      const vorher = {};
      for (const f of a.felder) if (f in a.bestand) vorher[f] = a.bestand[f];
      if (Object.keys(vorher).length) e.vorher = vorher;
    }
    return e;
  }

  /** wie in pruefung.js – Zeile eines anderen Blattes über einen Schlüssel */
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
          if (v && !m.has(v)) m.set(v, r);
        }
        index.set(k, m);
      }
      return index.get(k).get(String(zeile[ueber] ?? "")) || null;
    };
  }

  return { ausfuehren };
})();
