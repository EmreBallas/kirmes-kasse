# Roadmap Etappe 1 – Kasse Kirmes 2026 (Fassung 2)

> **Nachtrag 17.9.2026:** Die Helfer-Regel dieser Roadmap («Helfer/Gratis, 0 CHF») ist überholt. Helfer zahlen ihr Essen, sofort oder später, mit offenem Saldo je Name. Massgebend ist `docs/entscheidungen.md` Nr. 55. Ebenfalls nach dieser Fassung dazugekommen: separate Spenden (Nr. 51), Rabatt auf den ganzen Beleg (Nr. 53), Druckerwahl (Nr. 54).

Stand: Samstag, 12. September 2026, nach Kritik. Verbindliche Grundlage: `docs/entscheidungen.md`. Druckeranleitung: `docs/drucker-setup.md`. Produkt-Seed: `docs/produkte-seed.json`.

Änderungen gegenüber Fassung 1 (Kurzliste): Soll-Formeln des Abschlusses auf Brutto umgestellt (Storni nur als Gegenbuchung); Gruppenwerte `coupon` / `kasse` überall; kein Storno-Bon in Etappe 1; «Total in EUR» im EUR-Bezahlfluss; Tastatureingabe ins MUSS; Sonntag mit gepacktem Hello-World-Build und echtem Druck; Abschluss-Bildschirm und -Bon auf Dienstag; Kassen-Laptop bis Dienstag; Kurz-Regression am Donnerstag; Idempotenz per Client-UUID; `Remove-PrintJob` sofort bei hängendem Auftrag; Ampel nur «Druck OK / Druck prüfen»; Simulator nur im Dev-Modus; «Testdaten löschen» als Werkzeug; WebSocket gestrichen; Brack-Plan-B für Sonntag korrigiert; Kürzungsregel bei Rückstand.

## 1. Ziel und Rahmen

Am Sa 19. und So 20. September 2026 (12–19 Uhr) läuft eine lokale Kassensoftware auf einem Windows-Laptop mit Maus und Tastatur, Epson TM-T20II (USB, RAW ESC/POS) und 24-V-Kassenschublade. Genau eine Kasse, ein Kassier, ca. 20 Kunden pro Stunde. Zahlarten Bar-CHF, Bar-EUR (Rückgeld in CHF), Twint (statischer QR) und Helfer/Gratis. Pro Verkauf: Speichern vor Druck, Schubladenimpuls (nur Bar), ein Abholcoupon pro Produktzeile, minimaler Bon 1. Kassentag mit Startgeld, Abschluss mit Ist-Zählung als Bon und PDF. Entwicklung So 13.9. bis Mi 16.9. (Feature-Freeze Mittwochabend), Do Trockenlauf mit Kurz-Regression, Fr Aufbau, kein Code ab Freitag. Nach der Kirmes folgt Etappe 2 (Surface/Touch, mehrere Kassierer, Browser-Zweitkasse).

## 2. Umfang Etappe 1

### MUSS (fertig bis Mi 16.9. abends)

1. Verkaufsbildschirm: Produktkacheln (gross, touch-tauglich, Maus/Tastatur), Warenkorb mit +/−/Löschen, erneutes Antippen erhöht die Menge, Ausverkauft-Toggle auf der Kachel ohne PIN.
2. Bezahlen Bar-CHF: eigener Ziffernblock auf dem Bildschirm plus Schnellwahl (Passend, 10, 20, 50, 100, 200), drei Zeilen Total / Gegeben / Rückgeld (Rückgeld am grössten), Popup «Betrag nicht gedeckt» (blockierend), Popup «Rückgeld über 200» (Bestätigung), Button «stimmt so» = Bar-Spende. **Tastatur ist Hauptbedienweg 2026:** Ziffern, Punkt/Komma, Backspace, Enter (bestätigen), Esc (abbrechen) im Bezahldialog; «Bezahlen»-Button wird nach dem ersten Klick gesperrt.
3. Bezahlen Bar-EUR: Kurs aus Einstellungen (pro Beleg gespeichert), **Anzeige «Total in EUR»** (Total ÷ Kurs, aufgerundet auf 0.10 EUR, damit der Kassier den Betrag nennen kann), Gegenwert des gegebenen EUR-Betrags auf 5 Rappen abgerundet (zugunsten des Vereins), Rückgeld in CHF, gleiche Schutzregeln, «stimmt so» = Bar-Spende EUR.
4. Bezahlen Twint: Betrag gross anzeigen, **Betragsfeld mit dem Total vorbelegt**, Standardweg = ein Tipp «Bezahlt, geprüft» nach Sichtprüfung auf dem Kundenhandy; Betrag nur bei Abweichung ändern; Überzahlung = Twint-Spende; «nicht gedeckt» und 200er-Schutz (Überzahlung über 200) gelten auch hier.
5. Zahlart Helfer/Gratis: 0 CHF, Coupons werden gedruckt, Stückzahlen zählen, Abschlusszeile «Helferessen».
6. Bildschirm nach dem Bezahlen: «Sofort ausgeben: 2x Getränk Dose, 1x Kaffee» (Gruppe `kasse`) und Rückgeld gross stehen lassen bis zum nächsten Verkauf.
7. Druck: Verkauf speichern (Commit) → Zeile in `druckauftrag` → Worker sendet einen RAW-Auftrag: Schubladenimpuls (nur Bar) → Coupons (einer pro Produktzeile mit Anzahl) → Bon 1. Codepage PC857. ESC/POS-Builder als reine Funktion mit Byte-Snapshot-Tests.
8. Nachdruck letzter Beleg (alles / nur Coupons / nur Bon 1) mit Aufdruck NACHDRUCK; Nachdrucke zählen im Abschluss. Ist der letzte Beleg storniert, wird der Nachdruck mit Hinweis «Beleg storniert» verweigert.
9. Storno letzter Beleg mit einem Tipp und Pflichtgrund (Tippfehler / ausverkauft / Kunde abgesprungen), ganzer Beleg, Gegenbuchung, Auszahlung bar CHF = Belegtotal (Spende wird nicht erstattet), Schublade öffnet nur bei Auszahlung > 0, eigene Abschlusszeile. **Kein Storno-Bon** in Etappe 1 (Storno sichtbar in «Letzte Verkäufe» und im Abschluss). Ein zweiter Storno desselben Belegs wird abgelehnt. Ältere Belege über «Letzte Verkäufe» nur mit PIN.
10. Kassentag: Start mit Startgeld CHF (und EUR, default 0) und Kassier-Kürzel; Wiederaufnahme nach Absturz/Neustart inkl. halbfertigem Warenkorb; Tag 2 schlägt gezählten Endbestand von Tag 1 vor; Warnung bei nicht abgeschlossenem Vortag.
11. Kassenabschluss: Soll/Ist/Differenz CHF und EUR nach den Formeln in Abschnitt 4, Stück und Umsatz je Produkt (verkauft / Helfer getrennt), Kassier, Unterschriftslinie; Ausgabe als Bon und als PDF im Archivordner. Aggregation in `src/core`, am Sonntag getestet; Bildschirm und Bon am Dienstag; PDF am Mittwoch.
12. Produktverwaltung hinter 4-stelliger PIN: Name (max. 24 Zeichen, damit er doppelt breit auf den Coupon passt), Preis, Gruppe (`coupon` / `kasse`), aktiv/inaktiv; deaktivieren statt löschen, sobald Verkäufe existieren; Positionen speichern Name/Preis-Snapshot.
13. Einstellungen (hinter PIN): EUR-Kurs, Druckername, Kassen-Präfix, PIN ändern, Testdruck-Button, **«Testdaten löschen»** (löscht Verkäufe, Positionen, Zahlungen, Storni, Druckaufträge, Kassentage, Warenkorb-Entwurf; setzt Belegzähler zurück; behält Produkte und Einstellungen; legt vorher ein Backup an). Der Druck-Transport ist **keine** Kassier-Einstellung (siehe Abschnitt 3).
14. Robustheit: Druckerausfall blockiert die Kasse nicht; Anzeige «Drucker prüfen» plus Liste der von Hand zu schreibenden Coupons; hängender Spooler-Auftrag wird sofort per `Remove-PrintJob` entfernt (nie automatisch nachgedruckt); Ampel in der Kopfzeile mit nur zwei Zuständen «Druck OK» (Warteschlange vorhanden, nicht pausiert/offline, keine hängenden Aufträge, letzter Auftrag erfolgreich) und «Druck prüfen» (letzter Auftrag failed) – keine Papieraussage, Papier-LED bleibt Sache des Kassiers; beim App-Start werden alte Spooler-Aufträge verworfen und `druckauftrag`-Zeilen mit Status `queued`/`sent` auf `failed` gesetzt und als «nicht gedruckt» angezeigt. Doppelklick auf «Bezahlen» erzeugt keinen zweiten Verkauf (Client-UUID, siehe Abschnitt 5 Regel 17).
15. Backup: DB-Kopie bei jedem Abschluss und alle 10 Minuten in `C:\Kasse\backup\` und auf einen USB-Stick, falls vorhanden; auf dem Stick liegt zusätzlich der komplette Ordner `C:\Kasse` (App, `tools/`, `setup-laptop.ps1`) für ein Ersatzgerät.
16. Kiosk-Fenster (Vollbild), Beenden **nur** über Ctrl+Shift+Q mit anschliessender PIN-Abfrage; `close`-Event (Alt+F4) wird abgefangen und ebenfalls hinter die PIN gelegt; Single-Instance, powerSaveBlocker, Packaging als Ordner `C:\Kasse`, Autostart-Verknüpfung.
17. vitest-Tests für `src/core` (Rundung, Rückgeld, Schutzregeln, EUR-Rundung mit krummen Werten, Twint-Spende, Bar-Spende, Abschluss-Aggregation inkl. Storno Bar-CHF / Bar-EUR / Twint / Vortag), Byte-Snapshots des ESC/POS-Builders, Repository-Tests gegen In-Memory-SQLite (inkl. «doppelter POST = ein Verkauf»).

### KANN (nur wenn Zeit bleibt, in dieser Reihenfolge)

1. F-Tasten für Zahlarten (F1 Bar-CHF, F2 Bar-EUR, F3 Twint, F4 Helfer).
2. Zähl-Assistent im Abschluss (Anzahl je Note/Münze, CHF und EUR).
3. Storno-Zettel (Belegnummer, Grund, Auszahlung, STORNO gross) als Beleg für die Bar-Auszahlung – nur wenn vom Auftraggeber gewünscht (offene Frage).
4. X-Bericht (Zwischenstand ohne Abschluss).
5. Farbe und Reihenfolge je Produkt (sonst Reihenfolge = `reihenfolge` aus dem Seed, Gruppe als Farbe).
6. Laminierte Ein-Seiten-Anleitung (Standardvorgang, Twint, Storno, Drucker streikt).
7. Buchungen Entnahme/Einlage mit Schubladenimpuls.

### NICHT (bewusst gestrichen)

- Kartenzahlung, Mischzahlung, Rabatte – nicht gewünscht.
- Teilstorno – nur ganzer Beleg, weniger Fehlerquellen.
- Twint parken / Warteliste – bei 20 Kunden/h unnötig.
- CSV-Export, Buchhaltungs-Import, MwSt – nicht gewünscht, Abschluss-PDF genügt.
- WebSocket – ein Client, Renderer pollt `/api/status` alle 2 s; WebSocket erst in Etappe 2.
- Zweitkasse/Server auf 0.0.0.0, iPad, mehrere Kassierer – Etappe 2, Schnittstellen bleiben offen.
- Druckerstatus per DLE EOT / Epson Status API – über den Spooler nicht lesbar, Kassier sieht die LEDs.
- Storno-Bon in Etappe 1, Standname auf Coupons, Produktbilder, Kundendisplay, Statistik mit Grafiken – nicht nötig für 2026.
- Installer, Code-Signing, Assigned Access, Windows-Kiosk-Konto – Ordner-Deploy und Kiosk-Fenster reichen.
- Native Node-Module (better-sqlite3, node-printer) – nur als Fallback, falls `node:sqlite` in Electron 44 scheitert (Zeitbox Sonntag 12 Uhr).
- Simulator-Transport als Kassier-Einstellung – nur im Dev-Modus.

### Kürzungsregel (Notbremse, nur bei Rückstand)

Ist der Kassen-Laptop am Dienstagabend nicht verfügbar oder die Dienstag-Abnahme nicht bestanden, wird der Umfang am Mittwochmorgen schriftlich reduziert auf: Bar-CHF, Twint, Helfer, Storno letzter Beleg, Abschluss-Bon (ohne PDF), Produkte nur über Seed-Datei (keine Produktverwaltungs-UI), «Letzte Verkäufe» gestrichen. Bar-EUR nur bei Zeitreserve; Kurs-Tabelle auf Papier als Ersatz.

## 3. Architektur

- Ein npm-Projekt `kasse/` (electron-vite 5.0.0, Template react-ts, vite 7.x). Versionen gepinnt: Electron 44.3.0 (Node 24.20.0, Chromium 152), React 19.2, TypeScript 5.9, electron-builder 26.15.3, Hono 4.13.7 + @hono/node-server 2.1.1, vitest 5.0.0, iconv-lite (cp857, am Sonntag gegen `tools/testdruck.bin` verifizieren). Kein `ws`.
- `src/core/`: reine TypeScript-Geldlogik ohne Electron/DOM/Node-Imports, alle Beträge als Integer-Rappen bzw. Cent; Warenkorb, Rundung, Rückgeld, Schutzregeln, EUR-Kurs (`kurs_x10000`), Spenden, Abschluss-Aggregation, Bon-Modell (Zeilenliste) für Bon 1, Coupons und Abschluss-Bon.
- `src/server/`: Hono-Routen (`/api/...`) auf 127.0.0.1:47100, Repositories über `node:sqlite` (DatabaseSync, `journal_mode=WAL`, `synchronous=FULL`, Foreign Keys), nummerierte SQL-Migrationen; Belegnummern, Zeitstempel und Snapshots vergibt nur der Server; Verkaufs-ID kommt als UUID vom Client (Idempotenz). **Hono liefert das Renderer-Build statisch aus**; der Server ist standalone startbar (`npm run server`), damit bei Electron-Problemen Edge/Chrome im Kiosk-Modus (`msedge --kiosk http://127.0.0.1:47100`) als Plan B ohne Codeänderung bleibt (nur das Abschluss-PDF entfällt dann, der Abschluss-Bon bleibt).
- `src/main/`: Electron-Main startet Server und DB, öffnet ein Kiosk-BrowserWindow auf `http://127.0.0.1:47100` (kein `file://`, kein CORS), betreibt den Druck-Worker (`druckauftrag`), Backup-Timer, printToPDF für den Abschluss, fängt `close` ab.
- `src/renderer/`: React-UI, spricht ausschliesslich HTTP (kein IPC), pollt `/api/status` alle 2 s (Druckstatus, Ampel, Kassentag); damit später ein Browser im WLAN dieselbe UI nutzt.
- `src/print/`: Bon-Modell → ESC/POS-Bytes (ESC @, ESC t 13, ESC a, ESC E, GS !, GS V 66 0, ESC p 0 25 250) → Transport. Transport «winspool»: Bytes in `%TEMP%\kasse\job-<uuid>.bin`, `execFile('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File', <resources>/tools/print-raw.ps1, '-Printer','TM-T20II','-File', ...], { timeout: 20000, windowsHide: true })`. Das Skript behält die Job-ID aus `StartDocPrinterW`, wartet im selben Prozess bis 10 s auf das Verschwinden des Auftrags (`Get-PrintJob -ID`), entfernt einen hängenden Auftrag selbst per `Remove-PrintJob` und liefert JSON auf stdout (`{jobId, bytes, status}`); Exit 0 = vom Drucker angenommen, 2 = hing und wurde entfernt, 1 = Fehler (OpenPrinter usw.). Ein Prozess pro Beleg (ca. 0.7 s plus Wartezeit), nicht bis zu elf. Transport «simulator»: nur bei `KASSE_PRINT=sim` oder `--sim` bzw. im Dev-Modus aktiv, schreibt Bytes nach `Archiv/simulator/` und rendert eine einfache Vorschau (Text, Grösse, Ausrichtung, Schnitt); zeigt einen dauerhaften roten Banner «SIMULATOR – es wird nicht gedruckt». Im Produktbuild ist «winspool» fest verdrahtet.
- Ein Spooler-Auftrag pro Beleg (Schublade, Coupons, Bon 1 in einem WritePrinter). «Auftrag weg» heisst «vom Drucker angenommen» (4-KB-Puffer), nicht «gedruckt».
- Abschluss-PDF: HTML aus derselben Abschluss-Aggregation in verstecktem BrowserWindow, `webContents.printToPDF({ pageSize: 'A4' })`, Datei `C:\Kasse\archiv\Kassenabschluss_<Datum>_<Kasse>.pdf`.
- Daten: `C:\Kasse\data\kasse.sqlite`; Backup = `PRAGMA wal_checkpoint(TRUNCATE)` und Dateikopie mit Zeitstempel. Belegnummer wird erst nach Commit an den Druck-Worker übergeben.
- Packaging: `electron-builder --win dir`, Ordner nach `C:\Kasse` kopieren, `tools/print-raw.ps1` und `tools/setup-laptop.ps1` als extraResources; Start `C:\Kasse\Kasse.exe`, Verknüpfung in `shell:startup`. **Erster gepackter Build bereits am Sonntag** (Hello-World mit node:sqlite und RAW-Testdruck aus dem Paket), nicht erst am Freeze-Tag.

## 4. Datenmodell

Alle Beträge Integer (Rappen bzw. Cent), IDs UUID, Zeitstempel ISO lokal. Nichts wird gelöscht (Ausnahme: Werkzeug «Testdaten löschen» vor dem Event). Namen in Roadmap, Seed und Schema identisch.

| Tabelle | Felder (Kern) |
|---|---|
| produkt | id, name (≤ 24 Zeichen), preis_rappen (null = offen → inaktiv), gruppe (`coupon` / `kasse`, CHECK auf genau diese Werte), aktiv, ausverkauft, reihenfolge, erstellt_am |
| kassentag | id, datum, kasse_praefix, kassier, startgeld_chf, startgeld_eur, geoeffnet_am, abgeschlossen_am, ist_chf, ist_eur, differenz_chf, differenz_eur, bemerkung |
| verkauf | id (UUID **vom Client**, UNIQUE; Duplikat liefert den bestehenden Beleg zurück), kassentag_id, belegnr (z. B. `K1-0123`, fortlaufend pro Kasse über Kassentage), zeit, zahlart (`bar_chf` / `bar_eur` / `twint` / `helfer`), total_rappen, storniert_am (null oder Zeit), storno_id |
| position | id, verkauf_id, produkt_id, name_snapshot, preis_snapshot, anzahl, gruppe_snapshot |
| zahlung | verkauf_id, waehrung (`CHF` / `EUR`), **kurs_x10000** (CHF pro EUR × 10 000, z. B. 9000 = 0.90; null bei CHF), gegeben (in Währung, Cent bzw. Rappen), gegeben_chf_rappen (gerundeter Gegenwert), rueckgeld_chf_rappen, spende_chf_rappen, spende_typ (`bar_chf` / `bar_eur` / `twint` / null) |
| storno | id, verkauf_id (UNIQUE – ein Storno pro Beleg), kassentag_id (**Kassentag des Stornos**, nicht des Verkaufs), zeit, grund (`tippfehler` / `ausverkauft` / `abgesprungen`), auszahlung_chf_rappen, mit_pin |
| druckauftrag | id, verkauf_id (oder kassentag_id für Abschluss), typ (`beleg` / `nachdruck_alles` / `nachdruck_coupons` / `nachdruck_bon` / `abschluss` / `test`), bytes_pfad, status (`queued` / `sent` / `done` / `failed`), spooler_job_id, fehler, erstellt_am, erledigt_am |
| einstellung | key, value (eur_kurs_x10000, drucker_name, kassen_praefix, pin_hash, belegzaehler, backup_pfad_usb, port) |
| warenkorb_entwurf | id (immer 1), json, aktualisiert_am (Wiederherstellung nach Neustart) |

Kurs: Gegenwert in Rappen = gegeben_cent × kurs_x10000 ÷ 10 000, danach abgerundet auf 5 Rappen. Wächter-Test: 20 EUR bei 0.90 → 1800 Rappen; 7 EUR bei 0.93 → 651 → 650; 13 EUR bei 0.93 → 1209 → 1205. Anzeige und Bon: «Kurs 0.90».

**Abschluss-Aggregation** (alle Summen **brutto über ALLE Verkäufe des Kassentags, einschliesslich der später stornierten**; Storni ausschliesslich als Gegenbuchung über `storno.kassentag_id`, also dem Tag, an dem storniert wurde):

```
Bar-Einnahmen CHF        = Σ total                 (zahlart = bar_chf)
Bar-Spende CHF           = Σ spende_chf            (spende_typ = bar_chf)
Bar-Einnahmen EUR Stück  = Σ gegeben_eur           (zahlart = bar_eur)     // inkl. Anteil, der zur Spende wurde
Bar-Einnahmen EUR CHF-Gegenwert = Σ gegeben_chf    (zahlart = bar_eur)
Rückgeld aus EUR-Verkäufen = Σ rueckgeld_chf       (zahlart = bar_eur)
Bar-Spende EUR (CHF-Gegenwert) = Σ spende_chf      (spende_typ = bar_eur)  // informativ, steckt im EUR-Bestand
Twint-Umsatz (brutto)    = Σ total                 (zahlart = twint)
  davon storniert (bar ausbezahlt) = Σ total der Twint-Verkäufe mit Storno am heutigen Tag
Twint-Spende             = Σ spende_chf            (spende_typ = twint)
Storni                   = Anzahl und Σ auszahlung_chf über storno.kassentag_id = heutiger Tag
Helferessen              = Σ anzahl (zahlart = helfer), entgangener Umsatz = Σ anzahl × preis_snapshot
Nachdrucke               = Anzahl druckauftrag.typ LIKE 'nachdruck_%' des Tages

Soll CHF = Startgeld CHF + Bar-Einnahmen CHF + Bar-Spende CHF
         − Rückgeld aus EUR-Verkäufen − Σ Storno-Auszahlung
Soll EUR = Startgeld EUR + Bar-Einnahmen EUR Stück
Differenz CHF = Ist CHF − Soll CHF;  Differenz EUR = Ist EUR − Soll EUR

Anzahl Belege        = Verkäufe des Tages (inkl. Helfer) − am selben Tag stornierte; Storni separat
Stück je Produkt     = nur nicht stornierte Verkäufe; Spalten «verkauft» (zahlart ≠ helfer) und «Helfer»
Umsatz je Produkt    = Σ anzahl × preis_snapshot, nur zahlart ≠ helfer, nicht storniert
```

Kontrollfälle (vitest, Sonntag): Bar-CHF 11.00 verkauft und storniert → Soll = Startgeld. Bar-EUR: Total 12.00, gegeben 20 EUR bei 0.90 (Gegenwert 18.00, Rückgeld 6.00), dann storniert → Soll CHF = Startgeld − 6.00 − 12.00, Soll EUR = +20. Twint 12.00 storniert → Soll CHF = Startgeld − 12.00, Twint-Umsatz 12.00 mit «davon storniert 12.00». Helfer storniert → Auszahlung 0, kein Impuls. Vortags-Storno (Samstag-Beleg am Sonntag storniert) → nur Sonntag trägt die Auszahlung; die Stückzahlen des Samstags bleiben, wie sie abgeschlossen wurden.

## 5. Fachregeln

1. Rückgeld = Gegeben (CHF-Gegenwert) − Total, immer in CHF, nie negativ.
2. Gegeben < Total → blockierender Popup «Betrag nicht gedeckt», kein Abschluss möglich (Bar und Twint).
3. Rückgeld > 200.00 CHF → Bestätigungs-Popup; bei Twint gilt die Schwelle für die Überzahlung Gegeben − Total (die zur Spende würde).
4. Bar-EUR: Kurs aus Einstellungen wird pro Beleg gespeichert (`kurs_x10000`); Bildschirm zeigt «Total in EUR» (aufgerundet auf 0.10 EUR); CHF-Gegenwert des gegebenen Betrags = gegeben × Kurs, abgerundet auf 5 Rappen; Rückgeld in CHF nach Regel 1; im Abschluss EUR-Stück und CHF-Gegenwert getrennt.
5. CHF-Preise sind auf 5 Rappen definiert; Rundung findet nur beim EUR-Gegenwert statt, nie auf Positionen.
6. Twint: Kunde tippt den Betrag selbst, Kassier prüft die Bestätigung auf dem Kundenhandy; Betragsfeld ist mit dem Total vorbelegt, Kassier ändert nur bei Abweichung; Überzahlung wird als Twint-Spende gespeichert, kein Rückgeld.
7. Bar «stimmt so»: das Rückgeld wird als Bar-Spende (CHF bzw. EUR-Gegenwert) gebucht, Rückgeld = 0.
8. Helfer/Gratis: Total 0, keine Zahlung, Coupons werden gedruckt, Stückzahlen zählen als Helferessen, nie als Umsatz.
9. Storno nur ganzer Beleg, nur mit Grund, als Gegenbuchung dem Kassentag des Stornos zugeordnet; Auszahlung = Belegtotal bar in CHF (Spenden werden nicht zurückerstattet; Helfer-Beleg = 0); Coupons werden eingezogen; ein Beleg kann nur einmal storniert werden; letzter Beleg ohne PIN, ältere mit PIN; kein Storno-Bon.
10. Schubladenimpuls nur bei Bar-CHF, Bar-EUR und Storno mit Auszahlung > 0; nie bei Twint oder Helfer.
11. Verkauf wird gespeichert (Commit) und mit Belegnummer versehen, bevor irgendetwas gedruckt wird; Druckreihenfolge Schubladenimpuls → Coupons → Bon 1 in einem Auftrag.
12. Ein Coupon pro Produktzeile der Gruppe `coupon`: Produktname und Anzahl doppelt gross, Datum/Uhrzeit, kleine Belegnummer, «Coupon n/m»; kein Standname. Produkte der Gruppe `kasse` erscheinen nach dem Bezahlen als «Sofort ausgeben».
13. Bon 1 minimal: Positionen (Anzahl, Name, Betrag), Total, Gegeben, Rückgeld; bei Twint statt Rückgeld die Spende (falls > 0); bei EUR: Gegeben EUR, Kurs, Rückgeld CHF; bei Helfer die Zeile «HELFER»; Fusszeile Belegnummer und Uhrzeit; kein Logo, kein Vereinsname, kein Datum im Kopf.
14. Nachdruck druckt identische Daten mit Aufdruck NACHDRUCK und zählt im Abschluss; stornierte Belege werden nicht nachgedruckt.
15. Positionen speichern Name und Preis zum Verkaufszeitpunkt; Produkte werden deaktiviert, nie gelöscht.
16. Belegnummern `<Präfix>-<laufend>` pro Kasse, fortlaufend über Kassentage; Kassen-Präfix aus Einstellungen (2026: `K1`).
17. Idempotenz: der Client erzeugt die Verkaufs-UUID vor dem POST; ein zweiter POST mit derselben UUID liefert den bestehenden Beleg (keine zweite Belegnummer, kein zweiter Druck).
18. Druckaufträge werden nie automatisch nachgedruckt: hängende Spooler-Aufträge werden sofort entfernt, `queued`/`sent` beim App-Start auf `failed` gesetzt; Nachdruck nur über die Nachdruck-Funktion.

## 6. Tagesplan

| Tag | Ziel | Ergebnisse | Abnahme («am Abend kann man …») |
|---|---|---|---|
| Sa 12.9. | Entscheiden, bestellen, Drucker beweisen, Gerät festlegen | Roadmap, Entscheidungsprotokoll, Druckeranleitung; RAW-Testdruck (Umlaute PC857, Schnitt, Impuls) auf Papier abgehakt; Bestellung Brack (Schublade PCK-41 II, 2 × 5 Rollen, Kabel, Leiste, Stick, Kabelbinder) ausgelöst und Bestellbestätigung geprüft (Lieferdatum, RJ12-Kabel im Lieferumfang; falls unklar: Galaxus-Absicherung mit Abholung Winterthur); **Kassen-Laptop festgelegt** (Gerät, Adminrechte, verfügbar spätestens Di 15.9.); Preise/Produktliste angefragt; Entscheidung Reservedrucker | … den Testbon in der Hand halten, die Bestellbestätigung zeigen und sagen, welches Gerät am Samstag die Kasse ist. |
| So 13.9. | Fundament, gepackter Build, echter Druck | 08:00 `npx electron@44.3.0 smoke.js` (node:sqlite), **Zeitbox bis 12 Uhr**, sonst better-sqlite3 13.0.3 hinter der Repository-Schicht; Scaffold electron-vite react-ts, Versionen gepinnt, `npm run dev`; **Hello-World-Build `electron-builder --win dir` → `C:\Kasse`**, daraus node:sqlite im gepackten Main und RAW-Testdruck über die gepackte `print-raw.ps1`; `src/core` komplett mit vitest (Warenkorb, Rückgeld, Schutzregeln, EUR-Rundung 20/0.90, 7/0.93, 13/0.93, Twint-/Bar-Spende, Abschluss-Aggregation inkl. der Storno-Kontrollfälle, Bon-Modell); SQL-Schema + Migrationen + Repositories (Idempotenz-Test); Hono mit statischem Renderer, `/api/health`, `/api/produkte`, Seed aus `docs/produkte-seed.json`; ESC/POS-Builder mit Byte-Snapshots, iconv-lite cp857 gegen `testdruck.bin` verifiziert; winspool-Transport (execFile) + `druckauftrag`-Worker → Testdruck aus der App; Simulator (einfache Textvorschau) am Abend, falls Zeit | … `npm test` grün sehen, aus `C:\Kasse\Kasse.exe` die Produktliste aus SQLite im Fenster und einen Testbon aus der gepackten App auf dem TM-T20II. |
| Mo 14.9. | Verkaufen, alle Zahlarten, Bons auf Papier | Verkaufsbildschirm (Kacheln, Warenkorb, Ausverkauft-Toggle); Bezahlfluss Bar-CHF, Bar-EUR (mit «Total in EUR»), Twint (vorbelegt), Helfer mit Ziffernblock, Tastatur, Schnellwahl, drei Zeilen, beide Popups, «stimmt so», Button-Sperre + Client-UUID; «Sofort ausgeben»-Anzeige; abends: Coupons und Bon 1 aus dem Verkauf **echt drucken** und Layout auf Papier korrigieren (Schnittposition, Spalten, Coupon-Grössen) | … 10 Verkäufe aller Zahlarten komplett durchspielen, jeder mit echten Coupons und Bon 1 auf Papier; Doppelklick auf Bezahlen erzeugt einen Beleg. |
| Di 15.9. | Kassentag, Fehlerpfade, Storno, Abschluss-Bon, Laptop | Vormittag: Kassentag-Start, Wiederaufnahme, Warenkorb-Entwurf; Job-Überwachung (`print-raw.ps1` mit Job-ID/Warten/Remove-PrintJob/JSON), Fehleranzeige, Handschreib-Liste, Ampel «Druck OK / Druck prüfen», alte Aufträge beim Start verwerfen, `queued`/`sent` → `failed`; Nachdruck; Storno letzter Beleg (Impuls nur bei Auszahlung > 0, zweiter Storno abgelehnt); Nachmittag: Abschluss-Bildschirm mit Ist-Zählung und Abschluss-Bon aus der core-Aggregation; Abend: **Kassen-Laptop**: `tools/setup-laptop.ps1` (Add-Printer, powercfg, Autostart, Windows-Update pausieren), RAW-Testdruck, gepackte App starten | … einen kompletten Verkauf auf dem TM-T20II drucken, nachdrucken, stornieren, einen Abschluss-Bon mit korrekter Differenz drucken; **USB gezogen: Verkauf gespeichert, Auftrag failed und aus der Warteschlange entfernt, Handschreib-Liste sichtbar, alles innert 15 s; USB wieder dran: kein alter Ausdruck**; die gepackte App läuft auf dem Kassen-Laptop. |
| Mi 16.9. | PDF, Verwaltung, Backup, Paket, Freeze | Vormittag: Schubladentest mit echter Last (Impuls, m=0/1); Abschluss-PDF via printToPDF, Sonntag-Startgeldvorschlag, Vortag-Warnung; «Letzte Verkäufe» mit PIN und Storno älterer Belege; Produktverwaltung und Einstellungen hinter PIN, Testdruck-Button, «Testdaten löschen»; Backup-Timer + USB-Stick (inkl. Kopie von `C:\Kasse`); Kiosk-Härtung (Ctrl+Shift+Q + PIN, `close` abgefangen), Single-Instance, powerSaveBlocker; finaler Build → `C:\Kasse` auf Dev-Rechner und Kassen-Laptop; Fehlerfälle: Rolle leer, Neustart mitten im Vorgang mit offenem Druckauftrag; Wortlaut aller Popups; 12 Uhr Kürzungsregel prüfen; **Feature-Freeze schriftlich am Abend** mit Build-Stand (Datum/Hash) | … aus `C:\Kasse\Kasse.exe` auf dem Kassen-Laptop einen ganzen Kassentag inkl. Abschluss-Bon und PDF fahren; Backup-Datei auf dem Stick jünger als 10 Minuten; harter Neustart → Verkaufsbildschirm mit Warenkorb innert 60 s nach Anmeldung; kein Dev-Werkzeug auf dem Zielgerät nötig. |
| Do 17.9. | Trockenlauf, Fixes, Kurz-Regression | Vormittag: Testplan (Abschnitt 8) mit der Person, die kassiert; Fixes bis 16 Uhr; danach **Kurz-Regression** (Testfälle 1, 2, 3, 6, 7, 9, 14, 17, 18, 19, 22, 26–29) mit neuem Build und frischer DB; Build-Stand aufs Notfallblatt; Fixes nach 18 Uhr nur noch als Papier-Workaround; «Testdaten löschen», Produktliste final, Kurs, PIN gesetzt; letzten Kassentag der Regression **bewusst offen lassen** (Vortagswarnung am Freitag real); Coupon-Vorlage A4 erstellen, 20 Bögen am ET-3850 drucken, schneiden; Papier-Notfallkiste gepackt; Lagerstand Reservedrucker prüfen (falls nicht bestellt) | … der Kassier alle Testfälle ohne Hilfe des Entwicklers bestehen; Abschluss-PDF im Archiv, Backup auf Stick, Regression nach dem letzten Fix grün. |
| Fr 18.9. | Aufbau vor Ort, kein Code | Strom, Tisch, Regenschutz, Kabel fixiert (USB, Netzteil, RJ12), App-Start am Standort zeigt Vortagswarnung (Testfall 24) → Abschluss nachholen, Testverkauf drucken, dann «Testdaten löschen» (0 Belege abhaken), Twint-QR laminiert, Notfallkiste, Startgeld gestückelt, Notfallblatt am Kassenplatz (Kontaktnummer, Windows-Passwort des Kassenkontos, Build-Stand, Ablauf «Drucker streikt») | … einen Testverkauf am Standort drucken und danach eine leere Kasse (0 Belege, Produkte und Einstellungen vorhanden) zeigen. |
| Sa 19.9. | Kassentag 1 | 11:30 Start Kassentag mit Startgeld; Entwickler die ersten zwei Stunden an der Kasse und erreichbar; 19:15 Abschluss mit Ist-Zählung, Bon + PDF, Backup auf Stick, Bargeld nach Stückelung sichern | … Abschluss-Bon unterschrieben, Stick in der Tasche. |
| So 20.9. | Kassentag 2 | Start mit vorgeschlagenem Startgeld (editierbar); Betrieb; Abschluss; Backup; Notizen für die Retrospektive | … beide Abschlüsse vorliegen haben und die Liste der Verbesserungen für Etappe 2. |

## 7. Hardware- und Materialcheckliste

- [x] Epson TM-T20II, USB-Druckerklasse, Warteschlange «TM-T20II» (Generic / Text Only, USB001), Netzteil 24 V
- [x] Testdruck am 12.9. bestätigt: Umlaute und türkische Zeichen korrekt (PC857), Teilschnitt korrekt; Schubladenimpuls erst mit Schublade prüfbar
- [x] Kassen-Laptop: volle Adminrechte bestätigt (12.9.); Gerät benannt, spätestens Di 15.9. verfügbar (Netzteil, Maus, Tastatur, Akku, USB-Ports); Windows-Passwort des Kassenkontos bekannt
- [x] Kassenschublade 4POS/Epson PCK-41 II, 24 V, RJ12 – am 12.9. bei Brack bestellt; beim Auspacken RJ12-Kabel prüfen (Zweitquelle Galaxus CHF 147, Di–Mi, Abholung Winterthur, 30 Tage Rückgabe)
- [ ] Thermopapier 80 × 80 × 12 mm, 2 × 5 Rollen (4POS, Brack CHF 17.20 je Packung); Bedarf ca. 3 Rollen, Rest Reserve
- [ ] USB-A–USB-B-Kabel 2 m Reserve (Brack CHF 6.60), Kabelbinder (CHF 6.85) als Zugentlastung
- [ ] Steckdosenleiste 5 × T13 mit Schalter (CHF 7.90), Verlängerungskabel Aussenbereich (vorhanden?)
- [ ] USB-Stick 64 GB für Backup und Kopie von `C:\Kasse` (CHF 15.95), beschriftet
- [ ] Twint-QR des Vereins laminiert (A5), Kurs-Tabelle EUR auf Papier (Notfall)
- [ ] Notfallkiste: 20 A4-Couponbögen (ET-3850, geschnitten), Preisliste mit Rückgeldtabelle, Kassenbuch mit Strichliste, Kugelschreiber, Ersatzrollen, Schubladenschlüssel, Klebeband, Notfallblatt
- [ ] Reservedrucker: Entscheidung heute (offene Frage). Falls ja: Epson TM-T20IV, Brack CHF 153.00, 4 an Lager, mitbestellen und am Donnerstag mit eigener Warteschlange testen (USB-Modus des T20IV nicht geprüft). Falls nein: Ausfall am Samstag = Papier-Coupons bis Eventende; Brack liefert und gibt nur Mo–Fr heraus, für Sonntag ist über Brack nichts beschaffbar; Galaxus Winterthur (Sa/So 10–20) hat keinen belegten Druckerbestand
- [ ] Ersatzgerät für «PC tot» benannt (zweiter Laptop eines Vereinsmitglieds?) und am Freitag einmal von Stick gestartet; sonst Papierkasse bis Feierabend

## 8. Testplan Trockenlauf (Do 17.9., mit dem Kassier)

Vorher: DB leer («Testdaten löschen»), Produkte final, Kurs gesetzt, PIN gesetzt, Drucker echt (kein Simulator-Banner), Stick eingesteckt.

1. Kassentag starten: Startgeld 300.00 CHF, Kürzel eingeben → Verkaufsbildschirm, Kopfzeile zeigt Kassentag und Ampel «Druck OK».
2. Bar-CHF passend: 1x Winti Burger (11.00), Gegeben 11.00 per Tastatur, Enter → Rückgeld 0.00, Schublade öffnet, 1 Coupon «1x Winti Burger», Bon 1.
3. Bar-CHF mit Rückgeld: 2x Winti Burger mit Pommes + 2x Getränk Dose (35.00), Schnellwahl 50 → Rückgeld 15.00; Bildschirm «Sofort ausgeben: 2x Getränk Dose»; Coupon «2x Winti Burger mit Pommes», kein Coupon für Dosen.
4. Nicht gedeckt: Total 75.00, Gegeben 60 → blockierender Popup, Korrektur auf 100 → Rückgeld 25.00.
5. Rückgeld über 200: Total 12.00, Gegeben 1000 → Bestätigungs-Popup; abbrechen (Esc), dann mit 20 abschliessen.
6. Bar «stimmt so»: Total 17.00, Gegeben 20, «stimmt so» → Rückgeld 0, Bon zeigt Spende 3.00.
7. Bar-EUR krumm: Total 12.00 CHF bei Kurs 0.93 → Bildschirm «Total in EUR 13.00» (12.00 ÷ 0.93 = 12.90 → 13.00); Gegeben 13 EUR → Gegenwert 12.09 → abgerundet 12.05 → Rückgeld 0.05 CHF; Bon zeigt 13.00 EUR, Kurs 0.93, Rückgeld 0.05. Zweiter Fall: Total 5.00, Gegeben 7 EUR → 6.51 → 6.50 → Rückgeld 1.50; Bon zeigt 6.50.
8. Bar-EUR nicht gedeckt: Total 12.00, Gegeben 10 EUR → Popup.
9. Twint normal: Total 17.00, Betrag steht vorbelegt auf 17.00, «Bezahlt, geprüft» → keine Schublade, Coupons + Bon 1 ohne Rückgeldzeile.
10. Twint Überzahlung: Total 75.00, Betrag auf 80.00 ändern → Spende 5.00 auf Bon und im Abschluss.
11. Twint Unterzahlung: Total 17.00, Betrag auf 15.00 → blockierender Popup; Kunde zahlt 2.00 nach → Betrag auf 17.00 korrigieren, abschliessen.
12. Helfer: 2x Lahmacun, 1x Ayran als Helfer → Total 0, keine Schublade, Coupon «2x Lahmacun», «Sofort ausgeben: 1x Ayran».
13. Ausverkauft-Toggle: Gözleme auf ausverkauft → Kachel grau, nicht wählbar; zurückschalten.
14. Storno letzter Beleg: Fall 3 stornieren, Grund «Tippfehler» → Schublade öffnet (Auszahlung 35.00), kein Bon; Beleg in «Letzte Verkäufe» als storniert; Nachdruck dieses Belegs wird mit «Beleg storniert» verweigert; zweiter Storno-Versuch wird abgelehnt.
15. Storno älterer Beleg: Fall 6 über «Letzte Verkäufe» → PIN-Abfrage, falsche PIN abgelehnt, richtige PIN → Storno mit Auszahlung 17.00 (Spende 3.00 wird nicht erstattet).
16. Nachdruck: letzter nicht stornierter Beleg nur Coupons → Aufdruck NACHDRUCK; Zähler im Abschluss steigt.
17. Rolle leer: Papier während eines Verkaufs mit 3 Coupons entfernen → Error-LED, Kasse zeigt «Drucker prüfen» und Handschreib-Liste; Rolle einlegen, Deckel zu; prüfen, ob der Rest gedruckt wird, sonst Nachdruck. Verhalten notieren.
18. USB gezogen: USB abziehen, Verkauf abschliessen → Verkauf gespeichert, Auftrag failed, Ampel «Druck prüfen», `Get-PrintJob -PrinterName TM-T20II` ist leer; USB einstecken → nichts druckt von selbst, Ampel nach nächstem erfolgreichem Auftrag «Druck OK», Nachdruck manuell.
19. Neustart mitten im Vorgang: Verkauf abschliessen und sofort Laptop hart ausschalten, dann Warenkorb mit 3 Positionen anlegen und erneut hart ausschalten; einschalten → App startet automatisch, Kassentag offen (kein zweites Startgeld), letzter Verkauf vorhanden, Warenkorb wiederhergestellt, kein automatischer Ausdruck.
20. Produktverwaltung: PIN, Preis Dürüm setzen (Kachel erscheint), Produkt «Test» anlegen, Name mit 25 Zeichen wird abgelehnt, verkaufen, danach deaktivieren → Kachel weg, Verkauf bleibt mit Snapshot.
21. Drucker-Testdruck aus Einstellungen: Umlaute ä ö ü, Gözleme, Dürüm, Schnitt, Impuls.
22. Abschluss mit Differenz: Ist-Zählung bewusst 5.00 zu wenig → Differenz −5.00 rot, EUR-Zählung stimmt; Abschluss-Bon und PDF im Archiv, Backup auf Stick; alle Zeilen (Startgeld, Bar CHF brutto, Bar EUR Stück/Gegenwert, Rückgeld aus EUR, Twint brutto mit «davon storniert», Spenden 3-fach, Storni Anzahl/Betrag, Helferessen, Nachdrucke, Belege, Stück je Produkt verkauft/Helfer, Kassier, Unterschrift) nachrechnen: Soll CHF muss 300 + Bar-CHF-Brutto + Bar-Spende − EUR-Rückgeld − Storno-Auszahlungen ergeben.
23. Sonntag-Startgeld: neuen Kassentag starten → Vorschlag = gezählter Endbestand, auf 300.00 ändern, starten.
24. Nicht abgeschlossener Vortag: der offene Kassentag aus Fall 23 bleibt bis Freitag offen; beim App-Start am Freitag am Standort muss die Warnung erscheinen und der Abschluss nachholbar sein.
25. Kiosk verlassen und Beenden: Alt+F4 → PIN-Abfrage (abbrechen); Ctrl+Shift+Q → PIN → Fenster schliessbar; Doppelstart der App öffnet keine zweite Instanz.
26. Storno Bar-EUR-Beleg: Fall 7 (erster Teil) stornieren → Auszahlung 12.00 CHF bar, EUR-Schein bleibt in der Lade; im Abschluss Soll CHF −12.05 gegenüber vorher (Rückgeld 0.05 bleibt abgezogen, plus 12.00 Auszahlung), Soll EUR unverändert +13.
27. Storno Twint-Beleg: Fall 9 stornieren → Auszahlung 17.00 bar, Schublade öffnet; Abschluss zeigt Twint-Umsatz 17.00 brutto mit «davon storniert 17.00».
28. Storno Helfer-Beleg: Fall 12 stornieren → Auszahlung 0, Schublade öffnet nicht, Helferessen-Stück sinken.
29. Neustart mit offenem Druckauftrag: USB abziehen, Verkauf abschliessen, App sofort beenden (Ctrl+Shift+Q + PIN), USB einstecken, App starten → Druckauftrag steht auf failed, Anzeige «nicht gedruckt», nichts druckt von selbst; Nachdruck manuell.
30. Abschluss ohne Verkauf: Kassentag starten und sofort abschliessen → Soll = Startgeld, alle Zeilen 0, Bon und PDF ohne Fehler.
31. Doppelklick: «Bezahlen» doppelt schnell klicken → ein Beleg, eine Belegnummer, ein Ausdruck.
32. Abschluss-Bon bei Druckerausfall: USB ziehen, Abschluss durchführen → PDF vorhanden, Abschluss-Bon failed mit Nachdruck-Möglichkeit nach Anstecken.

## 9. Notfallplan am Eventtag

**Drucker tot** (keine LED, Fehler bleibt nach Aus/Ein und USB-Neustecken, Selbsttest schlägt fehl): Kasse läuft weiter, Aufträge landen auf failed, Ampel «Druck prüfen». Kassier schreibt Coupons von Hand nach der Bildschirmliste (vorgedruckte A4-Couponbögen aus der Notfallkiste, Belegnummer drauf). Rückgeld vom Bildschirm ablesen, Schublade mit Schlüssel öffnen. Bon 1 entfällt. Ersatzbeschaffung am Wochenende ist über Brack nicht möglich (Abholung und Versand nur Mo–Fr); ohne mitbestellten Reservedrucker gilt bis Eventende die Papiervariante. Falls Reservedrucker vorhanden: anstecken, Warteschlange gemäss Notfallblatt, Testdruck aus Einstellungen.

**PC tot** (kein Start, kein Bild): Papierkasse aus der Notfallkiste: Kassenbuch mit Strichliste je Produkt und Zahlart, Preisliste mit Rückgeldtabelle, Papier-Coupons. Twint läuft weiter (QR laminiert). Falls ein Ersatzgerät benannt und am Freitag getestet wurde: Ordner `C:\Kasse` vom Stick kopieren, `setup-laptop.ps1` ausführen, jüngstes Backup nach `C:\Kasse\data\kasse.sqlite` kopieren, App starten. Sonst am Abend Strichliste in die Kasse nachtragen (Sammelbelege) oder als Papier-Abschluss archivieren.

**Strom weg**: Laptop läuft auf Akku weiter (Verkäufe möglich), Drucker und Schublade nicht. Coupons von Hand, Schublade mit Schlüssel. Strom zurück → Drucker ein; die App hat hängende Aufträge bereits entfernt, es druckt nichts von selbst; Nachdruck nur bei Bedarf. Bildschirmhelligkeit runter, Kasse nicht schlafen lassen.

**App abgestürzt / Fenster weg**: Verknüpfung `C:\Kasse\Kasse.exe` doppelklicken (Single-Instance verhindert Doppelstart); Kassentag und Warenkorb kommen zurück. Plan B ohne Electron: `C:\Kasse\server.cmd` starten und `msedge --kiosk http://127.0.0.1:47100` (Abschluss-PDF entfällt, Bon bleibt).

## 10. Etappe 2 (nach der Kirmes)

- Retrospektive mit dem Kassier: Wortlaut, Reihenfolge, was gefehlt hat; Abschlusszahlen gegen Twint-Portal abgleichen (Twint-Umsatz brutto).
- Surface mit Touch: Kachelgrössen, Ziffernblock, Bildschirmtastatur unterdrücken, Gesten.
- Mehrere Kassierer: Kassier-Entität, Schichtwechsel mit Zwischenzählung, PIN pro Kassier.
- Browser-Zweitkasse im WLAN (iPad): Server auf 0.0.0.0, Firewall-Regel, Reise-Router, WebSocket für Live-Updates, Kassen-ID pro Verkauf, Abschluss pro Kasse.
- Statistik: Umsatz pro Stunde und Produkt, Jahresvergleich, Event-Entität; Abschluss-Bon pro Stand als Zählliste.
- Betrieb: X-Bericht, Entnahme/Einlage, Storno-Zettel, Twint parken, Druckerstatus (Papier bald leer), Testmodus mit separater DB, laminierte Anleitung.

## 11. Offene Punkte (Auftraggeber liefert)

1. Kassen-Laptop: welches Gerät, Windows-Version, Adminrechte, USB-Ports, Akku; verfügbar spätestens Di 15.9.? Falls kein Laptop: geht der Dev-Desktop mit Monitor an den Stand?
2. Preise für Dürüm, Adana Dürüm, Ayran, Wasser still, Wasser prickelnd; Bestätigung der übrigen Preise. *12.9.: vorläufig selbst definieren, finale Preise folgen.*
3. Finale Produktliste (Namen exakt wie auf dem Coupon, max. 24 Zeichen; Mocktail bleibt `coupon`?).
4. ~~4-stellige PIN~~ – 12.9. geliefert (steht nicht in den Dokumenten, nur im Notfallblatt).
5. Startgeld Samstag (CHF) und Stückelung; Startgeld EUR (vermutlich 0).
6. ~~EUR-Kurs~~ – 12.9.: 0.90 CHF pro EUR akzeptiert. Offen: nur Noten oder auch Münzen?
7. ~~Twint-QR~~ – 12.9.: wird ausgedruckt und liegt am Kassentisch; für die Software nicht relevant.
8. Kürzel des Kassiers; wer kassiert Samstag, wer Sonntag?
9. ~~Ergebnis des heutigen Testdrucks~~ – erledigt 12.9.: Zeichen und Schnitt bestätigt.
10. ~~Storno-Annahmen~~ – 12.9. bestätigt: Rückzahlung = Belegtotal ohne Spende, bar aus der Schublade, kein Storno-Bon.
11. ~~Bestellung Brack~~ – 12.9. ausgelöst. Offen: Lieferdatum laut Bestätigung, RJ12-Kabel im Lieferumfang?
12. Reservedrucker TM-T20IV (CHF 153) mitbestellen oder Papier-Notfall bis Eventende akzeptieren?
13. Ersatzgerät für «PC tot» vorhanden?
14. Windows-Passwort des Kassenkontos aufs Notfallblatt oder Auto-Login (nur wenn Vereinsgerät)?
15. Stromversorgung am Stand (Steckdose, Verlängerungskabel Aussenbereich) und Regenschutz für Laptop/Drucker?
16. Telefonnummer des Entwicklers fürs Notfallblatt?
