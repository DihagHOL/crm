"use strict";

/* Die Prozessbeschreibung im Werkzeug selbst.

   Sie lag bisher nur als `docs/10-prozess.md` im Repository – also genau
   dort, wo die Fachabteilung nicht hinsieht. Wer den Import ausführt, hat
   die App offen, nicht GitHub.

   Gelesen wird die Datei zur Laufzeit, nicht in den Code kopiert. Eine
   zweite Fassung wäre nach dem ersten Rundschreiben veraltet, und niemand
   merkte es: Doku, die von der Wahrheit abweicht, ist schlimmer als keine.

   Der Darsteller kann genau so viel Markdown, wie die Datei benutzt –
   Überschriften, Listen, Tabellen, Trennlinien, Codeblöcke und die drei
   Inline-Formen. Eine Bibliothek nachzuladen wäre eine Abhängigkeit für
   265 Zeilen Text, und CSP-seitig wäre sie eine Frage mehr.               */

const DOKU = (() => {

  const esc = s => String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  /** Inline-Auszeichnung. Erst escapen, dann auszeichnen – umgekehrt
   *  entstünde aus `<b>` in der Datei echtes Markup. */
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, ziel) =>
        /^https?:\/\//.test(ziel)
          ? `<a href="${esc(ziel)}" target="_blank" rel="noopener">${text}</a>`
          // Verweise auf Dateien im Repository fuehren aus der App heraus
          // ins Leere. Der Pfad bleibt lesbar, der Link entfaellt.
          : `${text} (<code>${esc(ziel)}</code>)`);
  }

  const zellen = z => z
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map(s => s.trim());

  const istListe = z => /^\s*[-*+]\s+/.test(z);
  const istNummer = z => /^\s*[0-9]+\.\s+/.test(z);

  /** Markdown zu HTML. Kennt nur, was `docs/10-prozess.md` benutzt.
   *  @param {string} md
   *  @returns {string} */
  function zuHtml(md) {
    const zeilen = String(md == null ? "" : md).replace(/\r/g, "").split("\n");
    const aus = [];
    let absatz = [];
    let i = 0;

    const absatzSchliessen = () => {
      if (absatz.length) aus.push(`<p>${inline(absatz.join(" "))}</p>`);
      absatz = [];
    };

    while (i < zeilen.length) {
      const z = zeilen[i];

      if (!z.trim()) { absatzSchliessen(); i++; continue; }

      // Codeblock – Inhalt bleibt unangetastet
      if (/^\s*```/.test(z)) {
        absatzSchliessen();
        const inhalt = [];
        i++;
        while (i < zeilen.length && !/^\s*```/.test(zeilen[i])) inhalt.push(zeilen[i++]);
        i++;
        aus.push(`<pre><code>${esc(inhalt.join("\n"))}</code></pre>`);
        continue;
      }

      // Trennlinie. Die Tabellentrennung faengt mit | an und faellt nicht
      // hierher.
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(z)) {
        absatzSchliessen(); aus.push("<hr>"); i++; continue;
      }

      // Ueberschrift. `#` wird h2: h1 ist die Seitenueberschrift der App,
      // und zwei h1 auf einer Seite lesen sich fuer Screenreader falsch.
      const h = /^(#{1,4})\s+(.+?)\s*$/.exec(z);
      if (h) {
        absatzSchliessen();
        const stufe = Math.min(h[1].length + 1, 5);
        aus.push(`<h${stufe}>${inline(h[2])}</h${stufe}>`);
        i++; continue;
      }

      // Tabelle – nur mit Trennzeile, sonst ist es ein Absatz mit Strichen
      if (/^\s*\|/.test(z) && i + 1 < zeilen.length
          && /^\s*\|[\s:|-]+\|\s*$/.test(zeilen[i + 1])) {
        absatzSchliessen();
        const kopf = zellen(z);
        i += 2;
        const rumpf = [];
        while (i < zeilen.length && /^\s*\|/.test(zeilen[i])) rumpf.push(zellen(zeilen[i++]));
        aus.push('<div class="tbl-wrap"><table class="tbl">'
          + `<thead><tr>${kopf.map(c => `<th>${inline(c)}</th>`).join("")}</tr></thead>`
          + `<tbody>${rumpf.map(r =>
              `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody>`
          + "</table></div>");
        continue;
      }

      // Liste, mit Fortsetzungszeilen: Markdown bricht Punkte um, und ohne
      // diesen Zweig wuerde aus jeder Folgezeile ein eigener Absatz.
      if (istListe(z) || istNummer(z)) {
        absatzSchliessen();
        const nummeriert = istNummer(z);
        const punkte = [];
        while (i < zeilen.length) {
          const y = zeilen[i];
          if (istListe(y) || istNummer(y)) {
            punkte.push(y.replace(/^\s*(?:[-*+]|[0-9]+\.)\s+/, ""));
          } else if (punkte.length && /^\s+\S/.test(y)) {
            punkte[punkte.length - 1] += " " + y.trim();
          } else break;
          i++;
        }
        const t = nummeriert ? "ol" : "ul";
        aus.push(`<${t}>${punkte.map(p => `<li>${inline(p)}</li>`).join("")}</${t}>`);
        continue;
      }

      // Zitat
      if (/^\s*>\s?/.test(z)) {
        absatzSchliessen();
        const inhalt = [];
        while (i < zeilen.length && /^\s*>\s?/.test(zeilen[i]))
          inhalt.push(zeilen[i++].replace(/^\s*>\s?/, ""));
        aus.push(`<blockquote>${inline(inhalt.join(" "))}</blockquote>`);
        continue;
      }

      absatz.push(z.trim());
      i++;
    }

    absatzSchliessen();
    return aus.join("\n");
  }

  /** Die Datei holen. Ein Fehlschlag ist kein Grund, die App zu stoeren –
   *  er ist eine Meldung, die den Pfad nennt. */
  async function laden(pfad = "docs/10-prozess.md") {
    const a = await fetch(pfad, { cache: "no-cache" });
    if (!a.ok) throw new Error(`${pfad} liess sich nicht laden (HTTP ${a.status}).`);
    return a.text();
  }

  return { zuHtml, laden };
})();
