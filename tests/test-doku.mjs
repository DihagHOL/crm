/* Die Prozessbeschreibung im Werkzeug.
   -------------------------------------
   Sie lag nur als docs/10-prozess.md im Repository - dort, wo die
   Fachabteilung nicht hinsieht. Jetzt liest der Reiter "Anleitung" die
   Datei zur Laufzeit; eine zweite Fassung im Code waere nach dem ersten
   Rundschreiben veraltet, ohne dass es jemand merkt.

   Geprueft wird zweierlei: dass der Darsteller kann, was die Datei
   benutzt - und dass die ECHTE Datei vollstaendig durchlaeuft. Ein
   Darsteller, der an Zeile 200 aufgibt, faellt sonst niemandem auf.    */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");

let fehler = 0;
const pruefe = (b, t) => { console.log(`  ${b ? "ok  " : "FEHL"}  ${t}`); if (!b) fehler++; };
const gleich = (a, b, t) => pruefe(JSON.stringify(a) === JSON.stringify(b),
  `${t}${JSON.stringify(a) === JSON.stringify(b) ? "" : `  (erwartet ${JSON.stringify(b)}, war ${JSON.stringify(a)})`}`);

const src = readFileSync(join(wurzel, "js/doku.js"), "utf8");
const DOKU = new Function("console", src + "; return DOKU;")(console);
const h = DOKU.zuHtml.bind(DOKU);

console.log("\nUeberschriften");
{
  pruefe(h("# Titel").includes("<h2>Titel</h2>"),
    "# wird h2 - h1 ist die Seitenueberschrift der App");
  pruefe(h("## Eins").includes("<h3>Eins</h3>"), "## wird h3");
  pruefe(h("### Zwei").includes("<h4>Zwei</h4>"), "### wird h4");
  pruefe(!h("#kein Titel").includes("<h"), "ohne Leerzeichen ist es keine Ueberschrift");
}

console.log("\nInline");
{
  pruefe(h("Das ist **wichtig**.").includes("<strong>wichtig</strong>"), "fett");
  pruefe(h("Feld `ownerid` da").includes("<code>ownerid</code>"), "Code");
  pruefe(h("[Anthropic](https://example.com/x)").includes('href="https://example.com/x"'),
    "echter Verweis wird verlinkt");
  pruefe(h("[docs](docs/02.md)").includes("<code>docs/02.md</code>"),
    "Verweis ins Repository bleibt lesbar, statt ins Leere zu fuehren");
}

console.log("\nHTML in der Datei wird nicht zu Markup");
{
  /* Die Datei ist vertrauenswuerdig, aber ein <script> aus einem
     kopierten Fehlertext waere trotzdem eine Luecke - und Fehlertexte
     stehen in dieser Doku reichlich. */
  const r = h("Ein <script>alert(1)</script> im Text");
  pruefe(!r.includes("<script>"), "kein ausfuehrbares Markup");
  pruefe(r.includes("&lt;script&gt;"), "sondern sichtbarer Text");
  pruefe(h("Wert `<b>x</b>`").includes("&lt;b&gt;"), "auch innerhalb von Code");
}

console.log("\nListen");
{
  const r = h("- eins\n- zwei");
  pruefe(r.includes("<ul>") && (r.match(/<li>/g) || []).length === 2, "zwei Punkte");
  const f = h("- ein sehr langer Punkt,\n  der umgebrochen ist\n- zweiter");
  pruefe(f.includes("<li>ein sehr langer Punkt, der umgebrochen ist</li>"),
    "Fortsetzungszeilen gehoeren zum Punkt, nicht in einen eigenen Absatz");
  pruefe(h("1. eins\n2. zwei").includes("<ol>"), "nummerierte Liste");
}

console.log("\nTabellen");
{
  const r = h("| A | B |\n|---|---|\n| 1 | 2 |");
  pruefe(r.includes("<th>A</th>") && r.includes("<td>2</td>"), "Kopf und Rumpf");
  pruefe(r.includes('class="tbl-wrap"'), "in einem Rahmen, der waagerecht rollen kann");
  // Ohne Trennzeile ist es keine Tabelle, sondern ein Absatz.
  pruefe(!h("| kein | Kopf |").includes("<table"), "ohne Trennzeile keine Tabelle");
}

console.log("\nTrennlinien und Absaetze");
{
  pruefe(h("---").includes("<hr>"), "drei Striche trennen");
  pruefe(!h("| A |\n|---|\n| 1 |").includes("<hr>"),
    "die Tabellentrennung wird nicht zur Trennlinie");
  const r = h("Erste Zeile\nzweite Zeile\n\nNeuer Absatz");
  gleich((r.match(/<p>/g) || []).length, 2, "Leerzeile trennt Absaetze, Zeilenumbruch nicht");
}

console.log("\nCodeblock");
{
  const r = h("Text\n\n```\nGET /x?$select=a\n```\n\nmehr");
  pruefe(r.includes("<pre><code>GET /x?$select=a</code></pre>"), "unveraendert");
  pruefe(!r.includes("<code>a</code>"), "innen wird nichts ausgezeichnet");
}

console.log("\nDie echte Prozessbeschreibung");
{
  const md = readFileSync(join(wurzel, "docs/10-prozess.md"), "utf8");
  const r = h(md);
  pruefe(r.length > 4000, "die Datei wird vollstaendig dargestellt");
  pruefe(r.includes("<h2>"), "hat eine Ueberschrift");
  pruefe(r.includes("<table"), "die Tabellen kommen an");
  pruefe(!/^\s*[#|-]/m.test(r.replace(/<[^>]+>/g, "")),
    "keine Markdown-Zeichen bleiben roh stehen");
  // Jede Ueberschrift der Datei muss auch im HTML auftauchen.
  const ueberschriften = md.split("\n").filter(z => /^#{1,4}\s/.test(z)).length;
  gleich((r.match(/<h[2-5]>/g) || []).length, ueberschriften,
    "jede Ueberschrift der Datei steht im Ergebnis");
}

console.log("\nLeeres und Kaputtes");
{
  gleich(h(""), "", "leerer Text ergibt leeres HTML");
  gleich(h(null), "", "null ebenso - der Reiter darf nicht abstuerzen");
  pruefe(typeof h("```\nnie geschlossen") === "string", "offener Codeblock haengt nicht");
}

console.log(fehler ? `\n${fehler} Pruefung(en) fehlgeschlagen.` : "\nAlle Pruefungen bestanden.");
process.exit(fehler ? 1 : 0);
