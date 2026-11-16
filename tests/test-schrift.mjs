/**
 * Schrift: Kommt Exo aus dem eigenen Repository, und geht kein Abruf mehr an Google?
 *
 * Anlass (16.11.2026): Die Schrift kam von Google Fonts, jeder Aufruf übertrug
 * damit die IP-Adresse an Google. Seitdem liegt sie im Repository (assets/fonts,
 * SIL Open Font License). Der Test braucht kein Netz und keine Pakete.
 *
 *   node tests/test-schrift.mjs
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lies = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const gibt = (p) => fs.existsSync(path.join(ROOT, p));

/* Was für diese Anwendung gilt */
const K = {
  seiten: ['index.html', 'prozess.html'],
  schrift: { name: 'Exo', css: 'css/styles.css' },
};

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

/* Getrackte Dateien: Was lokal nur herumliegt (node_modules, Notizen), zählt nicht. */
let dateien;
try {
  dateien = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
} catch (e) {
  dateien = [];
  const lauf = (d) => {
    for (const n of fs.readdirSync(path.join(ROOT, d))) {
      if (n === '.git' || n === 'node_modules') continue;
      const p = d ? d + '/' + n : n;
      if (fs.statSync(path.join(ROOT, p)).isDirectory()) lauf(p); else dateien.push(p);
    }
  };
  lauf('');
}
dateien = dateien.filter(gibt);

/* 1. Schrift */
if (K.schrift) {
  const quelle = lies(K.schrift.css);
  const bloecke = [...quelle.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => m[1]).filter(b => b.includes("'" + K.schrift.name + "'"));
  ok(bloecke.length === 2, `${K.schrift.name} ist in ${K.schrift.css} erklärt: Latein und erweitertes Latein`);
  ok(bloecke.every(b => /font-weight:\s*100 900/.test(b) && /font-display:\s*swap/.test(b) && /unicode-range:/.test(b)),
    'Eine Datei je Zeichensatz deckt alle Strichstärken ab, Text steht sofort da');
  const ziele = bloecke.map(b => (b.match(/url\('([^']+)'\)/) || [])[1] || '');
  ok(ziele.length > 0 && ziele.every(z => z && !/^(https?:)?\/\//.test(z)), 'Die Dateien liegen im eigenen Repository');
  for (const z of ziele) {
    const p = path.posix.normalize(path.posix.join(path.posix.dirname(K.schrift.css), z));
    ok(gibt(p) && fs.readFileSync(path.join(ROOT, p)).subarray(0, 4).toString('latin1') === 'wOF2', `${p} ist da und eine WOFF2-Datei`);
  }
  ok(gibt('assets/fonts/OFL.txt') && /SIL Open Font License/i.test(lies('assets/fonts/OFL.txt')), 'Die Lizenz liegt bei den Dateien, wie sie es verlangt');
  for (const seite of K.seiten) {
    const html = lies(seite);
    const hinweis = (html.match(/<link rel="preload" as="font"[^>]*>/) || [])[0] || '';
    const ziel = (hinweis.match(/href="([^"]+)"/) || [])[1] || '';
    ok(/type="font\/woff2"/.test(hinweis) && /\bcrossorigin\b/.test(hinweis) && ziel && gibt(path.posix.join(path.posix.dirname(seite), ziel)),
      `${seite}: die Schrift wird vorgeladen, mit crossorigin (sonst lädt der Browser sie doppelt)`);
  }
}
const mitGoogle = dateien.filter(p => /\.(html|css|js|mjs)$/.test(p) && !p.startsWith('tests/') && !/(^|\/)vendor\//.test(p) && /fonts\.(googleapis|gstatic)\.com/.test(lies(p)));
ok(mitGoogle.length === 0, 'Keine Seite, kein Skript und kein Stylesheet lädt von Google Fonts' + (mitGoogle.length ? ': ' + mitGoogle.join(', ') : ''));

/* 2. Vorlade-Hinweise: nur für Seiten mit der Sicherheitsrichtlinie im Kopf */
for (const seite of K.vorladen || []) {
  const html = lies(seite);
  const csp = html.indexOf('<meta http-equiv="Content-Security-Policy"');
  const ersterSkript = html.search(/<script\s+[^>]*src=/);
  const hinweise = [...html.matchAll(/<link rel="(preload|modulepreload)"(?: as="(script|style)")? href="([^"]+)"[^>]*>/g)]
    .map(m => ({ art: m[1] === 'modulepreload' ? 'script' : m[2], ziel: m[3], ort: m.index }));
  const skripte = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]).filter(z => !/^https?:/.test(z));
  const stile = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]).filter(z => !/^https?:/.test(z));
  ok(csp >= 0, `${seite}: die Sicherheitsrichtlinie steht im Kopf`);
  const ohne = skripte.filter(z => !hinweise.some(h => h.art === 'script' && h.ziel === z))
    .concat(stile.filter(z => !hinweise.some(h => h.art === 'style' && h.ziel === z)));
  ok(skripte.length > 0 && ohne.length === 0,
    `${seite}: jedes Skript und jedes Stylesheet hat seinen Hinweis, Adresse aufs Zeichen gleich` + (ohne.length ? ', es fehlt: ' + ohne.join(', ') : ''));
  // Module: Ihre Importe findet der Browser erst, wenn das importierende Modul geladen ist.
  // Ohne Hinweis lädt er die Kette Stufe für Stufe. Dynamische Importe zählen nicht, die sollen spät laden.
  const ort = (ziel) => path.posix.normalize(path.posix.join(path.posix.dirname(seite), ziel.split('?')[0]));
  const huelle = new Set();
  const folge = (p) => {
    if (huelle.has(p) || !gibt(p)) return;
    huelle.add(p);
    for (const m of lies(p).matchAll(/\b(?:from|import)\s*['"](\.{1,2}\/[^'"]+)['"]/g)) folge(path.posix.normalize(path.posix.join(path.posix.dirname(p), m[1])));
  };
  const einstiege = [...html.matchAll(/<script\b[^>]*type="module"[^>]*\bsrc="([^"]+)"/g)].map(m => ort(m[1]));
  einstiege.forEach(folge);
  const importiert = [...huelle].filter(p => !einstiege.includes(p));
  const ohneModul = importiert.filter(p => !hinweise.some(h => h.art === 'script' && ort(h.ziel) === p));
  if (einstiege.length) ok(ohneModul.length === 0, `${seite}: jedes importierte Modul hat seinen Hinweis (${importiert.length} Module)` + (ohneModul.length ? ', es fehlt: ' + ohneModul.join(', ') : ''));
  const verwaist = hinweise.filter(h => !(h.art === 'script' ? skripte : stile).includes(h.ziel) && !importiert.includes(ort(h.ziel))).map(h => h.ziel);
  ok(verwaist.length === 0, `${seite}: kein Hinweis ohne Tag (der Browser lüde sonst umsonst)` + (verwaist.length ? ': ' + verwaist.join(', ') : ''));
  ok(hinweise.length > 0 && hinweise.every(h => h.ort > csp && h.ort < ersterSkript), `${seite}: die Hinweise stehen hinter der Richtlinie und vor dem ersten Skript`);
}

/* 3. Veröffentlichung */
if (K.workflow) {
  const wf = lies(K.workflow).replace(/\r/g, '');
  const job = wf.slice(wf.indexOf('\n  veroeffentlichen:'));
  ok(job.length > 100 && job.includes('needs: ' + K.pruefJob + '\n'), 'Veröffentlicht wird erst nach grüner Prüfung');
  ok(job.includes("if: github.event_name != 'pull_request' && github.ref == 'refs/heads/" + K.zweig + "'"), `und nur für ${K.zweig}, nie aus einem Pull Request`);
  ok(/\n    permissions:\n      contents: read\n      pages: write\n      id-token: write\n/.test(job) && /\npermissions:\n  contents: read\n/.test(wf),
    'Veröffentlichen darf nur dieser eine Job, alles andere liest nur');
  const laeufe = dateien.filter(p => p.startsWith('.github/workflows/')).map(p => lies(p));
  ok(!laeufe.some(t => /git (commit|push|add)\b/.test(t) || /contents:\s*write/.test(t)), 'Kein Lauf schreibt ins Repository zurück: kein Bot-Commit, kein Schreibrecht');
  const kopiert = ((job.match(/cp -r ([^\n]+) _site\//) || [])[1] || '').trim().split(/\s+/).filter(Boolean);
  ok(kopiert.length > 0 && kopiert.every(p => gibt(p)), 'Alles, was der Lauf hochlädt, gibt es: ' + kopiert.join(' '));
  if (K.version) ok(job.indexOf('sed -i') > 0 && job.indexOf('sed -i') < job.indexOf('cp -r '), 'Erst die Version setzen, dann zusammenstellen');

  const online = (p) => kopiert.some(k => p === k || p.startsWith(k + '/'));
  // Was die Seiten einbinden, muss in dem liegen, was hochgeladen wird.
  const eingebunden = [];
  for (const seite of dateien.filter(p => p.endsWith('.html') && online(p))) {
    for (const m of lies(seite).matchAll(/(?:src|href)="([^"#?]+)(?:\?[^"]*)?"/g)) {
      if (/^(https?:|data:|mailto:|tel:|#|\/\/)/.test(m[1]) || /[${}+' ]/.test(m[1]) || !/\.[a-z0-9]+$/i.test(m[1])) continue;
      eingebunden.push(path.posix.normalize(path.posix.join(path.posix.dirname(seite), m[1])));
    }
  }
  const draussen = [...new Set(eingebunden)].filter(p => !online(p) && !(K.fremdEingebunden || []).includes(p));
  ok(eingebunden.length > 0 && draussen.length === 0, 'Jede eingebundene Datei liegt in dem, was hochgeladen wird' + (draussen.length ? ', es fehlt: ' + draussen.join(', ') : ''));

  const oben = [...new Set(dateien.map(p => p.split('/')[0]))].filter(n => !n.startsWith('.'));
  const nichtOnline = oben.filter(n => !kopiert.includes(n)).sort();
  ok(nichtOnline.join(' ') === K.nichtOnline.slice().sort().join(' '),
    'Was im Repository liegt und nicht online steht, ist bekannt. Ein neuer Ordner fällt hier auf: ' + nichtOnline.join(' '));
  // Kein veröffentlichtes Skript darf etwas brauchen, das nicht online steht.
  const texte = dateien.filter(p => online(p) && /\.(html|js|mjs|css|json)$/.test(p) && !/(^|\/)vendor\//.test(p));
  const gebraucht = [];
  for (const n of nichtOnline) {
    const istOrdner = dateien.some(p => p.startsWith(n + '/'));
    // Gesucht wird die Schreibweise eines Abrufs (Pfad in Anführungszeichen), nicht die Erwähnung im Kommentar.
    const muster = istOrdner
      ? ["'" + n + '/', '"' + n + '/', '`' + n + '/', "'./" + n + '/', '"./' + n + '/']
      : ["'" + n + "'", '"' + n + '"', "'./" + n + "'", '"./' + n + '"'];
    for (const t of texte) if (muster.some(x => lies(t).includes(x))) gebraucht.push(t + ' braucht ' + n);
  }
  ok(gebraucht.length === 0, 'Nichts Veröffentlichtes verweist auf etwas, das nicht online steht' + (gebraucht.length ? ': ' + gebraucht.join(', ') : ''));
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} grün, ${fail} rot`);
process.exit(fail ? 1 : 0);
