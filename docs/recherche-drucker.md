# Drucker-Setup: Epson TM-T20II unter Windows 11 (rohes ESC/POS)

Stand: Samstag, 12. September 2026. Gilt fuer den Entwicklungsrechner (Windows 11 IoT Enterprise LTSC 2024) und muss am Donnerstag 17.9. auf dem Kassen-Laptop wiederholt werden, falls das ein anderes Geraet ist.

## 1. Kurzantwort

- **Der gewaehlte Weg ist korrekt und tragfaehig:** Drucker im USB-Druckerklassen-Modus (Werkseinstellung des TM-T20II), Windows-Warteschlange "TM-T20II" mit Treiber "Generic / Text Only" auf Port USB001, Daten als RAW ueber winspool (OpenPrinter / StartDocPrinter mit pDataType "RAW" / WritePrinter). Bei RAW veraendert der Spooler die Daten nicht, der Treiber rendert nichts, es wird kein Formfeed angehaengt (das macht nur der Datentyp "RAW [FF appended]"). Epson bestaetigt ausdruecklich, dass man ueber den Druckerklassen-Port "USBxxx" drucken kann; nur die Epson Status API steht dort nicht zur Verfuegung.
- **Nichts von Epson installieren.** Weder APD 5.13, TMUSB, Virtual Port Driver, OPOS, JavaPOS noch ePOS SDK. Alle diese Pakete setzen auf den Epson-Vendor-Class-Modus (Port "ESDPRTxxx") und wuerden die heute funktionierende Konfiguration eine Woche vor dem Einsatz veraendern. Der einzige echte Mehrwert des APD waere der Statusmonitor (Papierende, Deckel offen, offline). Darauf verzichten wir bewusst (Abschnitt 6).
- **Heute auf dem Rechner erledigt (verifiziert per Get-Printer):** Warteschlange "TM-T20II", Treiber "Generic / Text Only", Port USB001, Druckprozessor winprint, Standard-Datentyp RAW, Status "Normal", keine haengenden Auftraege, Spooler-Dienst laeuft. PnP zeigt den Drucker als USB\VID_04B8&PID_0E15 (PID 0E15 = USB-Druckerklasse laut Epson-Referenz; im Vendor-Modus waere es 0202). Ergebnis des Testdrucks (tools/testdruck.bin) bitte im Abschnitt 4 abhaken.

## 2. Was der Auftraggeber tun muss (Checkliste)

1. **Nichts installieren.** Die Epson-Downloadseite (APD, TMUSB, Virtual Port, OPOS, JavaPOS, ePOS SDK, EpsonNet Config) ignorieren. Auch keine "Treiber-Updater".
2. **Energieoptionen anpassen** (auf dem Kassen-Laptop, am Netzteil):
   - Systemsteuerung > Energieoptionen > Planeinstellungen aendern > Erweiterte Energieeinstellungen > USB-Einstellungen > "Einstellung fuer selektives USB-Energiesparen" = **Deaktiviert** (Netzbetrieb und Akku). Auf dem Dev-Rechner steht sie heute auf "Aktiviert" (powercfg). Microsoft empfiehlt das Ausschalten zwar allgemein nicht, aber fuer einen dauerhaft angeschlossenen POS-Drucker ist das die uebliche Massnahme gegen "Drucker ploetzlich offline / Auftrag haengt" (Microsoft Q&A).
   - Energie sparen (Standby) bei Netzbetrieb: **Nie**. Bildschirm darf sich ausschalten, der Rechner nicht schlafen. Deckel-zu-Aktion bei Laptop: "Nichts unternehmen".
   - Geraete-Manager > USB-Controller > jeder "USB-Root-Hub" / "Generic USB Hub" > Energieverwaltung > "Computer kann das Geraet ausschalten, um Energie zu sparen" **abwaehlen**.
   - Drucker immer direkt an einen USB-Port des Laptops, nicht ueber einen unversorgten Hub; USB-2.0-Port bevorzugen, wenn vorhanden.
3. **Papier**: Thermorollen **80 mm breit, max. 83 mm Durchmesser**, Kern innen 12 mm / aussen 18 mm, Papier darf nicht am Kern angeklebt sein. 58-mm-Papier NICHT verwenden (braucht Fuehrungsplatte plus Memory-Switch, und Epson warnt, dass der Wechsel wegen Verschleiss von Druckkopf/Cutter praktisch nicht rueckgaengig gemacht werden kann). Mengenabschaetzung (grob, nicht belegt): ca. 20 Kunden/h x 14 h = ca. 280 Bons plus ca. 400 Coupons, je ca. 8-10 cm, also ca. 60-70 m gesamt; **6 Rollen kaufen**, das deckt auch Nachdrucke, Abschlussbons und Fehlversuche.
4. **Kassenschublade** (heute bestellt): 24-V-Modell mit RJ12-Kabel fuer den Epson-DK-Port (Abschnitt 5). Kein 12-V-Modell.
5. **Kassen-Laptop vorbereiten** (Donnerstag): Drucker einstecken, Warteschlange anlegen (Abschnitt 3), Testdruck (Abschnitt 4), Energieoptionen (Punkt 2), Schublade testen (Abschnitt 5). USB-Kabel am Laptop mit Klebeband fixieren.

## 3. Warteschlange anlegen (auf einem neuen Rechner)

Ohne Epson-Software erkennt Windows den TM-T20II von selbst (Treiber usbprint.sys) und legt einen virtuellen Port "USB001" (oder USB002 ...) an. Danach in einer PowerShell als Administrator:

```powershell
# 1. Welchen Port hat Windows angelegt?
Get-PrinterPort | Where-Object Name -like 'USB*'
# 2. Warteschlange mit dem mitgelieferten Textonly-Treiber anlegen (Portname ggf. anpassen)
Add-Printer -Name "TM-T20II" -DriverName "Generic / Text Only" -PortName "USB001"
# 3. Kontrolle: PrinterStatus Normal, PortName USB001, JobCount 0
Get-Printer -Name "TM-T20II" | Format-List Name, DriverName, PortName, PrinterStatus, JobCount
```

Hinweise:
- Der Treiber "Generic / Text Only" ist bei Windows dabei, es wird nichts heruntergeladen. Bei RAW-Auftraegen wird er nicht zum Rendern benutzt; er ist nur Platzhalter, damit die Warteschlange existiert.
- Falls Windows den Drucker bereits mit einer eigenen Warteschlange (z. B. "EPSON TM-T20II") angelegt hat, kann diese bleiben; unsere Software spricht ausschliesslich den Namen "TM-T20II" an. Der Name ist in der App konfigurierbar zu halten.
- Wenn der Drucker an einem anderen USB-Port eingesteckt wird, kann Windows einen neuen Port (USB002) anlegen. Dann: `Set-Printer -Name "TM-T20II" -PortName "USB002"`. Deshalb am Kassen-Laptop immer denselben Port verwenden und markieren.
- Auf dem Dev-Rechner meldet `Get-PrinterPort` fuer USB001 den Portmonitor "Dynamic Print Monitor" (nicht das klassische "USB Monitor"/usbmon). Das ist der Stand von Windows 11 24H2; fuer das reine Schreiben von RAW-Daten spielt es keine Rolle, fuer die Statusabfrage schon (Abschnitt 6).

## 4. Testdruck ausloesen

Der Helfer `tools/print-raw.ps1` oeffnet die Warteschlange, startet ein Dokument mit Datentyp "RAW" und schreibt die Datei byteweise mit WritePrinter. Aufruf aus dem Projektordner:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\print-raw.ps1 -Printer "TM-T20II" -File tools\testdruck.bin
```

Erwartete Ausgabe im Terminal: `Gesendet: 220 Bytes an 'TM-T20II'`. Erwartetes Ergebnis auf Papier:
- "KASSE" doppelt gross und zentriert, darunter "TESTDRUCK TM-T20II".
- Zeile "Umlaute: ä ö ü Ä Ö Ü ß" und "Türkçe: ş ğ ı ç İ Ş Ğ Ç" korrekt (Codepage PC857 via ESC t 13). Sind hier Fantasiezeichen zu sehen, ist ESC t 13 nicht angekommen oder die Bytes wurden nicht als PC857 kodiert.
- "Gözleme  Dürüm  Lahmacun", Total/Gegeben/Rueckgeld (Rueckgeld doppelt gross), Datum/Uhrzeit.
- Drei Leerzeilen, dann **Teilschnitt** (GS V 66 0: Vorschub bis zur Schneideposition und Schnitt mit einem Haltepunkt am linken Rand). Der Bon laesst sich abreissen, haengt aber links noch an einem Punkt. Das ist bei diesem Modell die einzige Schnittart (kein Vollschnitt).
- Zum Schluss ein Klick-Geraeusch/Impuls am DK-Port (ESC p 0 25 250 = 50 ms an, 500 ms aus). Ohne Schublade hoert man nur ein leises Relais-/Transistorgeraeusch oder gar nichts; das ist normal.

Zusaetzlich sinnvoll, ganz ohne PC: **Selbsttest** = Drucker aus, Feed-Taste gedrueckt halten, einschalten. Der Drucker druckt seine Einstellungen (Firmware, Interface, USB-Klasse, Codepage-Default, Papierbreite). Feed-Taste kurz druecken fuer den Rest; endet mit "*** completed ***". Das ist auch der schnellste Beweis, dass Papier, Druckkopf und Cutter funktionieren.

Ergebnis heute: [ ] Testdruck korrekt  [ ] Umlaute/tuerkische Zeichen korrekt  [ ] Schnitt korrekt  [ ] Impuls hoerbar

## 5. Kassenschublade anschliessen (DK-Port)

Belegt aus dem Technical Reference Guide (Seiten 58/59):
- Buchse "DK" auf der Rueckseite, **6-poliger Modularstecker (RJ12)**. Stecker einstecken, bis er klickt. Kabel muss **geschirmt** sein (normale Kassenschubladen-Kabel "fuer Epson DK" sind das).
- **Niemals ein Telefonkabel oder ein Telefon/DSL-Geraet in die DK-Buchse stecken** und das DK-Kabel niemals in eine Netzwerk- oder Telefonbuchse (Epson-Warnung: kann Telefonleitung oder Drucker beschaedigen). Bei Ethernet-Modellen zusaetzlich: kein DK-Kabel in die Ethernet-Buchse.
- Pinbelegung (Printer-Seite, Pins 1..6): **Pin 1** Frame Ground/Schirm, **Pin 2** Schubladen-Impuls 1, **Pin 3** Schubladen-Schalter offen/zu (Signal), **Pin 4** +24 V, **Pin 5** Schubladen-Impuls 2, **Pin 6** Signal-Masse. Das Solenoid der Schublade liegt zwischen Pin 4 und Pin 2 (oder 4 und 5); der Oeffnungsschalter zwischen Pin 3 und 6.
- Die Schublade muss **24 V** vertragen (Pin 4 liefert 24 V); Spulenwiderstand mindestens 24 Ohm bzw. Strom hoechstens 1 A. Eine 12-V-Schublade gehoert hier nicht dran.
- Der optionale externe Summer (OT-BZ20) und eine Schublade koennen nicht gleichzeitig verwendet werden; ist der Summer per Memory-Switch aktiviert, oeffnet die Schublade nicht. Auslieferungszustand ist "Summer aus"; sollte die Schublade nicht reagieren, im Selbsttest nachschauen.
- **Befehl:** `ESC p m t1 t2` (1B 70 m t1 t2). m = 0 fuer Pin 2, m = 1 fuer Pin 5. Impuls an = t1 x 2 ms, aus = t2 x 2 ms, t1 < t2 waehlen. Unser Standard: `1B 70 00 19 FA` = 50 ms an / 500 ms aus. Zwei Impulse nicht gleichzeitig auf Pin 2 und 5; bei wiederholtem Ausloesen mindestens 4x die Impulsdauer Pause. Oeffnet die Schublade mit m = 0 nicht, m = 1 probieren (manche Schubladen sind auf Pin 5 verdrahtet).
- Der Impuls wird im RAW-Job vor die Coupons gestellt (nur bei Barzahlung). Da alles in einem Auftrag liegt, ist die Reihenfolge Schublade -> Coupons -> Bon 1 garantiert.
- Ob die Schublade offen ist (Pin 3), kann der Drucker per DLE EOT melden; ueber den Spooler ist das nicht lesbar (Abschnitt 6). Fuer 2026 nicht noetig.

## 6. Druckerstatus (Papierende, offline) ohne Epson-Software

Fakten:
- Die ESC/POS-Statusbefehle (DLE EOT, GS r, ESC v, ASB GS a) werden vom TM-T20II unterstuetzt, sind aber **Antworten des Druckers**: Man muss vom Geraet lesen. Unser Pfad ueber den Spooler ist schreibend (WritePrinter); die Warteschlange hat "Bidirektionale Unterstuetzung" aus (EnableBIDI False), es gibt keinen Sprachmonitor. Diese Befehle **nicht senden**: Eine unbeantwortete Statusanfrage ist zwar harmlos, aber laut Epson soll nach DLE EOT erst weitergesendet werden, wenn die Antwort da ist.
- Die Epson Status API (Papierende, Deckel, offline, ausgeschaltet) gibt es nur mit APD/TMUSB im Vendor-Class-Modus. Bewusst verzichtet.
- Windows selbst: usbprint.sys kann per IOCTL_USBPRINT_GET_LPT_STATUS das Statusbyte des USB-Druckers (Paper-Out/Select/Error-Bits) liefern, aber nur an "upper-layer software such as a language monitor". Ob Windows 11 24H2 mit dem "Dynamic Print Monitor" das fuer eine Generic/Text-Only-Warteschlange in `Get-Printer PrinterStatus` (PaperOut/Offline/Error) abbildet, ist **nicht belegt** und muss am Donnerstag ausprobiert werden: Deckel oeffnen bzw. Papier entfernen und `Get-Printer -Name TM-T20II | Select PrinterStatus` sowie `(Get-CimInstance Win32_Printer -Filter "Name='TM-T20II'").DetectedErrorState` anschauen. Heute (Drucker bereit) stehen dort "Normal" bzw. PrinterStatus 3 / DetectedErrorState 0.

Entscheidung fuer Etappe 1 (praktikabel, ohne Epson-Software):
1. Verkauf wird vor dem Druck gespeichert (bereits so entschieden). Druck ist "fire and forget" mit Kontrolle des Spoolers.
2. Nach dem Senden pollt die App bis ca. 10 s: `Get-PrintJob -PrinterName TM-T20II` (bzw. EnumJobs). Verschwindet der Auftrag, hat der Drucker die Daten angenommen (in seinen 4-KB-Empfangspuffer). Bleibt er stehen oder traegt JobStatus-Flags Error / Offline / PaperOut / Blocked, zeigt die Kasse "Drucker pruefen" plus die Handschreib-Liste (Coupons von Hand). Achtung: "Auftrag weg" heisst nicht "Papier ist gedruckt"; bei Papierende mitten im Bon stoppt der Drucker offline (Error-LED an, Paper-LED an) und druckt nach dem Rollenwechsel weiter (Verhalten nach Rollenwechsel unsicher, am Donnerstag testen).
3. Beim App-Start und vor jedem Druck: `Get-Printer` (Status muss Normal sein, nicht Paused/Offline) und alte Auftraege in der Warteschlange erkennen. **Haengende Auftraege vom Vortag oder von einem Druckerausfall werden nicht "nachgedruckt", sondern per `Remove-PrintJob` verworfen** (sonst kommen beim Wiedereinstecken des Druckers ploetzlich alte Coupons heraus). Nachdrucke laufen nur ueber die Nachdruck-Funktion der Kasse.
4. Der Kassier sieht den Drucker: Paper-LED leuchtet bei wenig oder keinem Papier, Error-LED leuchtet bei offline (Deckel offen, Papierende) und blinkt bei Fehlern. Das ist die Papierende-Erkennung fuer 2026.

## 7. Bon-Layout auf 80 mm (Empfehlungen, belegt)

- Druckbreite 72 mm = **576 Punkte** bei 203 dpi. **Font A: 48 Zeichen/Zeile**, Font B: 64 Zeichen/Zeile. Doppelte Breite halbiert das: Font A 24, Font B 32 Zeichen. Zeilenabstand Standard 3,75 mm (ca. 8 Zeilen auf 3 cm).
- Zeichengroesse: `GS ! n` (1D 21 n), n = (Breite-1)<<4 | (Hoehe-1). 0x00 normal, 0x01 doppelt hoch (48 Spalten bleiben), 0x10 doppelt breit, **0x11 doppelt breit + hoch (24 Spalten)**, 0x22 dreifach (16 Spalten). Gilt bis ESC ! / ESC @. Fuer Coupons: Produktname 0x11, bei Namen ueber 24 Zeichen ("Winti Burger mit Pommes" = 23 Zeichen, passt knapp) auf 0x01 zurueckfallen; Anzahl "2x" in 0x22.
- Ausrichtung: `ESC a n` (1B 61 n), 0 links, 1 zentriert, 2 rechts; nur am Zeilenanfang wirksam.
- Fett: `ESC E 1` / `ESC E 0`. Invers (GS B) nur fuer kurze Titelzeilen; Epson begrenzt Drucklaenge mit hohem Schwaerzungsgrad (bei 80 % Deckung max. ca. 30 mm am Stueck), sonst ungleichmaessige Schwaerzung.
- Jeder Job beginnt mit `ESC @` (1B 40, setzt auch die Codepage zurueck) und danach `ESC t 13` (1B 74 0D = PC857 Tuerkisch, enthaelt ä ö ü Ä Ö Ü ß und ç ğ ı ş İ Ş Ğ Ç). WPC1252 (Seite 16) haette kein ğ/ş/ı, PC858 (Seite 19) auch nicht; PC857 ist die richtige Wahl. Kein Euro-Zeichen in PC857, "EUR" ausschreiben. In Node die Strings mit iconv-lite als "cp857" kodieren (wahrscheinlich unterstuetzt; im Simulator-Transport pruefen) und alle nicht kodierbaren Zeichen durch "?" ersetzen, damit kein Steuerbyte entsteht.
- Zeilenende nur `LF` (0x0A), kein CR. Positionszeilen als feste Spalten: 3 Zeichen Anzahl, 1 Leerzeichen, 34 Zeichen Name (abgeschnitten), 10 Zeichen Betrag rechtsbuendig = 48.
- **Schnitt:** Die Cutter-Klinge sitzt **ca. 10,5 mm oberhalb der Druckzeile** (Handabriss 27,1 mm). `GS V 66 n` (1D 56 42 n) fuehrt das Papier selbst bis zur Schneideposition (+ n Einheiten) und schneidet, daher ist kein eigener Vorschub zwingend; wir senden trotzdem 2-3 Leerzeilen vor dem Schnitt, damit der Text nicht unmittelbar an der Schnittkante endet, und `GS V 66 0`. Der naechste Ausdruck beginnt dadurch mit ca. 10 mm Leerrand oben; das ist bauartbedingt. Pro Coupon und pro Bon je ein Schnitt; alles in einem RAW-Auftrag.
- Teilschnitt = ein Haltepunkt links; der Kassier reisst ab. Vollschnitt gibt es beim TM-T20II nicht.
- Coupons und Bon 1 in einem einzigen WritePrinter-Aufruf senden (Reihenfolge garantiert, ein Spooler-Auftrag pro Verkauf, leicht zu ueberwachen).

## 8. Fehlerbehebung

| Symptom | Pruefen / Massnahme |
|---|---|
| Nichts passiert, Terminal meldet "Gesendet: n Bytes" | `Get-PrintJob -PrinterName TM-T20II`: haengt der Auftrag? Drucker Power-LED an? Error-LED an (Deckel offen, Papierende)? USB-Kabel? Danach `Remove-PrintJob` fuer den haengenden Auftrag, Drucker aus/ein, erneut senden. |
| OpenPrinter fehlgeschlagen (Win32-Fehler 1801) | Warteschlangenname stimmt nicht: `Get-Printer` zeigt die Namen. |
| Warteschlange "Angehalten" oder "Offline" | `Resume-Printer -Name TM-T20II`; in Einstellungen > Drucker "Drucker offline verwenden" abwaehlen; Drucker ab- und anstecken. |
| Auftraege bleiben ewig "Wird gedruckt" | Spooler neu starten: `Restart-Service Spooler` (Admin). Vorher haengende Auftraege loeschen. |
| Nach Standby druckt nichts mehr | Selektives USB-Energiesparen deaktivieren, Standby "Nie", Hub-Energieverwaltung aus (Abschnitt 2). Drucker aus/ein, USB neu stecken. |
| Port ist ploetzlich USB002 | `Set-Printer -Name TM-T20II -PortName USB002` oder Drucker wieder in den urspruenglichen Port. |
| Umlaute/tuerkische Zeichen falsch | ESC t 13 fehlt (steht ESC @ danach?) oder Text wurde als UTF-8 statt cp857 gesendet. Testdruck.bin als Referenz drucken. |
| Schnitt mitten im Text | Vor GS V 66 0 Leerzeilen fehlen; oder es wurde GS V 0/1 (Function A, ohne Vorschub) benutzt. |
| Schublade oeffnet nicht | 24-V-Schublade? Kabel eingerastet? m=1 statt m=0 probieren; Summer-Option im Selbsttest pruefen (muss "Disable" sein); Impulslaenge auf 25/250 (50 ms) oder 50/250 (100 ms) erhoehen; nur bei Barzahlung wird der Impuls gesendet. |
| Error-LED blinkt | Papierstau/Cutter-Fehler: Deckel oeffnen, Papier entfernen, Deckel zu, Drucker aus/ein. Bleibt es, Selbsttest. |
| Paper-LED an | Rolle fast leer oder leer: neue Rolle 80 mm, Deckel zu; beim Schliessen schneidet der Drucker automatisch ab (Werkseinstellung). |
| Ganz ohne PC pruefen | Selbsttest (Feed halten + einschalten). Druckt der, ist der Drucker in Ordnung und das Problem liegt bei USB/Windows. |

Notfallplan bleibt: Kasse laeuft weiter, zeigt die von Hand zu schreibenden Coupons; Papier-Coupons liegen bereit; ET-3850 als Plan B fuer Couponboegen.

## 9. Was bewusst NICHT gemacht wird

- Kein APD 5.13 (bringt Windows-GDI-Druck, Logos ueber Treiber und die Status API; nichts davon brauchen wir; Supportliste endet bei Windows 11 22H2, LTSC 2024 ist nicht genannt).
- Kein TMUSB / Vendor-Class-Umschaltung: wuerde neuen Port "ESDPRTxxx" erzeugen und unsere Warteschlange auf USB001 entwerten.
- Kein Virtual Port Driver (nur fuer Alt-Software, die eine COM-Schnittstelle erwartet), kein OPOS/JavaPOS (UPOS-Treiberschicht), kein ePOS SDK (fuer ePOS-Print/Netzwerkdrucker mit Intelligent-Modul, nicht fuer diesen USB-Drucker).
- Keine Memory-Switch-Aenderungen am Drucker (Codepage-Default, Papierbreite, USB-Klasse). Alles Noetige wird pro Auftrag per ESC/POS gesetzt.
- Kein 58-mm-Umbau.
