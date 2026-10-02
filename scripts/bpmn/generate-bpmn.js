'use strict';
/**
 * BPMN-Generator: Anfragen aus TimeLine ins CRM
 * =============================================
 * Erzeugt die vier Modelle dieser Schnittstelle im **Hausschema des RMS**
 * (rms.dihag.de): ein Hauptprozess, zwei eingebundene Unterprozesse und die
 * Eingangsüberwachung, die einen eigenen Auslöser hat und deshalb ein eigener
 * Prozess ist.
 *
 * Die Regeln sind nicht hier erfunden. Sie stehen im RMS
 * (`js/prozessschema.js`, Regeln R1–R10) und gelten für jedes Modell im Haus:
 * genau ein Auslöser, benannte Ergebnisse, keine nackte Aufgabe (👤 Mensch,
 * ⚙ System, ✋ Handgriff), jeder Knoten in genau einer Bahn, Bahnen tragen
 * Rollen statt Personen, jede Entscheidung ist eine Frage mit beschrifteten
 * Ausgängen, nichts hängt lose, mindestens eine Richtlinie, und ein
 * Unterprozess wird eingebunden statt abgeschrieben.
 * `tests/test-prozess.mjs` prüft die erzeugten Dateien dagegen.
 *
 * **Führend sind die Modelle im RMS.** Dieser Generator ist der Weg für den
 * Erstimport und für grössere Umbauten; danach wird im RMS weitergepflegt,
 * und `prozess.html` liest von dort, sobald das Konto Zugriff hat.
 *
 * Der Motor (Raster, Kantenführung, BPMN-DI) ist wörtlich der aus
 * `e-rechnung/scripts/bpmn/generate-bpmn.js`. Zwei Layout-Engines im Haus
 * wären zwei Bildsprachen für dieselbe Sache.
 *
 * Aufruf:  node scripts/bpmn/generate-bpmn.js
 * Ausgabe: docs/bpmn/*.bpmn und docs/bpmn/modelle.json
 * Eingabe: docs/bpmn/rms-ids.json (Datei-Kennungen im RMS, nach dem Import)
 *
 * Raster: c = Spalte (von links), r = Zeile innerhalb der Bahn.
 */

const fs = require('fs');
const path = require('path');

/* ── Raster & Maße ─────────────────────────────────────────────────────── */
const COL_W = 170, ROW_H = 120;
const TASK_W = 132, TASK_H = 84, EV = 36, GW = 50;
const POOL_X = 100, POOL_HEAD = 30, LANE_HEAD = 30, POOL_GAP = 70, TOP = 60, BLACKBOX_H = 70;
const CONTENT_X = POOL_X + POOL_HEAD + LANE_HEAD + 20;

/* ── Farben (identisch zur Legende auf prozess.html) ───────────────────── */
const ACTOR = {
  extern: { lane: '#F6F7F9', fill: '#E9ECF0', stroke: '#5B6472' },  // Lieferant, Kunde, Bank
  auto:   { lane: '#F3F8FE', fill: '#D8E8F8', stroke: '#17509E' },  // Postfach & Power Automate
  api:    { lane: '#F8F5FD', fill: '#E6DDF7', stroke: '#5B3FA8' },  // Prüfdienst (Azure)
  archiv: { lane: '#F1FAF8', fill: '#D2EEE8', stroke: '#0F766E' },  // SharePoint, Monitoring, GoBD
  mensch: { lane: '#FFF8F1', fill: '#FFE3C8', stroke: '#C2410C' },  // Buchhaltung, Vertrieb, Treasury
  app:    { lane: '#F3F6FB', fill: '#DCE5F2', stroke: '#1A2644' },  // Browser-Apps (Konverter, MC-Converter)
  erp:    { lane: '#F7F7F6', fill: '#E6E6E4', stroke: '#424241' },  // ERP, MultiCash, Versand
};
const TONE = {
  ok:   { fill: '#DDF3E4', stroke: '#1E7B3A' },
  warn: { fill: '#FFF1CC', stroke: '#A65F00' },
  err:  { fill: '#FDE2E1', stroke: '#B42318' },
  gate: { fill: '#FFF8DB', stroke: '#8A6100' },
  plan: { fill: '#F1F1F3', stroke: '#8A8F98' },
};

/* ── Elementarten (Hausschema: Aufgaben sind 👤 user, ⚙ service oder ✋ manual) ── */
const KIND = {
  start:       { tag: 'startEvent',  size: 'ev' },
  msgStart:    { tag: 'startEvent',  size: 'ev', def: 'message' },
  timerStart:  { tag: 'startEvent',  size: 'ev', def: 'timer' },
  end:         { tag: 'endEvent',    size: 'ev' },
  errEnd:      { tag: 'endEvent',    size: 'ev', def: 'error' },
  boundaryErr: { tag: 'boundaryEvent', size: 'ev', def: 'error' },
  service:     { tag: 'serviceTask', size: 'task' },
  user:        { tag: 'userTask',    size: 'task' },
  manual:      { tag: 'manualTask',  size: 'task' },
  call:        { tag: 'callActivity', size: 'task' },
  gw:          { tag: 'exclusiveGateway', size: 'gw' },
  gwInc:       { tag: 'inclusiveGateway', size: 'gw' },
  gwPar:       { tag: 'parallelGateway',  size: 'gw' },
};

const R = b => b.x + b.w, B = b => b.y + b.h, CX = b => b.x + b.w / 2, CY = b => b.y + b.h / 2;
const rnd = v => Math.round(v);
const isGw = n => KIND[n.k].size === 'gw';
const sizeOf = k => (KIND[k].size === 'ev' ? [EV, EV] : KIND[k].size === 'gw' ? [GW, GW] : [TASK_W, TASK_H]);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colorOf(n, actor) {
  if (n.tone) return TONE[n.tone];
  if (n.k === 'start' || n.k === 'msgStart' || n.k === 'timerStart' || n.k === 'end') return TONE.ok;
  if (n.k === 'errEnd' || n.k === 'boundaryErr') return TONE.err;
  if (isGw(n)) return TONE.gate;
  const a = ACTOR[actor] || ACTOR.app;
  return { fill: a.fill, stroke: a.stroke };
}
const colorAttrs = c => (c
  ? ` bioc:stroke="${c.stroke}" bioc:fill="${c.fill}" color:background-color="${c.fill}" color:border-color="${c.stroke}"`
  : '');

/* Kurzschreibweise für Sequenzflüsse: F(von, nach, Beschriftung, Optionen) */
const F = (from, to, name, o) => ({ from, to, name: name || '', o: o || {} });

const ANSICHT = 'https://crm.dihag.de/prozess.html';

/* Verknüpfte Regelwerke im RMS. Die Kennungen sind die Listen-IDs in
   `Richtlinien` auf sites/IT – dieselben, die `rms.dihag.de/?richtlinie=<id>`
   öffnet. R9 verlangt mindestens eine je Modell: ein Ablauf ohne Regelwerk
   ist Gewohnheit, keine Vorgabe. */
const POLICIES = {
  120: 'Konzernfachregelung Prozessmanagement',
  111: 'ISMS-Richtlinie Sichere Softwareentwicklung',
  119: 'ISMS-Richtlinie Aufbewahrungsfristen und -pflichten',
};

/* ═════════════════════════════════════════════════════════════════════════
 *  DIE MODELLE
 *
 *  Vier, nicht eines. Ein Modell hat genau einen Auslöser (R1); die
 *  Eingangsüberwachung beginnt mit einer Uhrzeit und nicht mit einer
 *  gelieferten Datei – also ist sie ein eigener Prozess. Import und Freigabe
 *  sind Unterprozesse: eingebunden (⊞), nicht abgeschrieben (R10).
 * ═════════════════════════════════════════════════════════════════════════ */

const UEBERNAHME = {
  key: 'uebernahme', file: '01-anfragen-uebernehmen.bpmn', tab: 'uebernahme', haupt: true,
  name: 'Anfragen aus TimeLine ins CRM übernehmen',
  kennung: 'Process_CRM_Timeline_Uebernahme',
  policies: ['120', '111', '119'],
  doku: 'Jeden Donnerstag um 6 Uhr exportiert der TimeLine-Anwendungsserver der '
      + 'Schmiedeberger Guss alle Anfragen, die seit dem letzten Export geändert '
      + 'wurden. Die Mappe erreicht über OneDrive den SharePoint-Ordner '
      + '„Austausch/Projekt CRM-Timeline". Die CRM-Schnittstelle greift sie auf, '
      + 'prüft sie und schreibt die unstrittigen Zeilen nach Dynamics 365. Was sie '
      + 'nicht allein entscheiden kann, legt sie der CRM-Betreuung zur Freigabe vor.',
  pools: [
    {
      id: 'P_Haupt', name: 'DIHAG · Anfragen aus TimeLine ins CRM', main: true,
      lanes: [
        { id: 'LA', name: 'TimeLine Anwendungsserver', actor: 'erp' },
        { id: 'LB', name: 'SharePoint-Ablage (Austausch)', actor: 'archiv' },
        { id: 'LC', name: 'CRM-Schnittstelle (Automatik)', actor: 'auto' },
        { id: 'LD', name: 'CRM-Betreuung', actor: 'mensch' },
      ],
      nodes: [
        { id: 'A_start', k: 'timerStart', n: 'Donnerstag 6 Uhr erreicht', lane: 'LA', c: 0, r: 0 },
        { id: 'A_exp', k: 'service', n: 'Seit dem letzten Export geänderte Anfragen exportieren', lane: 'LA', c: 1, r: 0 },
        { id: 'A_file', k: 'service', n: 'Mappe „Anfragen JJJJ-MM-TT.xlsx" im Austauschordner ablegen', lane: 'LA', c: 2, r: 0 },
        { id: 'B_sync', k: 'service', n: 'Mappe über OneDrive nach SharePoint übertragen', lane: 'LB', c: 3, r: 0 },
        { id: 'C_find', k: 'service', n: 'Neue oder seit dem Import geänderte Mappe erkennen', lane: 'LC', c: 4, r: 0 },
        { id: 'C_pruef', k: 'service', n: 'Mappe auf Pflichtfelder, Zuordnungen und Mehrfachtreffer prüfen', lane: 'LC', c: 5, r: 0 },
        { id: 'C_gw', k: 'gw', n: 'Alles unstrittig?', lane: 'LC', c: 6, r: 0 },
        { id: 'D_frei', k: 'call', ref: 'freigabe', n: 'Freigabe einholen', lane: 'LD', c: 7, r: 1 },
        { id: 'D_endFrei', k: 'end', n: 'zur Freigabe vorgelegt', lane: 'LD', c: 8, r: 1, tone: 'warn' },
        { id: 'C_imp', k: 'call', ref: 'import', n: 'Datensätze ins CRM schreiben', lane: 'LC', c: 7, r: 0 },
        { id: 'C_prot', k: 'service', n: 'Lauf, Zeilen und Vollprotokoll schreiben', lane: 'LC', c: 8, r: 0 },
        { id: 'C_mark', k: 'service', n: 'Mappe als importiert vermerken', lane: 'LC', c: 9, r: 0 },
        { id: 'C_mail', k: 'service', n: 'Bericht ablegen und versenden', lane: 'LC', c: 10, r: 0 },
        { id: 'D_lesen', k: 'user', n: 'Bericht lesen und offene Konflikte entscheiden', lane: 'LD', c: 11, r: 0 },
        { id: 'D_end', k: 'end', n: 'Anfragen stehen im CRM', lane: 'LD', c: 12, r: 0 },
      ],
      flows: [
        F('A_start', 'A_exp'),
        F('A_exp', 'A_file'),
        F('A_file', 'B_sync'),
        F('B_sync', 'C_find'),
        F('C_find', 'C_pruef'),
        F('C_pruef', 'C_gw'),
        F('C_gw', 'C_imp', 'ja'),
        F('C_gw', 'D_frei', 'nein', { in: 'top' }),
        F('D_frei', 'D_endFrei'),
        F('C_imp', 'C_prot'),
        F('C_prot', 'C_mark'),
        F('C_mark', 'C_mail'),
        F('C_mail', 'D_lesen'),
        F('D_lesen', 'D_end'),
      ],
      annotations: [
        { id: 'An_job', of: 'A_start', lane: 'LA', c: 0, r: 1, w: 210, h: 62,
          text: 'Dienst „CRM Export" im TimeLine AppSrv (192.168.100.163), Filter Woche: Donnerstag, Startzeit 06:00.' },
        { id: 'An_takt', of: 'C_find', lane: 'LC', c: 4, r: 1, w: 210, h: 62,
          text: 'Zeitplan sieht alle 15 Minuten nach. Takt, Zeitfenster und Schalter stehen in der Liste CRM_Automatik.' },
      ],
    },
    { id: 'P_Dyn', name: 'Dynamics 365 (Dataverse)', actor: 'app', blackbox: true },
  ],
  messages: [
    { from: 'C_imp', to: 'P_Dyn', name: 'Firmen, Kontakte, Verkaufschancen, Positionen' },
  ],
};

const IMPORT = {
  key: 'import', file: '02-datensaetze-schreiben.bpmn', tab: 'uebernahme', von: 'uebernahme',
  name: 'Datensätze ins CRM schreiben',
  kennung: 'Process_CRM_Timeline_Import',
  policies: ['111', '119'],
  doku: 'Die sechs Schritte des Importprofils, in dieser Reihenfolge und in einem '
      + 'Lauf. Geschrieben wird in Stapeln; scheitert eine Zeile, laufen die '
      + 'übrigen weiter, und die gescheiterte steht mit Grund im Protokoll. '
      + 'Eine im CRM geschlossene Verkaufschance ist schreibgeschützt – verloren '
      + 'gegebene werden wieder geöffnet, gewonnene bleiben unberührt.',
  pools: [
    {
      id: 'P_Imp', name: 'DIHAG · Datensätze ins CRM schreiben', main: true,
      lanes: [
        { id: 'LA', name: 'CRM-Schnittstelle (Automatik)', actor: 'auto' },
      ],
      nodes: [
        { id: 'I_start', k: 'start', n: 'Mappe ist geprüft und ohne offene Frage', lane: 'LA', c: 0, r: 0 },
        { id: 'I_10', k: 'service', n: '10 Firmen über die Kundennummer zuordnen', lane: 'LA', c: 1, r: 0 },
        { id: 'I_20', k: 'service', n: '20 Kontakte anlegen oder aktualisieren', lane: 'LA', c: 2, r: 0 },
        { id: 'I_gw1', k: 'gw', n: 'Verkaufschance im CRM geschlossen?', lane: 'LA', c: 3, r: 0 },
        { id: 'I_30', k: 'service', n: '30 Verkaufschance anlegen oder aktualisieren', lane: 'LA', c: 5, r: 0 },
        { id: 'I_40', k: 'service', n: '40 Positionen je Verkaufschance ersetzen', lane: 'LA', c: 6, r: 0 },
        { id: 'I_50', k: 'service', n: '50 Vertriebsprozess auf die Stufe aus der Datei setzen', lane: 'LA', c: 7, r: 0 },
        { id: 'I_gw3', k: 'gw', n: 'In der Datei abgeschlossen?', lane: 'LA', c: 8, r: 0 },
        { id: 'I_60', k: 'service', n: '60 Verkaufschance mit ihrem Ergebnis schliessen', lane: 'LA', c: 9, r: 0 },
        { id: 'I_end', k: 'end', n: 'Datensätze stehen im CRM', lane: 'LA', c: 10, r: 0 },
        { id: 'I_gw2', k: 'gw', n: 'War sie verloren?', lane: 'LA', c: 4, r: 1 },
        { id: 'I_open', k: 'service', n: 'Verkaufschance wieder öffnen und den alten Grund als Notiz sichern', lane: 'LA', c: 5, r: 1, tone: 'warn' },
        { id: 'I_skip', k: 'end', n: 'übersprungen – gewonnene Verkaufschance bleibt unberührt', lane: 'LA', c: 5, r: 2, tone: 'warn' },
      ],
      flows: [
        F('I_start', 'I_10'),
        F('I_10', 'I_20'),
        F('I_20', 'I_gw1'),
        F('I_gw1', 'I_30', 'nein'),
        F('I_gw1', 'I_gw2', 'ja', { in: 'top' }),
        F('I_gw2', 'I_open', 'ja'),
        F('I_gw2', 'I_skip', 'nein', { in: 'top' }),
        F('I_open', 'I_40', '', { in: 'bottom' }),
        F('I_30', 'I_40'),
        F('I_40', 'I_50'),
        F('I_50', 'I_gw3'),
        F('I_gw3', 'I_60', 'ja'),
        F('I_gw3', 'I_end', 'nein', { via: 'above' }),
        F('I_60', 'I_end'),
      ],
      annotations: [
        { id: 'An_dubl', of: 'I_20', lane: 'LA', c: 1, r: 1, w: 220, h: 62,
          text: 'Mehrfachtreffer: gibt es genau einen aktiven Datensatz, gewinnt dieser ohne Rückfrage. Sonst hält der Lauf an.' },
      ],
    },
    { id: 'P_Dyn', name: 'Dynamics 365 (Dataverse)', actor: 'app', blackbox: true },
  ],
  messages: [
    { from: 'I_40', to: 'P_Dyn', name: 'Stapel über die Web-API' },
  ],
};

const FREIGABE = {
  key: 'freigabe', file: '03-freigabe-einholen.bpmn', tab: 'uebernahme', von: 'uebernahme',
  name: 'Freigabe einholen',
  kennung: 'Process_CRM_Timeline_Freigabe',
  policies: ['120', '111'],
  doku: 'Was einen Menschen stutzen liesse, hält die Automatik an: ein Fehler im '
      + 'Prüflauf, ein fehlendes Blatt, eine Mehrdeutigkeit mit mehreren aktiven '
      + 'Datensätzen. Die Frage wartet in der Liste CRM_Freigaben und im Reiter '
      + '„Automatik", die Antwort gilt für den nächsten Lauf. Freigeben darf nur, '
      + 'wer die Rolle „editor" hat – eine Freigabe lässt den Anwendungsbenutzer '
      + 'schreiben, also an den eigenen CRM-Rechten vorbei.',
  pools: [
    {
      id: 'P_Frei', name: 'DIHAG · Freigabe einholen', main: true,
      lanes: [
        { id: 'LA', name: 'CRM-Schnittstelle (Automatik)', actor: 'auto' },
        { id: 'LB', name: 'CRM-Betreuung', actor: 'mensch' },
      ],
      nodes: [
        { id: 'F_start', k: 'start', n: 'Prüflauf hat eine offene Frage', lane: 'LA', c: 0, r: 0 },
        { id: 'F_vorgang', k: 'service', n: 'Vorgang anlegen und Mappe auf „Wartet auf Freigabe" setzen', lane: 'LA', c: 1, r: 0 },
        { id: 'F_mail', k: 'service', n: 'Bericht mit den offenen Fragen versenden', lane: 'LA', c: 2, r: 0 },
        { id: 'F_antw', k: 'user', n: 'Offene Fragen im Reiter „Automatik" beantworten', lane: 'LB', c: 3, r: 0 },
        { id: 'F_gw', k: 'gw', n: 'Freigegeben?', lane: 'LB', c: 4, r: 0 },
        { id: 'F_end', k: 'end', n: 'freigegeben – der nächste Lauf importiert', lane: 'LB', c: 5, r: 0 },
        { id: 'F_ab', k: 'service', n: 'Mappe auf „Abgelehnt" setzen', lane: 'LA', c: 5, r: 1 },
        { id: 'F_endAb', k: 'end', n: 'abgelehnt – die Mappe bleibt liegen', lane: 'LA', c: 6, r: 1, tone: 'warn' },
      ],
      flows: [
        F('F_start', 'F_vorgang'),
        F('F_vorgang', 'F_mail'),
        F('F_mail', 'F_antw'),
        F('F_antw', 'F_gw'),
        F('F_gw', 'F_end', 'ja'),
        F('F_gw', 'F_ab', 'nein', { in: 'top' }),
        F('F_ab', 'F_endAb'),
      ],
      annotations: [
        { id: 'An_rolle', of: 'F_antw', lane: 'LB', c: 3, r: 1, w: 220, h: 48,
          text: 'Bei mehreren Treffern gewinnt der aktive Datensatz – das entscheidet die Automatik selbst.' },
      ],
    },
  ],
  messages: [],
};

const EINGANG = {
  key: 'eingang', file: '04-eingang-ueberwachen.bpmn', tab: 'eingang', haupt: true,
  name: 'Eingang der TimeLine-Mappe überwachen',
  kennung: 'Process_CRM_Timeline_Eingang',
  policies: ['120', '111'],
  doku: 'Der stillste Fehler ist der ausbleibende Eingang: kein Import, kein '
      + 'Bericht, keine Protokollzeile – Ausbleiben sieht aus wie „alles in '
      + 'Ordnung". Deshalb ein eigener Auslöser: donnerstags um 14 Uhr fragt die '
      + 'Automatik, ob seit dem vorigen Termin eine Mappe eingegangen ist, und '
      + 'meldet die Fehlanzeige an den IT-Service. Die Erwartung gilt der Datei, '
      + 'nicht der Automatik: sie greift auch, wenn der Import abgeschaltet ist.',
  pools: [
    {
      id: 'P_Ein', name: 'DIHAG · Eingang überwachen', main: true,
      lanes: [
        { id: 'LA', name: 'CRM-Schnittstelle (Automatik)', actor: 'auto' },
        { id: 'LB', name: 'IT-Service Desk', actor: 'mensch' },
      ],
      nodes: [
        { id: 'E_start', k: 'timerStart', n: 'Donnerstag 14 Uhr erreicht', lane: 'LA', c: 0, r: 0 },
        { id: 'E_gw', k: 'gw', n: 'Seit dem vorigen Termin eine Mappe eingegangen?', lane: 'LA', c: 1, r: 0 },
        { id: 'E_ok', k: 'end', n: 'Lieferung ist da', lane: 'LA', c: 2, r: 0 },
        { id: 'E_mail', k: 'service', n: 'Fehlanzeige an den IT-Service senden', lane: 'LA', c: 2, r: 1, tone: 'warn' },
        { id: 'E_klaeren', k: 'user', n: 'Lieferung aus TimeLine klären', lane: 'LB', c: 3, r: 0 },
        { id: 'E_end', k: 'end', n: 'Lieferung geklärt', lane: 'LB', c: 4, r: 0 },
      ],
      flows: [
        F('E_start', 'E_gw'),
        F('E_gw', 'E_ok', 'ja'),
        F('E_gw', 'E_mail', 'nein', { in: 'top' }),
        F('E_mail', 'E_klaeren'),
        F('E_klaeren', 'E_end'),
      ],
      annotations: [
        { id: 'An_erw', of: 'E_gw', lane: 'LA', c: 0, r: 1, w: 220, h: 62,
          text: 'Tag, Frist und Empfänger stehen in CRM_Automatik: ErwartetAn, ErwartetBisUhr, ErwartetEmpfaenger. Leer heisst: keine Erwartung.' },
      ],
    },
  ],
  messages: [],
};

const MODELLE = [UEBERNAHME, IMPORT, FREIGABE, EINGANG];
const BY_KEY = Object.fromEntries(MODELLE.map(m => [m.key, m]));

/* ═════════════════════════════════════════════════════════════════════════
 *  LAYOUT
 * ═════════════════════════════════════════════════════════════════════════ */

function placeNode(n, cx, cy) {
  const [w, h] = sizeOf(n.k);
  n.b = { x: rnd(cx - w / 2), y: rnd(cy - h / 2), w, h };
}

/** Pools und Bahnen anordnen, Knoten platzieren. Geschlossene Pools (externe
 *  Partner) sind nur ein Band ohne Inhalt. */
function layoutMain(spec) {
  const N = {};
  let maxCol = 0;
  for (const p of spec.pools) {
    for (const n of p.nodes || []) if (n.c != null) maxCol = Math.max(maxCol, n.c);
    for (const a of p.annotations || []) maxCol = Math.max(maxCol, a.c + Math.ceil((a.w || 160) / COL_W) - 1);
  }
  const width = (CONTENT_X - POOL_X) + (maxCol + 1) * COL_W + 30;
  let y = TOP;
  for (const p of spec.pools) {
    p.x = POOL_X; p.y = y; p.w = width; p.laneGeo = [];
    if (p.blackbox) {
      p.h = BLACKBOX_H;
      y += p.h + POOL_GAP;
      continue;
    }
    for (const ld of p.lanes) {
      let rows = ld.rows || 1;
      for (const n of p.nodes) if (n.lane === ld.id && n.r != null) rows = Math.max(rows, n.r + 1);
      for (const a of p.annotations || []) if (a.lane === ld.id) rows = Math.max(rows, a.r + 1);
      const h = rows * ROW_H + 20;
      p.laneGeo.push({ ...ld, x: POOL_X + POOL_HEAD, y, w: width - POOL_HEAD, h });
      y += h;
    }
    p.h = y - p.y;
    y += POOL_GAP;
    const laneOf = o => p.laneGeo.find(l => l.id === o.lane);
    p.colLeft = c => CONTENT_X + c * COL_W;
    p.rowTop = (o, r) => laneOf(o).y + 10 + r * ROW_H;
    for (const n of p.nodes) {
      if (n.k === 'boundaryErr') continue;
      const lane = laneOf(n);
      if (!lane) throw new Error(`${spec.key}: Bahn "${n.lane}" für ${n.id} fehlt`);
      n.pool = p; n.actor = lane.actor;
      placeNode(n, CONTENT_X + n.c * COL_W + COL_W / 2, lane.y + 10 + n.r * ROW_H + ROW_H / 2);
      N[n.id] = n;
    }
    for (const n of p.nodes.filter(x => x.k === 'boundaryErr')) {
      const h = N[n.attachedTo];
      n.pool = p; n.actor = h.actor;
      placeNode(n, R(h.b) - 28, B(h.b));
      N[n.id] = n;
    }
  }
  return N;
}

function checkOverlaps(nodes, where) {
  const seen = new Map();
  for (const n of nodes) {
    if (n.k === 'boundaryErr') continue;
    const key = `${n.lane || ''}|${n.c}|${n.r}`;
    if (seen.has(key)) throw new Error(`${where}: ${n.id} liegt auf demselben Rasterplatz wie ${seen.get(key)}`);
    seen.set(key, n.id);
  }
}

/* ── Kanten führen (orthogonal) ───────────────────────────────────────── */

function route(f, N, inCnt, outCnt) {
  const s = N[f.from], t = N[f.to];
  if (!s || !t) throw new Error(`Fluss ${f.from} -> ${f.to}: Knoten fehlt`);
  const sb = s.b, tb = t.b, o = f.o;
  const sx = CX(sb), sy = CY(sb), tx = CX(tb), ty = CY(tb);
  // Übergang in ein tieferes Band: unten raus, durch die freie Zeile, oben rein
  // (rechts raus, damit Ein- und Ausgänge nicht dieselbe Kante teilen)
  if (o.viaRow != null) {
    const yv = t.pool.rowTop(t, o.viaRow) + ROW_H / 2, xr = R(sb) + 28;
    return [[R(sb), sy], [xr, sy], [xr, yv], [tx, yv], [tx, tb.y]];
  }
  // Senkrecht aus der Aufgabe in die Zeile des Ziels, dann waagerecht hinein
  if (o.out === 'vertical' && tx > sx) return [[sx, ty < sy ? sb.y : B(sb)], [sx, ty], [tb.x, ty]];
  if (o.via === 'above' || o.via === 'below') {
    const up = o.via === 'above';
    const g = o.gap || 28;
    const yv = up ? Math.min(sb.y, tb.y) - g : Math.max(B(sb), B(tb)) + g;
    return [[sx, up ? sb.y : B(sb)], [sx, yv], [tx, yv], [tx, up ? tb.y : B(tb)]];
  }
  if (o.via === 'left') return [[sb.x, sy], [tx, sy], [tx, ty < sy ? B(tb) : tb.y]];
  if (s.k === 'boundaryErr') return [[sx, B(sb)], [sx, ty], [tx < sx ? R(tb) : tb.x, ty]];
  // Von einer Entscheidung schräg nach unten rechts, oben in das Ziel
  if (o.in === 'top' && tx > sx && ty > sy) {
    const yv = tb.y - 30;
    return [[sx, B(sb)], [sx, yv], [tx, yv], [tx, tb.y]];
  }

  const sameRow = Math.abs(sy - ty) < 1, sameCol = Math.abs(sx - tx) < 1;
  if (sameRow) {
    if (tx > sx) return [[R(sb), sy], [tb.x, ty]];
    const yv = Math.max(B(sb), B(tb)) + 28;
    return [[sx, B(sb)], [sx, yv], [tx, yv], [tx, B(tb)]];
  }
  if (sameCol) return ty > sy ? [[sx, B(sb)], [tx, tb.y]] : [[sx, sb.y], [tx, B(tb)]];

  const split = isGw(s) && outCnt[s.id] > 1;
  const join = isGw(t) && inCnt[t.id] > 1;
  if (tx > sx) {
    if (split) return [[sx, ty < sy ? sb.y : B(sb)], [sx, ty], [tb.x, ty]];
    if (o.in || join) {
      const fromBelow = o.in ? o.in === 'bottom' : ty < sy;
      return [[R(sb), sy], [tx, sy], [tx, fromBelow ? B(tb) : tb.y]];
    }
    const mx = rnd((R(sb) + tb.x) / 2);
    return [[R(sb), sy], [mx, sy], [mx, ty], [tb.x, ty]];
  }
  // Rücksprung nach links in eine andere Zeile: außen herum
  const yv = ty > sy ? Math.max(B(sb), B(tb)) + 28 : Math.min(sb.y, tb.y) - 28;
  return ty > sy
    ? [[sx, B(sb)], [sx, yv], [tx, yv], [tx, B(tb)]]
    : [[sx, sb.y], [sx, yv], [tx, yv], [tx, tb.y]];
}

function labelLines(text, perLine) {
  return Math.max(1, Math.ceil(String(text).length / perLine));
}

function flowLabel(wp, name) {
  const lines = name.length > 16 ? 2 : 1;
  const w = Math.min(112, Math.max(24, rnd(name.length * 6.4 / lines) + 12));
  const h = lines === 2 ? 27 : 14;
  const [a, b] = wp;
  if (wp.length >= 3 && Math.abs(a[0] - b[0]) < 1 && Math.abs(wp[1][1] - wp[2][1]) < 1) {
    const c = wp[2];
    return { x: c[0] > b[0] ? b[0] + 8 : b[0] - w - 8, y: b[1] - h - 3, w, h };
  }
  if (Math.abs(a[1] - b[1]) < 1) return { x: b[0] > a[0] ? a[0] + 6 : a[0] - w - 6, y: a[1] - h - 3, w, h };
  return { x: a[0] + 6, y: rnd((a[1] + b[1]) / 2 - h / 2), w, h };
}

function nodeLabel(n, flows, N) {
  const b = n.b;
  if (!n.n || KIND[n.k].size === 'task') return null;
  if (isGw(n)) {
    const lines = labelLines(n.n, 16);
    const h = lines * 13 + 2, w = 96;
    let below = n.lp === 'below';
    if (!n.lp) below = flows.some(f => f.to === n.id && CY(N[f.from].b) < CY(b) - 1);
    return { x: rnd(CX(b) - 100), y: below ? B(b) + 4 : b.y - h - 4, w, h };
  }
  if (n.k === 'boundaryErr') return { x: b.x - 112, y: B(b) - 2, w: 108, h: 27 };
  const lines = labelLines(n.n, 20);
  const h = lines * 13 + 2;
  if (n.lp === 'above') return { x: rnd(CX(b) - 60), y: b.y - h - 5, w: 120, h };
  return { x: rnd(CX(b) - 60), y: B(b) + 5, w: 120, h };
}

/* ── Anmerkungen, Gruppen ─────────────────────────────────────────────── */

function placeAnnotation(a, host) {
  const w = a.w || 160, h = a.h || 56;
  a.b = { x: host.colLeft(a.c) + 10, y: rnd(host.rowTop(a, a.r) + (ROW_H - h) / 2), w, h };
}

function assocPath(nb, ab) {
  const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const ncx = CX(nb), ncy = CY(nb);
  if (ab.y >= B(nb)) return [[ncx, B(nb)], [cl(ncx, ab.x + 12, R(ab) - 12), ab.y]];
  if (B(ab) <= nb.y) return [[ncx, nb.y], [cl(ncx, ab.x + 12, R(ab) - 12), B(ab)]];
  if (ab.x >= R(nb)) return [[R(nb), ncy], [ab.x, cl(ncy, ab.y + 8, B(ab) - 8)]];
  return [[nb.x, ncy], [R(ab), cl(ncy, ab.y + 8, B(ab) - 8)]];
}

function groupBounds(g, byId) {
  const bs = g.members.map(id => {
    const o = byId[id];
    if (!o || !o.b) throw new Error(`Gruppe ${g.id}: Mitglied ${id} fehlt`);
    return o.b;
  });
  const x = Math.min(...bs.map(b => b.x)) - 18, y = Math.min(...bs.map(b => b.y)) - 24;
  const r = Math.max(...bs.map(R)) + 18, bo = Math.max(...bs.map(B)) + 16;
  return { x, y, w: r - x, h: bo - y };
}

/* ═════════════════════════════════════════════════════════════════════════
 *  XML
 * ═════════════════════════════════════════════════════════════════════════ */

const fmtB = b => `<dc:Bounds x="${rnd(b.x)}" y="${rnd(b.y)}" width="${rnd(b.w)}" height="${rnd(b.h)}" />`;
const fmtWp = wp => wp.map(([x, y]) => `<di:waypoint x="${rnd(x)}" y="${rnd(y)}" />`).join('');
const labelXml = lb => (lb ? `<bpmndi:BPMNLabel>${fmtB(lb)}</bpmndi:BPMNLabel>` : '');

function counts(flows) {
  const inCnt = {}, outCnt = {};
  for (const f of flows) {
    outCnt[f.from] = (outCnt[f.from] || 0) + 1;
    inCnt[f.to] = (inCnt[f.to] || 0) + 1;
  }
  return { inCnt, outCnt };
}

function flowId(f) { return `Flow_${f.from}_${f.to}`; }

/** Text der Dokumentation einer Aufrufaktivität, wie das RMS ihn schreibt:
 *  Klartextzeile plus Marker mit der Datei-Kennung im RMS. */
function callDoku(n, rms) {
  const ziel = BY_KEY[n.ref];
  if (!ziel) throw new Error(`Aufruf ${n.id}: Modell "${n.ref}" unbekannt`);
  const zeilen = ['Unterprozess: ' + ziel.name];
  const itemId = rms.modelle && rms.modelle[n.ref];
  if (itemId) zeilen.push(`[[rms:modell=${itemId}]]`);
  return zeilen.join('\n');
}

/** Semantik eines Knotens. */
function nodeSem(n, flows, rms) {
  const K = KIND[n.k];
  const attrs = [`id="${n.id}"`];
  if (n.n) attrs.push(`name="${esc(n.n)}"`);
  if (n.k === 'boundaryErr') attrs.push(`attachedToRef="${n.attachedTo}"`, 'cancelActivity="true"');
  if (n.k === 'call') attrs.push(`calledElement="${BY_KEY[n.ref].kennung}"`);
  let body = '';
  if (n.k === 'call') body += `<bpmn:documentation>${esc(callDoku(n, rms))}</bpmn:documentation>`;
  for (const f of flows) if (f.to === n.id) body += `<bpmn:incoming>${flowId(f)}</bpmn:incoming>`;
  for (const f of flows) if (f.from === n.id) body += `<bpmn:outgoing>${flowId(f)}</bpmn:outgoing>`;
  if (K.def === 'message') body += `<bpmn:messageEventDefinition id="${n.id}_def" />`;
  if (K.def === 'timer') body += `<bpmn:timerEventDefinition id="${n.id}_def" />`;
  if (K.def === 'error') body += `<bpmn:errorEventDefinition id="${n.id}_def" errorRef="Error_Pruefung" />`;
  return `      <bpmn:${K.tag} ${attrs.join(' ')}>${body}</bpmn:${K.tag}>\n`;
}

function flowsSem(flows) {
  return flows.map(f => `      <bpmn:sequenceFlow id="${flowId(f)}" sourceRef="${f.from}" targetRef="${f.to}"${f.name ? ` name="${esc(f.name)}"` : ''} />\n`).join('');
}

function artifactsSem(annotations, groups) {
  let x = '';
  for (const a of annotations || []) {
    x += `      <bpmn:textAnnotation id="${a.id}"><bpmn:text>${esc(a.text)}</bpmn:text></bpmn:textAnnotation>\n`;
    x += `      <bpmn:association id="Assoc_${a.id}" associationDirection="None" sourceRef="${a.of}" targetRef="${a.id}" />\n`;
  }
  for (const g of groups || []) x += `      <bpmn:group id="${g.id}" categoryValueRef="CV_${g.id}" />\n`;
  return x;
}

/* Verknüpfte Richtlinien im RMS, so geschrieben wie das RMS es selbst tut
   (Klartextzeile plus Marker [[rms:policies=…]]). */

/* Verknüpfte Richtlinien im RMS, so geschrieben wie das RMS es selbst tut
   (Klartextzeile plus Marker [[rms:policies=…]]). Ohne den Marker wäre die
   Verknüpfung beim nächsten Speichern im RMS verloren. */
function processDoku(spec) {
  const zeilen = [spec.doku];
  if (spec.von) zeilen.push(`Eingebunden in: ${BY_KEY[spec.von].name}.`);
  zeilen.push(`Anwender-Ansicht: ${ANSICHT}#${spec.tab}`);
  const ids = spec.policies || [];
  if (ids.length) {
    zeilen.push('Im Einklang mit den Richtlinien: ' + ids.map(i => POLICIES[i] || i).join('; '));
    zeilen.push(`[[rms:policies=${ids.join(',')}]]`);
  }
  return zeilen.join('\n');
}


/** DI-Formen und -Kanten für eine Menge Knoten/Flüsse/Anmerkungen. */
function planeDi(nodes, flows, N, annotations, groups, byId) {
  const { inCnt, outCnt } = counts(flows);
  let x = '';
  for (const n of nodes) {
    const c = colorOf(n, n.actor);
    const extra = isGw(n) ? ' isMarkerVisible="true"' : '';
    x += `      <bpmndi:BPMNShape id="${n.id}_di" bpmnElement="${n.id}"${extra}${colorAttrs(c)}>${fmtB(n.b)}${labelXml(nodeLabel(n, flows, N))}</bpmndi:BPMNShape>\n`;
  }
  for (const f of flows) {
    const wp = route(f, N, inCnt, outCnt);
    const lb = f.name ? flowLabel(wp, f.name) : null;
    x += `      <bpmndi:BPMNEdge id="${flowId(f)}_di" bpmnElement="${flowId(f)}">${fmtWp(wp)}${labelXml(lb)}</bpmndi:BPMNEdge>\n`;
  }
  for (const a of annotations || []) {
    const c = a.tone ? TONE[a.tone] : { fill: '#FFFFFF', stroke: '#6B7280' };
    x += `      <bpmndi:BPMNShape id="${a.id}_di" bpmnElement="${a.id}"${colorAttrs(c)}>${fmtB(a.b)}</bpmndi:BPMNShape>\n`;
    x += `      <bpmndi:BPMNEdge id="Assoc_${a.id}_di" bpmnElement="Assoc_${a.id}">${fmtWp(assocPath(N[a.of].b, a.b))}</bpmndi:BPMNEdge>\n`;
  }
  for (const g of groups || []) {
    const gb = groupBounds(g, byId);
    x += `      <bpmndi:BPMNShape id="${g.id}_di" bpmnElement="${g.id}" bioc:stroke="#17509E" color:border-color="#17509E">${fmtB(gb)}`
       + `${labelXml({ x: gb.x + 10, y: gb.y + 6, w: 260, h: 14 })}</bpmndi:BPMNShape>\n`;
  }
  return x;
}

function build(spec, rms) {
  const N = layoutMain(spec);
  const categories = [];
  let usesError = false;
  const inner = spec.pools.filter(p => !p.blackbox);
  if (inner.length !== 1) throw new Error(`${spec.key}: genau ein eigener Pool erwartet`);

  for (const p of inner) {
    checkOverlaps(p.nodes, `${spec.key}/${p.id}`);
    for (const a of p.annotations || []) placeAnnotation(a, p);
  }

  // Semantik
  let collab = `  <bpmn:collaboration id="Collab_${spec.key}">\n`;
  for (const p of spec.pools) {
    collab += p.blackbox
      ? `    <bpmn:participant id="${p.id}" name="${esc(p.name)}" />\n`
      : `    <bpmn:participant id="${p.id}" name="${esc(p.name)}" processRef="${spec.kennung}" />\n`;
  }
  for (const m of spec.messages) collab += `    <bpmn:messageFlow id="Msg_${m.from}_${m.to}" name="${esc(m.name)}" sourceRef="${m.from}" targetRef="${m.to}" />\n`;
  collab += '  </bpmn:collaboration>\n';

  let procs = '';
  for (const p of inner) {
    let x = `  <bpmn:process id="${spec.kennung}" name="${esc(spec.name)}" isExecutable="false">\n`;
    x += `    <bpmn:documentation>${esc(processDoku(spec))}</bpmn:documentation>\n`;
    x += `    <bpmn:laneSet id="LaneSet_${p.id}">\n`;
    for (const l of p.lanes) {
      x += `      <bpmn:lane id="${l.id}" name="${esc(l.name)}">`;
      for (const n of p.nodes.filter(n => n.lane === l.id)) x += `<bpmn:flowNodeRef>${n.id}</bpmn:flowNodeRef>`;
      x += '</bpmn:lane>\n';
    }
    x += '    </bpmn:laneSet>\n';
    for (const n of p.nodes) {
      if (KIND[n.k].def === 'error') usesError = true;
      x += nodeSem(n, p.flows, rms);
    }
    x += flowsSem(p.flows);
    x += artifactsSem(p.annotations, p.groups);
    for (const g of p.groups || []) categories.push(g);
    x += '  </bpmn:process>\n';
    procs += x;
  }

  // DI
  let di = `  <bpmndi:BPMNDiagram id="Diagram_${spec.key}">\n    <bpmndi:BPMNPlane id="Plane_${spec.key}" bpmnElement="Collab_${spec.key}">\n`;
  const byId = { ...N };
  for (const p of inner) for (const a of p.annotations || []) byId[a.id] = a;
  for (const p of spec.pools) {
    const a = ACTOR[p.actor] || null;
    const pc = p.blackbox ? { fill: a.lane, stroke: a.stroke } : { fill: '#FFFFFF', stroke: '#1A2644' };
    di += `      <bpmndi:BPMNShape id="${p.id}_di" bpmnElement="${p.id}" isHorizontal="true"${colorAttrs(pc)}>${fmtB(p)}</bpmndi:BPMNShape>\n`;
    for (const l of p.laneGeo) {
      const ac = ACTOR[l.actor];
      di += `      <bpmndi:BPMNShape id="${l.id}_di" bpmnElement="${l.id}" isHorizontal="true"${colorAttrs({ fill: ac.lane, stroke: ac.stroke })}>${fmtB(l)}</bpmndi:BPMNShape>\n`;
    }
  }
  for (const p of inner) di += planeDi(p.nodes, p.flows, N, p.annotations, p.groups, byId);
  // Nachrichtenflüsse: Knoten oder geschlossener Pool auf beiden Seiten
  const poolById = Object.fromEntries(spec.pools.map(p => [p.id, p]));
  for (const m of spec.messages) {
    const sPool = poolById[m.from], tPool = poolById[m.to];
    const sNode = N[m.from], tNode = N[m.to];
    let wp, lx, ly;
    if (sPool) {   // aus einem geschlossenen Pool auf einen Knoten
      const tb = tNode.b, tx = CX(tb);
      const down = tNode.pool.y > sPool.y;
      wp = [[tx, down ? sPool.y + sPool.h : sPool.y], [tx, down ? tb.y : B(tb)]];
      lx = tx + 8; ly = rnd((wp[0][1] + wp[1][1]) / 2 - 14);
    } else {
      const sb = sNode.b, sx = CX(sb) + (m.dx || 0), sp = sNode.pool;
      const tp = tPool || tNode.pool;
      const down = tp.y > sp.y;
      const gapMid = down ? (sp.y + sp.h + tp.y) / 2 : (tp.y + tp.h + sp.y) / 2;
      if (tPool) wp = [[sx, down ? B(sb) : sb.y], [sx, down ? tPool.y : tPool.y + tPool.h]];
      else {
        const tb = tNode.b, tx = CX(tb);
        const y1 = down ? B(sb) : sb.y, y2 = down ? tb.y : B(tb);
        wp = Math.abs(sx - tx) < 1 ? [[sx, y1], [tx, y2]] : [[sx, y1], [sx, gapMid], [tx, gapMid], [tx, y2]];
      }
      lx = sx + 8; ly = rnd(gapMid - 14);
    }
    di += `      <bpmndi:BPMNEdge id="Msg_${m.from}_${m.to}_di" bpmnElement="Msg_${m.from}_${m.to}">${fmtWp(wp)}${labelXml({ x: lx, y: ly, w: 170, h: 27 })}</bpmndi:BPMNEdge>\n`;
  }
  di += '    </bpmndi:BPMNPlane>\n  </bpmndi:BPMNDiagram>\n';

  let defs = '';
  if (usesError || inner.some(p => p.nodes.some(n => n.k === 'boundaryErr')))
    defs += '  <bpmn:error id="Error_Pruefung" name="Prüfung nicht bestanden" errorCode="PRUEFUNG" />\n';
  for (const g of categories) defs += `  <bpmn:category id="Cat_${g.id}"><bpmn:categoryValue id="CV_${g.id}" value="${esc(g.label)}" /></bpmn:category>\n`;

  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" '
    + 'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" '
    + 'xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" '
    + 'xmlns:color="http://www.omg.org/spec/BPMN/non-normative/color/1.0" '
    + `id="Definitions_${spec.key}" targetNamespace="https://crm.dihag.de/bpmn" `
    + 'exporter="DIHAG BPMN-Generator (scripts/bpmn/generate-bpmn.js)" exporterVersion="2.0">\n'
    + defs + collab + procs + di
    + '</bpmn:definitions>\n';
}


/* ── Ausgabe ──────────────────────────────────────────────────────────── */
if (require.main === module) {
  const outDir = path.join(__dirname, '..', '..', 'docs', 'bpmn');
  fs.mkdirSync(outDir, { recursive: true });
  let rms = {};
  try { rms = JSON.parse(fs.readFileSync(path.join(outDir, 'rms-ids.json'), 'utf8')); } catch (e) { /* noch kein Import */ }
  for (const spec of MODELLE) {
    const xml = build(spec, rms);
    fs.writeFileSync(path.join(outDir, spec.file), xml, 'utf8');
    console.log(`geschrieben: docs/bpmn/${spec.file} (${(xml.length / 1024).toFixed(1)} KB)`);
  }
  // Modell-Liste für prozess.html: welche Datei, welche Kennung, wo im RMS
  const liste = {
    hinweis: 'Erzeugt von scripts/bpmn/generate-bpmn.js. Führend sind die Modelle im RMS.',
    rms: { url: 'https://rms.dihag.de', ablage: rms.ablage || 'Prozesse/KONZERN', driveId: rms.driveId || '' },
    modelle: MODELLE.map(m => ({
      key: m.key, name: m.name, kennung: m.kennung, datei: 'docs/bpmn/' + m.file, tab: m.tab,
      haupt: !!m.haupt, von: m.von || '',
      unter: (m.pools.find(p => !p.blackbox).nodes || []).filter(n => n.k === 'call').map(n => n.ref),
      policies: m.policies || [],
      itemId: (rms.modelle && rms.modelle[m.key]) || '',
    })),
  };
  fs.writeFileSync(path.join(outDir, 'modelle.json'), JSON.stringify(liste, null, 2) + '\n', 'utf8');
  console.log('geschrieben: docs/bpmn/modelle.json');
}

module.exports = { MODELLE, build };
