"use strict";

/* Dataverse Web API.

   Stand: Phase 2. Enthält den Grundzugriff samt Drosselungsbehandlung und
   die WhoAmI-Probe. Auflösungsphase (Phase 0), Batch und Upsert über
   Alternativschlüssel folgen in Phase 5 und 6 – siehe CLAUDE.md §7 und §8.

   Der Aufruf läuft mit einem eigenen Token: user_impersonation gegen die
   Organisations-URL, nicht gegen Graph. Es gelten die CRM-Rechte des
   angemeldeten Benutzers – wer dort nichts anlegen darf, kann es auch über
   diese App nicht.                                                        */

const DV = (() => {

  const warte = ms => new Promise(r => setTimeout(r, ms));

  const basis = () => CRM_CONFIG.dataverseUrl.replace(/\/+$/, "")
    + "/api/data/" + CRM_CONFIG.apiVersion;

  /** Ist die Organisations-URL überhaupt gesetzt? Ohne sie hat ein Aufruf
   *  keinen Sinn, und die Meldung soll das sagen – statt eines
   *  Netzwerkfehlers gegen „https://<org>.crm4.dynamics.com“. */
  function pruefeKonfiguration() {
    if (istOffen(CRM_CONFIG.dataverseUrl)) {
      const e = new Error("dataverseUrl ist in js/config.js noch nicht gesetzt. "
        + "Die URL der Testumgebung steht im Altflow nur in der Verbindung "
        + "und muss einmal nachgetragen werden (CLAUDE.md §13).");
      e.code = "KONFIGURATION_OFFEN";
      throw e;
    }
  }

  /** Ein Aufruf gegen die Web API.
   *
   *  Wiederholungsregeln aus CLAUDE.md §7 und dem Review (B5):
   *  · 429 und 503 → exakt `Retry-After` warten, dann noch einmal.
   *  · 400, 403, 404 → nicht wiederholen. Das sind Datenfehler und gehören
   *    sofort in den Fehlerbericht.
   *  · Zeitüberschreitung oder 5xx bei einem POST → NICHT blind wiederholen.
   *    Die Anfrage kann angekommen sein und nur die Antwort verloren
   *    gegangen. Deshalb wird hier nur bei GET und PATCH wiederholt; PATCH
   *    ist als Upsert idempotent. */
  async function call(pfad, opts = {}, versuch = 0) {
    pruefeKonfiguration();
    const token = await AUTH.getToken("dataverse");
    const url = pfad.startsWith("https://") ? pfad : basis() + pfad;
    const methode = (opts.method || "GET").toUpperCase();

    const res = await fetch(url, {
      ...opts,
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        ...(opts.headers || {})
      }
    });

    const wiederholbar = methode === "GET" || methode === "PATCH";
    if ((res.status === 429 || (res.status >= 500 && wiederholbar)) && versuch < 4) {
      const s = Number(res.headers.get("Retry-After")) || 5;
      console.warn(`[Dataverse] ${res.status} – ${s} s warten (Versuch ${versuch + 1})`);
      await warte(s * 1000);
      return call(pfad, opts, versuch + 1);
    }

    if (res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.error?.message || res.statusText || String(res.status);
      const err = new Error(msg);
      err.status = res.status;
      err.code = data?.error?.code;
      err.request = methode + " " + pfad;
      err.detail = `${err.request} → HTTP ${res.status}`
        + (err.code ? ` ${err.code}` : "") + `: ${msg}`;
      throw err;
    }
    return data;
  }

  /** Funktionsprobe nach docs/01 §4.
   *
   *  Sie testet in einem Aufruf drei Dinge auf einmal: ob der Token für die
   *  richtige Ressource ausgestellt ist, ob CORS und die SPA-Plattform
   *  stimmen, und ob der Benutzer im Environment überhaupt existiert.
   *
   *  200 → alles korrekt
   *  401 → Token für die falsche Ressource; Scope prüfen
   *  403 → Benutzer nicht im Environment oder ohne Sicherheitsrolle
   *  CORS-Fehler → Umleitungs-URI oder Plattformtyp falsch, oder es greift
   *                eine Richtlinie für bedingten Zugriff
   *
   *  @returns {Promise<{UserId:string, BusinessUnitId:string, OrganizationId:string}>} */
  const whoAmI = () => call("/WhoAmI");

  /** Alle Seiten einer Abfrage einsammeln (`@odata.nextLink`).
   *  @param {number} [maxSeiten] Deckel gegen einen unbeabsichtigten
   *    Vollscan. Wird er erreicht, sagt der Aufrufer das auch – ein still
   *    abgeschnittenes Ergebnis waere schlimmer als ein langsames. */
  async function alle(pfad, maxSeiten = 20) {
    let out = [], next = pfad, seiten = 0, vollstaendig = true;
    while (next) {
      if (seiten++ >= maxSeiten) { vollstaendig = false; break; }
      const d = await call(next, { headers: { Prefer: "odata.maxpagesize=1000" } });
      out = out.concat(d?.value || []);
      next = d?.["@odata.nextLink"] || null;
    }
    out.vollstaendig = vollstaendig;
    return out;
  }

  /** Doppelte Werte in einem Feld zaehlen.
   *
   *  Der Anlass steht in docs/05: Der Altflow hat am 04.06.2026 durch eine
   *  verschachtelte Schleife 76 Verkaufschancen doppelt angelegt, und
   *  aufgefallen ist das erst, als der Alternativschluessel nicht anlegbar
   *  war. Ein Schluesselfeld, das seine Eindeutigkeit verliert, macht den
   *  ganzen Upsert-Ansatz kaputt – also wird es nachgesehen, statt darauf zu
   *  vertrauen.
   *
   *  @returns {Promise<{gesamt:number, verschieden:number,
   *                     dubletten:Array<{wert:any, anzahl:number}>,
   *                     vollstaendig:boolean}>} */
  async function dubletten(entitySet, feld) {
    const rows = await alle(
      `/${entitySet}?$select=${feld}&$filter=${feld} ne null`);
    const zaehler = new Map();
    for (const r of rows) {
      const v = r[feld];
      if (v === null || v === undefined) continue;
      zaehler.set(v, (zaehler.get(v) || 0) + 1);
    }
    const dub = [...zaehler.entries()]
      .filter(([, n]) => n > 1)
      .map(([wert, anzahl]) => ({ wert, anzahl }))
      .sort((a, b) => b.anzahl - a.anzahl);
    return { gesamt: rows.length, verschieden: zaehler.size,
             dubletten: dub, vollstaendig: rows.vollstaendig !== false };
  }

  /* ── Metadaten ────────────────────────────────────────────────────────
     Die Feldliste kommt aus Dataverse, nicht aus einer gepflegten Konstante
     im Code. Eine Konstante wäre am Tag ihrer Entstehung korrekt und danach
     nie wieder – und ein Tippfehler im Zielfeldnamen fällt sonst erst beim
     Schreiben auf. Genau so verliert der Altflow die Zeichnungsnummer.   */

  const META_KEY = "crm_dvmeta";
  const _meta = (() => {
    try { return JSON.parse(sessionStorage.getItem(META_KEY) || "{}"); }
    catch { return {}; }
  })();

  const metaSichern = () => {
    try { sessionStorage.setItem(META_KEY, JSON.stringify(_meta)); } catch {}
  };

  /** Vom Mengennamen (`opportunities`) auf den logischen Namen
   *  (`opportunity`) schließen. Dataverse führt beides; die Metadaten hängen
   *  am logischen Namen, das Profil nennt den Mengennamen. */
  async function logischerName(entitySet) {
    const k = "set|" + entitySet;
    if (_meta[k]) return _meta[k];
    const d = await call(`/EntityDefinitions?$select=LogicalName,EntitySetName`
      + `&$filter=EntitySetName eq '${entitySet}'`);
    const e = d?.value?.[0];
    if (!e) throw new Error(`Tabelle „${entitySet}“ gibt es in dieser Umgebung nicht.`);
    _meta[k] = e.LogicalName;
    metaSichern();
    return e.LogicalName;
  }

  /** Felder einer Tabelle.
   *  @returns {Promise<Object<string,{typ:string, anlegbar:boolean,
   *            aenderbar:boolean, pflicht:string, maxLength:number|null}>>}
   *    Schlüssel ist der logische Feldname. */
  async function felder(entitySet) {
    const k = "felder|" + entitySet;
    if (_meta[k]) return _meta[k];
    const ln = await logischerName(entitySet);
    const d = await call(`/EntityDefinitions(LogicalName='${ln}')/Attributes`
      + `?$select=LogicalName,AttributeType,IsValidForCreate,IsValidForUpdate,RequiredLevel`);
    const out = {};
    for (const a of d?.value || []) {
      out[a.LogicalName] = {
        typ: a.AttributeType,
        anlegbar: a.IsValidForCreate !== false,
        aenderbar: a.IsValidForUpdate !== false,
        pflicht: a.RequiredLevel?.Value || "None"
      };
    }
    _meta[k] = out;
    metaSichern();
    return out;
  }

  /** Navigationsnamen der Verweisfelder.
   *
   *  `@odata.bind` verlangt den Namen der NAVIGATIONSEIGENSCHAFT, nicht den
   *  des Attributs. Bei den Standardfeldern sind beide gleich
   *  (`parentaccountid`), bei selbst angelegten fast nie:
   *  `cr570_technicalaudit_lookup` heisst als Navigationseigenschaft
   *  `cr570_TechnicalAudit_lookup`. Dataverse antwortet auf den falschen
   *  Namen mit
   *
   *    An undeclared property '…' which only has property annotations in
   *    the payload but no property value was found in the payload.
   *
   *  – einer Meldung, die den eigentlichen Grund nicht nennt.
   *
   *  @returns {Promise<Object<string,string>>} Attributname → Navigationsname */
  async function navigation(entitySet) {
    const k = "nav|" + entitySet;
    if (_meta[k]) return _meta[k];
    const ln = await logischerName(entitySet);
    const d = await call(`/EntityDefinitions(LogicalName='${ln}')/ManyToOneRelationships`
      + `?$select=ReferencingAttribute,ReferencingEntityNavigationPropertyName`);
    const out = {};
    for (const r of d?.value || [])
      if (r.ReferencingAttribute && r.ReferencingEntityNavigationPropertyName)
        out[r.ReferencingAttribute] = r.ReferencingEntityNavigationPropertyName;
    _meta[k] = out;
    metaSichern();
    return out;
  }

  /** Alternativschlüssel einer Tabelle.
   *
   *  Steht im Profil ein Schlüssel, den es in der Umgebung nicht gibt,
   *  scheitert JEDER Schreibzugriff dieses Schrittes – mit
   *  `0x80060888: The key in the request URI is not valid`. Das soll der
   *  Prüflauf sagen, nicht der Import.
   *
   *  @returns {Promise<Array<{name:string, felder:string[], status:string}>>} */
  async function schluessel(entitySet) {
    const k = "keys|" + entitySet;
    if (_meta[k]) return _meta[k];
    const ln = await logischerName(entitySet);
    const d = await call(`/EntityDefinitions(LogicalName='${ln}')/Keys`
      + `?$select=LogicalName,KeyAttributes,EntityKeyIndexStatus`);
    const out = (d?.value || []).map(r => ({
      name: r.LogicalName,
      felder: r.KeyAttributes || [],
      status: r.EntityKeyIndexStatus || ""
    }));
    _meta[k] = out;
    metaSichern();
    return out;
  }

  const metaLeeren = () => {
    for (const k of Object.keys(_meta)) delete _meta[k];
    try { sessionStorage.removeItem(META_KEY); } catch {}
  };

  /** Passt der im Profil eingetragene Typ zu dem, was Dataverse führt?
   *  Die Namen unterscheiden sich, deshalb eine Tabelle statt eines
   *  Vergleichs. `null` heißt „nicht beurteilbar“. */
  const TYPEN = {
    String:   ["String", "Memo"],
    Int:      ["Integer", "BigInt"],
    Decimal:  ["Decimal", "Double"],
    Money:    ["Money"],
    Boolean:  ["Boolean"],
    DateTime: ["DateTime"],
    OptionSet:["Picklist", "State", "Status"],
    Lookup:   ["Lookup", "Customer", "Owner"],
    Action:   null
  };
  function typPasst(profilTyp, dvTyp) {
    const erlaubt = TYPEN[profilTyp];
    if (!erlaubt || !dvTyp) return null;
    return erlaubt.includes(dvTyp);
  }

  return { call, alle, dubletten, whoAmI, basis, pruefeKonfiguration,
           felder, logischerName, navigation, schluessel, typPasst, metaLeeren };
})();
