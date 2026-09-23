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

  /** Schlüsselfelder eines Verweises. Mehrere durch `|` getrennt, in der
   *  Reihenfolge, in der gesucht wird: `internalemailaddress|domainname`.
   *
   *  Ein Systembenutzer trägt seine Adresse an zwei Stellen – als
   *  Primäradresse und als Anmeldename –, und welche davon in der
   *  Quelldatei steht, ist von aussen nicht zu sehen. Ein einziges
   *  Schlüsselfeld heisst hier: entweder oder nichts. */
  const schluesselFelder = z => String(z.lookupKeyField || "")
    .split("|").map(t => t.trim()).filter(Boolean);

  /** Feldname für den Filter.
   *
   *  `Microsoft.Dynamics.CRM.In` kennt nur Attributnamen. Die
   *  OData-Schreibweise eines Verweises – `_opportunityid_value` – ist
   *  keiner, und Dataverse antwortet darauf mit HTTP 400: „entity doesn't
   *  contain attribute with Name = '_opportunityid_value'". Gefiltert wird
   *  deshalb über das Attribut (`opportunityid`), gelesen und gruppiert
   *  weiterhin über den Aliasnamen – nur unter dem steht die GUID in der
   *  Antwort. */
  const filterFeld = feld => /^_(.+)_value$/.exec(feld)?.[1] || feld;

  const zitat = v => `'${String(v).replace(/'/g, "''")}'`;
  const istGuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    .test(String(v));

  /** Rückfallweg, falls `In(...)` das Feld nicht annimmt: eine Kette aus
   *  `feld eq wert or …`. Das ist gewöhnliches OData und geht immer, kostet
   *  aber Adresslänge – jeder Wert schleppt den Feldnamen mit. Deshalb in
   *  kleineren Blöcken. */
  const KETTE = 20;

  async function ketteAbfragen(entitySet, feld, werte, sel) {
    let out = [];
    for (let i = 0; i < werte.length; i += KETTE) {
      const filter = werte.slice(i, i + KETTE)
        // GUIDs stehen in OData ohne Anführungszeichen, Text mit.
        .map(v => `${feld} eq ${istGuid(v) ? v : zitat(v)}`).join(" or ");
      out = out.concat(await DV.alle(`/${entitySet}?$select=${sel}`
        + `&$filter=${encodeURIComponent(filter)}`));
    }
    return out;
  }

  /** Werte in Blöcken abfragen und nach dem Schlüsselfeld gruppieren.
   *  Mehrfachtreffer werden NICHT auf den ersten reduziert – genau das tut
   *  der Altflow mit `$top: 1`, und genau deshalb schreibt er bei doppelten
   *  Kundennummern auf das falsche Konto.
   *  @returns {Promise<Map<*, object[]>>} */
  /** Vergleichsform eines Schlüsselwerts.
   *
   *  Dataverse vergleicht Zeichenketten **ohne** Rücksicht auf Gross- und
   *  Kleinschreibung. `internalemailaddress eq 'holger.kappelt@schmie-guss.de'`
   *  findet den Benutzer — zurück kommt er aber als
   *  `Holger.Kappelt@Schmie-guss.de`.
   *
   *  Die Auflösung legte ihn unter DIESER Schreibweise ab und suchte ihn
   *  danach kleingeschrieben, weil die Spalte `Mitarbeiter` durch
   *  `trim|lower` läuft. Ergebnis: „abgefragt und nicht vorhanden" über
   *  einen Datensatz, den sie sich selbst gerade geholt hatte — und der
   *  Besitzer blieb leer, ohne dass irgendetwas fehlgeschlagen wäre.
   *
   *  Die App muss so vergleichen wie die Abfrage, die sie stellt. Sonst
   *  widerspricht sie ihrem eigenen Ergebnis. */
  const vergleichbar = v => String(v).toLowerCase();

  async function sammle(entitySet, feld, werte, select) {
    const treffer = new Map();
    const liste = [...new Set(werte.filter(v => !leer(v)).map(v => String(v)))];
    const attribut = filterFeld(feld);
    const sel = encodeURIComponent(select);
    let inGehtNicht = false;

    for (let i = 0; i < liste.length; i += BLOCK) {
      const teil = liste.slice(i, i + BLOCK);
      let rows = null;

      if (!inGehtNicht) {
        const filter = `Microsoft.Dynamics.CRM.In(PropertyName='${attribut}',`
          + `PropertyValues=[${teil.map(zitat).join(",")}])`;
        try {
          rows = await DV.alle(`/${entitySet}?$select=${sel}`
            + `&$filter=${encodeURIComponent(filter)}`);
        } catch (e) {
          // 400 heißt: die Abfrage ist falsch gebaut, nicht die Umgebung
          // überlastet. Wiederholen bringt nichts, aber der andere Weg
          // schon. Alles andere – 401, 403, 429 – gehört nach oben.
          if (e.status !== 400) throw e;
          console.warn(`[Auflösung] In(...) auf ${entitySet}.${attribut} `
            + `abgelehnt: ${e.message} – weiter mit eq-Ketten.`);
          inGehtNicht = true;
        }
      }
      if (rows === null) rows = await ketteAbfragen(entitySet, feld, teil, sel);

      for (const r of rows) {
        const k = vergleichbar(r[feld]);
        if (!treffer.has(k)) treffer.set(k, []);
        treffer.get(k).push(r);
      }
    }
    return treffer;
  }

  /* ── Aktiv oder inaktiv ───────────────────────────────────────────
     Zwei Treffer auf denselben Wert sind meist kein Rätsel, sondern ein
     Altbestand: ein deaktivierter Datensatz und der, mit dem heute
     gearbeitet wird. Hausregel seit dem 23.09.2026: **ist genau einer
     aktiv, gewinnt er** – ohne Rückfrage, aber mit Vermerk im Protokoll.
     Sind mehrere aktiv oder alle inaktiv, bleibt es eine Frage an einen
     Menschen.

     Das Feld dafür heisst nicht überall gleich, und es ist auch nicht
     überall vorhanden: `statecode` bei fast allen Tabellen, `isdisabled`
     bei `systemuser` – und das mit umgekehrter Logik. `opportunityproduct`
     und `processstage` haben gar keins. Deshalb aus den Metadaten, nicht
     geraten. */

  /** @returns {Promise<"statecode"|"isdisabled"|null>} */
  async function zustandsFeld(entitySet, merker) {
    if (merker.has(entitySet)) return merker.get(entitySet);
    let f = null;
    try {
      const felder = await DV.felder(entitySet);
      if (felder.statecode) f = "statecode";
      else if (felder.isdisabled) f = "isdisabled";
    } catch { f = null; }   // keine Metadaten? Dann eben keine Regel.
    merker.set(entitySet, f);
    return f;
  }

  /** Ist dieser Datensatz aktiv? `null` heisst „nicht feststellbar". */
  function istAktiv(record, zustandsFeld) {
    if (!zustandsFeld || !record) return null;
    if (zustandsFeld === "statecode") {
      const v = record.statecode;
      return v === null || v === undefined ? null : Number(v) === 0;
    }
    // isdisabled: true heisst deaktiviert. Fehlt der Wert, gilt der
    // Datensatz als aktiv – so steht es auch in der Oberfläche von CRM.
    return record.isdisabled !== true;
  }

  /** Die aktiven unter mehreren Treffern. */
  const nurAktive = (records, zf) => records.filter(r => istAktiv(r, zf) === true);

  /** Welche Felder braucht der Vergleich? Alle, die der Import schreiben
   *  will – sonst ist „unverändert" nicht feststellbar (CLAUDE.md §8). */
  function vergleichsFelder(zuordnungen, primaerFeld, zustandsFeld) {
    /* `statecode`/`statuscode` nur, wenn die Tabelle sie führt. Blind
       mitselektiert, antwortet Dataverse mit 400 „Could not find a
       property named 'statecode'" – `opportunityproduct` hat keins. Heute
       fällt das nicht auf, weil dort kein Schlüsselfeld steht; beim
       nächsten Schlüsselfeld schon. */
    const s = new Set([primaerFeld]);
    if (zustandsFeld === "statecode") { s.add("statecode"); s.add("statuscode"); }
    else if (zustandsFeld) s.add(zustandsFeld);
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
  async function fuer(profil, mappe, fortschritt = () => {}, werte = {}) {
    const treffer = new Map();      // "entitySet|feld" → Map(wert → records)
    const abfragen = [];
    const idFelder = new Map();     // entitySet → Primärschlüsselfeld
    const navigation = new Map();   // entitySet → { Attribut: Navigationsname }
    const schluesselFehlt = new Map();  // "entitySet|feld" → Meldung oder null
    const zustandsFelder = new Map();   // entitySet → "statecode"|"isdisabled"|null

    /** Eine Abfrage vorbereiten, ausführen und protokollieren. */
    /** @param {boolean} [mehrfachErwartet] Mehrere Treffer je Wert sind
     *    hier normal, keine Doppeldeutigkeit – etwa die Positionen einer
     *    Verkaufschance. */
    async function frage(entitySet, feld, werte, select, zweck, mehrfachErwartet) {
      const gesucht = new Set(werte.filter(v => !leer(v)).map(v => String(v)));
      if (!gesucht.size) return;
      const k = schluessel(entitySet, feld);
      if (treffer.has(k)) return;   // dieselbe Abfrage nicht zweimal
      fortschritt(`${entitySet} über ${feld} (${gesucht.size} Werte) …`);

      /* Primärschlüsselfeld mitselektieren – ohne ihn lässt sich ein
         Datensatz bei Mehrfachtreffern nicht benennen, und genau das
         braucht die Entscheidung.

         Aus den METADATEN, nicht aus dem Namen abgeleitet. `logischerName
         + "id"` stimmt bei fast allen Tabellen und deshalb lange
         unbemerkt – `opportunitysalesprocess` heisst im Schlüssel aber
         `businessprocessflowinstanceid`, und Phase 0 endete in
         „Could not find a property named 'opportunitysalesprocessid'". */
      if (!idFelder.has(entitySet)) {
        try {
          idFelder.set(entitySet, (await DV.primaerId(entitySet))
            || (await DV.logischerName(entitySet)) + "id");
        }
        catch { idFelder.set(entitySet, null); }
      }
      const idF = idFelder.get(entitySet);
      let sel = idF && !select.split(",").includes(idF) ? select + "," + idF : select;

      /* Zustandsfeld mitlesen – sonst lässt sich bei zwei Treffern nicht
         sagen, welcher der aktive ist, und jede Dublette im Altbestand
         wird zu einer Frage. */
      const zf = await zustandsFeld(entitySet, zustandsFelder);
      if (zf && !sel.split(",").includes(zf)) sel += "," + zf;

      const m = await sammle(entitySet, feld, [...gesucht], sel);
      treffer.set(k, m);

      /* Mehrfachtreffer trennen: solche, die die Aktiv-Regel löst, und
         solche, die offen bleiben. Bei erwarteten Mehrfachtreffern (die
         Positionen einer Chance) ist beides bedeutungslos. */
      const mehrdeutig = [], automatisch = [];
      for (const [wert, v] of m.entries()) {
        if (v.length < 2) continue;
        const eintrag = { wert, anzahl: v.length };
        if (!mehrfachErwartet && nurAktive(v, zf).length === 1) {
          eintrag.aktive = 1;
          automatisch.push(eintrag);
        } else mehrdeutig.push(eintrag);
      }
      abfragen.push({
        entitySet, feld, zweck, mehrfachErwartet: !!mehrfachErwartet,
        gesucht: gesucht.size,
        gefunden: m.size,
        fehlend: [...gesucht].filter(v => !m.has(vergleichbar(v))),
        mehrdeutig, automatisch
      });
    }

    for (const s of profil.schritte) {
      if (!s.aktiv) continue;
      const zu = profil.zuordnungen[s.mappingKey] || [];
      const blatt = EXCEL.blatt(mappe, s.sourceSheet);
      if (!blatt) continue;

      // Navigationsnamen der Verweisfelder. Ohne sie schreibt der Import
      // `cr570_technicalaudit_lookup@odata.bind` statt
      // `cr570_TechnicalAudit_lookup@odata.bind` – und Dataverse lehnt die
      // ganze Zeile ab.
      if (!navigation.has(s.entitySet) && zu.some(z => z.aktiv && z.targetType === "Lookup")) {
        try { navigation.set(s.entitySet, await DV.navigation(s.entitySet)); }
        catch { navigation.set(s.entitySet, {}); }
      }

      /* Steht im Profil ein Alternativschlüssel, den es in dieser Umgebung
         nicht gibt, scheitert JEDE Zeile dieses Schrittes – mit
         „0x80060888: The key in the request URI is not valid". Das gehört
         in den Prüflauf, nicht in 156 Fehlerzeilen.

         Nur für schreibende Schritte: `LookupOnly` benutzt das Feld zum
         Suchen, und dafür braucht es keinen Schlüssel.                  */
      const schreibt = ["Upsert", "Update", "Create", "CreateIfMissing"].includes(s.mode);
      const sk = `${s.entitySet}|${s.alternateKey}`;
      if (s.alternateKey && schreibt && !schluesselFehlt.has(sk)) {
        let meldung = null;
        try {
          const keys = await DV.schluessel(s.entitySet);
          const t = keys.find(x => x.felder.length === 1 && x.felder[0] === s.alternateKey);
          if (!t)
            /* Zwei Wege hinaus, und lange stand nur einer da. Den Schlüssel
               anzulegen ist der eine; ihn aus dem Profil zu nehmen der
               andere – dann adressiert der Import über die GUID und legt
               Unbekanntes per POST an, so wie bei `contact` seit jeher.

               Der letzte Satz ist der wichtigste: die Konfiguration steht
               in SharePoint, nicht im Repository. Wer sie dort ändert und
               nicht hochlädt, sieht dieselbe Meldung wieder und sucht den
               Fehler im Code. */
            meldung = `In ${s.entitySet} gibt es keinen Alternativschlüssel auf `
              + `${s.alternateKey}. Zwei Wege: den Schlüssel in Dataverse `
              + "anlegen (docs/03), oder AlternateKey im Profil leeren – dann "
              + "adressiert der Import Bekanntes über seine GUID und legt "
              + "Unbekanntes per POST an. Achtung: geändert wird die "
              + "Konfiguration in SharePoint, nicht im Repository – erst "
              + "„setup-crm.ps1 -ProfilLaden“ macht eine Änderung wirksam.";
          else if (t.status && t.status !== "Active")
            meldung = `Der Alternativschlüssel ${t.name} auf ${s.alternateKey} steht `
              + `auf „${t.status}“, nicht „Active“. Solange der Index nicht aktiv ist, `
              + "weist Dataverse jede Adressierung darüber ab.";
        } catch { /* Metadaten nicht lesbar – dann eben keine Aussage */ }
        schluesselFehlt.set(sk, meldung);
      }

      // 1. Der eigene Schlüssel – existiert der Datensatz schon?
      //
      //    Auch OHNE Alternativschlüssel. Der Schlüssel entscheidet, wie
      //    geschrieben wird (Adresse oder POST); ob der Datensatz schon da
      //    ist, ist eine ganz andere Frage – und ohne Antwort darauf legt
      //    Schritt 20 jeden Kontakt neu an. Genau das war der Grund für
      //    „The key in the request URI is not valid": adressiert wurde über
      //    einen Alternativschlüssel, den es an `contact` nicht gibt.
      const key = zu.find(z => z.aktiv && z.istSchluessel && z.targetField);
      if (key) {
        const werte = blatt.zeilen.map(r => {
          const t = TRANSFORMS.anwenden(r[key.sourceColumn], key.transform);
          return t.wert;
        });
        await frage(s.entitySet, key.targetField, werte,
          vergleichsFelder(zu, key.targetField,
            await zustandsFeld(s.entitySet, zustandsFelder)).join(","),
          `Schritt ${s.step}: existiert der Datensatz schon?`);
      }

      // 2. Alle Lookups – auf welche GUID zeigen sie?
      for (const z of zu) {
        if (!z.aktiv || z.targetType !== "Lookup") continue;
        if (!z.lookupEntitySet || !z.lookupKeyField) continue;
        if (z.targetField?.startsWith("KLAEREN")) continue;
        const quellBlatt = z.sourceSheet ? EXCEL.blatt(mappe, z.sourceSheet) : blatt;
        if (!quellBlatt) continue;
        /* Gesucht wird mit dem Wert, den der Import später SCHREIBT –
           also nach der Wertzuordnung. Vorher fragte Phase 0 nach „Ja" und
           „Energieerzeugung", geschrieben wurden aber „Yes" und
           „50 Energieerzeugung": Die Auflösung fand nichts, und der Verweis
           blieb leer, obwohl die Zuordnung stimmte. */
        const wz = werte[`${s.mappingKey}|${z.targetField}`];
        const gesucht = (z.sourceColumn
          ? quellBlatt.zeilen.map(r => TRANSFORMS.anwenden(r[z.sourceColumn], z.transform).wert)
          : [z.defaultValue]
        ).map(v => {
          const abbild = MAPPING.zugeordnet(v, wz);
          if (abbild !== undefined) return abbild;
          return wz?.standard ?? v;
        });
        /* Beim Elternverweis eines Ersetzungsschrittes zählt auch der
           Zustand: Positionen einer geschlossenen Verkaufschance lassen
           sich nicht ersetzen. Meist liegt `statecode` ohnehin schon vor,
           weil ein früherer Schritt dieselbe Tabelle über denselben
           Schlüssel abgefragt hat — verlassen kann man sich darauf nicht,
           denn dieser Schritt kann inaktiv sein. */
        const brauchtZustand = s.skipIfParentClosed && z.targetField === s.parentField;
        for (const feld of schluesselFelder(z))
          await frage(z.lookupEntitySet, feld, gesucht,
            brauchtZustand ? `${feld},statecode` : feld,
            `Schritt ${s.step}: Verweis ${z.targetField}`);
      }

      /* 3. Kinddatensätze zum Elterndatensatz.
            Zwei Schrittarten brauchen sie, aus entgegengesetzten Gründen:

            · `ReplaceByParent` muss wissen, was heute dranhängt – sonst
              gibt es nichts zu löschen, und ein Ersetzen, das nur anlegt,
              verdoppelt die Positionen still.
            · `SetStage` muss die Prozessinstanz der Verkaufschance finden.
              Die Phase steht nicht an der Chance, sondern an ihrer
              `opportunitysalesprocess`-Zeile. Ohne diese Abfrage gäbe es
              keinen Datensatz, den der Import ändern könnte.            */
      if ((s.mode === "ReplaceByParent" || s.mode === "SetStage") && s.parentField) {
        const eltern = zu.find(z => z.aktiv && z.targetField === s.parentField
                                    && z.targetType === "Lookup");
        if (eltern?.lookupEntitySet && eltern.lookupKeyField) {
          const elternMap = treffer.get(schluessel(eltern.lookupEntitySet, eltern.lookupKeyField));
          const elternId = idFelder.get(eltern.lookupEntitySet);
          if (elternMap && elternId) {
            const guids = [...elternMap.values()].flat()
              .map(r => r[elternId]).filter(Boolean);
            /* Die übrigen Verweise des Schrittes mitlesen. Nur so lässt
               sich „unverändert" feststellen: steht die Chance schon auf
               der Phase, die die Datei nennt, darf der Import sie nicht
               noch einmal schreiben. Ohne `_activestageid_value` im
               Bestand meldete jede Zeile eine Änderung. */
            const weitere = zu
              .filter(z => z.aktiv && z.targetType === "Lookup"
                           && z.targetField && z.targetField !== s.parentField
                           && !z.targetField.startsWith("KLAEREN"))
              .map(z => `_${z.targetField}_value`);
            await frage(s.entitySet, `_${s.parentField}_value`, guids,
              [`_${s.parentField}_value`, ...weitere].join(","),
              s.mode === "SetStage"
                ? `Schritt ${s.step}: Prozessinstanz je Verkaufschance`
                : `Schritt ${s.step}: vorhandene Kinddatensätze zum Ersetzen`,
              /* mehrfachErwartet */ true);
          }
        }
      }
    }

    return { treffer, abfragen, idFelder, navigation, schluesselFehlt, zustandsFelder };
  }

  /** Primärschlüsselfeld einer Tabelle, aus der Auflösung.
   *
   *  NICHT aus dem Mengennamen zurückgerechnet: `opportunities` ergäbe zwar
   *  `opportunityid`, aber `opportunitysalesprocesses` ergäbe
   *  `opportunitysalesprocesseid` – falsch. Phase 0 holt den Namen aus den
   *  Metadaten (`PrimaryIdAttribute`); der Rückfallweg hier greift nur,
   *  wenn gar keine Auflösung vorliegt, und rät bewusst schlecht sichtbar
   *  statt still: `opportunitysalesprocess` heisst im Schlüssel
   *  `businessprocessflowinstanceid`, und keine Ableitung der Welt kommt
   *  darauf. */
  const idFeld = (aufl, entitySet) =>
    aufl.idFelder?.get(entitySet) || (entitySet.replace(/ies$/, "y").replace(/s$/, "") + "id");

  /** Treffer nachschlagen.
   *
   *  @param {Map} [entscheidungen] Getroffene Entscheidungen bei
   *    Mehrfachtreffern, Schlüssel `entitySet|feld|wert` → Datensatz-ID.
   *    Damit ist ein doppelter Wert kein Abbruch mehr, sondern eine Frage,
   *    die jemand beantwortet – und die Antwort steht im Protokoll.
   *  @returns {{records:object[], mehrdeutig:boolean, fehlt:boolean,
   *             entschieden:boolean}} */
  function finde(aufl, entitySet, feld, wert, entscheidungen) {
    const m = aufl.treffer.get(schluessel(entitySet, feld));
    if (!m) return { records: [], mehrdeutig: false, fehlt: true, entschieden: false };
    const r = m.get(vergleichbar(wert)) || [];
    /* Genau ein aktiver Treffer? Dann ist die Sache entschieden. Die
       ausdrückliche Entscheidung eines Menschen geht trotzdem vor – wer
       bewusst den inaktiven wählt, hat einen Grund. */
    if (r.length > 1) {
      const gewaehltVorher = entscheidungen?.get(`${entitySet}|${feld}|${vergleichbar(wert)}`);
      if (!gewaehltVorher) {
        const aktive = nurAktive(r, aufl.zustandsFelder?.get(entitySet));
        if (aktive.length === 1)
          return { records: aktive, mehrdeutig: false, fehlt: false,
                   entschieden: true, automatisch: "aktiv" };
      }
    }
    if (r.length > 1 && entscheidungen) {
      // Der Schlüssel der Entscheidung wird aus derselben Vergleichsform
      // gebaut wie in `offeneEntscheidungen` – sonst zeigt die Oberfläche
      // eine Frage an, deren Antwort hier nie ankommt.
      const gewaehlt = entscheidungen.get(`${entitySet}|${feld}|${vergleichbar(wert)}`);
      if (gewaehlt) {
        const id = idFeld(aufl, entitySet);
        const treffer = r.filter(x => x[id] === gewaehlt);
        if (treffer.length === 1)
          return { records: treffer, mehrdeutig: false, fehlt: false, entschieden: true };
      }
    }
    return { records: r, mehrdeutig: r.length > 1, fehlt: r.length === 0, entschieden: false };
  }

  /** Alle offenen Mehrdeutigkeiten – das sind die Fragen, die jemand
   *  beantworten muss, bevor der Import laufen darf. */
  function offeneEntscheidungen(aufl, entscheidungen) {
    const offen = [];
    for (const a of aufl.abfragen) {
      // Eine Verkaufschance hat mehrere Positionen – das ist keine Frage,
      // die jemand beantworten müsste, sondern der Normalfall. Vorher
      // standen hier elf Entscheidungen, die niemand treffen kann und die
      // nichts bewirken: gelöscht werden beim Ersetzen ohnehin alle.
      if (a.mehrfachErwartet) continue;
      for (const m of a.mehrdeutig) {
        const k = `${a.entitySet}|${a.feld}|${m.wert}`;
        if (entscheidungen?.get(k)) continue;
        const kandidaten = aufl.treffer.get(schluessel(a.entitySet, a.feld))
          ?.get(vergleichbar(m.wert)) || [];
        // Was die Aktiv-Regel löst, ist keine offene Frage mehr.
        if (nurAktive(kandidaten, aufl.zustandsFelder?.get(a.entitySet)).length === 1)
          continue;
        offen.push({ schluessel: k, entitySet: a.entitySet, feld: a.feld,
                     wert: m.wert, idFeld: idFeld(aufl, a.entitySet), kandidaten });
      }
    }
    return offen;
  }

  /** Was die Aktiv-Regel ohne Rückfrage entschieden hat.
   *
   *  Gehört in den Bericht und ins Protokoll: eine Entscheidung, die
   *  niemand getroffen hat, muss wenigstens nachlesbar sein. */
  function automatischGeloest(aufl) {
    const out = [];
    for (const a of aufl.abfragen || []) {
      for (const m of a.automatisch || []) {
        const kandidaten = aufl.treffer.get(schluessel(a.entitySet, a.feld))
          ?.get(vergleichbar(m.wert)) || [];
        const zf = aufl.zustandsFelder?.get(a.entitySet);
        const aktiv = nurAktive(kandidaten, zf)[0];
        out.push({ entitySet: a.entitySet, feld: a.feld, wert: m.wert,
                   anzahl: m.anzahl, zustandsFeld: zf,
                   gewaehlt: aktiv ? aktiv[idFeld(aufl, a.entitySet)] : null });
      }
    }
    return out;
  }

  /** Auflöser für `MAPPING.baue`: die GUID zu einem Verweiswert.
   *
   *  Gebunden wird darüber statt über den Alternativschlüssel des Ziels.
   *  Drei Gründe:
   *  · Es geht auch dort, wo es keinen Alternativschlüssel gibt.
   *  · Eine getroffene Entscheidung bei Mehrfachtreffern wirkt tatsächlich.
   *    Über `dag_dihag_kdnr=47000004` gebunden, sucht Dataverse selbst –
   *    und trifft dieselbe Doppeldeutigkeit wieder.
   *  · Der Vergleich auf „unverändert" wird richtig: im Bestand steht eine
   *    GUID, nicht die Kundennummer.
   *
   *  `null` heisst: nicht aufgelöst – dann bleibt der bisherige Weg. */
  function aufloeser(aufl, entscheidungen) {
    return (entitySet, felder, wert) => {
      if (!entitySet || !felder || leer(wert)) return undefined;
      const liste = Array.isArray(felder) ? felder : [felder];
      let auskunft = false;

      // Der Reihe nach: das erste Feld, das den Wert kennt, gewinnt.
      for (const feld of liste) {
        // `undefined` heisst „keine Auskunft" – dazu wurde nichts
        // abgefragt, also bleibt der bisherige Weg über den
        // Alternativschlüssel. `null` heisst „abgefragt und nicht
        // vorhanden" – das ist eine Aussage, und darauf darf
        // `OnLookupFail` reagieren.
        if (!aufl.treffer?.get(schluessel(entitySet, feld))) continue;
        auskunft = true;
        const t = finde(aufl, entitySet, feld, wert, entscheidungen);
        if (t.mehrdeutig) return undefined;    // offene Entscheidung: nicht raten
        if (t.records.length) return t.records[0][idFeld(aufl, entitySet)] || null;
      }
      return auskunft ? null : undefined;
    };
  }

  return { fuer, finde, sammle, vergleichsFelder, offeneEntscheidungen, idFeld,
           filterFeld, aufloeser, schluesselFelder, vergleichbar, istAktiv,
           automatischGeloest, BLOCK };
})();
