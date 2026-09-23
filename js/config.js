"use strict";

/* Zentrale Konfiguration – DIHAG CRM Schnittstelle
   ------------------------------------------------
   Die einzige Stelle, an der IDs, Pfade und Listennamen angepasst werden.
   Werte mit dem Präfix KLAEREN_ sind die offenen Punkte aus CLAUDE.md §13.
   Sie dürfen NICHT geraten werden – die App prüft darauf und sagt es. */

const CRM_CONFIG = {

  /* ── Entra ID / Anmeldung ──────────────────────────────────────────
     Eigene Registrierung „DIHAG CRM Schnittstelle“ – bewusst NICHT die der
     ZAPP-App, die andere Apps mitbenutzen. Nur diese hat die Berechtigung
     Dynamics CRM user_impersonation.
     Unter „Authentifizierung → Single-Page-Anwendung“ muss eingetragen sein:
       https://crm.dihag.de/
     Plattformtyp SPA ist zwingend: unter „Web“ lehnt der Token-Endpunkt die
     Anfrage aus dem Browser mit einem CORS-Fehler ab, dessen Meldung nicht
     dorthin zeigt (docs/01 §1, docs/08 §4).                            */

  tenantId: "fdb70646-023a-403b-a4b9-1f474a935123",
  clientId: "b6078457-e2ab-41e7-91a1-b49dfaf9d532",

  /* ── Dataverse ─────────────────────────────────────────────────────
     Organisations-URL der TESTUMGEBUNG – dieselbe, in der auch der Altflow
     arbeitet. Beim Produktivgang ist das der einzige Wert, der sich ändert
     (vorausgesetzt, es bleibt bei Namen statt GUIDs, siehe unten).       */

  dataverseUrl: "https://dihag-test.crm4.dynamics.com",
  apiVersion:   "v9.2",

  // Wird dauerhaft als Band im Kopf angezeigt. "PROD" erscheint rot.
  // Niemand soll versehentlich ins Produktivsystem importieren, weil beide
  // Umgebungen gleich aussehen (CLAUDE.md §5).
  umgebung: "TEST",

  /* ── SharePoint: Quelldateien ──────────────────────────────────────
     Über Namen aufgelöst, nie über GUIDs. Der Altflow verdrahtet die
     Bibliotheks-GUID 6fcaa8c8-… fest und muss deshalb beim Umzug Test →
     Produktion von Hand nachgezogen werden (Befund B9).

     Bestätigt am 02.09.2026: „Austausch“ ist eine eigene Dokumentbibliothek,
     „Projekt CRM-Timeline“ ein Ordner darin, in den Timeline die Mappen
     legt. Die Startseite prüft beides und meldet, wenn es abweicht.      */

  quellSite:   "dihag.sharepoint.com:/sites/IT",
  quellDrive:  "Austausch",
  quellOrdner: "/Projekt CRM-Timeline",

  /* ── SharePoint: Steuerung und Protokoll ───────────────────────────
     Eigene Site, getrennt von /sites/IT: die Fachabteilung legt Dateien ab,
     ändert aber keine Feldzuordnungen (docs/02, Schritt 0).
     Existiert noch nicht – die App läuft trotzdem und meldet es.        */

  // Achtung auf den Pfad: Der Tenant legt gruppenverbundene Sites unter
  // /teams/ ab, nicht unter /sites/ – und benutzt dafür den mailNickname
  // der Gruppe, nicht den Anzeigenamen. Angelegt am 02.09.2026.
  konfigSite: "dihag.sharepoint.com:/teams/crm-integration",
  listen: {
    profile:  "CRM_ImportProfiles",
    mappings: "CRM_FieldMappings",
    werte:    "CRM_ValueMappings",
    laeufe:   "CRM_ImportRuns",
    fehler:   "CRM_ImportErrors",
    // Steuerung des unbeaufsichtigten Laufs. Takt, Zeitfenster und
    // Schalter stehen hier und nicht im Repository: wer den Takt ändert,
    // soll das im Werkzeug tun und nicht einen Pull Request aufmachen.
    automatik: "CRM_Automatik",
    freigaben: "CRM_Freigaben"
  },

  /* ── Zugriffssteuerung ─────────────────────────────────────────────
     Zentrale Liste AppPermissions auf /sites/IT, wie in rundumdenjob,
     powerbi und umfrage1. Ein Eintrag mit App = "*" gilt app-übergreifend,
     App = "crm" nur hier.                                              */

  permSite: "dihag.sharepoint.com:/sites/IT",
  permList: "AppPermissions",
  appKey:   "crm",

  // Abweichend von rundumdenjob (dort "viewer"): KEINE Standardrolle.
  // Wer nicht in AppPermissions steht, sieht den Kein-Zugriff-Schirm. Ein
  // Werkzeug, das ins CRM schreibt, ist kein Portal.
  defaultRole: "none",

  // Immer Rolle „admin“, unabhängig von AppPermissions. Hält die App
  // administrierbar, solange in der Rechteliste noch kein Eintrag für „crm“
  // existiert – ohne diese Zeile wäre beim ersten Aufruf niemand drin.
  hauptAdmins: ["administrator@dihag.com", "fedorov@dihag.com"],

  /* ── Laufzeit ──────────────────────────────────────────────────────
     Grenzen laut CLAUDE.md §7: 6.000 Anfragen und 1.200 s Ausführungszeit
     je Benutzer im gleitenden 300-Sekunden-Fenster. Große Stapel sind
     nicht schneller – kleine Stapel mit maßvoller Parallelität sind der
     von Microsoft empfohlene Weg.                                       */

  batchSize:   100,
  maxParallel: 4,
  suppressDuplicateDetection: true,

  /* ── Scopes ────────────────────────────────────────────────────────
     Ein Access-Token gilt immer für genau EINE Ressource. Deshalb zwei
     getrennte Sätze; js/auth.js meldet einmal mit „graph“ an und löst den
     Refresh-Token danach für „dataverse“ ein (docs/08 §4).
     Der Dataverse-Scope wird aus dataverseUrl gebildet, nicht hier
     eingetragen – sonst stünde die Organisations-URL an zwei Stellen.    */

  scopes: ["User.Read", "Sites.ReadWrite.All"],

  /* ── Sonstiges ─────────────────────────────────────────────────────  */

  itMail: "ticket@dihag.com",
  adminUrl: "https://dfedorov12.github.io/admin/"
};

/** Wert noch nicht geklärt? Alle Stellen, die einen KLAEREN_-Wert benutzen
 *  wollen, fragen darüber ab – statt mit einer unverständlichen Meldung aus
 *  Graph oder Dataverse zu scheitern. */
const istOffen = v => typeof v === "string" && v.startsWith("KLAEREN");
