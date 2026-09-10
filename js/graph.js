"use strict";

/* Microsoft Graph – Aufrufe, SharePoint-Listen, Dokumentbibliotheken.
   Übernommen aus „Rund um den Job“, ergänzt um Drosselungsbehandlung und
   Bibliothekszugriff.

   Alles wird über NAMEN aufgelöst, nie über GUIDs. Der Altflow verdrahtet
   Site-, Bibliotheks- und Datei-GUIDs fest und muss deshalb beim Umzug
   Test → Produktion an sechs Stellen von Hand angefasst werden (Befund B9).
   Hier reicht js/config.js.                                              */

const GRAPH = (() => {

  const BASE = "https://graph.microsoft.com/v1.0";

  /* ── Metadaten-Cache ──────────────────────────────────────────────────
     Site-IDs, Listen-IDs und Spaltenzuordnungen ändern sich praktisch nie,
     kosten beim Start aber jedes Mal mehrere Aufrufe. Deshalb zusätzlich im
     sessionStorage, mit Ablauf. Der Cache enthält nur technische IDs, keine
     Inhalte.                                                              */

  const META_KEY = "crm_meta";
  const META_TTL = 12 * 60 * 60 * 1000;   // endet ohnehin mit der Sitzung

  // Feste Objekte – die übrigen Funktionen halten Referenzen darauf. Beim
  // Leeren dürfen sie deshalb nicht ersetzt, sondern nur ausgeräumt werden.
  const _meta = { siteIds: {}, listIds: {}, driveIds: {}, colMaps: {}, colExp: {} };
  try {
    const roh = sessionStorage.getItem(META_KEY);
    if (roh) {
      const c = JSON.parse(roh);
      if (c && Date.now() - c.ts < META_TTL && c.data) {
        for (const k of Object.keys(_meta)) Object.assign(_meta[k], c.data[k] || {});
      }
    }
  } catch {}

  let _metaTimer = null;
  function metaSpeichern() {
    // gesammelt schreiben – sonst serialisiert jeder Aufruf den ganzen Cache
    clearTimeout(_metaTimer);
    _metaTimer = setTimeout(() => {
      try { sessionStorage.setItem(META_KEY, JSON.stringify({ ts: Date.now(), data: _meta })); }
      catch {}
    }, 300);
  }

  function metaLeeren() {
    for (const teil of Object.values(_meta)) {
      for (const k of Object.keys(teil)) delete teil[k];
    }
    clearTimeout(_metaTimer);
    try { sessionStorage.removeItem(META_KEY); } catch {}
  }

  const _siteIds  = _meta.siteIds;    // "host:/sites/x" → id
  const _listIds  = _meta.listIds;    // "siteId|Listenname" → id
  const _driveIds = _meta.driveIds;   // "siteId|Bibliothek" → id

  const warte = ms => new Promise(r => setTimeout(r, ms));

  /** Ein Graph-Aufruf. Bei 429 und 503 wird die Wartezeit aus `Retry-After`
   *  eingehalten – nie mit festem Sleep, nie ignoriert (CLAUDE.md §2, Nr. 7).
   *  Alles Übrige wirft mit lesbarer Meldung; `err.detail` ist der Text für
   *  die Diagnose. */
  async function call(path, opts = {}, versuch = 0) {
    const token = await AUTH.getToken("graph");
    const url = path.startsWith("https://") ? path : BASE + path;
    const res = await fetch(url, {
      ...opts,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        ...(opts.headers || {})
      }
    });

    if ((res.status === 429 || res.status === 503) && versuch < 4) {
      const s = Number(res.headers.get("Retry-After")) || 5;
      console.warn(`[Graph] ${res.status} – ${s} s warten (Versuch ${versuch + 1})`);
      await warte(s * 1000);
      return call(path, opts, versuch + 1);
    }

    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.error?.message || res.statusText || String(res.status);
      const err = new Error(msg);
      err.status = res.status;
      err.code = data?.error?.code;
      // Für die Diagnose: welcher Aufruf ist womit gescheitert?
      err.request = (opts.method || "GET") + " " + path.replace(BASE, "");
      err.detail = `${err.request} → HTTP ${res.status}`
        + (err.code ? ` ${err.code}` : "") + `: ${msg}`;
      throw err;
    }
    return data;
  }

  /** Alle Seiten einer Collection einsammeln (@odata.nextLink). */
  async function callAll(path, maxPages = 40) {
    let out = [], next = path, pages = 0;
    while (next && pages++ < maxPages) {
      const d = await call(next);
      out = out.concat(d?.value || []);
      next = d?.["@odata.nextLink"] || null;
    }
    return out;
  }

  /* ── Sites, Listen, Bibliotheken ──────────────────────────────────── */

  async function siteId(sitePath) {
    if (_siteIds[sitePath]) return _siteIds[sitePath];
    const s = await call("/sites/" + sitePath);
    _siteIds[sitePath] = s.id;
    metaSpeichern();
    return s.id;
  }

  /** Listen-ID; null wenn die Liste nicht existiert. */
  async function listId(sitePath, name) {
    const sid = await siteId(sitePath);
    const key = sid + "|" + name;
    if (_listIds[key]) return _listIds[key];
    try {
      const l = await call(`/sites/${sid}/lists/${encodeURIComponent(name)}`);
      _listIds[key] = l.id;
      metaSpeichern();
      return l.id;
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  /** Alle Dokumentbibliotheken einer Site. */
  const drives = async sitePath => (await call(`/sites/${await siteId(sitePath)}/drives`))?.value || [];

  /** Bibliothek über den Anzeigenamen; null wenn es sie nicht gibt.
   *  Offene Frage aus docs/02: Ist „Austausch“ eine eigene Bibliothek oder
   *  ein Ordner in „Dokumente“? Beides ist möglich, deshalb gibt diese
   *  Funktion null zurück statt zu werfen – die Startseite prüft dann den
   *  zweiten Fall. */
  async function driveId(sitePath, driveName) {
    const sid = await siteId(sitePath);
    const key = sid + "|" + driveName;
    if (_driveIds[key]) return _driveIds[key];
    const gefunden = (await drives(sitePath))
      .find(d => (d.name || "").toLowerCase() === driveName.toLowerCase());
    if (!gefunden) return null;
    _driveIds[key] = gefunden.id;
    metaSpeichern();
    return gefunden.id;
  }

  /** Inhalt eines Ordners in einer Bibliothek. Leerer Pfad = Wurzel.
   *  @param {string} [query] Zusatz an die Abfrage, z. B.
   *    "$expand=listItem($expand=fields)" für die Statusspalten. */
  async function ordnerInhalt(driveIdOrPath, ordner = "", query = "") {
    const p = String(ordner || "").replace(/^\/+|\/+$/g, "");
    const ziel = p
      ? `/drives/${driveIdOrPath}/root:/${encodeURI(p)}:/children`
      : `/drives/${driveIdOrPath}/root/children`;
    return callAll(ziel + (query ? "?" + query : ""));
  }

  /* ── Spaltennamen-Toleranz ────────────────────────────────────────────
     SharePoint hängt beim Anlegen eine Ziffer an, wenn der interne Name
     schon belegt ist – aus „Typ“ wird dann „Typ2“. Auch ein nachträglich
     geänderter Anzeigename lässt den internen Namen unberührt. Damit die
     App unabhängig davon funktioniert, wird einmal je Liste eine Zuordnung
     „erwarteter Name → tatsächlicher interner Name“ aufgebaut und beim
     Lesen und Schreiben angewandt.                                       */

  const _colMaps = _meta.colMaps;   // "sitePath|Liste" → { erwartet: intern }
  const _colExp  = _meta.colExp;    // "sitePath|Liste" → string[]

  const clearCache = () => metaLeeren();

  async function columns(sitePath, name) {
    const sid = await siteId(sitePath);
    const lid = await listId(sitePath, name);
    if (!lid) return [];
    const d = await call(`/sites/${sid}/lists/${lid}/columns?$select=name,displayName&$top=200`);
    return d.value || [];
  }

  const rxEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /** @returns {Promise<Object<string,string>>} erwartet → intern */
  async function fieldMap(sitePath, name, expected, force = false) {
    const key = sitePath + "|" + name;
    if (_colMaps[key] && !force) return _colMaps[key];
    const cols = await columns(sitePath, name);
    const exact = new Set(cols.map(c => c.name));
    const map = {};
    for (const e of expected) {
      if (exact.has(e)) { map[e] = e; continue; }
      const suffixed = cols.find(c => new RegExp("^" + rxEsc(e) + "\\d+$").test(c.name));
      if (suffixed) { map[e] = suffixed.name; continue; }
      const byDisplay = cols.find(c => (c.displayName || "").toLowerCase() === e.toLowerCase());
      if (byDisplay) { map[e] = byDisplay.name; continue; }
      const ci = cols.find(c => c.name.toLowerCase() === e.toLowerCase());
      if (ci) { map[e] = ci.name; continue; }
      // bleibt unabgebildet → Spalte fehlt wirklich
    }
    _colMaps[key] = map;
    _colExp[key] = expected.slice();
    metaSpeichern();
    return map;
  }

  /** Rohfelder → erwartete Namen (fürs Lesen). */
  function normalize(sitePath, name, fields) {
    const map = _colMaps[sitePath + "|" + name];
    if (!map) return fields;
    const out = { ...fields };
    for (const [erwartet, intern] of Object.entries(map)) {
      if (erwartet !== intern) out[erwartet] = fields[intern];
    }
    return out;
  }

  /** Erwartete Namen → interne Namen (fürs Schreiben). */
  function denormalize(sitePath, name, fields) {
    const key = sitePath + "|" + name;
    const map = _colMaps[key];
    if (!map) return fields;
    const exp = _colExp[key] || [];
    const out = {};
    for (const [k, v] of Object.entries(fields)) {
      if (map[k]) { out[map[k]] = v; continue; }
      if (exp.includes(k)) {
        console.warn(`[SharePoint] Spalte „${k}“ fehlt in ${name} – Wert wird nicht geschrieben.`);
        continue;
      }
      out[k] = v;
    }
    return out;
  }

  /* ── Listeneinträge ───────────────────────────────────────────────── */

  /** @param expected Erwartete Feldnamen; aktiviert die Spaltennamen-Toleranz.
   *  @returns {Promise<object[]|null>} null, wenn die Liste nicht existiert
   *    oder für dieses Konto nicht lesbar ist. */
  async function listItems(sitePath, name, expected = null, top = 999) {
    const sid = await siteId(sitePath);
    const lid = await listId(sitePath, name);
    if (!lid) return null;
    if (expected) await fieldMap(sitePath, name, expected);
    const rows = await callAll(`/sites/${sid}/lists/${lid}/items?$expand=fields&$top=${top}`);
    /* `_geaendert` kommt mit, weil die Konfiguration in SharePoint steht und
       nicht im Repository. Wer dort etwas ändert und die App befragt, sieht
       sonst nicht, ob seine Änderung überhaupt angekommen ist – und sucht
       den Fehler im Code. */
    return rows.map(r => ({ id: r.id, _geaendert: r.lastModifiedDateTime || null,
                            ...normalize(sitePath, name, r.fields || {}) }));
  }

  async function addItem(sitePath, name, fields) {
    const sid = await siteId(sitePath);
    const lid = await listId(sitePath, name);
    if (!lid) throw new Error(`Liste „${name}“ existiert nicht.`);
    const r = await call(`/sites/${sid}/lists/${lid}/items`, {
      method: "POST",
      body: JSON.stringify({ fields: denormalize(sitePath, name, fields) })
    });
    return { id: r.id, ...normalize(sitePath, name, r.fields || {}) };
  }

  async function updateItem(sitePath, name, itemId, fields) {
    const sid = await siteId(sitePath);
    const lid = await listId(sitePath, name);
    if (!lid) throw new Error(`Liste „${name}“ existiert nicht.`);
    return call(`/sites/${sid}/lists/${lid}/items/${itemId}/fields`, {
      method: "PATCH",
      body: JSON.stringify(denormalize(sitePath, name, fields))
    });
  }

  return {
    call, callAll, siteId, listId, drives, driveId, ordnerInhalt,
    listItems, addItem, updateItem, columns, fieldMap, clearCache
  };
})();
