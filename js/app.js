"use strict";

/* Oberfläche – Start, Selbsttest, Gerüst der sechs Pipeline-Schritte.

   Stand: Phase 1 und 2. Anmeldung, Zugriffssteuerung und ein Selbsttest,
   der die offenen Punkte aus CLAUDE.md §13 beantwortet, sobald jemand die
   Seite aufruft: Wie heißt die Bibliothek wirklich? Steht die
   Konfigurationssite? Antwortet Dataverse?

   Die Schritte 3 bis 8 sind angelegt, aber leer. Nichts täuscht hier
   Funktion vor, die es noch nicht gibt.                                  */

const APP = (() => {

  const C = CRM_CONFIG;
  const $ = id => document.getElementById(id);

  const esc = s => {
    const d = document.createElement("div");
    d.textContent = s ?? "";
    return d.innerHTML;
  };

  const initialen = n => {
    if (!n) return "?";
    const p = String(n).trim().split(/\s+/);
    return (p.length > 1 ? p[0][0] + p[p.length - 1][0] : n.slice(0, 2)).toUpperCase();
  };

  let _toastT = null;
  function toast(msg, fehler = false) {
    let t = $("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.className = fehler ? "err-t" : "";
    t.hidden = false;
    clearTimeout(_toastT);
    _toastT = setTimeout(() => { t.hidden = true; }, 3600);
  }

  /* ── Start ─────────────────────────────────────────────────────────── */

  async function boot() {
    const setTxt = t => { const e = $("bootTxt"); if (e) e.textContent = t; };
    const fail = m => {
      $("bootSpin").hidden = true;
      $("bootTxt").hidden = true;
      const e = $("bootErr"); e.hidden = false; e.innerHTML = "⚠️ " + esc(m);
      const b = $("bootBtn"); b.hidden = false;
      b.onclick = () => AUTH.startLogin("select_account");
    };

    let r;
    try { r = await AUTH.signIn(); }
    catch (e) { return fail(e.message); }
    if (r === "redirecting") return;
    if (typeof r === "object" && r.error) return fail(r.error);

    try {
      setTxt("Benutzerdaten werden geladen …");
      await DATA.loadUser();
    } catch (e) {
      return fail("Anmeldung fehlgeschlagen: " + (e.detail || e.message));
    }

    if (DATA.ctx.role === "none") return keinZugriff();

    $("boot").hidden = true;
    $("app").hidden = false;
    renderKopf();
    renderSchritte();
    zeigeSchritt("start");
    selbsttest();
  }

  function keinZugriff() {
    $("boot").hidden = true;
    $("noAccess").hidden = false;
    $("naMsg").innerHTML =
      `Ihr Konto <b>${esc(DATA.ctx.email)}</b> ist für die CRM-Schnittstelle nicht `
      + "freigeschaltet. Sie können hier eine Freigabe bei der IT anfordern.";
    $("naWarum").textContent = DATA.roleErklaerung();
    $("naOut").onclick = AUTH.logout;
    $("naReq").onclick = freigabeAnfragen;
  }

  async function freigabeAnfragen() {
    const btn = $("naReq");
    btn.disabled = true; btn.textContent = "Wird gesendet …";
    try {
      await GRAPH.call("/me/sendMail", {
        method: "POST",
        body: JSON.stringify({
          saveToSentItems: false,
          message: {
            subject: "Freigabe-Anfrage: CRM-Schnittstelle – " + DATA.ctx.name,
            body: {
              contentType: "HTML",
              content: `<p>Hallo IT-Team,</p>
                <p>folgende Person beantragt Zugriff auf die <strong>CRM-Schnittstelle</strong>:</p>
                <ul><li>Name: <strong>${esc(DATA.ctx.name)}</strong></li>
                <li>E-Mail: ${esc(DATA.ctx.email)}</li>
                <li>App-Schlüssel: ${esc(C.appKey)}</li>
                <li>Datum: ${new Date().toLocaleString("de-DE")}</li></ul>
                <p>Freigabe über einen Eintrag in <code>${esc(C.permList)}</code>
                auf ${esc(C.permSite)} erteilen.</p>`
            },
            toRecipients: [{ emailAddress: { address: C.itMail } }]
          }
        })
      });
      $("naSent").hidden = false;
      btn.hidden = true;
    } catch (e) {
      const el = $("naErr");
      el.hidden = false;
      el.textContent = "Konnte nicht gesendet werden: " + (e.detail || e.message);
      btn.disabled = false; btn.textContent = "📧 Freigabe anfragen";
    }
  }

  /* ── Kopfbereich ───────────────────────────────────────────────────── */

  function renderKopf() {
    const c = DATA.ctx;
    $("uName").textContent = c.name;
    $("uMeta").textContent = c.email + " · " + c.role;
    $("uAvatar").textContent = initialen(c.name);
    $("btnLogout").onclick = AUTH.logout;

    const band = $("umgBand");
    band.textContent = C.umgebung;
    band.classList.toggle("prod", String(C.umgebung).toUpperCase() === "PROD");
    band.title = C.umgebung === "PROD"
      ? "Produktivsystem – Schreibzugriffe wirken sofort und sind nicht zurücknehmbar."
      : "Testumgebung";
  }

  /* ── Schritte ──────────────────────────────────────────────────────── */

  const SCHRITTE = [
    { id: "start",     nr: "",  titel: "Start",        aktiv: true },
    { id: "datei",     nr: "3", titel: "Datei wählen", aktiv: true },
    { id: "zuordnung", nr: "4", titel: "Zuordnung",    aktiv: true },
    { id: "pruefung",  nr: "5", titel: "Prüflauf",     aktiv: true },
    { id: "import",    nr: "6", titel: "Import",       aktiv: false },
    { id: "protokoll", nr: "7", titel: "Protokoll",    aktiv: false }
  ];

  function renderSchritte() {
    $("tabBar").innerHTML = SCHRITTE.map(s => `
      <button data-ziel="${s.id}"${s.aktiv ? "" : " disabled"}
              title="${s.aktiv ? "" : "Folgt in Phase " + s.nr}">
        ${s.nr ? `<span class="nr">${s.nr}</span>` : ""}${esc(s.titel)}
      </button>`).join("");
    for (const b of $("tabBar").querySelectorAll("button[data-ziel]")) {
      if (!b.disabled) b.onclick = () => zeigeSchritt(b.dataset.ziel);
    }
  }

  function zeigeSchritt(id) {
    for (const b of $("tabBar").querySelectorAll("button"))
      b.classList.toggle("active", b.dataset.ziel === id);
    if (id === "start") renderStart();
    if (id === "datei") renderDatei();
    if (id === "zuordnung") renderZuordnung();
    if (id === "pruefung") renderPruefung();
  }

  /* ── Schritt 5: Prüflauf ───────────────────────────────────────────────
     Erst auflösen (Phase 0), dann prüfen. Geschrieben wird nichts. Das
     Ergebnis ist die Aussage, die ein Prüflauf haben muss: „12 neu, 57
     geändert, 3 unverändert" – und die ist ohne die vorherige Abfrage
     nicht möglich (CLAUDE.md §8).                                        */

  let _bericht = null;
  /** Antworten auf Mehrfachtreffer: "entitySet|feld|wert" → Datensatz-ID.
     Sie überleben ein erneutes Prüfen und gehen später ins Protokoll –
     wer welchen Datensatz gewählt hat, muss nachvollziehbar bleiben. */
  const _entscheidungen = new Map();

  async function renderPruefung() {
    if (!_mappe) {
      $("main").innerHTML = `
        <div class="page-head"><h2>Prüflauf</h2></div>
        <div class="card"><p class="warn">Erst unter <b>Datei wählen</b> eine Mappe
          öffnen – der Prüflauf braucht die Daten.</p></div>`;
      return;
    }

    $("main").innerHTML = `
      <div class="page-head">
        <h2>Prüflauf</h2>
        <p>Sagt vorher, was ein Import täte. Es wird <b>nichts geschrieben</b>.
           Geprüft wird <code>${esc(_datei.name)}</code>.</p>
      </div>
      <div class="card"><p class="hint" id="plStatus">Konfiguration wird geladen …</p></div>`;

    const status = t => { const e = $("plStatus"); if (e) e.textContent = t; };

    try {
      const profil = await SPLISTEN.profil();
      status("Wertzuordnungen …");
      const werte = await SPLISTEN.werte().catch(() => ({}));
      status("Auflösung: Bestand in Dataverse abfragen …");
      const aufl = await AUFLOESUNG.fuer(profil, _mappe, t => status("Auflösung: " + t));
      status("Zeilen prüfen …");
      _bericht = { ...PRUEFUNG.lauf(profil, _mappe, aufl, werte, _entscheidungen),
                   aufl, profil, werte };
      renderBericht();
    } catch (e) {
      $("main").innerHTML += `<div class="card"><p class="err">${esc(e.detail || e.message)}</p></div>`;
    }
  }

  function renderBericht() {
    const b = _bericht, g = b.gesamt;
    const sauber = !g.fehler;

    $("main").innerHTML = `
      <div class="page-head">
        <h2>Prüflauf</h2>
        <p>Es wurde <b>nichts geschrieben</b>. Geprüft: <code>${esc(_datei.name)}</code></p>
      </div>

      <div class="card">
        <h4>${sauber ? "✓" : "!"} Vorschau</h4>
        <div class="bilanz">
          ${[["neu", g.neu, "gruen"], ["geändert", g.aktualisiert, "gruen"],
             ["unverändert", g.unveraendert, "grau"],
             ["übersprungen", g.uebersprungen, "grau"],
             ["mit Fehler", g.fehler, g.fehler ? "rot" : "grau"]]
            .map(([t, n, f]) => `<div class="zahl-kachel ${f}">
                 <b>${n}</b><small>${t}</small></div>`).join("")}
        </div>
        <p class="hint" style="margin-top:14px">
          <b>unverändert</b> ist ein eigenes Ergebnis: ohne diesen Wert sieht ein
          Lauf, der nichts geändert hat, genauso aus wie einer, der nicht
          gelaufen ist.</p>
        <div class="row">
          <button class="btn" id="plExcel">⬇ Bericht als Excel</button>
          <button class="btn sec" id="plNeu">Erneut prüfen</button>
          <button class="btn" id="plImport" disabled title="Phase 6 – noch nicht gebaut">
            Import starten</button>
        </div>
        ${g.fehler ? `<p class="err" style="margin-top:14px">Solange Fehler offen sind,
          bleibt der Import gesperrt. Es gibt keinen Weg daran vorbei.</p>` : ""}
      </div>

      ${entscheidungsBlock()}

      <h3 class="section">Je Schritt</h3>
      <div class="card"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Schritt</th><th>Ziel</th><th>Modus</th><th>Zeilen</th>
          <th>neu</th><th>geändert</th><th>unverändert</th><th>übersprungen</th><th>Fehler</th></tr></thead>
        <tbody>${b.schritte.map(z => `
          <tr class="${z.inaktiv ? "inaktiv" : z.fehler ? "problem" : ""}">
            <td><b>${z.s.step}</b></td>
            <td>${esc(z.s.entitySet)}${z.inaktiv ? ' <span class="pill grau">inaktiv</span>' : ""}</td>
            <td>${esc(z.s.mode)}</td>
            <td>${z.zeilen || ""}</td>
            <td>${z.neu || ""}</td><td>${z.aktualisiert || ""}</td>
            <td>${z.unveraendert || ""}</td><td>${z.uebersprungen || ""}</td>
            <td>${z.fehler || ""}</td>
          </tr>
          ${z.strukturfehler ? `<tr class="problem"><td></td><td colspan="8">
             <span class="hinweis-text">${esc(z.strukturfehler)}</span></td></tr>` : ""}
        `).join("")}</tbody>
      </table></div></div>

      <h3 class="section">Auflösung</h3>
      <div class="card">
        <p class="hint">${b.aufl.abfragen.length} Sammelabfragen statt eines Aufrufs
           je Zeile. Der Altflow braucht für 300 Zeilen rund 600 Einzelabfragen.</p>
        <div class="tbl-wrap"><table class="tbl roh">
          <thead><tr><th>Tabelle</th><th>Feld</th><th>gesucht</th><th>gefunden</th>
            <th>nicht gefunden</th><th>mehrdeutig</th></tr></thead>
          <tbody>${b.aufl.abfragen.map(a => `
            <tr class="${a.mehrdeutig.length ? "problem" : ""}">
              <td>${esc(a.entitySet)}</td><td>${esc(a.feld)}</td>
              <td>${a.gesucht}</td><td>${a.gefunden}</td>
              <td>${a.fehlend.length ? `<span class="hinweis-text">${a.fehlend.length}: ${esc(a.fehlend.slice(0,4).join(", "))}${a.fehlend.length>4?" …":""}</span>` : ""}</td>
              <td>${a.mehrdeutig.length ? `<span class="fehlt">${a.mehrdeutig.map(m=>`${m.wert}×${m.anzahl}`).join(", ")}</span>` : ""}</td>
            </tr>`).join("")}</tbody>
        </table></div>
      </div>

      ${liste("Fehler", b.fehler, "err")}
      ${liste("Warnungen – der Import läuft trotzdem", b.warnungen, "warn")}`;

    $("plNeu").onclick = renderPruefung;
    $("plExcel").onclick = berichtExportieren;

    for (const sel of document.querySelectorAll("select[data-entscheidung]")) {
      sel.onchange = () => {
        if (sel.value) _entscheidungen.set(sel.dataset.entscheidung, sel.value);
        else _entscheidungen.delete(sel.dataset.entscheidung);
      };
    }
    const uebernehmen = $("plUebernehmen");
    if (uebernehmen) uebernehmen.onclick = () => {
      // Nur neu einstufen, nicht neu abfragen – der Bestand hat sich nicht
      // geändert, und ein zweiter Durchlauf durch Dataverse kostet nur Zeit.
      _bericht = { ..._bericht,
        ...PRUEFUNG.lauf(_bericht.profil, _mappe, _bericht.aufl,
                         _bericht.werte, _entscheidungen) };
      renderBericht();
      toast("Entscheidungen übernommen.");
    };
  }

  /** Offene Mehrfachtreffer zur Auswahl. Der Altflow nimmt hier mit
   *  `$top: 1` einfach den ersten – und schreibt bei doppelten
   *  Kundennummern auf das falsche Konto. Hier entscheidet ein Mensch,
   *  und die Entscheidung wird protokolliert. */
  function entscheidungsBlock() {
    const offen = AUFLOESUNG.offeneEntscheidungen(_bericht.aufl, _entscheidungen);
    const getroffen = _entscheidungen.size;
    if (!offen.length && !getroffen) return "";

    return `
      <h3 class="section">Offene Entscheidungen${offen.length ? ` (${offen.length})` : ""}</h3>
      <div class="card">
        <p class="hint">Ein Wert findet mehrere Datensätze. Welcher gemeint ist,
           kann die App nicht wissen – geraten wird nicht. Die Auswahl gilt für
           diesen Lauf und steht im Protokoll.</p>
        ${offen.length ? offen.map(o => `
          <div class="entscheidung">
            <div class="frage">
              <code>${esc(o.entitySet)}.${esc(o.feld)} = ${esc(String(o.wert))}</code>
              <small>${o.kandidaten.length} Treffer</small>
            </div>
            <select data-entscheidung="${esc(o.schluessel)}">
              <option value="">— bitte wählen —</option>
              ${o.kandidaten.map(k => `<option value="${esc(k[o.idFeld] || "")}">
                ${esc(kandidatText(k, o))}</option>`).join("")}
            </select>
          </div>`).join("") : '<p class="ok">Alle Mehrfachtreffer sind entschieden.</p>'}
        ${getroffen ? `<p class="hint" style="margin-top:12px">${getroffen}
           Entscheidung(en) getroffen.</p>` : ""}
        <div class="row" style="margin-top:12px">
          <button class="btn" id="plUebernehmen">Entscheidungen übernehmen</button>
        </div>
      </div>`;
  }

  /** Ein Kandidat muss unterscheidbar sein, sonst hilft die Auswahl nicht.
   *  Deshalb Name plus alles, was ihn von seinem Zwilling trennt. */
  function kandidatText(k, o) {
    const teile = [];
    for (const f of ["name", "fullname", "emailaddress1", "statecode"]) {
      if (k[f] === undefined || k[f] === null) continue;
      teile.push(f === "statecode" ? (Number(k[f]) === 0 ? "aktiv" : "inaktiv") : String(k[f]));
    }
    const id = k[o.idFeld];
    if (id) teile.push("…" + String(id).slice(-6));
    return teile.join(" · ") || String(id || "?");
  }

  function liste(titel, eintraege, klasse) {
    if (!eintraege.length) return "";
    const zeigen = eintraege.slice(0, 100);
    return `
      <h3 class="section">${esc(titel)} (${eintraege.length})</h3>
      <div class="card">
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Schritt</th><th>Zeile</th><th>Spalte</th><th>Feld</th><th>Meldung</th></tr></thead>
          <tbody>${zeigen.map(f => `<tr>
            <td>${f.schritt ?? ""}</td>
            <td class="zeilennr">${f.zeile ?? ""}</td>
            <td>${esc(f.spalte || "")}</td>
            <td>${esc(f.feld || "")}</td>
            <td><span class="${klasse === "err" ? "fehlt" : "hinweis-text"}">${esc(f.meldung)}</span></td>
          </tr>`).join("")}</tbody>
        </table></div>
        ${eintraege.length > zeigen.length
          ? `<p class="hint" style="margin-top:12px">${eintraege.length - zeigen.length}
             weitere – vollständig im Excel-Bericht.</p>` : ""}
      </div>`;
  }

  /** Bericht als Arbeitsmappe. Die Fachabteilung arbeitet ihn in der
   *  Quelldatei ab; dafür ist die Zeilennummer die wichtigste Spalte. */
  async function berichtExportieren() {
    await EXCEL.ensureSheetJS();
    const b = _bericht;
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      b.schritte.map(z => ({
        Schritt: z.s.step, Ziel: z.s.entitySet, Modus: z.s.mode,
        Aktiv: z.inaktiv ? "nein" : "ja", Zeilen: z.zeilen,
        Neu: z.neu, Geaendert: z.aktualisiert, Unveraendert: z.unveraendert,
        Uebersprungen: z.uebersprungen, Fehler: z.fehler
      }))), "Bilanz");

    const spalten = e => ({ Schritt: e.schritt ?? "", Zeile: e.zeile ?? "",
      Spalte: e.spalte || "", Feld: e.feld || "", Wert: e.wert ?? "", Meldung: e.meldung });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      b.fehler.length ? b.fehler.map(spalten) : [{ Meldung: "keine" }]), "Fehler");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      b.warnungen.length ? b.warnungen.map(spalten) : [{ Meldung: "keine" }]), "Warnungen");

    const name = _datei.name.replace(/\.xlsx?$/i, "") + "_Pruefbericht.xlsx";
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buf],
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast("Bericht heruntergeladen: " + name);
  }

  /* ── Schritt 4: Zuordnung prüfen ───────────────────────────────────────
     Die Zuordnung wird hier NICHT bearbeitet – sie liegt in SharePoint und
     wird dort gepflegt (docs/02). Was hier passiert, ist die Prüfung:
     Passen die eingetragenen Quellspalten zur geladenen Datei, und passen
     die Zielfelder zu dem, was Dataverse tatsächlich führt?

     Das ist der Punkt, an dem der Altflow scheitert: Er liest die Spalte
     „Zeichennummer“, die es nicht gibt, bekommt null und schreibt es
     klaglos. Hier fällt so etwas auf, bevor irgendwo geschrieben wird.   */

  async function renderZuordnung() {
    $("main").innerHTML = `
      <div class="page-head">
        <h2>Zuordnung</h2>
        <p>Gepflegt wird sie in SharePoint unter
           <code>${esc(C.listen.profile)}</code> und
           <code>${esc(C.listen.mappings)}</code>. Hier wird geprüft, ob sie
           zur geladenen Datei und zu den Feldern passt, die es in Dataverse
           wirklich gibt.</p>
      </div>
      <div id="zoInhalt"><div class="card"><p class="hint">Profil wird geladen …</p></div></div>`;

    let p;
    try {
      p = await SPLISTEN.profil();
    } catch (e) {
      $("zoInhalt").innerHTML = `<div class="card"><p class="err">${esc(e.detail || e.message)}</p></div>`;
      return;
    }

    const kopf = `
      <div class="card">
        <h4>📋 ${esc(p.name || "kein Profil")}</h4>
        <p class="hint">${p.schritte.length} Schritte
          ${p.profile.length > 1 ? ` · weitere Profile in der Liste: ${esc(p.profile.filter(x => x !== p.name).join(", "))}` : ""}
          ${_mappe ? ` · geprüft gegen <b>${esc(_datei.name)}</b>`
                   : ' · <b>keine Datei geladen</b> – die Quellspalten werden nicht geprüft'}</p>
        ${!_mappe ? '<p class="warn">Ohne geladene Datei prüft diese Seite nur die '
          + 'Zielfelder gegen Dataverse. Für die vollständige Prüfung erst unter '
          + '<b>Datei wählen</b> eine Mappe öffnen.</p>' : ""}
      </div>`;

    $("zoInhalt").innerHTML = kopf + '<div class="card"><p class="hint">Dataverse-Felder werden gelesen …</p></div>';

    const teile = [];
    for (const s of p.schritte) {
      let felder = null, fehlerText = "";
      try {
        felder = istOffen(C.dataverseUrl) ? null : await DV.felder(s.entitySet);
      } catch (e) {
        fehlerText = e.detail || e.message;
      }
      teile.push(schrittKarte(s, p.zuordnungen[s.mappingKey] || [], felder, fehlerText));
    }
    $("zoInhalt").innerHTML = kopf + teile.join("");
  }

  /** Eine Karte je Importschritt, mit der Prüftabelle darin. */
  function schrittKarte(s, zuordnungen, felder, fehlerText) {
    const blatt = _mappe && s.sourceSheet ? EXCEL.blatt(_mappe, s.sourceSheet) : null;
    const kopfzeilen = blatt ? new Set(blatt.kopfzeilen) : null;

    let probleme = 0;
    const zeilen = zuordnungen.map(z => {
      const befunde = [];

      // Quellspalte – nur prüfbar, wenn eine Datei geladen ist.
      let quelle = '<span class="leer">–</span>';
      if (z.sourceColumn) {
        const wo = z.sourceSheet || s.sourceSheet;
        const b = _mappe && wo ? EXCEL.blatt(_mappe, wo) : null;
        if (!_mappe) quelle = esc(z.sourceColumn);
        else if (!b) { quelle = `<span class="fehlt">${esc(z.sourceColumn)}</span>`;
                       befunde.push(`Blatt „${wo}“ fehlt`); }
        else if (b.kopfzeilen.includes(z.sourceColumn)) quelle = esc(z.sourceColumn);
        else { quelle = `<span class="fehlt">${esc(z.sourceColumn)}</span>`;
               befunde.push("Spalte nicht in der Datei"); }
      }

      // Zielfeld gegen die Metadaten.
      let ziel = z.targetField ? esc(z.targetField) : '<span class="leer">–</span>';
      if (z.targetField && z.targetField.startsWith("KLAEREN")) {
        ziel = '<span class="offen">noch offen</span>';
      } else if (z.targetField && felder) {
        const f = felder[z.targetField];
        if (!f) { ziel = `<span class="fehlt">${esc(z.targetField)}</span>`;
                  befunde.push("Feld gibt es in Dataverse nicht"); }
        else {
          const passt = DV.typPasst(z.targetType, f.typ);
          if (passt === false) befunde.push(`Typ: Profil ${z.targetType}, Dataverse ${f.typ}`);
          if (!f.aenderbar && !f.anlegbar) befunde.push("Feld ist schreibgeschützt");
        }
      }

      if (befunde.length && z.aktiv) probleme++;
      const zustand = !z.aktiv ? "inaktiv" : befunde.length ? "problem" : "gut";
      return `<tr class="${zustand}">
        <td>${quelle}</td>
        <td>${ziel}</td>
        <td>${esc(z.targetType || "")}</td>
        <td>${z.istSchluessel ? "🔑" : ""}${z.pflicht ? " ✱" : ""}</td>
        <td>${esc(z.writePolicy)}</td>
        <td>${befunde.length ? `<span class="hinweis-text">${esc(befunde.join(" · "))}</span>`
                             : (z.aktiv ? "" : '<span class="leer">nicht aktiv</span>')}</td>
      </tr>`;
    }).join("");

    const st = fehlerText ? "schlecht" : probleme ? "schlecht" : "gut";
    return `
      <div class="card">
        <h4>
          <span class="stufe">${s.step}</span>
          ${esc(s.entitySet)}
          <span class="pill ${st === "gut" ? "gruen" : "grau"}">${esc(s.mode)}</span>
          ${s.aktiv ? "" : '<span class="pill grau">inaktiv</span>'}
        </h4>
        <p class="hint">
          Blatt <b>${esc(s.sourceSheet || "—")}</b>
          ${s.alternateKey ? ` · Schlüssel <code>${esc(s.alternateKey)}</code>` : ""}
          ${s.skipIfClosed ? " · geschlossene Chancen werden übersprungen" : ""}
          ${blatt ? ` · ${blatt.anzahl} Zeilen in der Datei` : ""}
        </p>
        ${fehlerText ? `<p class="err">Dataverse-Felder nicht lesbar: ${esc(fehlerText)}</p>` : ""}
        ${probleme ? `<p class="warn"><b>${probleme}</b> aktive Zuordnung(en) mit Befund –
                      siehe letzte Spalte.</p>` : ""}
        <div class="tbl-wrap"><table class="tbl roh">
          <thead><tr>
            <th>Quellspalte</th><th>Zielfeld</th><th>Typ</th><th></th>
            <th>Schreibregel</th><th>Befund</th>
          </tr></thead>
          <tbody>${zeilen || '<tr><td colspan="6" class="leer">keine Zuordnungen</td></tr>'}</tbody>
        </table></div>
      </div>`;
  }

  /* ── Schritt 3: Datei wählen ───────────────────────────────────────── */

  /** Aktueller Stand: gewählte Datei und die eingelesene Mappe. Liegt
   *  bewusst nur im Arbeitsspeicher – die Datei bleibt in SharePoint. */
  let _datei = null;
  let _mappe = null;
  let _dateien = [];      // vollständige Liste, einmal geladen
  let _seite = 0;         // nullbasiert

  const PRO_SEITE = 10;

  const datum = s => s ? new Date(s).toLocaleString("de-DE",
    { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

  /** Zellwert für die Vorschau. Date, Zahl, null und Text sehen sonst
   *  gleich aus – und „null“ als Text wäre eine Lüge. */
  function zelle(v) {
    if (v === null || v === undefined || v === "") return '<span class="leer">–</span>';
    if (v instanceof Date) return esc(v.toLocaleDateString("de-DE"));
    return esc(String(v));
  }

  async function renderDatei() {
    $("main").innerHTML = `
      <div class="page-head">
        <h2>Datei wählen</h2>
        <p>Die Mappen liegen in <code>${esc(C.quellSite.split(":").pop())}</code> ▸
           <code>${esc(C.quellDrive)}</code> ▸ <code>${esc(C.quellOrdner)}</code> –
           dort, wo Timeline sie ablegt. Sie werden gelesen, nicht verschoben
           und nicht verändert.</p>
      </div>
      <div class="card"><h4>📂 Verfügbare Mappen</h4><div id="dateiListe">Wird geladen …</div></div>
      <div id="vorschau"></div>`;

    try {
      _dateien = await SPFILES.liste();
      _seite = 0;
      renderDateiListe();
    } catch (e) {
      $("dateiListe").innerHTML = `<p class="err">${esc(e.detail || e.message)}</p>`;
    }
  }

  /** Tabelle für die aktuelle Seite. Die Liste wird EINMAL geladen und dann
   *  nur noch geblättert – der Ordner hat ein paar Dutzend Mappen, das lohnt
   *  keinen zweiten Graph-Aufruf je Seitenwechsel. */
  function renderDateiListe() {
    if (!_dateien.length) {
      $("dateiListe").innerHTML = '<p class="hint">Keine Excel-Mappen im Ordner gefunden.</p>';
      return;
    }

    const seiten = Math.ceil(_dateien.length / PRO_SEITE);
    _seite = Math.min(Math.max(_seite, 0), seiten - 1);
    const von = _seite * PRO_SEITE;
    const teil = _dateien.slice(von, von + PRO_SEITE);

    $("dateiListe").innerHTML = `
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr>
          <th>Datei</th><th>Geändert</th><th>Von</th><th>Größe</th>
          <th>Status</th><th></th>
        </tr></thead>
        <tbody>${teil.map((d, i) => `
          <tr${_datei && _datei.id === d.id ? ' class="gewaehlt"' : ""}>
            <td><b>${esc(d.name)}</b></td>
            <td>${esc(datum(d.geaendert))}</td>
            <td>${esc(d.geaendertVon)}</td>
            <td>${esc(d.groesse)}</td>
            <td><span class="pill ${d.status === "Importiert" ? "gruen" : "grau"}">${esc(d.status)}</span></td>
            <td class="actions"><button class="btn sm" data-i="${von + i}">Öffnen</button></td>
          </tr>`).join("")}
        </tbody>
      </table></div>
      ${seiten > 1 ? blaetterung(von, teil.length, seiten) : ""}`;

    for (const b of $("dateiListe").querySelectorAll("button[data-i]"))
      b.onclick = () => oeffnen(_dateien[+b.dataset.i], b);

    for (const b of $("dateiListe").querySelectorAll("button[data-s]")) {
      b.onclick = () => { _seite = +b.dataset.s; renderDateiListe(); };
    }
  }

  function blaetterung(von, anzahl, seiten) {
    // Bei vielen Seiten nicht alle Knöpfe zeigen, sondern ein Fenster um die
    // aktuelle – sonst bricht die Zeile bei 40 Mappen um.
    const fenster = [];
    const rand = 2;
    for (let s = 0; s < seiten; s++) {
      if (s === 0 || s === seiten - 1 || Math.abs(s - _seite) <= rand) fenster.push(s);
      else if (fenster[fenster.length - 1] !== "…") fenster.push("…");
    }

    return `
      <div class="blaettern">
        <span class="zaehler">${von + 1}–${von + anzahl} von ${_dateien.length}</span>
        <button class="btn sec sm" data-s="${_seite - 1}"${_seite === 0 ? " disabled" : ""}>‹</button>
        ${fenster.map(s => s === "…"
          ? '<span class="luecke">…</span>'
          : `<button class="btn sec sm${s === _seite ? " aktiv" : ""}" data-s="${s}">${s + 1}</button>`
        ).join("")}
        <button class="btn sec sm" data-s="${_seite + 1}"${_seite === seiten - 1 ? " disabled" : ""}>›</button>
      </div>`;
  }

  async function oeffnen(d, btn) {
    const ziel = $("vorschau");
    btn.disabled = true; btn.textContent = "Lädt …";
    ziel.innerHTML = '<div class="card"><p class="hint">Datei wird geladen und gelesen …</p></div>';
    try {
      const buf = await SPFILES.laden(d);
      _datei = d;
      _mappe = await EXCEL.lesen(buf);
      renderDateiListe();   // markiert die gewählte Zeile
      renderVorschau();
    } catch (e) {
      ziel.innerHTML = `<div class="card"><p class="err">${esc(e.detail || e.message)}</p></div>`;
    } finally {
      btn.disabled = false; btn.textContent = "Öffnen";
    }
  }

  function renderVorschau() {
    const erwartet = ["Anfragen", "Positionen"];
    const fehlend = erwartet.filter(n => !EXCEL.blatt(_mappe, n));
    const normAlle = _mappe.blaetter.flatMap(b =>
      b.normalisiert.map(n => ({ blatt: b.name, ...n })));
    const doppeltAlle = _mappe.blaetter.flatMap(b =>
      b.doppelt.map(k => ({ blatt: b.name, k })));

    $("vorschau").innerHTML = `
      <h3 class="section dateiname">${esc(_datei.name)}</h3>

      ${_datei.status === "Importiert" ? `<p class="warn">Diese Datei ist bereits
        als <b>importiert</b> markiert${_datei.importiertAm ? " (" + esc(datum(_datei.importiertAm)) + ")" : ""}.
        Ein Wiederholungslauf ist erlaubt und dank Upsert über Alternativschlüssel
        gefahrlos – aber sieh vorher nach, ob er beabsichtigt ist.</p>` : ""}

      ${fehlend.length
        ? `<p class="err">Erwartete Blätter fehlen: <b>${esc(fehlend.join(", "))}</b>.
           Vorhanden: ${esc(_mappe.blaetter.map(b => b.name).join(", "))}.</p>`
        : `<p class="ok">Beide erwarteten Blätter vorhanden – die Annahme über die
           Dateistruktur stimmt.</p>`}

      ${normAlle.length ? `<p class="warn"><b>${normAlle.length} Kopfzeile(n) normalisiert.</b>
        Die Vorlage ist an diesen Stellen unsauber; der Import läuft trotzdem, weil
        die Zuordnung gegen die normalisierte Fassung arbeitet:<br>
        ${normAlle.map(n => `<code>${esc(n.blatt)}</code>: „${esc(n.roh)}“ → „${esc(n.normal)}“`).join("<br>")}</p>` : ""}

      ${doppeltAlle.length ? `<p class="err"><b>Doppelte Spaltennamen:</b>
        ${doppeltAlle.map(x => `<code>${esc(x.blatt)}</code>: ${esc(x.k)}`).join(", ")}.
        Die jeweils zweite Spalte überschreibt die erste.</p>` : ""}

      <div class="row" id="blattWahl">
        ${_mappe.blaetter.map((b, i) => `
          <button class="btn sec sm" data-b="${i}">
            ${esc(b.name)} <span class="zahl">${b.anzahl}</span>
          </button>`).join("")}
      </div>
      <div id="blattInhalt"></div>`;

    for (const b of $("blattWahl").querySelectorAll("button[data-b]"))
      b.onclick = () => zeigeBlatt(+b.dataset.b);

    // Erstes nicht leeres Blatt vorbelegen
    const start = _mappe.blaetter.findIndex(b => b.anzahl > 0);
    zeigeBlatt(start < 0 ? 0 : start);
  }

  function zeigeBlatt(idx) {
    const b = _mappe.blaetter[idx];
    for (const btn of $("blattWahl").querySelectorAll("button[data-b]"))
      btn.classList.toggle("aktiv", +btn.dataset.b === idx);

    if (!b || !b.anzahl) {
      $("blattInhalt").innerHTML = `<div class="card"><p class="hint">Blatt
        „${esc(b ? b.name : "?")}“ enthält keine Datenzeilen.</p></div>`;
      return;
    }

    const zeigen = b.zeilen.slice(0, 20);
    $("blattInhalt").innerHTML = `
      <div class="card">
        <h4>${esc(b.name)}</h4>
        <p class="hint">${b.anzahl} Datenzeilen, ${b.kopfzeilen.length} Spalten.
           Angezeigt: die ersten ${zeigen.length}. Die Spalte <b>Zeile</b> ist die
           Zeilennummer wie in Excel sichtbar – Fehlermeldungen verweisen später
           genau darauf.</p>
        <div class="tbl-wrap"><table class="tbl roh">
          <thead><tr><th>Zeile</th>${b.kopfzeilen.map(k => `<th>${esc(k)}</th>`).join("")}</tr></thead>
          <tbody>${zeigen.map(z => `<tr>
            <td class="zeilennr">${z._zeile}</td>
            ${b.kopfzeilen.map(k => `<td>${zelle(z[k])}</td>`).join("")}
          </tr>`).join("")}</tbody>
        </table></div>
      </div>`;
  }

  /* ── Startseite ────────────────────────────────────────────────────── */

  function renderStart() {
    const c = DATA.ctx;
    $("main").innerHTML = `
      <div class="page-head">
        <h2>CRM-Schnittstelle</h2>
        <p>Excel-Daten aus SharePoint nach Dynamics 365 importieren – in der
           richtigen Abhängigkeitsreihenfolge, wiederholbar, mit Prüflauf und
           Protokoll. Ablösung des Flows <code>TestumgebungExpImpCRMTimeline</code>.</p>
      </div>

      <div class="split">
        <div class="card">
          <h4>🔐 Anmeldung</h4>
          <dl class="kv">
            <dt>Angemeldet als</dt><dd>${esc(c.name)}</dd>
            <dt>E-Mail</dt><dd>${esc(c.email)}</dd>
            <dt>Rolle</dt><dd>${esc(c.role)}</dd>
            <dt>Umgebung</dt><dd>${esc(C.umgebung)}</dd>
            <dt>Umleitungs-URI</dt><dd><code>${esc(AUTH.redirectUri)}</code></dd>
          </dl>
          <p class="hint" style="margin-top:14px">${esc(DATA.roleErklaerung())}</p>
          <div class="row">
            <button class="btn sec sm" id="btnRolle">🔄 Rolle neu einlesen</button>
            <button class="btn sec sm" id="btnCache">🧹 Metadaten-Cache leeren</button>
          </div>
        </div>

        <div class="card">
          <h4>🩺 Selbsttest</h4>
          <p class="hint">Beantwortet die offenen Punkte aus <code>CLAUDE.md</code> §13,
             ohne dass jemand den Graph Explorer öffnen muss.</p>
          <div id="tests"></div>
          <div class="row" style="margin-top:12px">
            <button class="btn sec sm" id="btnTest">Erneut prüfen</button>
          </div>
        </div>
      </div>

      <h3 class="section">Ablauf</h3>
      <div class="card">
        <p class="hint">Nach jeder Phase steht etwas Lauffähiges. Schritt 6 –
           der Prüflauf – ist nicht überspringbar: es gibt keinen Weg von der
           Zuordnung zum Import, der ihn auslässt.</p>
        <table class="tbl">
          <thead><tr><th style="width:70px">Phase</th><th>Ergebnis</th><th style="width:130px">Stand</th></tr></thead>
          <tbody>
            ${[
              ["1", "Gerüst, Corporate Design, Auslieferung", "fertig"],
              ["2", "Anmeldung, Rolle, Selbsttest", "fertig"],
              ["3", "Dateien aus SharePoint lesen", "offen"],
              ["4", "Feldzuordnung aus den Konfigurationslisten", "offen"],
              ["5", "Auflösungsphase und Prüflauf", "offen"],
              ["6", "Import mit Stapeln und Drosselung", "offen"],
              ["7", "Protokoll nach SharePoint", "offen"]
            ].map(([n, t, s]) => `<tr${s === "offen" ? ' class="off"' : ""}>
                 <td><b>${n}</b></td><td>${esc(t)}</td>
                 <td><span class="pill ${s === "fertig" ? "gruen" : "grau"}">${esc(s)}</span></td>
               </tr>`).join("")}
          </tbody>
        </table>
      </div>`;

    $("btnTest").onclick = selbsttest;
    $("btnCache").onclick = () => { GRAPH.clearCache(); toast("Cache geleert."); selbsttest(); };
    $("btnRolle").onclick = async () => {
      const r = await DATA.reloadRole();
      renderKopf();
      renderStart();
      toast(r.geaendert ? `Rolle: ${r.alt} → ${r.neu}` : `Rolle unverändert (${r.neu}).`);
    };
  }

  /* ── Selbsttest ────────────────────────────────────────────────────── */

  /** Eine Prüfung: { titel, lauf } – lauf() liefert { ok, text } oder wirft. */
  function pruefungen() {
    return [
      {
        titel: "Microsoft Graph",
        lauf: async () => {
          const t = AUTH.tokenInfo("graph");
          if (!t) return { ok: false, text: "Kein Graph-Token im Speicher." };
          return { ok: true, text: `Token gültig bis ${t.exp?.toLocaleTimeString("de-DE") || "?"} `
            + `· Scopes: ${t.scopes.join(", ") || "keine"}` };
        }
      },
      {
        titel: `Rechteliste ${C.permList}`,
        lauf: async () => {
          const rows = await GRAPH.listItems(C.permSite, C.permList, ["UserEmail", "App", "Role"]);
          if (!rows) return { ok: false, text: `Auf ${C.permSite} nicht gefunden oder nicht lesbar.` };
          const meine = rows.filter(r => (r.App === C.appKey || r.App === "*"));
          return { ok: true, text: `${rows.length} Einträge, davon ${meine.length} für „${C.appKey}“ oder „*“.` };
        }
      },
      {
        titel: `Quellbibliothek „${C.quellDrive}“`,
        lauf: async () => {
          const id = await GRAPH.driveId(C.quellSite, C.quellDrive);
          if (id) return { ok: true, text: "Eigene Dokumentbibliothek – Konfiguration stimmt." };
          // Zweiter Fall: „Austausch“ ist ein Ordner in „Dokumente“.
          const alle = await GRAPH.drives(C.quellSite);
          const namen = alle.map(d => d.name).join(", ");
          for (const d of alle) {
            const kinder = await GRAPH.ordnerInhalt(d.id, "");
            if (kinder.some(k => k.folder && k.name.toLowerCase() === C.quellDrive.toLowerCase()))
              return { ok: false, text: `„${C.quellDrive}“ ist ein ORDNER in der Bibliothek `
                + `„${d.name}“, keine eigene Bibliothek. In js/config.js entsprechend `
                + `anpassen: quellDrive = "${d.name}", quellOrdner = "/${C.quellDrive}${C.quellOrdner}".` };
          }
          return { ok: false, text: `Nicht gefunden. Vorhandene Bibliotheken: ${namen || "keine"}.` };
        }
      },
      {
        titel: `Quellordner ${C.quellOrdner}`,
        lauf: async () => {
          const id = await GRAPH.driveId(C.quellSite, C.quellDrive);
          if (!id) return { ok: false, text: "Übersprungen – Bibliothek nicht aufgelöst." };
          const kinder = await GRAPH.ordnerInhalt(id, C.quellOrdner);
          const dateien = kinder.filter(k => k.file);
          // Graph liefert die Kinder nicht nach Datum sortiert. Wer „neueste“
          // schreibt, muss auch danach sortieren.
          const xlsx = dateien.filter(k => /\.xlsx?$/i.test(k.name))
            .sort((a, b) => String(b.lastModifiedDateTime || "")
              .localeCompare(String(a.lastModifiedDateTime || "")));
          return { ok: true, text: `${dateien.length} Dateien, davon ${xlsx.length} Excel-Mappen.`
            + (xlsx[0] ? ` Zuletzt geändert: ${xlsx[0].name}` : "") };
        }
      },
      {
        titel: "Konfigurationssite CRM-Integration",
        lauf: async () => {
          try { await GRAPH.siteId(C.konfigSite); }
          catch { return { ok: false, text: "Existiert noch nicht – anzulegen nach docs/02, Schritt 0." }; }
          const fehlt = [];
          for (const name of Object.values(C.listen))
            if (!await GRAPH.listId(C.konfigSite, name)) fehlt.push(name);
          return fehlt.length
            ? { ok: false, text: `Site vorhanden, es fehlen: ${fehlt.join(", ")}.` }
            : { ok: true, text: "Site und alle fünf Listen vorhanden." };
        }
      },
      {
        titel: "Dataverse (WhoAmI)",
        lauf: async () => {
          if (istOffen(C.dataverseUrl))
            return { ok: false, text: "dataverseUrl in js/config.js noch nicht gesetzt "
              + "– die URL der Testumgebung fehlt (CLAUDE.md §13)." };
          try {
            const w = await DV.whoAmI();
            return { ok: true, text: `UserId ${w.UserId} · Organisation ${w.OrganizationId}` };
          } catch (e) {
            // Der häufigste Fall ist nicht „abgelaufen“, sondern: die
            // Berechtigung Dynamics CRM user_impersonation fehlt an der
            // Registrierung oder ist ohne Administratorzustimmung. Entra
            // sagt das in error_description; das steht jetzt hier.
            if (e.res === "dataverse" || e.code === "kein_refresh_token") {
              return {
                ok: false,
                text: e.message + (e.interaktion
                  ? "  Ein Anmeldeversuch mit Zustimmung kann das beheben."
                  : "  Das ist keine abgelaufene Sitzung – prüfe in der "
                    + "Registrierung, ob „Dynamics CRM · user_impersonation“ "
                    + "mit Administratorzustimmung eingetragen ist (docs/01 §2)."),
                aktion: e.interaktion
                  ? { label: "Zustimmung erteilen",
                      fn: () => AUTH.startLogin("consent", "dataverse") }
                  : null
              };
            }
            // 401/403 heißt: Token da, aber der Benutzer fehlt im
            // Environment oder hat keine Sicherheitsrolle (docs/01 §4).
            if (e.status === 403)
              return { ok: false, text: "Token gültig, aber HTTP 403: Benutzer ist im "
                + "Environment nicht aktiviert oder hat keine Sicherheitsrolle "
                + "(docs/01 §3). " + e.message };
            return { ok: false, text: e.detail || e.message };
          }
        }
      },
      {
        // Anlass: docs/05, Befund B1. Der Altflow hat am 04.06.2026 durch
        // eine verschachtelte Schleife 76 Verkaufschancen doppelt angelegt.
        // Aufgefallen ist das erst, als der Alternativschlüssel nicht
        // anlegbar war – also Wochen später und nur durch Zufall. Ein
        // Schlüsselfeld, das seine Eindeutigkeit verliert, macht den
        // gesamten Upsert-Ansatz kaputt. Deshalb wird jetzt nachgesehen.
        titel: "Eindeutigkeit der Schlüsselfelder",
        lauf: async () => {
          if (istOffen(C.dataverseUrl))
            return { ok: false, text: "Übersprungen – dataverseUrl nicht gesetzt." };

          const felder = [
            { es: "opportunities", feld: "new_dagextopid", was: "Verkaufschancen" },
            { es: "accounts",      feld: "dag_dihag_kdnr", was: "Konten" }
          ];
          const teile = [];
          let sauber = true;
          for (const f of felder) {
            const r = await DV.dubletten(f.es, f.feld);
            const n = r.dubletten.length;
            if (n) sauber = false;
            const bsp = r.dubletten.slice(0, 3)
              .map(d => `${d.wert}×${d.anzahl}`).join(", ");
            teile.push(`${f.was}: ${r.gesamt} mit ${f.feld}, `
              + (n ? `${n} DOPPELT (${bsp}${n > 3 ? " …" : ""})` : "alle eindeutig")
              + (r.vollstaendig ? "" : " – Abfrage abgeschnitten, Zahl unvollständig"));
          }
          return { ok: sauber, text: teile.join(" · ")
            + (sauber ? "" : "  Ein Alternativschlüssel lässt sich darauf nicht "
              + "aktivieren, und die Auflösung müsste raten. Siehe docs/03 und docs/05.") };
        }
      }
    ];
  }

  async function selbsttest() {
    const liste = pruefungen();
    const el = $("tests");
    el.innerHTML = liste.map((p, i) =>
      `<div class="check" id="chk${i}"><span class="st">⏳</span>
         <div><b>${esc(p.titel)}</b><small>läuft …</small></div></div>`).join("");

    for (let i = 0; i < liste.length; i++) {
      const ziel = $("chk" + i);
      let ok = false, text = "", aktion = null;
      try {
        const r = await liste[i].lauf();
        ok = r.ok; text = r.text; aktion = r.aktion;
      } catch (e) {
        ok = false; text = e.detail || e.message;
      }
      ziel.className = "check " + (ok ? "gut" : "schlecht");
      ziel.querySelector(".st").textContent = ok ? "✓" : "!";
      ziel.querySelector("small").textContent = text;

      // Eine Prüfung darf einen Weg aus dem Fehler anbieten. Ohne das bleibt
      // nur die Meldung, und der nächste Schritt steht in einer Doku.
      if (aktion) {
        const b = document.createElement("button");
        b.className = "btn sec sm";
        b.style.marginTop = "8px";
        b.textContent = aktion.label;
        b.onclick = aktion.fn;
        ziel.lastElementChild.appendChild(b);
      }
    }
  }

  return { boot, toast };
})();

document.addEventListener("DOMContentLoaded", APP.boot);
