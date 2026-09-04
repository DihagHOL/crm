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

  /* Ohne Nummern. Sie stammten aus der Bauphase und zählten die
     Umsetzungsschritte mit, nicht die des Anwenders – „3 Datei wählen" als
     erster Punkt nach „Start" erklärt sich niemandem. */
  const SCHRITTE = [
    { id: "start",     titel: "Start" },
    { id: "datei",     titel: "Datei wählen" },
    { id: "zuordnung", titel: "Zuordnung" },
    { id: "pruefung",  titel: "Prüflauf" },
    { id: "import",    titel: "Import" },
    { id: "protokoll", titel: "Protokoll" },
    { id: "anleitung", titel: "Anleitung" }
  ];

  function renderSchritte() {
    $("tabBar").innerHTML = SCHRITTE.map(s => `
      <button data-ziel="${s.id}">${esc(s.titel)}</button>`).join("");
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
    if (id === "import") renderImport();
    if (id === "protokoll") renderProtokoll();
    if (id === "anleitung") renderAnleitung();
  }

  /* ── Anleitung ─────────────────────────────────────────────────────────
     Die Prozessbeschreibung lag bisher nur als `docs/10-prozess.md` im
     Repository – also dort, wo die Fachabteilung nicht hinsieht. Wer den
     Import ausführt, hat die App offen, nicht GitHub.

     Gelesen wird die Datei zur Laufzeit. Eine zweite Fassung im Code wäre
     nach dem ersten Rundschreiben veraltet, ohne dass es jemand merkt –
     und Doku, die von der Wahrheit abweicht, ist schlimmer als keine.   */
  let _doku = null;

  async function renderAnleitung() {
    $("main").innerHTML = `
      <div class="page-head">
        <h2>Anleitung</h2>
        <p>Die vollständige Prozessbeschreibung, geschrieben für alle, die
           den Import ausführen oder verantworten. Sie wird beim Öffnen frisch
           aus <code>docs/10-prozess.md</code> geladen — hier steht also
           derselbe Stand wie im Repository, nie eine Kopie davon.</p>
      </div>
      <div class="card doku" id="dokuText"><p class="hint">Wird geladen …</p></div>`;

    if (_doku === null) {
      try { _doku = await DOKU.laden(); }
      catch (e) {
        // Der Reiter darf nicht leer bleiben: wer hier nichts sieht, sucht
        // den Fehler bei sich.
        const z = $("dokuText");
        if (z) z.innerHTML = `<p class="err">${esc(e.message)}</p>
          <p class="hint">Die Beschreibung liegt im Repository unter
             <code>docs/10-prozess.md</code>.</p>`;
        return;
      }
    }
    // Nach dem Warten kann der Reiter gewechselt sein.
    const ziel = $("dokuText");
    if (ziel) ziel.innerHTML = DOKU.zuHtml(_doku);
  }

  /* ── Schritt 5: Prüflauf ───────────────────────────────────────────────
     Erst auflösen (Phase 0), dann prüfen. Geschrieben wird nichts. Das
     Ergebnis ist die Aussage, die ein Prüflauf haben muss: „12 neu, 57
     geändert, 3 unverändert" – und die ist ohne die vorherige Abfrage
     nicht möglich (CLAUDE.md §8).                                        */

  let _bericht = null;
  /** Kenntnisnahme der ausgeschlossenen Zeilen. Modulweit, damit ein
   *  Reiterwechsel sie nicht zurücksetzt – das Häkchen zweimal setzen zu
   *  müssen, weil man zwischendurch nachgesehen hat, ist Schikane. */
  let _bestaetigt = false;
  /** Antworten auf Mehrfachtreffer: "entitySet|feld|wert" → Datensatz-ID.
     Sie überleben ein erneutes Prüfen und gehen später ins Protokoll –
     wer welchen Datensatz gewählt hat, muss nachvollziehbar bleiben. */
  const _entscheidungen = new Map();

  /** @param {boolean} [neu] Auflösung und Prüfung wirklich neu rechnen.
   *    Ohne das wird ein vorhandener Bericht nur wieder angezeigt: Ein
   *    Reiterwechsel darf keine sechs Dataverse-Abfragen auslösen, und die
   *    getroffenen Entscheidungen sollen stehen bleiben. */
  /** Welche Felder ändern sich – nicht nur wie viele Zeilen.
   *
   *  „29 geändert" beantwortet die Frage nicht, die beim Besitzer zählt:
   *  holt der Import die Chance vom Verbindungsbenutzer des Altflows
   *  zurück, oder nimmt er sie einem Vertriebler weg? In der Zeilenbilanz
   *  sieht beides gleich aus. */
  function feldBilanz(z) {
    const e = Object.entries(z.felder || {}).sort((a, b) => b[1] - a[1]);
    if (!e.length) return "";
    return `<tr><td></td><td colspan="10" class="feldbilanz">
      <span class="leer">ändert sich:</span>
      ${e.map(([f, n]) => `<code>${esc(f)}</code> ${n}`).join(" · ")}</td></tr>`;
  }

  async function renderPruefung(neu = false) {
    if (!neu && _bericht && _bericht.datei === _datei) { renderBericht(); return; }
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
      // Die Wertzuordnungen gehören VOR die Auflösung: gesucht wird mit dem
      // Wert, der später geschrieben wird.
      const aufl = await AUFLOESUNG.fuer(profil, _mappe,
        t => status("Auflösung: " + t), werte);
      status("Zeilen prüfen …");
      _bericht = { ...PRUEFUNG.lauf(profil, _mappe, aufl, werte, _entscheidungen),
                   aufl, profil, werte, datei: _datei };
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
             ["ausgeschlossen", g.ausgeschlossen, "grau"],
             ["werden ersetzt", g.geloescht, "grau"],
             ["mit Fehler", g.fehler, g.fehler ? "rot" : "grau"]]
            .map(([t, n, f]) => `<div class="zahl-kachel ${f}">
                 <b>${n}</b><small>${t}</small></div>`).join("")}
        </div>
        <p class="hint" style="margin-top:14px">
          <b>unverändert</b> ist ein eigenes Ergebnis: ohne diesen Wert sieht ein
          Lauf, der nichts geändert hat, genauso aus wie einer, der nicht
          gelaufen ist.</p>
        ${g.geloescht ? `<p class="hint">Positionen werden <b>ersetzt</b>, nicht
          abgeglichen: <b>${g.geloescht}</b> vorhandene weichen den neuen aus der
          Datei. Sie zählen deshalb bei jedem Lauf als „neu“ – auch beim zweiten
          Import derselben Datei. Löschen und Anlegen geschehen in einer
          Transaktion; schlägt etwas fehl, bleibt der alte Stand.</p>` : ""}
        <div class="row">
          <button class="btn" id="plExcel">⬇ Bericht als Excel</button>
          <button class="btn sec" id="plNeu">Erneut prüfen</button>
          <button class="btn" id="plImport" disabled title="Phase 6 – noch nicht gebaut">
            Import starten</button>
        </div>
        ${g.fehler ? `<p class="err" style="margin-top:14px">Solange Fehler offen sind,
          bleibt der Import gesperrt. Es gibt keinen Weg daran vorbei.</p>` : ""}
        ${!g.fehler && g.ausgeschlossen ? `<p class="warn" style="margin-top:14px">
          <b>${g.ausgeschlossen}</b> Zeile(n) werden <b>nicht</b> importiert – siehe unten.
          Der Rest läuft durch. Eine unbekannte Kundennummer hält den Import
          nicht mehr auf (Review B3), sie soll aber auch niemandem hinten
          herunterfallen:</p>
          <label class="bestaetigung"><input type="checkbox" id="plOk">
            Ich habe die ausgeschlossenen Zeilen gesehen.</label>` : ""}
      </div>

      ${entscheidungsBlock()}

      <h3 class="section">Je Schritt</h3>
      <div class="card"><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Schritt</th><th>Ziel</th><th>Modus</th><th>Zeilen</th>
          <th>neu</th><th>geändert</th><th>unverändert</th><th>übersprungen</th>
          <th>ausgeschlossen</th><th>ersetzt</th><th>Fehler</th></tr></thead>
        <tbody>${b.schritte.map(z => `
          <tr class="${z.inaktiv ? "inaktiv" : z.fehler ? "problem" : ""}">
            <td><b>${z.s.step}</b></td>
            <td>${esc(z.s.entitySet)}${z.inaktiv ? ' <span class="pill grau">inaktiv</span>' : ""}</td>
            <td>${esc(z.s.mode)}</td>
            <td>${z.zeilen || ""}</td>
            <td>${z.neu || ""}</td><td>${z.aktualisiert || ""}</td>
            <td>${z.unveraendert || ""}</td><td>${z.uebersprungen || ""}</td>
            <td>${z.ausgeschlossen || ""}</td><td>${z.geloescht || ""}</td>
            <td>${z.fehler || ""}</td>
          </tr>
          ${z.strukturfehler ? `<tr class="problem"><td></td><td colspan="10">
             <span class="hinweis-text">${esc(z.strukturfehler)}</span></td></tr>` : ""}
          ${feldBilanz(z)}
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
              <td>${a.fehlend.length ? `<span class="hinweis-text">${a.fehlend.length}: ${esc(a.fehlend.slice(0,4).join(", "))}${a.fehlend.length>4?" …":""}</span>
                     <button class="btn ghost sm" data-bsp="${esc(a.entitySet)}|${esc(a.feld)}"
                       title="Zeigt, welche Werte in dieser Tabelle wirklich stehen"
                       >Was steht dort?</button>` : ""}</td>
              <td>${a.mehrdeutig.length ? `<span class="fehlt">${a.mehrdeutig.map(m=>`${m.wert}×${m.anzahl}`).join(", ")}</span>` : ""}</td>
            </tr>
            <tr class="bsp" id="bsp-${esc(a.entitySet)}-${esc(a.feld)}" hidden>
              <td colspan="6"></td>
            </tr>`).join("")}</tbody>
        </table></div>
      </div>

      ${liste("Fehler", b.fehler, "err")}
      ${liste("Ausgeschlossen – diese Zeilen werden nicht importiert",
              b.ausschluesse, "warn")}
      ${liste("Warnungen – der Import läuft trotzdem", b.warnungen, "warn")}`;

    const imp = $("plImport");
    const ok = $("plOk");
    if (imp) {
      // Fehler sperren. Ausschlüsse sperren nicht, sie verlangen aber eine
      // bewusste Kenntnisnahme – sonst wäre „N Zeilen fehlen" eine Zahl,
      // die man wegklickt.
      if (ok) ok.checked = _bestaetigt;
      const frei = () => !g.fehler && (!g.ausgeschlossen || ok?.checked);
      const stand = () => {
        imp.disabled = !frei();
        imp.title = g.fehler ? "Erst die Fehler beheben"
          : imp.disabled ? "Erst die ausgeschlossenen Zeilen bestätigen"
          : "Zum Import wechseln";
      };
      stand();
      if (ok) ok.onchange = () => { _bestaetigt = ok.checked; stand(); };
      imp.onclick = () => { if (frei()) zeigeSchritt("import"); };
    }
    $("plNeu").onclick = () => renderPruefung(true);

    /* „Was steht dort?" – die Gegenprobe zu „nicht gefunden".
       Ohne sie sieht ein falsches Schlüsselfeld genauso aus wie eine andere
       Schreibweise und wie ein leerer Bestand. Mit ihr steht beides
       nebeneinander und die Antwort ist in zwei Sekunden da. */
    for (const b of document.querySelectorAll("button[data-bsp]")) {
      b.onclick = async () => {
        const [es, feld] = b.dataset.bsp.split("|");
        const zeile = $(`bsp-${es}-${feld}`);
        const zelle = zeile.firstElementChild;
        zeile.hidden = false;
        zelle.innerHTML = '<span class="hint">wird geladen …</span>';
        b.disabled = true;
        try {
          const gefragt = _bericht.aufl.abfragen.find(x => x.entitySet === es && x.feld === feld);
          const pname = await DV.primaerName(es).catch(() => null);
          // Das Namensfeld gleich mitzeigen. Ist das eingetragene
          // Schlüsselfeld leer, lautet die nächste Frage ohnehin „dann eben
          // welches?" – und die Antwort steht dann schon da.
          const [r, rn] = await Promise.all([
            DV.beispielWerte(es, feld),
            pname && pname !== feld ? DV.beispielWerte(es, pname).catch(() => null) : null
          ]);
          const liste = (x, f) => x && x.werte.length
            ? `<div><b>${esc(es)}.${esc(f)}:</b>
                 ${x.werte.map(v => `<code>${esc(String(v ?? "–"))}</code>`).join(" ")}
                 ${x.mehr ? " …" : ""}</div>`
            : `<div><b>${esc(es)}.${esc(f)}:</b>
                 <span class="fehlt">kein einziger Wert</span></div>`;
          zelle.innerHTML = `<div class="gegenprobe">
              ${liste(r, feld)}
              ${rn ? liste(rn, pname) : ""}
              <div class="hint" style="margin-top:6px"><b>Gesucht wurde:</b>
                ${(gefragt?.fehlend || []).slice(0, 12)
                    .map(v => `<code>${esc(String(v))}</code>`).join(" ")}</div>
              ${!r.werte.length && rn?.werte.length
                ? `<p class="warn" style="margin-top:8px">Das eingetragene Schlüsselfeld
                   <code>${esc(feld)}</code> ist leer, das Namensfeld
                   <code>${esc(pname)}</code> nicht. Vermutlich gehört
                   <code>${esc(pname)}</code> ins Profil – in
                   <code>${esc(C.listen.mappings)}</code>, Spalte
                   <code>LookupKeyField</code>.</p>` : ""}
            </div>`;
        } catch (e) {
          zelle.innerHTML = `<span class="fehlt">${esc(e.detail || e.message)}</span>`;
        } finally {
          b.disabled = false;
        }
      };
    }
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

  /** Fehler- und Warnungsliste.
   *
   *  Die Spalte `Wert` stand bisher nur im Excel-Bericht. Bei „nicht
   *  gefunden" IST sie die Information: ohne sie nennt die Zeile das
   *  Problem, aber nicht den Fall. Daneben der Klartext aus den Spalten
   *  ohne Zielfeld – die Kundennummer allein sagt niemandem, welche Firma
   *  gemeint ist (CLAUDE.md §14). */
  function liste(titel, eintraege, klasse) {
    if (!eintraege.length) return "";
    const zeigen = eintraege.slice(0, 100);
    return `
      <h3 class="section">${esc(titel)} (${eintraege.length})</h3>
      <div class="card">
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Schritt</th><th>Zeile</th><th>Spalte</th><th>Feld</th>
            <th>Wert</th><th>Meldung</th></tr></thead>
          <tbody>${zeigen.map(f => `<tr>
            <td>${f.schritt ?? ""}</td>
            <td class="zeilennr">${f.zeile ?? ""}</td>
            <td>${esc(f.spalte || "")}</td>
            <td>${esc(f.feld || "")}</td>
            <td>${esc(f.wert ?? "")}${f.klartext
                 ? ` <span class="leer">${esc(f.klartext)}</span>` : ""}</td>
            <td><span class="${klasse === "err" ? "fehlt" : "hinweis-text"}">${esc(f.meldung)}</span></td>
          </tr>`).join("")}</tbody>
        </table></div>
        ${eintraege.length > zeigen.length
          ? `<p class="hint" style="margin-top:12px">${eintraege.length - zeigen.length}
             weitere – vollständig im Excel-Bericht.</p>` : ""}
      </div>`;
  }

  /* ── Schritt 6: Import ─────────────────────────────────────────────────
     Erreichbar nur über einen Prüflauf ohne Fehler. Es gibt keinen Weg von
     der Zuordnung zum Import, der ihn auslässt (Randbedingung 5).        */

  let _laufAbbruch = null;
  let _letzterLauf = null;

  function renderImport() {
    if (!_bericht) {
      $("main").innerHTML = `
        <div class="page-head"><h2>Import</h2></div>
        <div class="card"><p class="warn">Erst den <b>Prüflauf</b> ausführen.
          Ohne ihn ist nicht bekannt, was der Import täte – und ein Import ins
          CRM ist von Hand kaum rückholbar.</p></div>`;
      return;
    }
    if (_bericht.gesamt.fehler) {
      $("main").innerHTML = `
        <div class="page-head"><h2>Import</h2></div>
        <div class="card"><p class="err">Der Prüflauf meldet
          <b>${_bericht.gesamt.fehler}</b> Zeile(n) mit Fehler. Solange die offen
          sind, bleibt der Import gesperrt.</p></div>`;
      return;
    }

    const g = _bericht.gesamt;
    $("main").innerHTML = `
      <div class="page-head">
        <h2>Import</h2>
        <p>Schreibt nach <code>${esc(C.dataverseUrl)}</code> –
           Umgebung <b>${esc(C.umgebung)}</b>.</p>
      </div>
      <div class="card">
        <h4>Das wird passieren</h4>
        <p class="hint">${esc(PRUEFUNG.zusammenfassung(g))} ·
           Quelle <code>${esc(_datei.name)}</code></p>
        ${g.ausgeschlossen ? `<p class="warn"><b>${g.ausgeschlossen}</b> Zeile(n)
          werden übersprungen – sie hängen an einem Datensatz, den es im CRM
          nicht gibt. Sie stehen mit Grund im Protokoll.</p>` : ""}
        ${String(C.umgebung).toUpperCase() === "PROD"
          ? '<p class="err"><b>Produktivsystem.</b> Schreibzugriffe wirken sofort '
            + 'und sind nicht zurücknehmbar.</p>' : ""}
        <div class="row">
          <button class="btn" id="imStart">Import jetzt starten</button>
          <button class="btn sec" id="imAbbruch" hidden>Abbrechen</button>
        </div>
        <div id="imFortschritt" hidden style="margin-top:16px">
          <div class="balken"><div id="imBalken"></div></div>
          <p class="hint" id="imText" style="margin-top:8px"></p>
        </div>
      </div>
      <div id="imErgebnis"></div>`;

    $("imStart").onclick = importStarten;
    // Wer nach dem Import auf einen anderen Reiter geht und zurückkommt,
    // soll sein Ergebnis wiederfinden – samt Fehlerliste.
    if (_letzterLauf && _letzterLauf.datei === _datei) {
      renderImportErgebnis();
      const el = $("imProtokoll");
      if (el) el.innerHTML = _letzterLauf.protokollText
        || "Protokoll wurde im ersten Durchlauf geschrieben.";
    }
  }

  async function importStarten() {
    const start = $("imStart"), abbr = $("imAbbruch");
    start.disabled = true; abbr.hidden = false;
    $("imFortschritt").hidden = false;

    const ctl = new AbortController();
    _laufAbbruch = ctl;
    abbr.onclick = () => { ctl.abort(); abbr.disabled = true; abbr.textContent = "Wird abgebrochen …"; };

    const erwartet = _bericht.gesamt.neu + _bericht.gesamt.aktualisiert;
    let fertig = 0;
    const laufId = (crypto.randomUUID?.() || String(Date.now()));
    const beginn = new Date().toISOString();

    try {
      const e = await LAUF.ausfuehren({
        profil: _bericht.profil, mappe: _mappe, aufl: _bericht.aufl,
        werte: _bericht.werte, entscheidungen: _entscheidungen
      }, {
        signal: ctl.signal,
        onFortschritt: f => { $("imText").textContent = f.text; },
        onEintrag: n => {
          if (n.aktion === "angelegt" || n.aktion === "aktualisiert") fertig++;
          const p = erwartet ? Math.min(100, Math.round(fertig / erwartet * 100)) : 100;
          $("imBalken").style.width = p + "%";
        }
      });

      _letzterLauf = { ...e, laufId, beginn, ende: new Date().toISOString(),
                       datei: _datei, profil: _bericht.profil };
      renderImportErgebnis();
      await protokollSchreiben();
    } catch (e) {
      $("imErgebnis").innerHTML = `<div class="card"><p class="err">
        ${esc(e.detail || e.message)}</p></div>`;
    } finally {
      start.disabled = false; abbr.hidden = true;
      abbr.disabled = false; abbr.textContent = "Abbrechen";
      _laufAbbruch = null;
    }
  }

  function renderImportErgebnis() {
    const l = _letzterLauf, g = l.gesamt;
    $("imErgebnis").innerHTML = `
      <h3 class="section">Ergebnis</h3>
      <div class="card">
        ${l.abgebrochen ? '<p class="warn"><b>Abgebrochen.</b> Was bis dahin '
          + 'geschrieben wurde, steht im Protokoll – und ist dank Upsert über '
          + 'Alternativschlüssel gefahrlos wiederholbar.</p>' : ""}
        <div class="bilanz">
          ${[["angelegt", g.angelegt, "gruen"], ["aktualisiert", g.aktualisiert, "gruen"],
             ["unverändert", g.unveraendert, "grau"],
             ["übersprungen", g.uebersprungen, "grau"],
             ["ersetzt", g.geloescht || 0, "grau"],
             ["fehlgeschlagen", g.fehlgeschlagen, g.fehlgeschlagen ? "rot" : "grau"]]
            .map(([t, n, f]) => `<div class="zahl-kachel ${f}"><b>${n || 0}</b>
                 <small>${t}</small></div>`).join("")}
        </div>
        <p class="hint" style="margin-top:14px">
          Dauer ${Math.round(l.dauerMs / 1000)} s
          ${l.gedrosselt ? ` · ${l.gedrosselt}× gedrosselt, Parallelität am Ende ${l.parallelAmEnde}` : ""}
          · Lauf-ID <code>${esc(l.laufId)}</code></p>
        <p class="hint" id="imProtokoll">Protokoll wird geschrieben …</p>
      </div>
      ${fehlerBlock(l)}
      ${warnungsBlock(l)}`;
  }

  /** Was geschrieben wurde, aber nicht vollständig.
   *
   *  Ein Lauf ohne Fehler kann trotzdem Felder ausgelassen haben – im
   *  ersten sauberen Lauf blieben `ownerid` und beide cr570-Verweise in
   *  ALLEN Zeilen leer, weil ihre Ziele nicht auflösbar waren. Ohne diesen
   *  Block steht da „0 fehlgeschlagen" und sonst nichts, und genau so
   *  verliert der Altflow die Zeichnungsnummer (Randbedingung 12). */
  function warnungsBlock(l) {
    const gruppen = new Map();
    for (const e of l.eintraege)
      for (const w of e.warnungen || []) {
        // Ältere Protokolle führen die Warnung als reinen Text.
        const feld = typeof w === "object" ? (w.feld || "") : "";
        const text = typeof w === "object" ? w.meldung : String(w);
        const wert = typeof w === "object" ? w.wert : null;
        const k = `${e.schritt}|${feld}|${meldungsKern(text)}`;
        if (!gruppen.has(k))
          gruppen.set(k, { schritt: e.schritt, entitySet: e.entitySet, feld,
                           meldung: meldungsKern(text), anzahl: 0,
                           zeilen: [], werte: new Set() });
        const g = gruppen.get(k);
        g.anzahl++;
        if (g.zeilen.length < 8) g.zeilen.push(e.zeile);
        if (wert !== null && wert !== undefined) g.werte.add(String(wert));
      }
    if (!gruppen.size) return "";
    const sortiert = [...gruppen.values()].sort((a, b) => b.anzahl - a.anzahl);

    return `
      <h3 class="section">Geschrieben, aber nicht vollständig</h3>
      <div class="card">
        <p class="hint">Diese Zeilen sind im CRM gelandet – einzelne Felder
           aber nicht. Kein Fehler, trotzdem eine Aussage: ein Feld, das in
           jeder Zeile fehlt, ist eine offene Frage und kein Zufall.</p>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Anzahl</th><th>Schritt</th><th>Feld</th>
            <th>Meldung</th><th>Werte</th><th>Zeilen</th></tr></thead>
          <tbody>${sortiert.map(g => {
            const w = [...g.werte];
            return `<tr>
            <td><b>${g.anzahl}</b></td>
            <td>${g.schritt}</td>
            <td>${esc(g.feld || g.entitySet || "")}</td>
            <td><span class="hinweis-text">${esc(g.meldung)}</span></td>
            <td>${w.slice(0, 10).map(v => `<code>${esc(v)}</code>`).join(" ")}${
                 w.length > 10 ? ` … (${w.length} verschiedene)` : ""}</td>
            <td class="zeilennr">${g.zeilen.join(", ")}${g.anzahl > g.zeilen.length ? " …" : ""}</td>
          </tr>`; }).join("")}</tbody>
        </table></div>
      </div>`;
  }

  /** Meldungen so weit vereinheitlichen, dass gleiche Ursachen zusammen
   *  fallen. Dataverse setzt Datensatz-IDs und Werte in den Text; ohne das
   *  hier stünden 79 Fehler mit derselben Ursache 79-mal einzeln da. */
  const meldungsKern = m => String(m || "ohne Meldung")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "…")
    .replace(/'[^']*'/g, "'…'")
    // Auch deutsche Anfuehrungszeichen: der Wert steht in der Spalte
    // daneben, im Text stoert er die Gruppierung.
    .replace(/„[^“"]*[“"]/g, "„…“")
    // Auch abgeschnittene Datensatz-Kennungen: Dataverse hängt sie gern
    // ohne Bindestriche an. Ohne das steht dieselbe Ursache 79-mal da.
    .replace(/\b[0-9a-f]{8,}\b/gi, "…")
    .replace(/\b\d{3,}\b/g, "…");

  /** Warum es fehlschlug.
   *
   *  Ohne diesen Block sagt das Ergebnis „79 fehlgeschlagen" und sonst
   *  nichts – man müsste das Vollprotokoll herunterladen, um zu erfahren,
   *  woran. Gruppiert nach Ursache, weil 79 Fehler fast immer zwei Gründe
   *  sind und nicht 79. */
  function fehlerBlock(l) {
    const schlecht = l.eintraege.filter(e => e.aktion === "fehlgeschlagen");
    if (!schlecht.length) return "";

    const gruppen = new Map();
    for (const e of schlecht) {
      const k = `${e.schritt}|${e.httpStatus || 0}|${meldungsKern(e.meldung)}`;
      if (!gruppen.has(k))
        gruppen.set(k, { schritt: e.schritt, entitySet: e.entitySet,
                         status: e.httpStatus || 0, meldung: meldungsKern(e.meldung),
                         anzahl: 0, zeilen: [] });
      const g = gruppen.get(k);
      g.anzahl++;
      if (g.zeilen.length < 8) g.zeilen.push(e.zeile);
    }
    const sortiert = [...gruppen.values()].sort((a, b) => b.anzahl - a.anzahl);
    const zeigen = schlecht.slice(0, 100);

    return `
      <h3 class="section">Warum es fehlschlug</h3>
      <div class="card">
        <p class="hint">${schlecht.length} fehlgeschlagene Zeile(n),
           ${sortiert.length} verschiedene Ursache(n). Die häufigste zuerst –
           mehrere Dutzend Fehler haben fast immer denselben Grund.</p>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Anzahl</th><th>Schritt</th><th>Ziel</th><th>HTTP</th>
            <th>Meldung</th><th>Zeilen</th></tr></thead>
          <tbody>${sortiert.map(g => `<tr>
            <td><b>${g.anzahl}</b></td>
            <td>${g.schritt}</td>
            <td>${esc(g.entitySet || "")}</td>
            <td>${g.status || ""}</td>
            <td><span class="fehlt">${esc(g.meldung)}</span></td>
            <td class="zeilennr">${g.zeilen.join(", ")}${g.anzahl > g.zeilen.length ? " …" : ""}</td>
          </tr>`).join("")}</tbody>
        </table></div>
      </div>

      <div class="card">
        <h4>Einzeln</h4>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Schritt</th><th>Ziel</th><th>Zeile</th><th>Schlüssel</th>
            <th>HTTP</th><th>Meldung</th></tr></thead>
          <tbody>${zeigen.map(e => `<tr>
            <td>${e.schritt}</td>
            <td>${esc(e.entitySet || "")}</td>
            <td class="zeilennr">${e.zeile ?? ""}</td>
            <td>${esc(String(e.schluessel ?? ""))}</td>
            <td>${e.httpStatus || ""}</td>
            <td><span class="fehlt">${esc(e.meldung || "")}</span></td>
          </tr>`).join("")}</tbody>
        </table></div>
        ${schlecht.length > zeigen.length
          ? `<p class="hint" style="margin-top:12px">${schlecht.length - zeigen.length}
             weitere – vollständig im Vollprotokoll.</p>` : ""}
      </div>`;
  }

  /* ── Schritt 7: Protokoll ─────────────────────────────────────────────
     Drei Ebenen: Laufeintrag, Fehlerzeilen, Vollprotokoll als Datei. Und
     die Quelldatei wird als importiert markiert – der Ordner dokumentiert
     sich damit selbst, und ein Doppelimport fällt VOR dem Start auf.    */

  async function protokollSchreiben() {
    const l = _letzterLauf;
    const el = $("imProtokoll");
    const sagen = t => { l.protokollText = t; if (el) el.innerHTML = t; };
    try {
      const jeSchritt = {};
      for (const e of l.eintraege)
        (jeSchritt[e.schritt] ||= {})[e.aktion] = (jeSchritt[e.schritt]?.[e.aktion] || 0) + 1;

      const id = await SPLISTEN.laufSchreiben({
        laufId: l.laufId, profil: l.profil.name, datei: l.datei.name,
        start: l.beginn, ende: l.ende,
        status: l.abgebrochen ? "Abgebrochen"
              : l.gesamt.fehlgeschlagen ? "MitFehlern" : "Erfolgreich",
        zeilen: l.eintraege.length, ...l.gesamt,
        dauerMs: l.dauerMs, jeSchritt
      });

      const fehlerhaft = l.eintraege.filter(e => e.aktion === "fehlgeschlagen");
      const f = await SPLISTEN.fehlerSchreiben(l.laufId, fehlerhaft);
      const url = await SPLISTEN.vollprotokoll(l.laufId, {
        lauf: { ...l, eintraege: undefined }, eintraege: l.eintraege,
        entscheidungen: [..._entscheidungen.entries()]
      });

      // Quelldatei markieren. Scheitert das, ist der Lauf trotzdem gültig –
      // es ist ein Vermerk, kein Ergebnis.
      let markiert = true;
      try {
        await SPFILES.statusSetzen(l.datei, {
          ImportStatus: l.gesamt.fehlgeschlagen ? "Fehlgeschlagen" : "Importiert",
          ImportRunId: l.laufId,
          ImportedAt: l.ende
        });
      } catch { markiert = false; }

      sagen(`✓ Protokoll geschrieben: Lauf ${esc(String(id))} in
        <code>${esc(C.listen.laeufe)}</code>${f.geschrieben
          ? `, ${f.geschrieben} Fehlerzeile(n)` : ""}${f.ausgelassen
          ? ` (${f.ausgelassen} weitere nur im Vollprotokoll)` : ""}${url
          ? `, <a href="${esc(url)}" target="_blank" rel="noopener">Vollprotokoll</a>` : ""}.
        ${markiert ? "Die Quelldatei ist als bearbeitet markiert."
                   : "<b>Die Quelldatei konnte nicht markiert werden</b> – der Lauf ist trotzdem gültig."}`);
    } catch (e) {
      sagen(`<span class="fehlt">Protokoll konnte nicht geschrieben werden:
        ${esc(e.detail || e.message)}</span> – der Import selbst ist gelaufen,
        die Zahlen stehen oben.`);
    }
  }

  function renderProtokoll() {
    $("main").innerHTML = `
      <div class="page-head">
        <h2>Protokoll</h2>
        <p>Jeder Lauf steht in <code>${esc(C.listen.laeufe)}</code> auf
           <code>${esc(C.konfigSite.split(":").pop())}</code>, jede
           abgewiesene Zeile in <code>${esc(C.listen.fehler)}</code>.</p>
      </div>
      <div class="card"><p class="hint" id="prStatus">Läufe werden geladen …</p>
        <div id="prListe"></div></div>`;

    GRAPH.listItems(C.konfigSite, C.listen.laeufe,
      ["Title", "ProfileName", "SourceFile", "StartedAt", "FinishedAt", "Status",
       "TotalRows", "CreatedCount", "UpdatedCount", "UnchangedCount",
       "SkippedCount", "FailedCount", "DurationSeconds"])
      .then(rows => {
        if (!rows) { $("prStatus").textContent =
          `Liste ${C.listen.laeufe} nicht gefunden.`; return; }
        if (!rows.length) { $("prStatus").textContent =
          "Noch keine Läufe protokolliert."; return; }
        rows.sort((a, b) => String(b.StartedAt).localeCompare(String(a.StartedAt)));
        $("prStatus").textContent = `${rows.length} Lauf/Läufe.`;
        $("prListe").innerHTML = `
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>Start</th><th>Datei</th><th>Status</th><th>angelegt</th>
              <th>aktualisiert</th><th>unverändert</th><th>übersprungen</th>
              <th>Fehler</th><th>Dauer</th></tr></thead>
            <tbody>${rows.slice(0, 50).map(r => `<tr class="${
                r.Status === "MitFehlern" || r.Status === "Fehlgeschlagen" ? "problem" : ""}">
              <td>${esc(datum(r.StartedAt))}</td>
              <td>${esc(r.SourceFile || "")}</td>
              <td><span class="pill ${r.Status === "Erfolgreich" ? "gruen" : "grau"}">${esc(r.Status || "")}</span></td>
              <td>${r.CreatedCount ?? ""}</td><td>${r.UpdatedCount ?? ""}</td>
              <td>${r.UnchangedCount ?? ""}</td><td>${r.SkippedCount ?? ""}</td>
              <td>${r.FailedCount ?? ""}</td>
              <td>${r.DurationSeconds != null ? r.DurationSeconds + " s" : ""}</td>
            </tr>`).join("")}</tbody>
          </table></div>`;
      })
      .catch(e => { $("prStatus").textContent = e.detail || e.message; });
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
      Spalte: e.spalte || "", Feld: e.feld || "", Wert: e.wert ?? "",
      Klartext: e.klartext || "", Meldung: e.meldung });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      b.fehler.length ? b.fehler.map(spalten) : [{ Meldung: "keine" }]), "Fehler");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(
      b.ausschluesse.length ? b.ausschluesse.map(spalten) : [{ Meldung: "keine" }]),
      "Ausgeschlossen");
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
    const felderJeSchritt = new Map();
    for (const s of p.schritte) {
      let felder = null, fehlerText = "";
      try {
        felder = istOffen(C.dataverseUrl) ? null : await DV.felder(s.entitySet);
      } catch (e) {
        fehlerText = e.detail || e.message;
      }
      felderJeSchritt.set(s.step, felder);
      teile.push(schrittKarte(s, p.zuordnungen[s.mappingKey] || [], felder, fehlerText));
    }
    $("zoInhalt").innerHTML = kopf + teile.join("");

    /* Feldsuche je Schritt.
       Die Frage „gibt es dafür überhaupt ein Feld, und welchen Typ hat es?"
       kam bisher jedes Mal über den Umweg Dataverse-Oberfläche oder Graph
       Explorer zurück. Die Metadaten liegen längst hier – gesucht wird also
       hier, ohne einen einzigen zusätzlichen Aufruf. */
    /* Belegung im Ziel.
       Der Fall, der es nötig machte: `new_dag_materialteuerungszuschlagmtzabsolut`
       trug 4 Werte von 5000 Positionen, `new_dag_mtzabsolut` 2340. Der
       Import schrieb fehlerfrei in ein Feld, das niemand ansieht — jede
       Zeile grün, das Ergebnis unbrauchbar. Zeilen zu zählen genügt nicht,
       man muss die Felder ansehen. */
    for (const b of document.querySelectorAll("button[data-belegung]")) {
      b.onclick = async () => {
        const step = Number(b.dataset.belegung);
        const es = b.dataset.set;
        const schritt = p.schritte.find(x => x.step === step);
        const ziele = (p.zuordnungen[schritt.mappingKey] || [])
          .filter(z => z.aktiv && z.targetField && !z.targetField.startsWith("KLAEREN")
                       && !z.targetField.startsWith("$"))
          .map(z => z.targetField);
        b.disabled = true; b.textContent = "wird geprüft …";
        try {
          const r = await DV.belegung(es, ziele);
          for (const [f, n] of Object.entries(r.jeFeld)) {
            const zelle = $(`bel-${step}-${f}`);
            if (!zelle) continue;
            const anteil = r.gesamt ? n / r.gesamt : 0;
            // Unter einem Prozent heisst: dieses Feld führt praktisch
            // niemand. Fast immer das falsche Ziel.
            zelle.innerHTML = `<span class="${anteil < 0.01 ? "fehlt" : ""}">${n}</span>`
              + `<span class="leer"> / ${r.gesamt}</span>`;
          }
          b.textContent = `Belegung geprüft (${r.gesamt} Datensätze)`;
        } catch (e) {
          b.textContent = "Belegung: " + (e.detail || e.message);
          b.disabled = false;
        }
      };
    }

    for (const feld of document.querySelectorAll("input[data-suche]")) {
      const step = Number(feld.dataset.suche);
      const ziel = $("treffer-" + step);
      const alle = felderJeSchritt.get(step) || {};
      feld.oninput = () => {
        const q = feld.value.trim().toLowerCase();
        if (q.length < 2) { ziel.innerHTML = ""; return; }
        const gefunden = Object.entries(alle)
          .filter(([name]) => name.toLowerCase().includes(q))
          .sort((a, b) => a[0].localeCompare(b[0]))
          .slice(0, 25);
        ziel.innerHTML = gefunden.length
          ? `<table class="tbl roh"><thead><tr><th>Feld</th><th>Typ</th>
               <th>schreibbar</th></tr></thead><tbody>${gefunden.map(([name, f]) => `
             <tr><td><code>${esc(name)}</code></td><td>${esc(f.typ)}</td>
               <td>${f.anlegbar || f.aenderbar ? "ja"
                    : '<span class="fehlt">nein</span>'}</td></tr>`).join("")}
             </tbody></table>`
          : `<p class="hint">Kein Feld enthält „${esc(feld.value)}“.</p>`;
      };
    }
  }

  /** Eine Karte je Importschritt, mit der Prüftabelle darin. */
  function schrittKarte(s, zuordnungen, felder, fehlerText) {
    const blatt = _mappe && s.sourceSheet ? EXCEL.blatt(_mappe, s.sourceSheet) : null;
    const kopfzeilen = blatt ? new Set(blatt.kopfzeilen) : null;

    let probleme = 0;
    const zeilen = zuordnungen.map(z => {
      const befunde = [];   // zählt als Problem
      const notizen = [];   // erklärt nur

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
      } else if (z.targetField && z.targetField.startsWith("$")) {
        // `$action` ist kein Dataverse-Feld, sondern eine Anweisung an den
        // Lauf: WinOpportunity oder LoseOpportunity. Gegen die Metadaten
        // geprüft, meldete sie „Feld gibt es in Dataverse nicht“ – ein
        // Fehler, den es nicht gibt.
        ziel = esc(z.targetField);
        notizen.push("Anweisung an den Lauf, kein Feld");
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

      // Ein Befund in einem abgeschalteten Schritt ist kein Problem: dort
      // läuft nichts. Sichtbar bleibt er trotzdem – wer den Schritt später
      // einschaltet, soll ihn vorher sehen.
      /* Wie oft ist die Quellspalte überhaupt gefüllt? Eine Zuordnung, die
         in 0 von 89 Zeilen etwas zu schreiben hat, ist entweder falsch oder
         überflüssig – und das sieht man der Zeilenzahl nicht an. */
      let quellBelegung = "";
      if (z.sourceColumn) {
        const wo = z.sourceSheet || s.sourceSheet;
        const b = _mappe && wo ? EXCEL.blatt(_mappe, wo) : null;
        if (b) {
          const n = b.zeilen.filter(r => {
            const v = r[z.sourceColumn];
            return v !== null && v !== undefined && v !== "";
          }).length;
          quellBelegung = `<span class="${n ? "" : "fehlt"}">${n}</span>`
            + `<span class="leer"> / ${b.anzahl}</span>`;
        }
      } else if (z.defaultValue) {
        quellBelegung = '<span class="leer">fest</span>';
      }

      if (befunde.length && z.aktiv && s.aktiv) probleme++;
      const zustand = !z.aktiv || !s.aktiv ? "inaktiv"
                    : befunde.length ? "problem" : "gut";
      return `<tr class="${zustand}">
        <td>${quelle}</td>
        <td>${ziel}</td>
        <td>${esc(z.targetType || "")}</td>
        <td>${z.istSchluessel ? "🔑" : ""}${z.pflicht ? " ✱" : ""}</td>
        <td class="zahl-zelle">${quellBelegung}</td>
        <td class="zahl-zelle" id="bel-${s.step}-${esc(z.targetField || "")}"></td>
        <td>${esc(z.writePolicy)}</td>
        <td>${befunde.length ? `<span class="hinweis-text">${esc(befunde.join(" · "))}</span>`
                             : notizen.length ? `<span class="leer">${esc(notizen.join(" · "))}</span>`
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
            <th title="Wie oft ist die Quellspalte gefüllt?">Quelle</th>
            <th title="Wie viele Datensätze im CRM führen dieses Feld?">im CRM</th>
            <th>Schreibregel</th><th>Befund</th>
          </tr></thead>
          <tbody>${zeilen || '<tr><td colspan="8" class="leer">keine Zuordnungen</td></tr>'}</tbody>
        </table></div>
        ${felder ? `<div class="row" style="margin-top:12px">
          <button class="btn sec sm" data-belegung="${s.step}"
            data-set="${esc(s.entitySet)}">Belegung im CRM prüfen</button>
        </div>` : ""}
        ${felder ? `<div class="feldsuche">
          <label>Felder von <code>${esc(s.entitySet)}</code> durchsuchen
            <input type="search" data-suche="${s.step}" placeholder="z. B. audit, owner, weight …">
          </label>
          <div id="treffer-${s.step}"></div>
        </div>` : ""}
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
      <div class="card">
        <h4>📂 Verfügbare Mappen
          <button class="btn ghost sm" id="dtNeu" title="Liste neu von SharePoint holen">🔄</button>
        </h4>
        <div id="dateiListe">Wird geladen …</div>
      </div>
      <div id="vorschau"></div>`;

    try {
      // Die Liste wird einmal geholt und dann behalten. Ein Reiterwechsel
      // ist kein Grund für einen neuen Graph-Aufruf – und die geöffnete
      // Mappe soll dabei sichtbar bleiben, statt dass man sie ein zweites
      // Mal öffnen muss.
      $("dtNeu").onclick = dateienNeu;
      if (!_dateien.length) _dateien = await SPFILES.liste();
      renderDateiListe();
      if (_mappe && _datei) renderVorschau();
    } catch (e) {
      $("dateiListe").innerHTML = `<p class="err">${esc(e.detail || e.message)}</p>`;
    }
  }

  /** Liste wirklich neu holen – nach einem Import, oder auf Wunsch. */
  async function dateienNeu() {
    _dateien = [];
    _seite = 0;
    await renderDatei();
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
      // Ein Bericht gilt für genau eine Mappe. Bleibt er stehen, zeigt der
      // Prüflauf Zahlen zur vorigen Datei – schlimmer als gar keine.
      if (_datei && _datei.id !== d.id) {
        _bericht = null; _letzterLauf = null; _bestaetigt = false;
        _entscheidungen.clear();
      }
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
          <h4>▶️ Loslegen</h4>
          <p class="hint">Der Weg ist immer derselbe: Datei wählen, Zuordnung
             ansehen, Prüflauf, Import. Geschrieben wird erst im vorletzten
             Schritt — und nur nach einem Prüflauf ohne Fehler.</p>
          <div class="row" style="margin-top:12px">
            <button class="btn" id="btnDatei">📂 Datei wählen</button>
            <button class="btn sec" id="btnProzess">Wie der Import abläuft</button>
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
      </div>`;

    $("btnTest").onclick = selbsttest;
    $("btnDatei").onclick = () => zeigeSchritt("datei");
    $("btnProzess").onclick = () =>
      window.open("https://github.com/dfedorov12/crm/blob/main/docs/10-prozess.md",
                  "_blank", "noopener");
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

          // Die beiden Felder haben verschiedene Rollen, und nur eine davon
          // verträgt keine Dubletten:
          //
          //   Schlüssel – darüber läuft der Upsert. Doppelte Werte machen
          //     den Alternativschlüssel unanlegbar; ohne ihn gibt es keinen
          //     Upsert. Das ist ein Fehler.
          //   Verweis   – darüber wird nur gesucht. Doppelte Werte sind
          //     eine Frage, keine Sackgasse: der Prüflauf legt die
          //     Kandidaten vor, jemand entscheidet, die Entscheidung steht
          //     im Protokoll (CLAUDE.md §8). Das ist ein Hinweis.
          const felder = [
            { es: "opportunities", feld: "new_dagextopid", was: "Verkaufschancen",
              rolle: "schluessel" },
            { es: "accounts",      feld: "dag_dihag_kdnr", was: "Konten",
              rolle: "verweis" }
          ];
          const teile = [];
          let sauber = true, zuEntscheiden = 0;
          for (const f of felder) {
            const r = await DV.dubletten(f.es, f.feld);
            const n = r.dubletten.length;
            if (n && f.rolle === "schluessel") sauber = false;
            if (n && f.rolle === "verweis") zuEntscheiden += n;
            const bsp = r.dubletten.slice(0, 3)
              .map(d => `${d.wert}×${d.anzahl}`).join(", ");
            teile.push(`${f.was}: ${r.gesamt} mit ${f.feld}, `
              + (n ? `${n} doppelt (${bsp}${n > 3 ? " …" : ""})` : "alle eindeutig")
              + (r.vollstaendig ? "" : " – Abfrage abgeschnitten, Zahl unvollständig"));
          }
          return { ok: sauber, text: teile.join(" · ")
            + (sauber && zuEntscheiden
                ? `  Die ${zuEntscheiden} doppelten Kundennummern sind kein `
                  + "Hindernis: der Prüflauf fragt bei jeder betroffenen Zeile "
                  + "nach, welches Konto gemeint ist, und schreibt erst danach."
                : "")
            + (sauber ? "" : "  Auf einem doppelten Schlüsselfeld lässt sich kein "
              + "Alternativschlüssel aktivieren – ohne ihn gibt es keinen Upsert. "
              + "Siehe docs/03 und docs/05.") };
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
