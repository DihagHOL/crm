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
    { id: "zuordnung", nr: "4", titel: "Zuordnung",    aktiv: false },
    { id: "pruefung",  nr: "5", titel: "Prüflauf",     aktiv: false },
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
