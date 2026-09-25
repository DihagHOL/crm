"use strict";

/* Automatik – prüfen, freigeben, importieren ohne dass jemand danebensteht.

   Was hier NICHT steht: das Ausführen. Das tut `cron/automatik.mjs` in
   GitHub Actions mit denselben Bausteinen, die auch die Oberfläche benutzt
   (`AUFLOESUNG`, `PRUEFUNG`, `LAUF`). Hier stehen die drei Entscheidungen,
   die zwischen „Datei liegt da" und „Datensatz steht im CRM" fallen:

   1. LÄUFT DIE AUTOMATIK GERADE?  Takt, Zeitfenster und Schalter stehen in
      SharePoint, nicht im Repository. Wer den Takt ändern will, soll das
      im Werkzeug tun und nicht einen Pull Request aufmachen. Der Cron
      selbst sieht häufig nach und hält sich an das, was dort steht.

   2. DARF OHNE RÜCKFRAGE IMPORTIERT WERDEN?  Genau dann, wenn der Prüflauf
      nichts zu fragen hat: keine Fehler, keine offene Mehrdeutigkeit, kein
      Strukturbruch. Alles andere wird zur Freigabe vorgelegt.

   3. WAS STEHT IM BERICHT?  Eine Mail, die man morgens im Vorbeigehen liest
      und die trotzdem genug sagt, um zu handeln.

   Die Regel „bei mehreren Treffern gewinnt der aktive" steht bewusst NICHT
   hier, sondern in `js/aufloesung.js`: sie gilt auch für den Menschen, der
   die Oberfläche bedient. Eine Automatik, die anders entscheidet als die
   App, wäre ein zweites Regelwerk.                                       */

const AUTOMATIK = (() => {

  const C = CRM_CONFIG;
  const liste = k => (C.listen && C.listen[k]) || null;

  /* ── Einstellungen ────────────────────────────────────────────────── */

  /** Standardwerte. Sie gelten, solange in der Liste nichts steht – und
   *  `Aktiv: nein` heisst: wer die Automatik will, schaltet sie bewusst
   *  ein. Eine Automatik, die sich selbst einschaltet, weil jemand eine
   *  Liste angelegt hat, ist ein Betriebsunfall. */
  const STANDARD = {
    Aktiv:               "nein",
    TaktMinuten:         "60",
    VonUhr:              "6",
    BisUhr:              "18",
    Wochentage:          "Mo-Fr",
    AbDatum:             "",
    MaxDateien:          "3",
    WarnungenBlockieren: "nein",
    Empfaenger:          "administrator@dihag.com",
    Absender:            "administrator@dihag.com",
    LetzterLauf:         ""
  };

  /** Was jede Einstellung bedeutet – die Oberfläche zeigt es an, damit
   *  niemand raten muss, was „MaxDateien" tut. */
  const ERKLAERUNG = {
    Aktiv:               "ja | nein — der Hauptschalter. Bei „nein“ tut der Cron nichts.",
    TaktMinuten:         "Mindestabstand zwischen zwei Läufen, in Minuten.",
    VonUhr:              "Frühestens ab dieser vollen Stunde (deutsche Zeit).",
    BisUhr:              "Letzte Stunde, in der ein Lauf beginnen darf.",
    Wochentage:          "„Mo-Fr“, „täglich“ oder eine Liste wie „Mo,Mi,Fr“.",
    AbDatum:             "Stichtag JJJJ-MM-TT. Ältere Mappen bleiben liegen — sonst "
                       + "arbeitet die Automatik den ganzen Altbestand des Ordners durch. "
                       + "Leer heisst: alle.",
    MaxDateien:          "Wie viele Dateien höchstens in EINEM Lauf verarbeitet werden.",
    WarnungenBlockieren: "ja | nein — sollen Warnungen (z. B. „Besitzer nicht gefunden“) "
                       + "eine Freigabe erzwingen statt nur im Bericht zu stehen?",
    Empfaenger:          "Wer den Bericht bekommt. Mehrere durch Semikolon.",
    Absender:            "Postfach, aus dem gesendet wird (App-Berechtigung Mail.Send).",
    LetzterLauf:         "Schreibt der Cron selbst. Von Hand leeren erzwingt den nächsten Lauf."
  };

  const jaNein = v => String(v ?? "").trim().toLowerCase();
  const istJa  = v => ["ja", "yes", "true", "1", "x"].includes(jaNein(v));
  const zahl   = (v, ersatz) => {
    const n = Number(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : ersatz;
  };

  /** Einstellungen lesen. Fehlt die Liste, gelten die Standardwerte – die
   *  Automatik ist dann schlicht aus, und die Oberfläche sagt warum.
   *  @returns {Promise<{werte:object, ids:object, vorhanden:boolean}>} */
  async function einstellungen() {
    const name = liste("automatik");
    const werte = { ...STANDARD }, ids = {};
    if (!name) return { werte, ids, vorhanden: false };
    const rows = await GRAPH.listItems(C.konfigSite, name, ["Title", "Wert"]);
    if (!rows) return { werte, ids, vorhanden: false };
    for (const r of rows) {
      if (!r.Title) continue;
      werte[r.Title] = r.Wert ?? "";
      ids[r.Title] = r.id;
    }
    return { werte, ids, vorhanden: true };
  }

  /** Eine Einstellung schreiben – anlegen oder ändern. */
  async function einstellungSetzen(schluessel, wert, ids = null) {
    const name = liste("automatik");
    if (!name) throw new Error("Liste für die Automatik ist in js/config.js nicht eingetragen.");
    const id = ids?.[schluessel] ?? (await einstellungen()).ids[schluessel];
    const felder = { Title: schluessel, Wert: String(wert ?? "") };
    if (id) { await GRAPH.updateItem(C.konfigSite, name, id, { Wert: felder.Wert }); return id; }
    return (await GRAPH.addItem(C.konfigSite, name, felder)).id;
  }

  /* ── Läuft sie gerade? ────────────────────────────────────────────── */

  const TAGE = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

  /** Stunde und Wochentag in DEUTSCHER Zeit.
   *
   *  Der Cron läuft in UTC. „Ab 6 Uhr" hiesse dort im Sommer 8 Uhr, und
   *  zweimal im Jahr verschiebt sich das Fenster von selbst. Deshalb über
   *  `Intl` in die Zeitzone Europe/Berlin umgerechnet – das ist die
   *  einzige Stelle, an der Zeit interpretiert wird. */
  function deutscheZeit(jetzt) {
    const f = new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin", hour: "2-digit", hour12: false, weekday: "short"
    });
    let stunde = jetzt.getUTCHours(), tag = TAGE[jetzt.getUTCDay()];
    for (const t of f.formatToParts(jetzt)) {
      if (t.type === "hour") stunde = Number(t.value);
      if (t.type === "weekday") tag = t.value.replace(".", "").slice(0, 2);
    }
    return { stunde, tag };
  }

  /** Steht dieser Wochentag im Plan? */
  function tagErlaubt(plan, tag) {
    const p = String(plan || "").trim().toLowerCase();
    if (!p || p === "täglich" || p === "taeglich" || p === "alle") return true;
    if (p === "mo-fr" || p === "werktags") return !["Sa", "So"].includes(tag);
    return p.split(/[,;\s]+/).filter(Boolean)
            .some(t => t.slice(0, 2).toLowerCase() === tag.toLowerCase());
  }

  /** Darf jetzt ein Lauf beginnen?
   *
   *  Beantwortet die Frage IMMER mit einem Grund, auch beim Nein. Ein Cron,
   *  der still nichts tut, ist von einem kaputten Cron nicht zu
   *  unterscheiden – und genau danach wird gefragt, wenn eine Datei
   *  liegenbleibt.
   *
   *  @param {object} werte aus `einstellungen()`
   *  @param {Date} jetzt
   *  @returns {{ja:boolean, grund:string}} */
  function faellig(werte, jetzt = new Date()) {
    if (!istJa(werte.Aktiv))
      return { ja: false, grund: "Die Automatik ist ausgeschaltet (Aktiv = nein)." };

    const { stunde, tag } = deutscheZeit(jetzt);
    if (!tagErlaubt(werte.Wochentage, tag))
      return { ja: false, grund: `${tag} steht nicht im Plan (${werte.Wochentage}).` };

    const von = zahl(werte.VonUhr, 0), bis = zahl(werte.BisUhr, 23);
    if (stunde < von || stunde > bis)
      return { ja: false, grund: `${String(stunde).padStart(2, "0")} Uhr liegt `
        + `ausserhalb von ${von}–${bis} Uhr (deutsche Zeit).` };

    const takt = zahl(werte.TaktMinuten, 60);
    if (werte.LetzterLauf) {
      const letzter = Date.parse(werte.LetzterLauf);
      if (Number.isFinite(letzter)) {
        const verstrichen = Math.round((jetzt.getTime() - letzter) / 60000);
        /* Ein Zeitstempel aus der Zukunft (verstellte Uhr, Tippfehler in
           der Liste) darf die Automatik nicht auf Tage anhalten. Dann
           lieber laufen: ein Lauf zu viel kostet ein paar Abfragen, ein
           Lauf zu wenig lässt Dateien liegen. */
        if (verstrichen >= 0 && verstrichen < takt)
          return { ja: false, grund: `Letzter Lauf vor ${verstrichen} min, `
            + `Takt sind ${takt} min – noch ${takt - verstrichen} min.` };
      }
    }
    return { ja: true, grund: `${tag} ${String(stunde).padStart(2, "0")} Uhr, `
      + `Takt ${takt} min – Lauf ist fällig.` };
  }

  /** Liegt die Datei am oder nach dem Stichtag?
   *
   *  Der Quellordner ist ein ARCHIV, kein Eingang: am 23.09.2026 lagen dort
   *  71 Mappen zurück bis Mai 2025, 66 davon ohne Importvermerk. Ohne
   *  Stichtag hätte der erste eingeschaltete Lauf begonnen, sechzehn
   *  Monate Altbestand nachzuimportieren – drei Dateien je Stunde, jede
   *  mit dem Stand von damals über dem Stand von heute.
   *
   *  Leerer Stichtag heisst bewusst „alle“: wer den Altbestand doch
   *  einspielen will, soll das können, ohne im Code zu suchen.
   *
   *  @param {string} geaendert ISO-Zeitstempel der Datei
   *  @returns {boolean} */
  function nachStichtag(geaendert, werte = STANDARD) {
    const roh = String(werte.AbDatum || "").trim();
    if (!roh) return true;
    const grenze = Date.parse(roh.length <= 10 ? roh + "T00:00:00Z" : roh);
    if (!Number.isFinite(grenze)) return true;   // unlesbar? dann keine Grenze
    const wann = Date.parse(geaendert || "");
    if (!Number.isFinite(wann)) return true;     // ohne Datum lieber prüfen
    return wann >= grenze;
  }

  /** Wurde die Datei NACH ihrem Import noch angefasst?
   *
   *  Anlass, 24.09.2026: Im Ordner lag `Anfragen 2026-09-24_2.xlsx` mit
   *  Status „Importiert", derselben Lauf-ID und demselben Importzeitpunkt
   *  wie das Original — eine Kopie, die in SharePoint die Spaltenwerte
   *  geerbt hat. Die Automatik hätte sie nie angesehen, weil sie nur auf
   *  „Neu" achtet. Eine Datei mit neuem Inhalt und altem Vermerk wird so
   *  stillschweigend nie importiert, und genau solche stillen Verluste
   *  soll dieses Werkzeug abstellen.
   *
   *  Dasselbe greift, wenn Timeline eine korrigierte Fassung unter dem
   *  gleichen Namen nachlegt oder jemand eine fehlgeschlagene Datei
   *  repariert: geänderter Inhalt, alter Vermerk.
   *
   *  DIE TOLERANZ IST NÖTIG. Der Statusvermerk selbst verändert den
   *  Bibliothekseintrag — gemessen am 24.09.2026 zwei Sekunden nach dem
   *  eingetragenen Importzeitpunkt. Ohne Abstand hielte sich jede Datei
   *  selbst für geändert und würde bei jedem Lauf erneut importiert.
   *
   *  @param {{geaendert?:string, importiertAm?:string}} datei aus SPFILES.liste()
   *  @param {number} [minuten] Mindestabstand
   *  @returns {boolean} */
  function seitImportGeaendert(datei, minuten = 10) {
    const importiert = Date.parse(datei?.importiertAm || "");
    const geaendert = Date.parse(datei?.geaendert || "");
    if (!Number.isFinite(importiert) || !Number.isFinite(geaendert)) return false;
    return geaendert - importiert > minuten * 60000;
  }

  /* ── Darf ohne Rückfrage importiert werden? ───────────────────────── */

  /** Das Tor zwischen Prüflauf und Import.
   *
   *  Grundsatz: Was einen Menschen in der Oberfläche zum Nachdenken
   *  bringen würde, bringt die Automatik zum Anhalten. Warnungen sind
   *  einstellbar, weil sie beides sein können – „ein Besitzer von 108 ist
   *  unbekannt" ist ein Hinweis, kein Abbruchgrund.
   *
   *  @returns {{frei:boolean, gruende:string[], offen:object[]}} */
  function torschluss(bericht, aufl, entscheidungen, werte = STANDARD) {
    const roh = [];
    /* Derselbe Satz fünfmal ist keine fünffache Auskunft. „Blatt
       ‚Anfragen‘ gibt es nicht" meldet jeder Schritt einzeln – im Bericht
       steht er einmal. */
    const gruende = { push: t => { if (!roh.includes(t)) roh.push(t); },
                      get length() { return roh.length; } };
    const offen = AUFLOESUNG.offeneEntscheidungen(aufl, entscheidungen);

    if (offen.length)
      gruende.push(`${offen.length} offene Entscheidung(en): `
        + offen.slice(0, 5).map(o => `${o.entitySet}.${o.feld} = ${o.wert}`).join(", ")
        + (offen.length > 5 ? " …" : ""));

    if (bericht.fehler?.length)
      gruende.push(`${bericht.fehler.length} Fehler im Prüflauf: `
        + bericht.fehler[0].meldung);

    const struktur = (bericht.schritte || []).filter(z => z.strukturfehler);
    for (const z of struktur) gruende.push(z.strukturfehler);

    if (istJa(werte.WarnungenBlockieren) && bericht.warnungen?.length)
      gruende.push(`${bericht.warnungen.length} Warnung(en) – laut Einstellung `
        + "WarnungenBlockieren erzwingt das eine Freigabe.");

    return { frei: !roh.length, gruende: roh, offen };
  }

  /** Gibt es überhaupt etwas zu tun? Eine Datei ohne Änderung wird trotzdem
   *  als bearbeitet markiert – sonst prüft der Cron sie bis in alle
   *  Ewigkeit erneut. */
  const hatArbeit = g => (g.neu + g.aktualisiert + (g.geloescht || 0)) > 0;

  /* ── Freigaben ────────────────────────────────────────────────────── */

  const FREI = { offen: "Offen", frei: "Freigegeben", abgelehnt: "Abgelehnt",
                 erledigt: "Erledigt" };

  /** Alle Freigabevorgänge, neueste zuerst. */
  async function freigaben() {
    const name = liste("freigaben");
    if (!name) return null;
    const rows = await GRAPH.listItems(C.konfigSite, name,
      ["Title", "FileId", "FileUrl", "Status", "Findings", "Questions",
       "Decisions", "RequestedAt", "DecidedAt", "DecidedBy", "RunId"]);
    if (!rows) return null;
    return rows.sort((a, b) => String(b.RequestedAt).localeCompare(String(a.RequestedAt)));
  }

  /** Vorgang anlegen oder auffrischen. Eine Datei hat höchstens einen
   *  offenen Vorgang – sonst sammeln sich bei jedem Lauf neue Zeilen zu
   *  derselben Frage. */
  async function freigabeAnlegen(datei, befunde, fragen, laufId) {
    const name = liste("freigaben");
    if (!name) throw new Error("Liste für Freigaben ist in js/config.js nicht eingetragen.");
    const alle = (await freigaben()) || [];
    const da = alle.find(f => f.FileId === datei.id && f.Status === FREI.offen);
    const felder = {
      Title: datei.name,
      FileId: datei.id,
      FileUrl: datei.webUrl || "",
      Status: FREI.offen,
      Findings: befunde.join("\n"),
      Questions: JSON.stringify(fragen || []),
      RequestedAt: new Date().toISOString(),
      RunId: laufId || ""
    };
    if (da) { await GRAPH.updateItem(C.konfigSite, name, da.id, felder); return da.id; }
    return (await GRAPH.addItem(C.konfigSite, name, felder)).id;
  }

  /** Freigabe erteilen oder ablehnen – mit den getroffenen Auswahlen. */
  async function freigabeEntscheiden(itemId, status, entscheidungen, wer) {
    const name = liste("freigaben");
    return GRAPH.updateItem(C.konfigSite, name, itemId, {
      Status: status,
      Decisions: JSON.stringify(entscheidungen || {}),
      DecidedAt: new Date().toISOString(),
      DecidedBy: wer || ""
    });
  }

  /** Die Auswahlen eines freigegebenen Vorgangs als Map für die Auflösung. */
  function entscheidungenAus(vorgang) {
    const m = new Map();
    try {
      const d = JSON.parse(vorgang?.Decisions || "{}");
      for (const [k, v] of Object.entries(d)) if (v) m.set(k, v);
    } catch { /* kaputtes JSON heisst: keine Entscheidungen, nicht Absturz */ }
    return m;
  }

  /* ── Bericht ──────────────────────────────────────────────────────── */

  const esc = t => String(t ?? "").replace(/[&<>]/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  /** Warnungen zusammenfassen: 108-mal dieselbe Warnung ist EINE Zeile mit
   *  einer Zahl davor, nicht 108 Zeilen. Genau daran scheitert die
   *  Lesbarkeit des Altflow-Protokolls. */
  function warnungsGruppen(warnungen = []) {
    const m = new Map();
    for (const w of warnungen) {
      const k = `${w.feld || ""}|${String(w.meldung || "").replace(/„[^“]*“/g, "…")}`;
      if (!m.has(k)) m.set(k, { feld: w.feld || "", meldung: w.meldung || "",
                                anzahl: 0, werte: new Set() });
      const g = m.get(k);
      g.anzahl++;
      if (g.werte.size < 5 && w.wert != null) g.werte.add(String(w.wert));
    }
    return [...m.values()].sort((a, b) => b.anzahl - a.anzahl);
  }

  /** Übersprungene Zeilen nach Grund gruppieren – mit Zeilennummern.
   *
   *  „14 übersprungen" beantwortet die Frage nicht, die danach kommt:
   *  WELCHE, und WARUM? Beides steht in den Protokolleinträgen, es kam nur
   *  nie heraus. Zeilennummern sind die aus Excel, wie sie links im Blatt
   *  stehen – damit man die Zeile aufschlagen kann, ohne zu rechnen.
   *
   *  @returns {Array<{meldung, anzahl, zeilen:number[], schritt}>} */
  function auslassungen(eintraege = []) {
    const m = new Map();
    for (const e of eintraege) {
      if (e.aktion !== "uebersprungen") continue;
      /* Gleichartige Meldungen zusammenfassen: „Opp-ID = „7446" steht in
         SkipOnValues" ist für jede Zeile ein anderer Text, aber derselbe
         Grund. Der konkrete Wert steht dann bei den Beispielen. */
      const kern = String(e.meldung || "ohne Angabe")
        .replace(/„[^“]*“/g, "…").replace(/\s+/g, " ").trim();
      const k = `${e.schritt}|${kern}`;
      if (!m.has(k)) m.set(k, { meldung: kern, schritt: e.schritt,
                                anzahl: 0, zeilen: [], werte: new Set() });
      const g = m.get(k);
      g.anzahl++;
      if (g.zeilen.length < 25) g.zeilen.push(e.zeile);
      if (g.werte.size < 5 && e.schluessel != null && e.schluessel !== "")
        g.werte.add(String(e.schluessel));
    }
    return [...m.values()].sort((a, b) => b.anzahl - a.anzahl);
  }

  /** Geschlossen im CRM, aktiv in der Datei — der Widerspruch zweier Systeme.
   *
   *  Diese Zeilen sind keine gewöhnlichen Auslassungen. Bei „steht in
   *  SkipOnValues" hat jemand eine Regel aufgestellt und sie wirkt; hier
   *  behaupten CRM und Timeline verschiedene Dinge über dieselbe Anfrage,
   *  und **beide können nicht recht haben**. Solange niemand entscheidet,
   *  läuft die Datei jede Woche erneut auf dieselbe Wand.
   *
   *  Deshalb ein eigener Abschnitt statt sechs verstreuter Protokollzeilen:
   *  6428 und 6655 tauchten am 24.09.2026 zweimal auf, einmal für die
   *  Chance und einmal für ihre Positionen — als Befund ist es EINE Sache.
   *
   *  @returns {Array<{kennung, zustand, zeilen:number[], schritte:number[]}>} */
  function geschlosseneKonflikte(eintraege = []) {
    const m = new Map();

    /* Wiedereröffnete Chancen sind KEIN Konflikt mehr – sie waren einer
       und sind erledigt. Trotzdem gehören sie in den Bericht: das CRM
       sagt seit diesem Lauf etwas anderes über den Ausgang eines
       Geschäfts als vorher, und das soll niemand nur im Protokoll
       finden. */
    const geoeffnet = eintraege
      .filter(e => e.wiedereroeffnet)
      .map(e => ({ kennung: String(e.schluessel ?? "?"), zeilen: [e.zeile],
                   schritte: [e.schritt], zustand: "wiedereröffnet", erledigt: true }));

    for (const e of eintraege) {
      if (e.aktion !== "uebersprungen") continue;
      const t = String(e.meldung || "");
      if (!/geschlossen|schreibgeschützt/i.test(t)) continue;

      /* Die Kennung steht je nach Schritt an zwei Stellen: an der Chance
         selbst als Schlüssel, an der Position als Wert des Elternverweises
         — und im Text in Anführungszeichen. */
      const ausText = (t.match(/„([^“]+)“/) || [])[1];
      const kennung = String(e.schluessel ?? e.wert ?? ausText ?? "?");
      const zustand = /GEWONNEN/i.test(t) ? "gewonnen"
                    : /VERLOREN/i.test(t) ? "verloren" : "geschlossen";
      if (!m.has(kennung))
        m.set(kennung, { kennung, zustand, zeilen: [], schritte: [] });
      const g = m.get(kennung);
      // „verloren" ist genauer als „geschlossen" – die genauere Angabe gewinnt.
      if (zustand !== "geschlossen") g.zustand = zustand;
      if (!g.zeilen.includes(e.zeile)) g.zeilen.push(e.zeile);
      if (!g.schritte.includes(e.schritt)) g.schritte.push(e.schritt);
    }
    return [...geoeffnet, ...m.values()]
      .sort((a, b) => String(a.kennung).localeCompare(String(b.kennung)));
  }

  /** Der Konfliktabschnitt als Zeilen für den Bericht. */
  function konfliktZeilen(konflikte) {
    if (!konflikte.length) return [];
    const offen = konflikte.filter(k => !k.erledigt);
    return [
      "<b>Geschlossene Anfragen, die wieder in der Datei stehen:</b>",
      ...konflikte.map(k => k.erledigt
        ? `↺ <b>${esc(k.kennung)}</b> war geschlossen und wurde `
          + `<b>wiedereröffnet</b> (Zeile ${k.zeilen.join(", ")}).`
        : `⚠ <b>${esc(k.kennung)}</b> ist im CRM als <b>${esc(k.zustand)}</b> `
          + `abgeschlossen (Zeile ${k.zeilen.join(", ")}, `
          + `Schritt ${k.schritte.join(" und ")}). Unverändert geblieben.`),
      ...(offen.length ? [offen.length === 1
        ? "Die Anfrage bleibt bei jedem Lauf stehen, bis jemand entscheidet, "
          + "welches System recht hat."
        : "Diese Anfragen bleiben bei jedem Lauf stehen, bis jemand entscheidet, "
          + "welches System recht hat."] : [])
    ];
  }

  /** Eine Gruppe als Satz: Anzahl, Grund, Zeilennummern. */
  const auslassungsSatz = g =>
    `${g.anzahl}× Schritt ${g.schritt}: ${g.meldung}`
    + (g.werte.size ? ` (${[...g.werte].join(", ")}${g.anzahl > g.werte.size ? " …" : ""})` : "")
    + ` — Zeile ${g.zeilen.join(", ")}${g.anzahl > g.zeilen.length ? " …" : ""}`;

  /** Der Bericht als Mail. Ein Betreff, den man in der Übersicht lesen
   *  kann, und ein Text, der ohne Anmeldung an der App auskommt.
   *  @returns {{betreff:string, html:string}} */
  function bericht(abschnitte, opt = {}) {
    const fehler = abschnitte.filter(a => a.art === "fehler").length;
    const wartet = abschnitte.filter(a => a.art === "freigabe").length;
    const fertig = abschnitte.filter(a => a.art === "importiert").length;

    const geprueft = abschnitte.filter(a => a.art === "hinweis").length;
    const konflikte = abschnitte.reduce((n, a) => n + (a.konflikte || 0), 0);
    const geoeffnet = abschnitte.reduce((n, a) => n + (a.wiedereroeffnet || 0), 0);
    const teile = [fertig ? `${fertig} importiert` : null,
                   wartet ? `${wartet} wartet auf Freigabe` : null,
                   fehler ? `${fehler} fehlgeschlagen` : null].filter(Boolean);
    /* „nichts zu tun" wäre gelogen, wenn ein Probelauf gerade drei Dateien
       durchgerechnet hat. Der Betreff ist das Einzige, was in der
       Postfachübersicht steht – er muss stimmen. */
    /* Der Konflikt gehört in den Betreff. Er ist das Einzige im Bericht,
       das jemand entscheiden MUSS – alles andere ist Buchhaltung. */
    const betreff = `CRM-Import ${C.umgebung}: `
      + (teile.length ? teile.join(", ")
         : geprueft ? `${geprueft} geprüft, nichts geschrieben`
         : "nichts zu tun")
      + (geoeffnet ? ` · ${geoeffnet} wiedereröffnet` : "")
      + (konflikte ? ` · ${konflikte} geschlossene Anfrage(n) prüfen` : "");

    const farbe = { importiert: "#2e7d32", freigabe: "#F08300", fehler: "#c62828",
                    hinweis: "#424241" };

    const html = `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;
      font-size:14px;color:#424241;line-height:1.5">
      <p style="margin:0 0 4px"><b style="color:#17509E;font-size:16px">DIHAG CRM-Schnittstelle</b><br>
      <span style="color:#666">Automatischer Lauf vom ${new Date().toLocaleString("de-DE",
        { timeZone: "Europe/Berlin" })} Uhr · Umgebung ${esc(C.umgebung)}</span></p>
      ${abschnitte.map(a => `
        <div style="border-left:4px solid ${farbe[a.art] || "#999"};
                    background:#fafafa;padding:10px 14px;margin:14px 0">
          <div style="font-weight:600">${esc(a.titel)}</div>
          ${a.zeilen.map(z => `<div style="margin-top:4px">${z}</div>`).join("")}
        </div>`).join("")}
      <p style="margin-top:22px;color:#666;font-size:12px">
        ${opt.appUrl ? `<a href="${esc(opt.appUrl)}" style="color:#17509E">Werkzeug öffnen</a> · ` : ""}
        Diese Mail schickt der automatische Lauf aus GitHub Actions.
        Takt und Schalter stehen im Reiter „Automatik“.</p>
      </body></html>`;

    return { betreff, html };
  }

  /** Den Bericht ablegen, bevor er verschickt wird.
   *
   *  Eine Mail ist ein Kanal, kein Archiv. Sie kann im Spam landen, an
   *  einer Transportregel hängen bleiben oder schlicht übersehen werden —
   *  und dann steht nirgends, was der Lauf getan hat. Deshalb liegt jeder
   *  Bericht als HTML-Datei neben den Vollprotokollen, und der Reiter
   *  Automatik verlinkt die letzten.
   *
   *  Abgelegt wird ZUERST, verschickt danach: scheitert der Versand, ist
   *  der Bericht trotzdem da.
   *
   *  @returns {Promise<{url:string|null, pfad:string}>} */
  async function berichtAblegen(betreff, html, wann = new Date()) {
    const p = n => String(n).padStart(2, "0");
    const name = `${wann.getFullYear()}-${p(wann.getMonth() + 1)}-${p(wann.getDate())}`
      + `-${p(wann.getHours())}${p(wann.getMinutes())}${p(wann.getSeconds())}.html`;
    const pfad = `Berichte/${name}`;
    try {
      const sid = await GRAPH.siteId(C.konfigSite);
      const drive = (await GRAPH.call(`/sites/${sid}/drive`))?.id;
      if (!drive) return { url: null, pfad };
      const r = await GRAPH.call(`/drives/${drive}/root:/${encodeURI(pfad)}:/content`,
        { method: "PUT", headers: { "Content-Type": "text/html; charset=utf-8" },
          body: `<!-- ${betreff} -->\n${html}` });
      return { url: r?.webUrl || null, pfad };
    } catch (e) {
      console.warn("[Automatik] Bericht nicht abgelegt:", e.message);
      return { url: null, pfad };
    }
  }

  /** Die zuletzt abgelegten Berichte, neueste zuerst. */
  async function berichte(anzahl = 10) {
    try {
      const sid = await GRAPH.siteId(C.konfigSite);
      const drive = (await GRAPH.call(`/sites/${sid}/drive`))?.id;
      if (!drive) return [];
      const d = await GRAPH.call(`/drives/${drive}/root:/Berichte:/children`
        + `?$select=name,webUrl,lastModifiedDateTime&$top=200`);
      return (d?.value || [])
        .filter(f => /\.html?$/i.test(f.name))
        .sort((a, b) => String(b.name).localeCompare(String(a.name)))
        .slice(0, anzahl);
    } catch { return []; }   // noch kein Bericht abgelegt: kein Fehler
  }

  /** Mail über Graph senden. Braucht die Anwendungsberechtigung
   *  `Mail.Send` – die hat nur der Cron, nicht die angemeldete Person. */
  async function mailSenden(absender, empfaenger, betreff, html) {
    const zu = String(empfaenger || "").split(/[;,]/).map(t => t.trim()).filter(Boolean);
    if (!absender || !zu.length) return false;
    await GRAPH.call(`/users/${encodeURIComponent(absender)}/sendMail`, {
      method: "POST",
      body: JSON.stringify({
        message: {
          subject: betreff,
          body: { contentType: "HTML", content: html },
          toRecipients: zu.map(a => ({ emailAddress: { address: a } }))
        },
        saveToSentItems: true
      })
    });
    return true;
  }

  return { STANDARD, ERKLAERUNG, FREI, istJa, zahl, nachStichtag,
           seitImportGeaendert, auslassungen, auslassungsSatz,
           geschlosseneKonflikte, konfliktZeilen, berichtAblegen, berichte,
           einstellungen, einstellungSetzen, faellig, deutscheZeit, tagErlaubt,
           torschluss, hatArbeit, warnungsGruppen,
           freigaben, freigabeAnlegen, freigabeEntscheiden, entscheidungenAus,
           bericht, mailSenden };
})();
