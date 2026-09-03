/* Aufbau der Nutzlast – die Stelle, an der aus einer Zeile ein CRM-Aufruf wird.
   ---------------------------------------------------------------------------
   Vier Regeln werden hier geprüft, weil ihr Bruch jeweils still Daten kostet:
   Schlüsselwerte nicht in den Rumpf (Review A1), Sonderzeichen in
   Schlüsseln (A2), die Schreibrichtlinie (B2) und „unverändert" als eigenes
   Ergebnis.                                                                */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");
const lies = f => readFileSync(join(wurzel, f), "utf8");

const g = { CRM_CONFIG: { listen: { werte: "CRM_ValueMappings" } }, console };
const MAPPING = new Function(...Object.keys(g),
  lies("js/transforms.js") + "\n" + lies("js/mapping.js") + "; return MAPPING;"
)(...Object.values(g));

let fehler = 0;
const pruefe = (b, t) => { console.log(`  ${b ? "ok  " : "FEHL"}  ${t}`); if (!b) fehler++; };
const gleich = (a, b, t) => pruefe(JSON.stringify(a) === JSON.stringify(b),
  `${t}${JSON.stringify(a) === JSON.stringify(b) ? "" : `  (erwartet ${JSON.stringify(b)}, war ${JSON.stringify(a)})`}`);

const z = o => ({ aktiv: true, writePolicy: "Always", targetType: "String", ...o });

console.log("\nSchlüsselwerte gehören nur in die URL (Review A1)");
{
  const r = MAPPING.baue({ _zeile: 2, "Opp-ID": 6440, Thema: "Konsole" }, [
    z({ sourceColumn: "Opp-ID", targetField: "new_dagextopid", targetType: "Int", istSchluessel: true }),
    z({ sourceColumn: "Thema", targetField: "name" })
  ]);
  gleich(r.schluessel, { new_dagextopid: 6440 }, "Schlüsselwert steht separat");
  gleich(r.nutzlast, { name: "Konsole" }, "und NICHT im Rumpf");
  gleich(MAPPING.schluesselAdresse("opportunities", r.schluessel),
    "opportunities(new_dagextopid=6440)", "Zahl ohne Anführungszeichen");
}
gleich(MAPPING.schluesselAdresse("contacts", { emailaddress1: "a@b.de" }),
  "contacts(emailaddress1='a%40b.de')", "Text mit Anführungszeichen und kodiert");

console.log("\nSonderzeichen im Schlüssel (Review A2)");
{
  const r = MAPPING.baue({ _zeile: 5, Mail: "name+kunde@firma.de" }, [
    z({ sourceColumn: "Mail", targetField: "emailaddress1", istSchluessel: true })
  ]);
  pruefe(r.fehler.length === 1 && /zerbricht/.test(r.fehler[0].meldung),
    "das + in einer gültigen E-Mail wird als Schlüssel beanstandet");
  gleich(r.fehler[0].zeile, 5, "die Meldung nennt die Excel-Zeilennummer");
}

console.log("\nSchreibrichtlinie (Review B2)");
{
  const zu = [
    z({ sourceColumn: "Thema", targetField: "name", writePolicy: "OnCreateOnly" }),
    z({ sourceColumn: "Umsatz", targetField: "estimatedvalue", targetType: "Decimal",
        transform: "decimal:de", writePolicy: "Always" }),
    z({ sourceColumn: "Ort", targetField: "address1_city", writePolicy: "OnlyIfEmpty" })
  ];
  const zeile = { _zeile: 3, Thema: "Neu", Umsatz: "1.500,50", Ort: "Herne" };

  const neu = MAPPING.baue(zeile, zu, { modus: "create" });
  gleich(Object.keys(neu.nutzlast).sort(), ["address1_city", "estimatedvalue", "name"],
    "beim Anlegen wird alles geschrieben");
  gleich(neu.nutzlast.estimatedvalue, 1500.5, "deutsche Zahl umgewandelt");

  const upd = MAPPING.baue(zeile, zu, { modus: "update",
    bestand: { name: "Im CRM gepflegt", address1_city: "Bochum", estimatedvalue: 1 } });
  gleich(Object.keys(upd.nutzlast), ["estimatedvalue"],
    "beim Aktualisieren: name bleibt (OnCreateOnly), Ort bleibt (schon befüllt)");

  const upd2 = MAPPING.baue(zeile, zu, { modus: "update",
    bestand: { name: "x", address1_city: null, estimatedvalue: 1 } });
  gleich(Object.keys(upd2.nutzlast).sort(), ["address1_city", "estimatedvalue"],
    "OnlyIfEmpty greift, wenn das CRM-Feld leer ist");
}

{
  // Ohne decimal:de ist "1.500,50" für Number() keine Zahl. Das MUSS
  // auffallen — eine still verschluckte Zahl wäre schlimmer als ein Fehler.
  const r = MAPPING.baue({ _zeile: 3, Umsatz: "1.500,50" }, [
    z({ sourceColumn: "Umsatz", targetField: "estimatedvalue", targetType: "Decimal" })
  ]);
  gleich(r.nutzlast, {}, "deutsche Zahl OHNE decimal:de wird nicht geschrieben");
  pruefe(r.fehler.length === 1 && /keine Zahl/.test(r.fehler[0].meldung),
    "sondern beanstandet – die fehlende Umwandlung fällt auf");
}

console.log("\nUnverändert ist ein eigenes Ergebnis");
{
  const zu = [z({ sourceColumn: "Umsatz", targetField: "estimatedvalue", targetType: "Decimal" })];
  const zeile = { _zeile: 4, Umsatz: 150000 };
  const a = MAPPING.baue(zeile, zu, { modus: "update", bestand: { estimatedvalue: 150000 } });
  pruefe(a.unveraendert === true, "gleicher Wert → unveraendert");
  const b = MAPPING.baue(zeile, zu, { modus: "update", bestand: { estimatedvalue: 149000 } });
  pruefe(b.unveraendert === false, "anderer Wert → nicht unveraendert");
  const c = MAPPING.baue(zeile, zu, { modus: "create" });
  pruefe(c.unveraendert === false, "ohne Bestand ist nichts unveraendert");
}

console.log("\nLookups");
{
  const r = MAPPING.baue({ _zeile: 2, Firma: 99900245 }, [
    z({ sourceColumn: "Firma", targetField: "parentaccountid", targetType: "Lookup",
        lookupEntitySet: "accounts", lookupKeyField: "dag_dihag_kdnr" })
  ]);
  gleich(r.nutzlast, { "parentaccountid@odata.bind": "/accounts(dag_dihag_kdnr=99900245)" },
    "Bindung über den Alternativschlüssel des Ziels");
}
{
  const r = MAPPING.baue({ _zeile: 2, U: "3f3e410f-8b65-ed11-9561-000d3ab37c09" }, [
    z({ sourceColumn: "U", targetField: "ownerid", targetType: "Lookup",
        lookupEntitySet: "systemusers", lookupKeyField: "internalemailaddress" })
  ]);
  gleich(r.nutzlast["ownerid@odata.bind"], "/systemusers(3f3e410f-8b65-ed11-9561-000d3ab37c09)",
    "eine GUID wird direkt gebunden, nicht als Schlüsselwert");
}

console.log("\nValidierung");
{
  const r = MAPPING.baue({ _zeile: 7, Nr: "" }, [
    z({ sourceColumn: "Nr", targetField: "name", pflicht: true })
  ]);
  pruefe(r.fehler.length === 1 && /Pflichtfeld/.test(r.fehler[0].meldung), "leeres Pflichtfeld");
}
{
  const r = MAPPING.baue({ _zeile: 8, Z: "abc" }, [
    z({ sourceColumn: "Z", targetField: "closeprobability", targetType: "Int" })
  ]);
  pruefe(r.fehler.length === 1 && /keine Zahl/.test(r.fehler[0].meldung), "Text in einem Zahlenfeld");
}
{
  const r = MAPPING.baue({ _zeile: 9, T: "x".repeat(40) }, [
    z({ sourceColumn: "T", targetField: "name", maxLength: 20 })
  ]);
  pruefe(r.fehler.length === 1 && /lehnt den Datensatz ab/.test(r.fehler[0].meldung),
    "zu langer Text wird vorher beanstandet, nicht von Dataverse abgewiesen");
}
{
  const r = MAPPING.baue({ _zeile: 9, X: "a" }, [
    z({ sourceColumn: "X", targetField: "name", transform: "trim|gibtsnicht" })
  ]);
  pruefe(r.warnungen.length === 1 && /Tippfehler/.test(r.warnungen[0].meldung),
    "unbekannte Umwandlung ist eine Warnung, kein Abbruch");
}
{
  const r = MAPPING.baue({ _zeile: 9, S: "Win" }, [
    z({ sourceColumn: "S", targetField: "KLAEREN", aktiv: false })
  ]);
  gleich(r.nutzlast, {}, "inaktive und KLAEREN-Zuordnungen werden übergangen");
}

console.log("\nVerweis, den es nicht gibt");
{
  /* Im echten Lauf kostete ein unaufloesbarer Verweis 29 vollstaendige
     Verkaufschancen: gebunden wurde auf /tabelle(feld='wert'), und weil die
     Zieltabelle keinen Alternativschluessel auf dem Feld hat, wies Dataverse
     die ganze Zeile ab (0x80060888). Jetzt kostet er ein Feld. */
  const zu = [
    { aktiv: true, sourceColumn: "Pruefung", targetField: "cr570_technicalaudit_lookup",
      targetType: "Lookup", lookupEntitySet: "cr570_technicalaudit_lookups",
      lookupKeyField: "cr570_newcolumn", writePolicy: "Always" },
    { aktiv: true, sourceColumn: "Thema", targetField: "name",
      targetType: "String", writePolicy: "Always" }
  ];
  const zeile = { _zeile: 2, Pruefung: "gibt es nicht", Thema: "Anfrage" };

  // aufloesen liefert null = abgefragt und nicht vorhanden
  const r = MAPPING.baue(zeile, zu, { modus: "create", aufloesen: () => null });
  pruefe(!Object.keys(r.nutzlast).some(k => k.includes("odata.bind")),
    "das Verweisfeld wird nicht gebunden");
  gleich(r.nutzlast.name, "Anfrage", "der Rest der Zeile wird geschrieben");
  gleich(r.fehler.length, 0, "und das ist kein Fehler");
  pruefe(r.warnungen.some(w => /gibt es in cr570_technicalaudit_lookups nicht/.test(w.meldung)),
    "sondern eine Warnung, die den Wert und die Tabelle nennt");
}
{
  // Pflichtfeld bleibt ein Fehler - eine Zeile ohne Pflichtverweis ist
  // keine halbe Zeile, sondern eine falsche.
  const zu = [{ aktiv: true, sourceColumn: "Firma", targetField: "parentaccountid",
    targetType: "Lookup", lookupEntitySet: "accounts", lookupKeyField: "dag_dihag_kdnr",
    pflicht: true, writePolicy: "Always" }];
  const r = MAPPING.baue({ _zeile: 2, Firma: "99999999" }, zu,
    { modus: "create", aufloesen: () => null });
  gleich(r.fehler.length, 1, "Pflichtverweis ohne Ziel ist ein Fehler");
}
{
  // Keine Auskunft (undefined) heisst: nicht abgefragt. Dann bleibt der
  // bisherige Weg ueber den Alternativschluessel.
  const zu = [{ aktiv: true, sourceColumn: "Firma", targetField: "parentaccountid",
    targetType: "Lookup", lookupEntitySet: "accounts", lookupKeyField: "dag_dihag_kdnr",
    writePolicy: "Always" }];
  const r = MAPPING.baue({ _zeile: 2, Firma: "10042" }, zu, { modus: "create" });
  gleich(r.nutzlast["parentaccountid@odata.bind"], "/accounts(dag_dihag_kdnr=10042)",
    "ohne Auskunft wird ueber den Alternativschluessel gebunden");
}

console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen.\n` : "\nAlle Prüfungen bestanden.\n");
process.exit(fehler ? 1 : 0);
