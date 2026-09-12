# Drucker-Setup Epson TM-T20II (Windows 11, RAW ESC/POS, ohne Epson-Software) – Fassung 2

Stand 12.9.2026. Gilt für den Dev-Rechner (Windows 11 IoT Enterprise LTSC 2024) und wird am **Di 15.9.** (nicht erst Donnerstag) auf dem Kassen-Laptop per `tools/setup-laptop.ps1` wiederholt. Voraussetzung dort: Administratorrechte (Add-Printer, powercfg, Restart-Service).

## 1. Befund und Entscheidung

- Der Drucker meldet sich als `USB\VID_04B8&PID_0E15` und `USBPRINT\EPSONTM-T20II...&USB001`: USB-Druckerklassen-Modus (Werkseinstellung, usbprint.sys), Windows hat den Port USB001 angelegt.
- Warteschlange «TM-T20II» mit Treiber «Generic / Text Only» auf USB001, Druckprozessor winprint, Datentyp RAW, EnableBIDI False, Status Normal (per Get-Printer verifiziert).
- Druckweg: OpenPrinter → StartDocPrinter (pDataType «RAW») → WritePrinter → EndDocPrinter über `tools/print-raw.ps1`. Bei RAW verändert der Spooler nichts und hängt kein Formfeed an. Epson bestätigt, dass über den Port USBxxx gedruckt werden kann; nur die Epson Status API fehlt dort.
- **Nichts von Epson installieren.** APD 5.13/5.09, TMUSB, Virtual Port Driver, OPOS, JavaPOS, ePOS SDK, EpsonNet Config setzen auf den Vendor-Class-Modus (Port ESDPRTxxx) und würden die funktionierende Konfiguration eine Woche vor dem Einsatz verändern. Keine Memory-Switch-Änderungen, kein 58-mm-Umbau.

## 2. Warteschlange anlegen (neuer Rechner, PowerShell als Administrator)

```powershell
Get-PrinterPort | Where-Object Name -like 'USB*'          # welchen Port hat Windows angelegt?
Add-Printer -Name "TM-T20II" -DriverName "Generic / Text Only" -PortName "USB001"
Get-Printer -Name "TM-T20II" | Format-List Name, DriverName, PortName, PrinterStatus, JobCount
```

- «Generic / Text Only» ist bei Windows dabei, kein Download. Bei RAW rendert er nichts; die Warteschlange ist nur der Zugang zum Port.
- Hat Windows bereits eine eigene Warteschlange («EPSON TM-T20II») angelegt, bleibt sie; die App spricht nur «TM-T20II» (Name in den Einstellungen konfigurierbar).
- Anderer USB-Port → evtl. USB002: `Set-Printer -Name "TM-T20II" -PortName "USB002"`. Deshalb am Kassen-Laptop immer denselben Port verwenden und markieren.
- Auf Windows 11 24H2 meldet der Port den Monitor «Dynamic Print Monitor»; für RAW-Schreiben irrelevant.
- **`tools/setup-laptop.ps1`** (am Sonntag schreiben, am Dienstag auf dem Laptop ausführen) fasst zusammen: Port ermitteln, Add-Printer (falls fehlt), Energieoptionen aus Abschnitt 5, Verknüpfung `C:\Kasse\Kasse.exe` in `shell:startup`, Windows-Update 7 Tage pausieren, Kontrollausgabe. Das Skript liegt auch auf dem USB-Stick (für ein Ersatzgerät).

## 3. Testdruck

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\print-raw.ps1 -Printer "TM-T20II" -File tools\testdruck.bin
```

Erwartet: Terminal `Gesendet: 220 Bytes an 'TM-T20II'` (Fassung 1 des Skripts) bzw. JSON `{jobId, bytes, status}` (Fassung 2, Abschnitt 7). Auf Papier: «WintiKirmes» doppelt gross zentriert, «TESTDRUCK TM-T20II», Zeilen «Umlaute: ä ö ü Ä Ö Ü ß» und «Türkçe: ş ğ ı ç İ Ş Ğ Ç» korrekt (PC857 via ESC t 13), «Gözleme Dürüm Lahmacun», Total/Gegeben/Rückgeld (Rückgeld doppelt gross), Datum/Uhrzeit, drei Leerzeilen, Teilschnitt (GS V 66 0, ein Haltepunkt links; Vollschnitt gibt es bei diesem Modell nicht), zum Schluss ein Klick am DK-Port (ESC p 0 25 250; ohne Schublade evtl. unhörbar).

Fantasiezeichen statt Umlaute → ESC t 13 fehlt oder Text wurde nicht als cp857 kodiert. Die Bytes in `testdruck.bin` (0x84 ä, 0x94 ö, 0x81 ü, 0x8E Ä, 0x99 Ö, 0x9A Ü, 0xE1 ß, 0x9F ş, 0xA7 ğ, 0x8D ı, 0x87 ç, 0x98 İ, 0x9E Ş, 0xA6 Ğ, 0x80 Ç) sind die Referenz für den iconv-lite-Test am Sonntag.

Ohne PC: Selbsttest = Drucker aus, Feed halten, einschalten. Druckt Firmware, Interface, USB-Klasse, Codepage-Default, Papierbreite, Buzzer-Option.

Ergebnis 12.9.2026: [x] Testdruck [x] Umlaute/türkisch [x] Schnitt [ ] Impuls (erst mit Schublade prüfbar)

## 4. Kassenschublade (DK-Port)

- Buchse «DK» hinten, RJ12 (6-polig), geschirmtes Kabel, einstecken bis es klickt. **Nie** ein Telefon-/DSL-Kabel in DK und das DK-Kabel nie in eine Netzwerk-/Telefonbuchse.
- Pins (Drucker): 1 Schirm, 2 Impuls 1, 3 Schubladenschalter, 4 +24 V, 5 Impuls 2, 6 Masse. Schublade muss 24 V vertragen (≥ 24 Ohm bzw. ≤ 1 A); keine 12-V-Schublade. Vorgesehen: 4POS/Epson PCK-41 II (RJ12, 24 V); ob ein RJ12-Kabel beiliegt, ist in den Shop-Texten nicht belegt → Bestellbestätigung prüfen, sonst Kabel (6P6C, Epson-Belegung) separat bestellen.
- Befehl `ESC p m t1 t2` (1B 70 m t1 t2): m = 0 Pin 2, m = 1 Pin 5; an = t1 × 2 ms, aus = t2 × 2 ms. Standard `1B 70 00 19 FA` = 50 ms an / 500 ms aus. Öffnet sie nicht: m = 1 probieren, dann t1 auf 50 (100 ms). Zwischen zwei Impulsen ≥ 4 × Impulsdauer Pause.
- Summer-Option (OT-BZ20) und Schublade schliessen sich aus; im Selbsttest muss «Buzzer: Disable» stehen.
- Der Impuls steht im RAW-Auftrag vor den Coupons, nur bei Bar-CHF, Bar-EUR und Storno mit Auszahlung > 0. Schubladenzustand (Pin 3) ist über den Spooler nicht lesbar; für 2026 nicht nötig.
- **Schubladentest mit echter Last am Mi 16.9. vormittags** (eigener Punkt im Tagesplan). Kommt die Schublade später: Impuls bleibt aktiv (ohne Schublade unschädlich), Test am Donnerstag, Schlüssel-Öffnung als Rückfall.
- Beim Auspacken: RJ12-Kabel dabei? Schlüssel an den Kassenchef. Bei verstellter Breite nur 4 der 5 Notenfächer für CHF-Noten nutzbar (10/20/50/100, 200er unter den Einsatz).

## 5. Energieoptionen (Kassen-Laptop, als Administrator, Teil von `setup-laptop.ps1`)

```
powercfg /change monitor-timeout-ac 0
powercfg /change monitor-timeout-dc 0
powercfg /change standby-timeout-ac 0
powercfg /change standby-timeout-dc 0
powercfg /change hibernate-timeout-ac 0
powercfg /change hibernate-timeout-dc 0
powercfg /setacvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0
powercfg /setdcvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0
powercfg /setactive SCHEME_CURRENT
```

- Letzte drei Zeilen = «Einstellung für selektives USB-Energiesparen» = Deaktiviert (Dev-Rechner steht heute auf Aktiviert). Übliche Massnahme gegen «Drucker plötzlich offline».
- Zuklappen: Energieoptionen → «Zuklappen» = Nichts unternehmen (auf dem Desktop-Dev-Rechner nicht prüfbar; Alias unter SUB_BUTTONS am Laptop mit `powercfg /q SCHEME_CURRENT SUB_BUTTONS` nachschlagen).
- Geräte-Manager → USB-Controller → jeder USB-Root-Hub / Generic USB Hub → Energieverwaltung → «Computer kann das Gerät ausschalten» abwählen (manuell).
- Drucker direkt an einen USB-Port des Laptops, nicht über unversorgten Hub; USB-2.0-Port bevorzugen; Kabel mit Kabelbinder/Klebeband fixieren. Windows-Update für 7 Tage pausieren. Die App setzt zusätzlich `powerSaveBlocker`.
- Autostart über `shell:startup` läuft erst nach der Windows-Anmeldung: Windows-Passwort des Kassenkontos aufs Notfallblatt oder Auto-Login (nur bei Vereinsgerät).

## 6. Papier

Thermorollen 80 mm (79.5 ± 0.5), max. 83 mm Durchmesser, Kern 12/18 mm, nicht am Kern angeklebt. Vorgesehen: 4POS 80 × 80 × 12 mm, 2 × 5 Rollen (Brack). Bedarf zwei Tage grob 3 Rollen (Schätzung ohne Quelle); der Rest deckt Tests, Nachdrucke und Reserve. Paper-LED an = Rolle fast leer; beim Schliessen des Deckels schneidet der Drucker automatisch.

## 7. Druckerstatus und Auftragsüberwachung ohne Epson-Software

- DLE EOT / GS r / ASB sind Antworten des Druckers; unser Pfad ist nur schreibend (EnableBIDI False). **Nicht senden.**
- Ob Windows 11 24H2 für diese Warteschlange PaperOut/Offline/DoorOpen in `Get-Printer` bzw. `Win32_Printer.DetectedErrorState` abbildet, ist nicht belegt → am Dienstag/Donnerstag testen (Deckel öffnen, Papier raus, Drucker aus; jeweils `Get-Printer -Name TM-T20II | Select PrinterStatus` und `(Get-CimInstance Win32_Printer -Filter "Name='TM-T20II'").DetectedErrorState`). Die App verlässt sich nicht darauf.
- **`print-raw.ps1` Fassung 2 (Sonntag):** `$ErrorActionPreference='Stop'`; Job-ID aus `StartDocPrinterW` behalten; nach `EndDocPrinter` im selben Prozess bis 10 s pollen (`Get-PrintJob -PrinterName $Printer -ID $jobId`, alle 500 ms); verschwindet der Auftrag → Exit 0 (vom Drucker in den 4-KB-Puffer angenommen, nicht «gedruckt»); bleibt er stehen oder trägt JobStatus Error/Offline/PaperOut/Blocked → `Remove-PrintJob` auf diese ID, Exit 2; OpenPrinter-/WritePrinter-Fehler → Exit 1 mit Fehlertext auf stderr. Ausgabe auf stdout als JSON `{ "jobId": n, "bytes": n, "status": "accepted|removed|error" }`. Ein Prozess pro Beleg statt bis zu elf.
- **Ampel in der App** nur mit belegbarer Aussage: «Druck OK» = Warteschlange vorhanden, nicht Paused/Offline, keine hängenden Aufträge, letzter Auftrag Exit 0; «Druck prüfen» = letzter Auftrag Exit 1 oder 2. Keine Papieraussage. Kassier beobachtet Paper- und Error-LED.
- **Nie automatisch nachdrucken:** Beim App-Start werden alle Aufträge der Warteschlange mit `Remove-PrintJob` verworfen und `druckauftrag`-Zeilen mit `queued`/`sent` auf `failed` gesetzt (Anzeige «nicht gedruckt»). Ein hängender Auftrag wird sofort entfernt, nicht erst beim nächsten Start – sonst kommen beim Wiederanstecken des USB-Kabels alte Coupons heraus (Verhalten des Spoolers beim Wiederanstecken ist nicht belegt; das Entfernen macht es irrelevant). Nachdrucke laufen nur über die Nachdruck-Funktion der Kasse.
- Verkauf ist vor dem Druck gespeichert (Commit, `synchronous=FULL`); scheitert der Druck, zeigt die Kasse «Drucker prüfen» plus die Handschreib-Liste.

## 8. Layout-Fakten für Bon und Coupon (80 mm)

- 576 Punkte, Font A 48 Zeichen/Zeile, doppelt breit 24; Zeilenabstand 3.75 mm.
- `GS ! n`: 0x00 normal, 0x01 doppelt hoch, 0x11 doppelt breit+hoch (24 Spalten), 0x22 dreifach (16 Spalten). Coupon: Produktname 0x11, Anzahl 0x22. Produktnamen sind in der Verwaltung auf 24 Zeichen begrenzt, damit alle Coupons gleich aussehen (kein stiller Fallback auf 0x01). `ESC a n` Ausrichtung nur am Zeilenanfang. `ESC E 1/0` fett. Invers (GS B) nur kurze Zeilen (Schwärzungsgrenze ca. 30 mm am Stück).
- Jeder Auftrag: `ESC @` dann `ESC t 13`. Text mit iconv-lite «cp857» kodieren, nicht kodierbare Zeichen durch «?» ersetzen. Zeilenende nur LF.
- Positionszeile: 3 Zeichen Anzahl, 1 Leerzeichen, 34 Zeichen Name, 10 Zeichen Betrag rechtsbündig = 48.
- Schnitt: Klinge ca. 10.5 mm über der Druckzeile; 2–3 Leerzeilen, dann `GS V 66 0` (führt selbst bis zur Schneideposition). Nächster Ausdruck beginnt bauartbedingt mit ca. 10 mm Leerrand. Pro Coupon und pro Bon ein Schnitt, alles in einem WritePrinter.
- Layout wird am **Montagabend** auf Papier korrigiert (Schnittposition, Spalten, Grössen), nicht erst am Dienstag.

## 9. Fehlerbehebung

| Symptom | Massnahme |
|---|---|
| Skript meldet Exit 2 / «removed», nichts gedruckt | Power-/Error-LED; USB-Kabel; Drucker aus/ein; Auftrag ist bereits entfernt → Nachdruck aus der Kasse. |
| Win32-Fehler 1801 (OpenPrinter) | Warteschlangenname falsch: `Get-Printer` zeigt die Namen; Druckername in den Einstellungen prüfen. |
| Warteschlange Angehalten/Offline | `Resume-Printer -Name TM-T20II`; «Drucker offline verwenden» abwählen; USB neu stecken. |
| Aufträge bleiben «Wird gedruckt» | `Get-PrintJob -PrinterName TM-T20II \| Remove-PrintJob`, dann `Restart-Service Spooler` (Admin). |
| Nach Standby nichts mehr | Abschnitt 5 anwenden; Drucker aus/ein, USB neu stecken. |
| Port ist plötzlich USB002 | `Set-Printer -Name TM-T20II -PortName USB002` oder ursprünglichen Port nehmen. |
| Umlaute/türkisch falsch | ESC t 13 fehlt oder nach ESC @ vergessen, oder UTF-8 statt cp857; `testdruck.bin` als Referenz. |
| Schnitt mitten im Text | Leerzeilen vor GS V 66 0 fehlen oder GS V 0/1 (ohne Vorschub) benutzt. |
| Schublade öffnet nicht | 24-V-Modell? Kabel eingerastet? m = 1 statt 0; Buzzer im Selbsttest «Disable»; Impuls 50/250; Impuls nur bei Bar/Storno. |
| Error-LED blinkt | Papierstau/Cutter: Deckel auf, Papier raus, Deckel zu, aus/ein; sonst Selbsttest. |
| Paper-LED an | Neue 80-mm-Rolle, Deckel zu (schneidet automatisch). |
| Roter Banner «SIMULATOR» in der Kasse | Falscher Start (Dev-Modus / `KASSE_PRINT=sim`): App beenden und `C:\Kasse\Kasse.exe` ohne Parameter starten. |
| Drucker ganz ohne PC prüfen | Selbsttest (Feed halten + einschalten). Druckt er, liegt das Problem bei USB/Windows. |

Notfallplan: Kasse läuft weiter und zeigt die von Hand zu schreibenden Coupons; vorgedruckte A4-Couponbögen (ET-3850, am Donnerstag gedruckt) in der Notfallkiste. Reservedrucker TM-T20IV bei Brack (CHF 153, 4 an Lager) nur Mo–Fr beschaffbar; ein Ausfall am Samstag ist für den Sonntag über Brack nicht heilbar (Entscheid Reservedrucker heute, siehe offene Fragen).

## 10. Was der APD zusätzlich brächte (und warum nicht)

- Status API: Papierende, Deckel offen, offline, ausgeschaltet als Ereignisse in der Software; Windows-GDI-Druck (Logos, Grafiken über Treiber); Vorschau/Utility für Memory-Switches.
- Dafür: Vendor-Class-Umschaltung (neuer Port ESDPRTxxx, unsere Warteschlange auf USB001 wertlos), Supportliste endet bei Windows 11 22H2 (LTSC 2024 nicht genannt), zusätzliche Installations- und Fehlerquelle eine Woche vor dem Einsatz. Papierende erkennt 2026 der Kassier an den LEDs; alle Druckfunktionen werden per ESC/POS gesetzt.

## 11. Offen (Dienstag/Donnerstag prüfen)

- ~~Ergebnis des heutigen Testdrucks~~ – 12.9. bestätigt: Zeichen und Schnitt korrekt; Impuls offen bis die Schublade da ist.
- Verhalten bei Papierende mitten im Auftrag (Rest nach Rollenwechsel gedruckt oder verloren?) – Testfall 17.
- Ob Get-Printer/Win32_Printer PaperOut/Offline für diese Warteschlange liefert (nur informativ).
- Latenz von `print-raw.ps1` Fassung 2 auf dem Kassen-Laptop (Dev-Rechner 0.64–0.74 s ohne Wartezeit).
- iconv-lite cp857-Bytezuordnung gegen `testdruck.bin` verifizieren (So 13.9.).
- Werkseinstellung Buzzer-Memory-Switch per Selbsttest, falls die Schublade nicht reagiert.
- RJ12-Kabel im Lieferumfang der PCK-41 II; Liefertag (Mo oder Di).
- Adminrechte auf dem Kassen-Laptop (Voraussetzung für Abschnitte 2 und 5).
- Falls Reservedrucker TM-T20IV bestellt: USB-Modus/Port des T20IV prüfen (nicht recherchiert), eigene Warteschlange «TM-T20IV», Druckername in den Einstellungen umschaltbar.
