# ══════════════════════════════════════════════════════════════════════
#  Einrichtung „DIHAG CRM Schnittstelle"
#    1. Quellbibliothek um die vier Statusspalten ergaenzen
#    2. Konfigurationssite pruefen (optional anlegen)
#    3. Die fuenf CRM_*-Listen samt Spalten anlegen
#    4. Haupt-Administrator in AppPermissions eintragen
#
#  Das Skript ist wiederholbar: Vorhandenes wird erkannt und nicht
#  angefasst, Fehlendes ergaenzt.
#
#  VORAUSSETZUNG
#      Install-Module Microsoft.Graph.Authentication -Scope CurrentUser
#      Connect-MgGraph -Scopes "Sites.Manage.All","Sites.ReadWrite.All"
#      ./setup-crm.ps1
#
#  Es reicht das TEILMODUL Microsoft.Graph.Authentication (wenige MB) -
#  das Skript benutzt nur Invoke-MgGraphRequest. Das Gesamtpaket
#  Microsoft.Graph laedt rund 500 MB und wird nicht gebraucht.
#
#  Group.ReadWrite.All wird nur fuer -SiteAnlegen gebraucht.
#
#  NICHT geeignet: der Token der Azure CLI. Er traegt keinen Sites.*-Scope,
#  und Microsoft hat die CLI dafuer nicht vorautorisiert (AADSTS65002).
#  Lesen und Gruppen anlegen geht damit, Listen anlegen nicht. Details in
#  docs/02.
#
#  ACHTUNG: Das Anlegen von Listen scheitert mit 403, wenn das angemeldete
#  Konto auf der Site keinen Vollzugriff hat - SharePoint-Berechtigungen
#  gelten hier genauso wie im Browser.
# ══════════════════════════════════════════════════════════════════════

param(
    # Quellbibliothek – dort legt Timeline die Mappen ab
    [string] $QuellSite   = "dihag.sharepoint.com:/sites/IT",
    [string] $QuellDrive  = "Austausch",

    # Konfigurationssite – Steuerung und Protokoll.
    # /teams/, nicht /sites/: der Tenant legt gruppenverbundene Sites unter
    # dem verwalteten Pfad /teams/ ab und benutzt den mailNickname der
    # Gruppe, nicht ihren Anzeigenamen.
    [string] $KonfigSite  = "dihag.sharepoint.com:/teams/crm-integration",

    # Rechteliste
    [string] $PermSite    = "dihag.sharepoint.com:/sites/IT",
    [string] $PermList    = "AppPermissions",
    [string] $HauptAdmin  = "administrator@dihag.com",
    [string] $AppKey      = "crm",

    # Legt die Konfigurationssite als Microsoft-365-Gruppe an, falls sie
    # fehlt. Erzeugt damit auch eine Gruppe samt Postfach – deshalb nicht
    # der Standard.
    [switch] $SiteAnlegen,

    # Fuellt CRM_ImportProfiles und CRM_FieldMappings aus
    # config/import-profile.dihag.json. Wiederholbar: bestehende Zeilen des
    # Profils werden vorher entfernt, damit kein Mischstand entsteht.
    [switch] $ProfilLaden,
    [string] $ProfilDatei = "config/import-profile.dihag.json",

    [switch] $NurPruefen,

    # Graph-Token statt Connect-MgGraph. Damit laeuft das Skript ohne das
    # Modul Microsoft.Graph (rund 500 MB), etwa mit der Azure CLI:
    #   $t = az account get-access-token --resource https://graph.microsoft.com `
    #        --query accessToken -o tsv
    #   ./setup-crm.ps1 -AccessToken $t
    [string] $AccessToken
)

$ErrorActionPreference = "Stop"
$g = "https://graph.microsoft.com/v1.0"

function Gx {
    param([string]$Method = "GET", [string]$Uri, $Body)

    if ($AccessToken) {
        $h = @{ Authorization = "Bearer $AccessToken" }
        if ($null -ne $Body) {
            return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $h `
                -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 8)
        }
        return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $h
    }

    if ($null -ne $Body) {
        return Invoke-MgGraphRequest -Method $Method -Uri $Uri `
            -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 8)
    }
    return Invoke-MgGraphRequest -Method $Method -Uri $Uri
}

function Info($t) { Write-Host $t -ForegroundColor Green }
function Warn($t) { Write-Host $t -ForegroundColor Yellow }
function Fehl($t) { Write-Host $t -ForegroundColor Red }

Write-Host "=== CRM-Schnittstelle - Einrichtung ===" -ForegroundColor Cyan
if ($NurPruefen) { Warn "Nur-Pruefen-Modus: es wird nichts angelegt." }

# ── Spaltenanlage, gemeinsam genutzt ──────────────────────────────────
# SharePoint friert den internen Namen beim Anlegen ein. Deshalb werden
# die Spalten technisch benannt (SourceColumn, TargetField, ...) und die
# Anzeige bleibt gleich - sonst entsteht "Quell_x0020_Spalte" und jede
# API-Abfrage wird unlesbar.

function Ensure-Columns($siteId, $listName, $defs) {
    # Im Nur-Pruefen-Modus existiert die Liste womoeglich noch gar nicht.
    # Dann sind auch ihre Spalten nicht zu pruefen - und ein 404 hier waere
    # ein Abbruch mitten im Bericht, statt einer Zeile darin.
    try {
        $cols = (Gx -Uri "$g/sites/$siteId/lists/$listName/columns?`$top=200").value
    } catch {
        Warn "    [$listName] Liste nicht vorhanden - Spalten nicht geprueft."
        return
    }
    $vorhanden = @($cols | ForEach-Object { $_.name })
    foreach ($d in $defs) {
        if ($vorhanden -contains $d.name) { continue }
        if ($NurPruefen) { Warn "    [$listName] Spalte '$($d.name)' FEHLT"; continue }
        $body = @{ name = $d.name; displayName = $d.name }
        switch ($d.kind) {
            "note"     { $body["text"]        = @{ allowMultipleLines = $true; textType = "plain" } }
            "dateTime" { $body["dateTime"]    = @{ format = "dateTime" } }
            "person"   { $body["personOrGroup"] = @{ } }
            "choice"   { $body["choice"]      = @{ choices = $d.choices; displayAs = "dropDownMenu" } }
            default    { $body[$d.kind]       = @{ } }
        }
        try {
            Gx -Method POST -Uri "$g/sites/$siteId/lists/$listName/columns" -Body $body | Out-Null
            Info "    [$listName] Spalte '$($d.name)' angelegt"
        } catch {
            Fehl "    [$listName] Spalte '$($d.name)': $($_.Exception.Message)"
        }
    }
}

function Ensure-List($siteId, $name) {
    try {
        $l = Gx -Uri "$g/sites/$siteId/lists/$name"
        Info "  Liste '$name' vorhanden."
        return $l.id
    } catch {
        if ($NurPruefen) { Warn "  Liste '$name' FEHLT"; return $null }
        try {
            $l = Gx -Method POST -Uri "$g/sites/$siteId/lists" `
                    -Body @{ displayName = $name; list = @{ template = "genericList" } }
            Info "  Liste '$name' angelegt."
            return $l.id
        } catch {
            $msg = $_.Exception.Message
            Fehl "  Liste '$name' KONNTE NICHT angelegt werden: $msg"
            if ($msg -match "403|denied|Forbidden") {
                Fehl "  -> Dieses Konto darf auf der Site keine Listen anlegen."
                Fehl "     Als Websitebesitzer oder SharePoint-Administrator anmelden."
            }
            throw
        }
    }
}

# ══ 1 · Quellbibliothek ═══════════════════════════════════════════════
# Vier Spalten, damit der Ordner selbstdokumentierend wird und ein
# versehentlicher Doppelimport VOR dem Start auffaellt statt danach.

Write-Host "`n[1] Quellbibliothek '$QuellDrive' auf $QuellSite" -ForegroundColor Yellow
try {
    $qsite = Gx -Uri "$g/sites/$QuellSite"
    $listen = (Gx -Uri "$g/sites/$($qsite.id)/lists?`$expand=drive&`$top=100").value
    $bib = $listen | Where-Object { $_.displayName -eq $QuellDrive -or $_.name -eq $QuellDrive }

    if (-not $bib) {
        Fehl "  Bibliothek '$QuellDrive' nicht gefunden."
        Warn "  Vorhanden: $(($listen | Where-Object { $_.list.template -eq 'documentLibrary' } | ForEach-Object { $_.displayName }) -join ', ')"
    } else {
        Info "  Bibliothek gefunden: $($bib.displayName)"
        Ensure-Columns $qsite.id $bib.displayName @(
            @{ name = "ImportStatus"; kind = "choice"
               choices = @("Neu","Geprueft","Importiert","Fehlgeschlagen") },
            @{ name = "ImportRunId";  kind = "text"     },
            @{ name = "ImportedAt";   kind = "dateTime" },
            @{ name = "ImportedBy";   kind = "person"   }
        )
    }
} catch {
    Fehl "  Schritt 1 fehlgeschlagen: $($_.Exception.Message)"
}

# ══ 2 · Konfigurationssite ════════════════════════════════════════════

Write-Host "`n[2] Konfigurationssite $KonfigSite" -ForegroundColor Yellow
$ksite = $null
try {
    $ksite = Gx -Uri "$g/sites/$KonfigSite"
    Info "  Site vorhanden: $($ksite.webUrl)"
} catch {
    Warn "  Site existiert nicht."
    if (-not $SiteAnlegen) {
        Warn "  Zwei Moeglichkeiten:"
        Warn "    a) Mit -SiteAnlegen erneut starten. Legt eine private"
        Warn "       Microsoft-365-Gruppe 'CRM-Integration' an; die Site"
        Warn "       entsteht daraus. Braucht Group.ReadWrite.All."
        Warn "    b) Site von Hand anlegen (SharePoint: Website erstellen,"
        Warn "       Teamwebsite, Name 'CRM-Integration'), dann dieses"
        Warn "       Skript erneut starten."
        Warn "    c) Die Listen stattdessen auf /sites/IT legen:"
        Warn "       -KonfigSite 'dihag.sharepoint.com:/sites/IT'"
        Warn "       Dann liegen Quelldaten und Steuerung aber im selben Topf"
        Warn "       und lassen sich nicht getrennt berechtigen."
        Write-Host "`n  Schritt 3 wird uebersprungen." -ForegroundColor Yellow
    } elseif ($NurPruefen) {
        Warn "  Nur-Pruefen-Modus: Site wuerde angelegt."
    } else {
        $nick = "crm-integration"
        Write-Host "  Lege Microsoft-365-Gruppe '$nick' an ..."
        $grp = Gx -Method POST -Uri "$g/groups" -Body @{
            displayName     = "CRM-Integration"
            mailNickname    = $nick
            description     = "Steuerung und Protokoll der CRM-Schnittstelle"
            groupTypes      = @("Unified")
            mailEnabled     = $true
            securityEnabled = $false
            visibility      = "Private"
        }
        Info "  Gruppe angelegt: $($grp.id)"
        Write-Host "  Warte auf die Bereitstellung der Site (bis 3 Minuten) ..."
        $ksite = $null
        for ($i = 0; $i -lt 36; $i++) {
            Start-Sleep -Seconds 5
            try { $ksite = Gx -Uri "$g/groups/$($grp.id)/sites/root"; break } catch { }
        }
        if ($ksite) {
            Info "  Site bereit: $($ksite.webUrl)"
            Warn "  Bitte $KonfigSite in js/config.js gegen die tatsaechliche"
            Warn "  Adresse pruefen: $($ksite.webUrl)"
        } else {
            Fehl "  Site wurde nicht rechtzeitig bereitgestellt."
            Fehl "  Skript in ein paar Minuten erneut starten - die Gruppe steht bereits."
        }
    }
}

# ══ 3 · Die fuenf CRM_*-Listen ════════════════════════════════════════

if ($ksite) {
    $sid = $ksite.id
    Write-Host "`n[3] Konfigurations- und Protokolllisten" -ForegroundColor Yellow

    # ── Was in welcher Reihenfolge importiert wird. Das Herzstueck. ──
    Ensure-List $sid "CRM_ImportProfiles" | Out-Null
    Ensure-Columns $sid "CRM_ImportProfiles" @(
        @{ name = "Step";             kind = "number"  },   # Title = Profilname
        @{ name = "EntitySet";        kind = "text"    },
        @{ name = "SourceSheet";      kind = "text"    },
        @{ name = "MappingKey";       kind = "text"    },
        # Die letzten beiden Werte stehen nicht in docs/02: SetStage und
        # CloseOpportunity kamen erst mit Review A4/A5 dazu. Ohne sie liesse
        # sich import-profile.dihag.json nicht eintragen.
        @{ name = "Mode";             kind = "choice"
           choices = @("Upsert","Create","Update","LookupOnly","ReplaceByParent",
                       "CreateIfMissing","SetStage","CloseOpportunity") },
        @{ name = "OnMissingKey";     kind = "choice"; choices = @("Fail","Skip") },
        @{ name = "ParentField";      kind = "text"    },
        @{ name = "ReplaceScope";     kind = "choice"; choices = @("SourceParentsOnly","All") },
        @{ name = "AlternateKey";     kind = "text"    },
        @{ name = "BatchSize";        kind = "number"  },
        @{ name = "SecondPass";       kind = "boolean" },
        @{ name = "SecondPassFields"; kind = "text"    },
        @{ name = "StopOnError";      kind = "boolean" },
        @{ name = "SkipIfClosed";     kind = "boolean" },   # Review A3
        # Zeilen, die dieser Schritt auslassen soll - als JSON, etwa
        # {"Kontaktemail":["dummy@dihag.com"]}. Die Sammeladresse soll
        # keinen Kontakt erzeugen (docs/06); ohne diese Spalte legt der
        # Import sie an wie jede andere.
        @{ name = "SkipOnValues";     kind = "note"    },
        @{ name = "Active";           kind = "boolean" }
    )

    # ── Excel-Spalte -> Dataverse-Feld ──────────────────────────────
    Ensure-List $sid "CRM_FieldMappings" | Out-Null
    Ensure-Columns $sid "CRM_FieldMappings" @(
        @{ name = "MappingKey";       kind = "text"    },   # Title = Bezeichnung
        @{ name = "SourceColumn";     kind = "text"    },
        @{ name = "SourceSheet";      kind = "text"    },   # abweichendes Blatt
        @{ name = "SourceLookupBy";   kind = "text"    },   # Verknuepfung, z. B. Opp-ID
        @{ name = "TargetField";      kind = "text"    },
        @{ name = "TargetType";       kind = "choice"
           choices = @("String","Int","Decimal","Money","Boolean","DateTime",
                       "OptionSet","Lookup","Action") },
        @{ name = "IsKey";            kind = "boolean" },
        @{ name = "Required";         kind = "boolean" },
        @{ name = "LookupEntitySet";  kind = "text"    },
        @{ name = "LookupKeyField";   kind = "text"    },
        @{ name = "LookupTypeColumn"; kind = "text"    },
        @{ name = "OnLookupFail";     kind = "choice"
           choices = @("Fail","WarnAndSkipField") },
        # Ohne WritePolicy ist der Import kein Abgleich, sondern ein
        # Ueberschreiben der CRM-Pflege (Review B2).
        @{ name = "WritePolicy";      kind = "choice"
           choices = @("Always","OnCreateOnly","OnlyIfEmpty") },
        @{ name = "Transform";        kind = "note"    },
        @{ name = "DefaultValue";     kind = "text"    },
        @{ name = "MaxLength";        kind = "number"  },
        @{ name = "SortOrder";        kind = "number"  },
        @{ name = "Active";           kind = "boolean" }
    )

    # ── Auswahlwerte: "Deutschland" -> 100000001 ────────────────────
    Ensure-List $sid "CRM_ValueMappings" | Out-Null
    Ensure-Columns $sid "CRM_ValueMappings" @(
        @{ name = "MappingKey";  kind = "text"    },        # Title = Bezeichnung
        @{ name = "TargetField"; kind = "text"    },
        @{ name = "SourceValue"; kind = "text"    },
        @{ name = "TargetValue"; kind = "text"    },
        @{ name = "IsDefault";   kind = "boolean" },
        @{ name = "Active";      kind = "boolean" }
    )

    # ── Das Protokoll. Wird von der App geschrieben. ────────────────
    Ensure-List $sid "CRM_ImportRuns" | Out-Null
    Ensure-Columns $sid "CRM_ImportRuns" @(
        @{ name = "ProfileName";      kind = "text"     },  # Title = Lauf-ID (GUID)
        @{ name = "SourceFile";       kind = "text"     },
        # Beantwortet "wurde genau diese Datei schon importiert" zuverlaessig.
        # Der Dateiname tut das nicht.
        @{ name = "SourceFileHash";   kind = "text"     },
        @{ name = "EnvironmentLabel"; kind = "choice"; choices = @("TEST","PROD") },
        @{ name = "StartedAt";        kind = "dateTime" },
        @{ name = "FinishedAt";       kind = "dateTime" },
        @{ name = "StartedBy";        kind = "person"   },
        @{ name = "Status";           kind = "choice"
           choices = @("Laeuft","Erfolgreich","MitFehlern","Fehlgeschlagen","Abgebrochen") },
        @{ name = "IsDryRun";         kind = "boolean"  },
        @{ name = "TotalRows";        kind = "number"   },
        @{ name = "CreatedCount";     kind = "number"   },
        @{ name = "UpdatedCount";     kind = "number"   },
        @{ name = "UnchangedCount";   kind = "number"   },
        @{ name = "SkippedCount";     kind = "number"   },
        @{ name = "FailedCount";      kind = "number"   },
        @{ name = "DurationSeconds";  kind = "number"   },
        @{ name = "StepSummary";      kind = "note"     }
    )

    # ── Fehler auf Zeilenebene, damit die Fachabteilung nachbessert ──
    Ensure-List $sid "CRM_ImportErrors" | Out-Null
    Ensure-Columns $sid "CRM_ImportErrors" @(
        # RowNumber ist die Zeilennummer WIE IN EXCEL SICHTBAR, inklusive
        # Kopfzeile - nicht der nullbasierte Index. Der Fachanwender soll
        # die Zeile aufschlagen koennen, ohne zu rechnen.
        @{ name = "RowNumber";    kind = "number" },        # Title = Lauf-ID
        @{ name = "SheetName";    kind = "text"   },
        @{ name = "EntitySet";    kind = "text"   },
        @{ name = "SourceKey";    kind = "text"   },
        @{ name = "ErrorType";    kind = "choice"
           choices = @("Validierung","Lookup","Berechtigung","Dublette","API","Throttling") },
        @{ name = "HttpStatus";   kind = "number" },
        @{ name = "ErrorCode";    kind = "text"   },
        @{ name = "ErrorMessage"; kind = "note"   },
        @{ name = "FieldName";    kind = "text"   },
        @{ name = "SourceValue";  kind = "text"   },
        @{ name = "Resolved";     kind = "boolean" }
    )

    Write-Host ""
    Write-Host "  Einmalig von Hand, falls noch nicht geschehen: in CRM_ImportRuns die"
    Write-Host "  ANLAGEN aktivieren (Listeneinstellungen > Erweitert). Dort landet das"
    Write-Host "  Vollprotokoll als JSON - ein Textfeld reicht dafuer nicht, und ueber"
    Write-Host "  Graph laesst sich der Schalter nicht setzen."
}

# ══ 3b · Importprofil in die Listen schreiben ═════════════════════════
# Die Zuordnung steht fertig in config/import-profile.dihag.json - abgeleitet
# aus dem Flow-Export, durch die Reviews korrigiert und am 02.09.2026 gegen
# die Dataverse-Metadaten geprueft. Von Hand abzutippen waere eine Stunde
# Klickarbeit mit Tippfehlerrisiko in genau den Feldnamen, auf die es ankommt.

if ($ProfilLaden -and $ksite) {
    Write-Host "`n[3b] Importprofil laden aus $ProfilDatei" -ForegroundColor Yellow
    $sid = $ksite.id

    if (-not (Test-Path $ProfilDatei)) {
        Fehl "  Datei nicht gefunden: $ProfilDatei"
    } else {
        $prof = Get-Content $ProfilDatei -Raw -Encoding UTF8 | ConvertFrom-Json
        $name = $prof.profileName
        Info "  Profil: $name"

        # Wert oder Vorgabe. ConvertFrom-Json liefert fuer fehlende
        # Eigenschaften $null - das soll nicht als leerer String landen.
        function W($obj, $feld, $vorgabe = $null) {
            $v = $obj.PSObject.Properties[$feld]
            if ($null -eq $v -or $null -eq $v.Value) { return $vorgabe }
            return $v.Value
        }

        function Zeilen-Loeschen($liste, $spalte, $werte) {
            $items = (Gx -Uri "$g/sites/$sid/lists/$liste/items?`$expand=fields&`$top=999").value
            $weg = @($items | Where-Object { $werte -contains $_.fields.$spalte })
            foreach ($i in $weg) {
                Gx -Method DELETE -Uri "$g/sites/$sid/lists/$liste/items/$($i.id)" | Out-Null
            }
            if ($weg.Count) { Write-Host "    $liste`: $($weg.Count) alte Zeile(n) entfernt" }
        }

        $keys = @($prof.mappings.PSObject.Properties.Name)

        if ($NurPruefen) {
            $anz = ($keys | ForEach-Object { $prof.mappings.$_.Count } | Measure-Object -Sum).Sum
            Warn "  Nur-Pruefen-Modus: es wuerden $($prof.steps.Count) Schritte und $anz Zuordnungen geschrieben."
        } else {
            # ── Schritte ────────────────────────────────────────────────
            Zeilen-Loeschen "CRM_ImportProfiles" "Title" @($name)
            foreach ($s in $prof.steps) {
                $body = @{
                    Title        = $name
                    Step         = $s.Step
                    EntitySet    = $s.EntitySet
                    Mode         = $s.Mode
                    OnMissingKey = W $s "OnMissingKey" "Fail"
                    BatchSize    = W $s "BatchSize" 100
                    StopOnError  = [bool](W $s "StopOnError" $false)
                    SkipIfClosed = [bool](W $s "SkipIfClosed" $false)
                    Active       = [bool](W $s "Active" $true)
                }
                # Optionale Felder nur senden, wenn sie einen Wert haben.
                # SharePoint legte sonst Leerstrings an, und "" ist etwas
                # anderes als "nicht gesetzt".
                foreach ($k in @("SourceSheet","MappingKey","AlternateKey",
                                 "ParentField","ReplaceScope")) {
                    $v = W $s $k
                    if ($null -ne $v) { $body[$k] = $v }
                }
                # SkipOnValues ist ein Objekt und wandert als JSON-Text in
                # die Liste - eine Spalte je Quellspalte waere nicht
                # pflegbar.
                $sov = W $s "SkipOnValues"
                if ($null -ne $sov) { $body["SkipOnValues"] = ($sov | ConvertTo-Json -Compress -Depth 5) }
                Gx -Method POST -Uri "$g/sites/$sid/lists/CRM_ImportProfiles/items" `
                   -Body @{ fields = $body } | Out-Null
                Info "    Schritt $($s.Step) $($s.EntitySet) ($($s.Mode))"
            }

            # ── Feldzuordnungen ─────────────────────────────────────────
            Zeilen-Loeschen "CRM_FieldMappings" "MappingKey" $keys
            foreach ($mk in $keys) {
                $n = 0
                foreach ($m in $prof.mappings.$mk) {
                    $body = @{
                        Title      = "$(W $m "SourceColumn" (W $m "TargetField" "?"))"
                        MappingKey = $mk
                        SortOrder  = W $m "SortOrder" 0
                        # KLAEREN-Ziele werden bewusst MIT geschrieben, aber
                        # inaktiv: sichtbar offen ist besser als unsichtbar
                        # weggelassen.
                        Active     = [bool](W $m "Active" $true) -and
                                     -not ("$(W $m "TargetField")" -like "KLAEREN*")
                    }
                    foreach ($k in @("SourceColumn","SourceSheet","SourceLookupBy","TargetField",
                                     "TargetType","LookupEntitySet","LookupKeyField",
                                     "OnLookupFail","WritePolicy","Transform","DefaultValue")) {
                        $v = W $m $k
                        if ($null -ne $v) { $body[$k] = $v }
                    }
                    foreach ($k in @("IsKey","Required")) {
                        $v = W $m $k
                        if ($null -ne $v) { $body[$k] = [bool]$v }
                    }
                    $ml = W $m "MaxLength"
                    if ($null -ne $ml) { $body["MaxLength"] = $ml }

                    Gx -Method POST -Uri "$g/sites/$sid/lists/CRM_FieldMappings/items" `
                       -Body @{ fields = $body } | Out-Null
                    $n++
                }
                Info "    $mk`: $n Zuordnung(en)"
            }

            # ── Wertzuordnungen ─────────────────────────────────────────
            # Quellwert -> Zielwert, bevor der Verweis aufgeloest wird.
            # "Energieerzeugung" -> "50 Energieerzeugung", "Ja" -> "Yes".
            # Ohne diesen Block blieb CRM_ValueMappings leer, obwohl das
            # Profil die Zuordnungen mitbringt.
            if ($prof.valueMappings) {
                Zeilen-Loeschen "CRM_ValueMappings" "MappingKey" $keys
                $w = 0
                foreach ($mk in $prof.valueMappings.PSObject.Properties.Name) {
                    foreach ($tf in $prof.valueMappings.$mk.PSObject.Properties.Name) {
                        foreach ($sv in $prof.valueMappings.$mk.$tf.PSObject.Properties.Name) {
                            Gx -Method POST -Uri "$g/sites/$sid/lists/CRM_ValueMappings/items" `
                               -Body @{ fields = @{
                                   Title       = "$mk / $tf"
                                   MappingKey  = $mk
                                   TargetField = $tf
                                   SourceValue = $sv
                                   TargetValue = "$($prof.valueMappings.$mk.$tf.$sv)"
                                   IsDefault   = $false
                                   Active      = $true
                               } } | Out-Null
                            $w++
                        }
                    }
                }
                Info "    CRM_ValueMappings: $w Wertzuordnung(en)"
            }

            Write-Host ""
            Warn "  Inaktiv geschrieben, weil das Zielfeld fachlich offen ist:"
            foreach ($mk in $keys) {
                foreach ($m in $prof.mappings.$mk) {
                    if ("$(W $m "TargetField")" -like "KLAEREN*") {
                        Warn "    $mk / $(W $m "SourceColumn")"
                    }
                }
            }
        }
    }
} elseif ($ProfilLaden) {
    Warn "`n[3b] Importprofil nicht geladen - die Konfigurationssite fehlt."
}

# ══ 4 · Haupt-Administrator in AppPermissions ═════════════════════════

Write-Host "`n[4] Rechteliste $PermList auf $PermSite" -ForegroundColor Yellow
try {
    $psite = Gx -Uri "$g/sites/$PermSite"
    $items = (Gx -Uri "$g/sites/$($psite.id)/lists/$PermList/items?`$expand=fields&`$top=999").value
    $treffer = $items | Where-Object {
        $_.fields.UserEmail -eq $HauptAdmin -and ($_.fields.App -eq $AppKey -or $_.fields.App -eq "*")
    }
    if ($treffer) {
        Info "  Eintrag fuer $HauptAdmin / $AppKey vorhanden (Rolle: $($treffer[0].fields.Role))."
    } elseif ($NurPruefen) {
        Warn "  Eintrag fuer $HauptAdmin / $AppKey FEHLT"
    } else {
        Gx -Method POST -Uri "$g/sites/$($psite.id)/lists/$PermList/items" -Body @{
            fields = @{
                Title    = $HauptAdmin
                UserEmail = $HauptAdmin
                App      = $AppKey
                Role     = "admin"
                Notes    = "Angelegt durch setup-crm.ps1 am $(Get-Date -Format 'yyyy-MM-dd')"
            }
        } | Out-Null
        Info "  Eintrag fuer $HauptAdmin angelegt (Rolle admin)."
    }
} catch {
    Fehl "  $PermList nicht erreichbar: $($_.Exception.Message)"
}

Write-Host "`n=== Fertig ===" -ForegroundColor Cyan
Write-Host "Naechster Schritt: https://crm.dihag.de/ aufrufen, der Selbsttest"
Write-Host "auf der Startseite zeigt, was noch fehlt."
