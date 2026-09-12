# Entscheidungsprotokoll Kasse WintiKirmes 2026 (Fassung 2)

Alle Einträge vom 12.9.2026. Quelle «Auftraggeber» = heute verbindlich entschieden; «Analyse» = aus `docs/analyse-2026-09-12.md` und den Recherchen (Drucker, Beschaffung, Technik) abgeleitet; «Kritik» = nach der Kritikrunde vom 12.9. ergänzt oder korrigiert. Einträge mit «Annahme» sind vom Auftraggeber noch zu bestätigen (siehe Roadmap Abschnitt 11).

| Nr | Thema | Entscheidung | Datum | Quelle |
|---|---|---|---|---|
| 1 | Go-live | Produktivbetrieb Sa 19. und So 20.9.2026, zwei Kassentage, Sennhof/Winterthur. | 12.9.2026 | Auftraggeber |
| 2 | Zahlarten | Bar-CHF, Bar-EUR, Twint (statischer QR), Helfer/Gratis. Keine Karte, keine Mischzahlung, keine Rabatte. | 12.9.2026 | Auftraggeber |
| 3 | Bar-EUR | Rückgeld immer in CHF; Kurs als Einstellung zugunsten des Vereins, pro Beleg gespeichert (`kurs_x10000`); Gegenwert auf 5 Rappen abgerundet; Bildschirm zeigt «Total in EUR» (aufgerundet auf 0.10 EUR). | 12.9.2026 | Auftraggeber / Kritik |
| 4 | Twint | Kunde tippt Betrag selbst, Kassier prüft Bestätigung auf dem Kundenhandy; Betragsfeld mit Total vorbelegt, ein Tipp «Bezahlt, geprüft»; Überzahlung = Twint-Spende; 200er-Schutz und «nicht gedeckt» gelten auch bei Twint. | 12.9.2026 | Auftraggeber / Kritik |
| 5 | Helfer/Gratis | 0 CHF, Coupons werden gedruckt, Stückzahlen zählen, Abschlusszeile «Helferessen» (entgangener Umsatz), keine Einnahme. | 12.9.2026 | Auftraggeber |
| 6 | Rückgeld-Schutz | Nicht gedeckt = blockierender Popup; Rückgeld > 200 CHF = Bestätigungs-Popup (Bar und Twint). | 12.9.2026 | Auftraggeber |
| 7 | Bar-Spende | «stimmt so»-Button bucht das Rückgeld als Bar-Spende (CHF oder EUR getrennt). | 12.9.2026 | Auftraggeber |
| 8 | Anzeige Bezahlen | Drei Zeilen Total / Gegeben / Rückgeld, Rückgeld am grössten; bleibt bis zum nächsten Verkauf stehen. | 12.9.2026 | Auftraggeber / Analyse |
| 9 | Drucker | Epson TM-T20II, USB-Druckerklasse (Port USB001), Warteschlange «TM-T20II» mit «Generic / Text Only», RAW ESC/POS über winspool (`tools/print-raw.ps1`). Keine Epson-Software. | 12.9.2026 | Auftraggeber / Analyse |
| 10 | Codepage | PC857 (ESC t 13) für ä ö ü und ç ğ ı ş; «EUR» ausgeschrieben, kein Euro-Zeichen. | 12.9.2026 | Auftraggeber / Analyse |
| 11 | Kassenschublade | 24 V, RJ12 am DK-Port; Impuls ESC p 0 25 250 nur bei Bar-CHF, Bar-EUR und Storno mit Auszahlung > 0. Bestellung heute: 4POS/Epson PCK-41 II bei Brack; Bestellbestätigung auf Lieferdatum und RJ12-Kabel prüfen. | 12.9.2026 | Auftraggeber / Analyse / Kritik |
| 12 | Gerät | 2026 Laptop mit Maus und Tastatur; später Surface mit Touch. UI touch-tauglich (grosse Kacheln, eigener Ziffernblock) und voll per Maus/Tastatur bedienbar. Das konkrete Gerät wird heute festgelegt und ist spätestens Di 15.9. verfügbar. | 12.9.2026 | Auftraggeber / Kritik |
| 13 | Coupons | Ein Abholcoupon pro Produktzeile mit Anzahl; Produktname und Anzahl gross, Datum/Uhrzeit, kleine Belegnummer, «Coupon n/m»; kein Standname. Produktnamen max. 24 Zeichen. | 12.9.2026 | Auftraggeber / Kritik |
| 14 | Produktgruppen | Zwei Gruppen mit den Werten `coupon` (Essen, Mocktail: Abholcoupon) und `kasse` (übrige Getränke, sofort an der Kasse) in Seed, Schema (CHECK) und Roadmap. Bildschirm zeigt nach dem Bezahlen «Sofort ausgeben». | 12.9.2026 | Auftraggeber / Kritik |
| 15 | Bon 1 | Wird immer gedruckt, minimal: Positionen, Total, Gegeben, Rückgeld (Twint: Spende; EUR: gegeben EUR, Kurs, Rückgeld CHF), Fusszeile Belegnummer und Uhrzeit. Kein Logo, kein Vereinsname, kein Datum im Kopf. | 12.9.2026 | Auftraggeber |
| 16 | Druckreihenfolge | Verkauf speichern (Commit) vor Druck; ein Auftrag: Schubladenimpuls (nur Bar) → Coupons → Bon 1. | 12.9.2026 | Auftraggeber |
| 17 | Nachdruck | Letzter Beleg: alles / nur Coupons / nur Bon 1, Aufdruck NACHDRUCK, Zähler im Abschluss; stornierte Belege werden nicht nachgedruckt. | 12.9.2026 | Auftraggeber / Kritik |
| 18 | Druckerausfall | Kasse läuft weiter, zeigt Handschreib-Liste; vorgedruckte A4-Couponbögen (ET-3850, am Donnerstag gedruckt) als Notfallplan. | 12.9.2026 | Auftraggeber / Kritik |
| 19 | Storno | Letzter Beleg mit einem Tipp und Pflichtgrund (Tippfehler, ausverkauft, Kunde abgesprungen); ganzer Beleg; Auszahlung bar CHF = Belegtotal ohne Spende (Annahme); Coupons eingezogen; ältere Belege über «Letzte Verkäufe» nur mit PIN; Gegenbuchung dem Kassentag des Stornos zugeordnet, nie löschen; ein Storno pro Beleg; eigene Abschlusszeile; kein Teilstorno; **kein Storno-Bon in Etappe 1** (Storno-Zettel nur als KANN, falls gewünscht). | 12.9.2026 | Auftraggeber / Kritik |
| 20 | Kassentag | Entität mit Startgeld und Kassier-Kürzel; Programmstart führt offenen Kassentag fort (kein zweites Startgeld), Warenkorb wird wiederhergestellt; Tag 2 schlägt gezählten Endbestand vor; Warnung bei nicht abgeschlossenem Vortag. | 12.9.2026 | Auftraggeber |
| 21 | Kassenabschluss | Ist-Zählung mit Differenz; Zeilen: Startgeld, Bar CHF (brutto), Bar EUR (Stück und CHF-Gegenwert), Rückgeld aus EUR-Verkäufen, Twint (brutto, mit «davon storniert»), Spenden (Bar CHF / Bar EUR / Twint), Storni (Anzahl/Betrag), Helferessen, Nachdrucke, Soll/Ist/Differenz CHF und EUR, Anzahl Belege (ohne stornierte), Stück je Produkt (verkauft / Helfer getrennt, ohne stornierte) und Umsatz je Produkt, Kassier, Unterschriftslinie. Bon und PDF im Archivordner. Kein CSV, kein Buchhaltungsimport, keine MwSt. | 12.9.2026 | Auftraggeber / Kritik |
| 22 | Produktverwaltung | Im Frontend hinter 4-stelliger PIN; Produkt = Name (≤ 24 Zeichen), Preis, Gruppe, aktiv/inaktiv; deaktivieren statt löschen; Ausverkauft-Toggle auf der Kachel ohne PIN; Positionen mit Name/Preis-Snapshot. | 12.9.2026 | Auftraggeber / Kritik |
| 23 | Kassen und Kassierer | 2026 genau eine Kasse und eine Kassier-ID; Belegnummern mit Kassen-Präfix (`K1-0001`); IDs als UUID. Mehrere Kassierer erst übernächste Kirmes. | 12.9.2026 | Auftraggeber |
| 24 | Last | Ca. 20 Kunden/h; Druckdauer unkritisch, ein PowerShell-Prozess pro Beleg (ca. 0.7 s plus Wartezeit auf den Spooler) akzeptiert. | 12.9.2026 | Auftraggeber / Analyse |
| 25 | iOS | 2026 nur Windows. «iOS» = iPad als Browser-Zweitkasse im WLAN in der Zukunft; Architektur Server + Web-UI hält das offen. Keine native App. | 12.9.2026 | Auftraggeber |
| 26 | Backup | Lokal: automatische DB-Kopie in Backup-Ordner und auf USB-Stick (falls eingesteckt), bei Abschluss und alle 10 Minuten; auf dem Stick zusätzlich der komplette Ordner `C:\Kasse`. | 12.9.2026 | Auftraggeber / Kritik |
| 27 | Sprache | UI und Belege Deutsch (Schweiz, ss statt ß); türkische Zeichen in Produktnamen. | 12.9.2026 | Auftraggeber |
| 28 | Vorgehen | Roadmap Sa 12.9.; Coding So 13.9. bis Mi 16.9.; Feature-Freeze Mi abends mit notiertem Build-Stand; Do Trockenlauf vormittags, Fixes bis 16 Uhr, danach Kurz-Regression mit neuem Build; Fr Aufbau; kein Code ab Freitag. | 12.9.2026 | Auftraggeber / Kritik |
| 29 | Stack | Reiner TypeScript-Stack, ein npm-Projekt: `src/core` (Geldlogik, Integer-Rappen, vitest), `src/server` (Hono + node:sqlite, liefert Renderer statisch aus, standalone startbar), `src/renderer` (React, nur HTTP), `src/main` (Electron-Hülle), `src/print`. Kein Flutter, .NET, Tauri, kein Monorepo. | 12.9.2026 | Analyse / Kritik |
| 30 | Versionen | Electron 44.3.0 gepinnt (Node 24.20.0), electron-vite 5.0.0 mit vite 7.x, React 19.2, TypeScript 5.9, electron-builder 26.15.3, Hono 4.13.7, @hono/node-server 2.1.1, vitest 5.0.0, iconv-lite. Kein `ws`. | 12.9.2026 | Analyse (Technik-Recherche) / Kritik |
| 31 | Datenbank | `node:sqlite` (DatabaseSync, WAL, `synchronous=FULL`, Foreign Keys) im Main-Prozess; Rauchtest So 13.9. 08:00 mit Zeitbox bis 12 Uhr, sonst better-sqlite3 13.0.3 hinter der Repository-Schicht (mit @electron/rebuild 4.2.0), Entscheid schriftlich hier nachtragen. Datei `C:\Kasse\data\kasse.sqlite`, nummerierte Migrationen. | 12.9.2026 | Analyse / Kritik |
| 32 | HTTP-Server | Hono im Electron-Main auf 127.0.0.1:47100; BrowserWindow lädt `http://127.0.0.1:47100` (kein file://); Renderer spricht nur HTTP und pollt `/api/status` alle 2 s; kein WebSocket in Etappe 1; Belegnummern, Zeitstempel, Snapshots nur vom Server; Verkaufs-UUID vom Client (Idempotenz). Später 0.0.0.0 für Zweitkasse. | 12.9.2026 | Analyse / Kritik |
| 33 | Druckpfad | Drei Schichten: Bon-Modell → ESC/POS-Bytes (reine Funktion, Byte-Snapshots) → Transport. winspool via `print-raw.ps1` als Kindprozess: Skript behält Job-ID, wartet im selben Prozess bis 10 s, entfernt hängenden Auftrag per `Remove-PrintJob`, liefert JSON; Exit 0 angenommen / 2 entfernt / 1 Fehler. `druckauftrag`-Tabelle, Worker sequenziell; beim Start alte Spooler-Aufträge verwerfen und `queued`/`sent` auf `failed`. Simulator nur im Dev-Modus (`KASSE_PRINT=sim`) mit rotem Banner, im Produktbuild fest winspool. Kein natives Modul. | 12.9.2026 | Analyse / Kritik |
| 34 | Druckerstatus | Kein DLE EOT, keine Status API; Ampel nur «Druck OK / Druck prüfen» aus Spooler-Jobstatus; Papierende erkennt der Kassier an den LEDs. | 12.9.2026 | Analyse (Drucker-Recherche) / Kritik |
| 35 | Abschluss-PDF | Electron `printToPDF` (A4) aus HTML in verstecktem BrowserWindow, Ablage `C:\Kasse\archiv\`. Kein pdfkit/pdfmake. | 12.9.2026 | Analyse |
| 36 | Packaging | `electron-builder --win dir` → Ordner `C:\Kasse`, kein Installer, kein Signing, kein portable-Target; `print-raw.ps1` und `setup-laptop.ps1` als extraResources; Autostart-Verknüpfung in `shell:startup`; Kiosk-BrowserWindow, Beenden nur Ctrl+Shift+Q + PIN, `close` (Alt+F4) abgefangen, Single-Instance, powerSaveBlocker. Erster gepackter Build am So 13.9. | 12.9.2026 | Analyse / Kritik |
| 37 | Energie / Laptop-Setup | `tools/setup-laptop.ps1` (Add-Printer, powercfg: Standby/Ruhezustand nie, selektives USB-Energiesparen aus, Autostart-Verknüpfung, Windows-Update pausieren) wird am Di 15.9. auf dem Kassen-Laptop ausgeführt (Adminrechte nötig); dazu manuell Hub-Energieverwaltung aus und Zuklappen «Nichts tun». | 12.9.2026 | Analyse / Kritik |
| 38 | Beschaffung | Entschieden: Kassenschublade heute bestellen (PCK-41 II, Brack CHF 139). Vorschlag Analyse für dieselbe Bestellung: 2 × 5 Rollen 4POS 80/80/12 (CHF 34.40), USB-Kabel, Steckdosenleiste, USB-Stick 64 GB, Kabelbinder. Reservedrucker TM-T20IV (Brack CHF 153): Entscheid des Auftraggebers heute (offene Frage); Galaxus-Absicherung für die Schublade optional (Abholung Winterthur, Retoure). | 12.9.2026 | Auftraggeber / Analyse (Beschaffungs-Recherche) / Kritik |
| 39 | Papier | Nur 80-mm-Rollen, max. 83 mm Durchmesser, Kern 12 mm; kein 58-mm-Umbau. | 12.9.2026 | Analyse |
| 40 | Gestrichen | Teilstorno, Storno-Bon (Etappe 1), Twint parken, CSV, WebSocket, Zweitkasse 2026, Statistik-Grafiken, Kundendisplay, Produktbilder, Installer/Signing, Assigned Access, Standname auf Coupons, native Module, Simulator als Kassier-Einstellung. | 12.9.2026 | Auftraggeber / Analyse / Kritik |
| 41 | Soll-Formeln | Alle Abschluss-Summen brutto über alle Verkäufe des Kassentags (inkl. später stornierte); Storni ausschliesslich als Gegenbuchung (− Auszahlung CHF) am Tag des Stornos; Twint-Umsatz brutto mit Zeile «davon storniert». Formeln und Kontrollfälle in Roadmap Abschnitt 4, als vitest-Fälle am Sonntag. | 12.9.2026 | Kritik |
| 42 | Idempotenz | Verkaufs-UUID im Client, UNIQUE in der DB, Duplikat liefert den bestehenden Beleg; «Bezahlen»-Button nach erstem Klick gesperrt. | 12.9.2026 | Kritik |
| 43 | Tastatur | Ziffern, Punkt/Komma, Backspace, Enter, Esc im Bezahldialog sind MUSS (Hauptbedienweg 2026); F-Tasten für Zahlarten KANN. | 12.9.2026 | Kritik |
| 44 | Testdaten löschen | Menüpunkt hinter PIN: löscht Verkäufe, Positionen, Zahlungen, Storni, Druckaufträge, Kassentage, Warenkorb-Entwurf; Belegzähler zurück; Produkte und Einstellungen bleiben; Backup vorher. Wird am Do nach der Regression und am Fr nach dem Testverkauf am Standort ausgeführt. | 12.9.2026 | Kritik |
| 45 | Tagesplan | So: Rauchtest, Scaffold, gepackter Hello-World-Build, core + Tests, Schema, Hono, ESC/POS-Builder, winspool-Transport. Mo: Verkaufsbildschirm + vier Bezahlflüsse, abends echter Druck der Bons. Di: Kassentag, Fehlerpfade, Storno, Nachdruck, Abschluss-Bildschirm + Bon, Laptop-Setup. Mi: PDF, Verwaltung, Backup, Kiosk, finaler Build, Freeze. | 12.9.2026 | Kritik |
| 46 | Kürzungsregel | Fehlt der Kassen-Laptop am Dienstagabend oder scheitert die Dienstag-Abnahme: Mittwochmorgen Umfang reduzieren auf Bar-CHF, Twint, Helfer, Storno letzter Beleg, Abschluss-Bon ohne PDF, Produkte per Seed; Bar-EUR nur bei Zeitreserve. | 12.9.2026 | Kritik |
| 47 | Plan B Drucker | Ein Druckerausfall am Samstag ist über Brack für den Sonntag nicht heilbar (Abholung/Versand nur Mo–Fr). Ohne mitbestellten Reservedrucker gilt bis Eventende die Papiervariante; das steht so auf dem Notfallblatt. | 12.9.2026 | Kritik (Beschaffungs-Recherche) |
| 49 | Freigabe | Roadmap Fassung 2 vom Auftraggeber akzeptiert; Entwicklung startet am 12.9.2026. Kassenschublade PCK-41 II bei Brack bestellt. Kassen-Laptop mit vollen Adminrechten. EUR-Kurs 0.90 bestätigt. Vorläufige Preise darf die Entwicklung selbst setzen, finale Preise folgen. Twint-QR liegt gedruckt am Kassentisch, für die Software irrelevant. Storno-Annahmen bestätigt. Admin-PIN geliefert (nur im Notfallblatt, nicht in Dokumenten oder git). | 12.9.2026 | Auftraggeber |
| 50 | Feedback 12.9. (erster Test des Auftraggebers) | Produktverwaltung: Position mit Einfuege-Semantik (neues Produkt auf Position n schiebt die anderen nach unten, danach lueckenlos 1..N); Button «Loeschen» zusaetzlich zu «Deaktivieren», erlaubt nur fuer Produkte ohne Verkaeufe (sonst 409, nur deaktivieren). Bon 1 bei Twint: «Gegeben CHF - TWINT» und «Spende CHF - TWINT», Bar bleibt unveraendert. Beenden-Knopf links oben in der Kopfzeile (mit PIN). Zusaetzlich aus dem Test des Entwicklers: Banner zeigt nach Storno «Beleg storniert», Kacheln fuellen die Bildschirmhoehe. | 12.9.2026 | Auftraggeber / Entwickler |
| 51 | Separate Spenden | Nach dem Verkauf: Knopf «Rückgeld als Spende» im Banner und in «Letzte Verkäufe» (Betrag = Rückgeld des Belegs, dem Beleg zugeordnet, nur einmal pro Beleg). Freie Spende ohne Kauf über eigene Taste «Spende» (Bar CHF / Twint / Bar EUR, Betrag frei). Kein Bon. Im Abschluss in den Zeilen Bar-Spende / Twint-Spende enthalten plus Zeile «davon separat erfasst (n)»; Bar-Spenden erhöhen Soll CHF, EUR-Spenden Soll EUR, Twint nicht. Storno der letzten Spende ohne PIN, ältere mit PIN. Tabelle spende (Migration 003). | 12.9.2026 | Auftraggeber (Fall: 98 CHF, 100er-Note, «passt schon» erst nach dem Kassieren) |
| 48 | Plan B Electron | Server standalone startbar; `msedge --kiosk http://127.0.0.1:47100` als Rückfall ohne Codeänderung (PDF entfällt, Bon bleibt). | 12.9.2026 | Kritik |

## Produktliste (vorläufig, 12.9.2026)

Preise aus der alten Menükarte; «offen» = vom Auftraggeber zu liefern. Alle ohne MwSt. Gruppenwerte wie in `docs/produkte-seed.json`.

| Name | Preis CHF | Gruppe |
|---|---|---|
| Winti Burger | 11.00 | coupon |
| Winti Burger mit Pommes | 15.00 | coupon |
| Lahmacun | 5.00 | coupon |
| Gözleme | 5.00 | coupon |
| Döner Kebap | 12.00 | coupon |
| Dürüm | offen | coupon |
| Adana Dürüm | offen | coupon |
| Mocktail | 5.00 | coupon |
| Getränk Dose | 2.50 | kasse |
| Getränk Flasche | 3.00 | kasse |
| Ayran | offen | kasse |
| Red Bull | 3.00 | kasse |
| Wasser still | offen | kasse |
| Wasser prickelnd | offen | kasse |
| Kaffee | 2.50 | kasse |

Seed-Datei: `docs/produkte-seed.json` (Feld `reihenfolge` = Kachelreihenfolge). Produkte mit Preis «offen» (null) werden inaktiv angelegt, bis der Preis gesetzt ist. Alle Namen haben höchstens 24 Zeichen («Winti Burger mit Pommes» = 23).
