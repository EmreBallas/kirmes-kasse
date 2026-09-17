# setup-laptop.ps1 - Einrichtung des Kassen-Laptops fuer die Vereins-Kasse, als Administrator ausfuehren.
#
# Schritte:
#   1. USB-Druckerport ermitteln, Treiber "Generic / Text Only" sicherstellen (Add-PrinterDriver) und Warteschlange
#      "TM-T20II" (RAW) anlegen, falls sie fehlt. Ist stattdessen der Epson-Treiber (APD) installiert, gibt es keinen
#      USB*-Port, sondern eine Warteschlange wie "EPSON TM-T20 Receipt" auf ESDPRT001: dann wird keine zweite
#      Warteschlange angelegt, sondern ihr Name genannt; er wird in der Kasse unter Einstellungen > Drucker gewaehlt.
#   2. Energieoptionen: Bildschirm/Standby/Ruhezustand nie, selektives USB-Energiesparen aus (docs/drucker-setup.md, Abschnitt 5)
#   3. Autostart: Verknuepfung C:\Kasse\Kasse.exe in shell:startup
#   4. Windows-Update 7 Tage pausieren (Registry-Weg wie die Einstellungen-App)
#   5. Kontrollausgabe inkl. Liste aller vorhandenen Warteschlangen (Name, Port, Treiber)
#
# Aufruf:  powershell -NoProfile -ExecutionPolicy Bypass -File setup-laptop.ps1 [-Drucker TM-T20II] [-Port USB001] [-KasseOrdner C:\Kasse] [-PauseTage 7]
# Manuell danach: Geraete-Manager -> USB-Root-Hubs -> Energieverwaltung "Computer kann das Geraet ausschalten" abwaehlen;
# Energieoptionen -> Zuklappen = "Nichts unternehmen"; Auto-Login oder Windows-Passwort aufs Notfallblatt.

param(
  [string]$Drucker = 'TM-T20II',
  [string]$Port = '',
  [string]$KasseOrdner = 'C:\Kasse',
  [int]$PauseTage = 7
)

$ErrorActionPreference = 'Continue'
$fehler = @()
$hinweise = @()
$generischerTreiber = 'Generic / Text Only'

function Schritt([string]$text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }
function Ok([string]$text) { Write-Host "   OK  $text" -ForegroundColor Green }
function Warnung([string]$text) { Write-Host "   !!  $text" -ForegroundColor Yellow; $script:fehler += $text }
function Hinweis([string]$text) { Write-Host "   ->  $text" -ForegroundColor White; $script:hinweise += $text }

# Warteschlangen, die zu einem Epson-Bondrucker gehoeren (Name oder Treiber enthaelt "TM-T" oder "EPSON TM").
# Typisch nach Installation des Epson-Treibers (APD): "EPSON TM-T20 Receipt" auf Port ESDPRT001, kein USB*-Port.
function EpsonWarteschlangen() {
  @(Get-Printer -ErrorAction SilentlyContinue | Where-Object {
      $_.Name -match 'TM-T|EPSON TM' -or $_.DriverName -match 'TM-T|EPSON TM'
    })
}

# ---------------------------------------------------------------- 0. Adminrechte
$istAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $istAdmin) {
  Write-Host "Bitte PowerShell als Administrator starten (Rechtsklick -> Als Administrator ausfuehren)." -ForegroundColor Red
  exit 1
}

# ---------------------------------------------------------------- 1. Drucker
Schritt "Drucker-Warteschlange '$Drucker'"
$vorhanden = Get-Printer -Name $Drucker -ErrorAction SilentlyContinue
if ($null -ne $vorhanden) {
  Ok "Warteschlange vorhanden: Treiber '$($vorhanden.DriverName)', Port '$($vorhanden.PortName)'"
} else {
  if ($Port -eq '') {
    $usbPorts = @(Get-PrinterPort | Where-Object { $_.Name -like 'USB*' } | Select-Object -ExpandProperty Name | Sort-Object)
    if ($usbPorts.Count -eq 0) {
      $epson = EpsonWarteschlangen
      if ($epson.Count -gt 0) {
        # Epson-Treiber installiert: der Drucker haengt am Epson-Port (ESDPRTxxx), es gibt keinen USB*-Port.
        # Die Kasse druckt rohe ESC/POS-Bytes ueber die Windows-Warteschlange; das funktioniert auch mit dem Epson-Treiber.
        # Deshalb keine zweite Warteschlange anlegen, sondern die vorhandene in der Kasse auswaehlen.
        Ok "Epson-Treiber ist installiert, Warteschlange vorhanden (kein USB*-Port noetig):"
        foreach ($q in $epson) {
          Write-Host ("       '{0}'  (Port {1}, Treiber {2})" -f $q.Name, $q.PortName, $q.DriverName) -ForegroundColor Green
        }
        $namen = ($epson | ForEach-Object { "'" + $_.Name + "'" }) -join ', '
        Hinweis "Keine neue Warteschlange angelegt. In der Kasse unter Einstellungen > Drucker den Drucker $namen aus der Liste auswaehlen (die Kasse bietet die installierten Drucker an und schlaegt ihn selbst vor), dann Testdruck."
      } else {
        Warnung "Kein USB-Druckerport gefunden. Drucker einschalten, per USB anschliessen, dann Skript erneut ausfuehren (oder -Port angeben)."
      }
    } elseif ($usbPorts.Count -eq 1) {
      $Port = $usbPorts[0]
      Ok "USB-Port ermittelt: $Port"
    } else {
      $Port = $usbPorts[-1]
      Warnung "Mehrere USB-Ports gefunden ($($usbPorts -join ', ')); verwende $Port. Bei Bedarf mit -Port korrigieren."
    }
  }
  if ($Port -ne '') {
    # Auf einem frischen Windows ist der Treiber zwar mitgeliefert, aber noch nicht im Druckertreiber-Speicher eingetragen;
    # Add-Printer scheitert dann mit "Der angegebene Treiber ist nicht vorhanden". Deshalb zuerst Add-PrinterDriver.
    $treiberOk = $true
    if (-not (Get-PrinterDriver -Name $generischerTreiber -ErrorAction SilentlyContinue)) {
      try {
        Add-PrinterDriver -Name $generischerTreiber -ErrorAction Stop
        Ok "Treiber '$generischerTreiber' installiert (Add-PrinterDriver)"
      } catch {
        $treiberOk = $false
        Warnung "Add-PrinterDriver '$generischerTreiber' fehlgeschlagen: $($_.Exception.Message)"
      }
    } else {
      Ok "Treiber '$generischerTreiber' ist vorhanden"
    }
    if ($treiberOk) {
      try {
        Add-Printer -Name $Drucker -DriverName $generischerTreiber -PortName $Port -ErrorAction Stop
        Ok "Warteschlange '$Drucker' auf $Port angelegt ($generischerTreiber)"
      } catch {
        Warnung "Add-Printer fehlgeschlagen: $($_.Exception.Message)"
      }
    }
  }
}

# ---------------------------------------------------------------- 2. Energieoptionen
Schritt "Energieoptionen (nie abschalten, USB-Energiesparen aus)"
$powercfgBefehle = @(
  @('/change', 'monitor-timeout-ac', '0'),
  @('/change', 'monitor-timeout-dc', '0'),
  @('/change', 'standby-timeout-ac', '0'),
  @('/change', 'standby-timeout-dc', '0'),
  @('/change', 'hibernate-timeout-ac', '0'),
  @('/change', 'hibernate-timeout-dc', '0'),
  @('/setacvalueindex', 'SCHEME_CURRENT', '2a737441-1930-4402-8d77-b2bebba308a3', '48e6b7a6-50f5-4782-a5d4-53bb8f07e226', '0'),
  @('/setdcvalueindex', 'SCHEME_CURRENT', '2a737441-1930-4402-8d77-b2bebba308a3', '48e6b7a6-50f5-4782-a5d4-53bb8f07e226', '0'),
  @('/setactive', 'SCHEME_CURRENT')
)
foreach ($args in $powercfgBefehle) {
  & powercfg.exe @args 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { Ok "powercfg $($args -join ' ')" } else { Warnung "powercfg $($args -join ' ') -> Exit $LASTEXITCODE" }
}
# Zuklappen-Aktion (SUB_BUTTONS / LIDACTION) auf "Nichts unternehmen", falls das Geraet einen Deckel hat
$lidAc = & powercfg.exe /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0 2>&1
$lidDc = & powercfg.exe /setdcvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0 2>&1
if ($LASTEXITCODE -eq 0) { & powercfg.exe /setactive SCHEME_CURRENT | Out-Null; Ok "Zuklappen = Nichts unternehmen" } else { Warnung "Zuklappen-Aktion konnte nicht gesetzt werden (Desktop ohne Deckel?): $lidAc $lidDc" }

# ---------------------------------------------------------------- 3. Autostart
Schritt "Autostart-Verknuepfung"
$exe = Join-Path $KasseOrdner 'Kasse.exe'
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'Kasse.lnk'
if (-not (Test-Path $exe)) {
  Warnung "Kasse.exe nicht gefunden unter $exe. Ordner dist\win-unpacked nach $KasseOrdner kopieren, Verknuepfung wird trotzdem angelegt."
}
try {
  $shell = New-Object -ComObject WScript.Shell
  $verknuepfung = $shell.CreateShortcut($lnk)
  $verknuepfung.TargetPath = $exe
  $verknuepfung.WorkingDirectory = $KasseOrdner
  $verknuepfung.Description = 'Kasse'
  $verknuepfung.Save()
  Ok "Verknuepfung $lnk -> $exe"
} catch {
  Warnung "Verknuepfung konnte nicht angelegt werden: $($_.Exception.Message)"
}

# ---------------------------------------------------------------- 4. Windows-Update pausieren
Schritt "Windows-Update $PauseTage Tage pausieren"
try {
  $start = (Get-Date).ToUniversalTime()
  $ende = $start.AddDays($PauseTage)
  $fmt = 'yyyy-MM-ddTHH:mm:ssZ'
  $key = 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings'
  if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
  # Dieselben Werte, die die Einstellungen-App bei "Updates fuer 7 Tage anhalten" schreibt.
  Set-ItemProperty -Path $key -Name 'PauseUpdatesStartTime' -Value $start.ToString($fmt) -Type String
  Set-ItemProperty -Path $key -Name 'PauseUpdatesExpiryTime' -Value $ende.ToString($fmt) -Type String
  Set-ItemProperty -Path $key -Name 'PauseFeatureUpdatesStartTime' -Value $start.ToString($fmt) -Type String
  Set-ItemProperty -Path $key -Name 'PauseFeatureUpdatesEndTime' -Value $ende.ToString($fmt) -Type String
  Set-ItemProperty -Path $key -Name 'PauseQualityUpdatesStartTime' -Value $start.ToString($fmt) -Type String
  Set-ItemProperty -Path $key -Name 'PauseQualityUpdatesEndTime' -Value $ende.ToString($fmt) -Type String
  Ok "Pause bis $($ende.ToLocalTime().ToString('dd.MM.yyyy HH:mm')) eingetragen ($key)"
  Write-Host "   Hinweis: Falls Einstellungen -> Windows Update die Pause nicht anzeigt (Gruppenrichtlinie/LTSC), dort von Hand 'Updates 1 Woche anhalten' waehlen." -ForegroundColor DarkGray
} catch {
  Warnung "Windows-Update-Pause konnte nicht gesetzt werden: $($_.Exception.Message). Bitte in Einstellungen -> Windows Update von Hand 'Updates 1 Woche anhalten'."
}

# ---------------------------------------------------------------- 5. Kontrollausgabe
Schritt "Kontrolle"
$p = Get-Printer -Name $Drucker -ErrorAction SilentlyContinue
if ($null -ne $p) {
  Write-Host ("   Drucker: {0} | Treiber {1} | Port {2} | Status {3} | Auftraege {4}" -f $p.Name, $p.DriverName, $p.PortName, $p.PrinterStatus, $p.JobCount)
} elseif ((EpsonWarteschlangen).Count -gt 0) {
  Write-Host "   Drucker: Warteschlange '$Drucker' fehlt, aber eine Epson-Warteschlange ist vorhanden (siehe Liste); in der Kasse auswaehlen." -ForegroundColor Yellow
} else {
  Write-Host "   Drucker: Warteschlange '$Drucker' fehlt" -ForegroundColor Yellow
}
Write-Host "   Vorhandene Warteschlangen:"
$alleWarteschlangen = @(Get-Printer -ErrorAction SilentlyContinue | Sort-Object Name)
if ($alleWarteschlangen.Count -eq 0) {
  Write-Host "   - (keine)"
} else {
  foreach ($q in $alleWarteschlangen) {
    Write-Host ("   - {0} | Port {1} | Treiber {2}" -f $q.Name, $q.PortName, $q.DriverName)
  }
}
Write-Host "   Energie (Auszug powercfg /q, Standby AC/DC):"
$standby = (& powercfg.exe /q SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>&1 | Select-String 'Index') -join ' | '
Write-Host "   $standby"
Write-Host "   Autostart: $(if (Test-Path $lnk) { $lnk } else { 'fehlt' })"
Write-Host "   Kasse.exe: $(if (Test-Path $exe) { 'vorhanden' } else { 'FEHLT' })  ($exe)"
$ux = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings' -ErrorAction SilentlyContinue
Write-Host "   Windows-Update pausiert bis: $(if ($ux -and $ux.PauseUpdatesExpiryTime) { $ux.PauseUpdatesExpiryTime } else { 'nicht gesetzt' })"

Write-Host ""
if ($fehler.Count -eq 0) {
  Write-Host "Setup abgeschlossen, keine Warnungen." -ForegroundColor Green
} else {
  Write-Host "Setup abgeschlossen mit $($fehler.Count) Warnung(en):" -ForegroundColor Yellow
  $fehler | ForEach-Object { Write-Host "   - $_" -ForegroundColor Yellow }
}
if ($hinweise.Count -gt 0) {
  Write-Host "Noch zu tun in der Kasse:" -ForegroundColor White
  $hinweise | ForEach-Object { Write-Host "   - $_" -ForegroundColor White }
}
Write-Host "Manuell: USB-Root-Hubs Energieverwaltung aus, Zuklappen pruefen, Testdruck in der Kasse (Einstellungen -> Testdruck)."
