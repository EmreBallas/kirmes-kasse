# Kontrakt: Module, Datenmodell, API, Druck

Verbindliche Schnittstellen für alle, die parallel an der Kasse bauen. Fachliche Grundlage: `../docs/roadmap-v1.md` (Abschnitte 2, 4, 5) und `../docs/entscheidungen.md`. Typen: `src/core/types.ts` (nicht ändern ohne Absprache; Ergänzungen sind erlaubt, Umbenennungen nicht).

## Grundregeln

- TypeScript strict, keine `any`. Deutsche Fachbegriffe im Code (`verkauf`, `rueckgeld`, `kassentag`), englische Technik (`repo`, `router`, `worker`).
- Geld: CHF in ganzen Rappen, EUR in ganzen Cent, Kurs als `kursX10000`. Nie Fliesskomma für Geld.
- Nichts wird gelöscht. Storno ist eine Gegenbuchung. Produkte werden deaktiviert.
- Verkauf wird gespeichert (Commit), bevor irgendetwas gedruckt wird.
- `package.json` und `node_modules` nicht anfassen; fehlende Abhängigkeiten im Ergebnis melden.
- Jedes Modul bringt vitest-Tests mit (`*.test.ts` neben dem Code). `npx vitest run src/<modul>` muss grün sein.
- Alias: `@core/*`, `@server/*`, `@print/*` (electron.vite.config.ts, vitest.config.ts, tsconfig).

## Ordner

```
src/core/      reine Geldlogik, kein Node-/DOM-Import (nur TypeScript)
src/print/     Bon-Modell -> ESC/POS-Bytes -> Transport (winspool | simulator), Druck-Worker
src/server/    SQLite (node:sqlite), Migrationen, Repositories, Hono-Routen, Seeds
src/main/      Electron: startet Server + Worker, Kiosk-Fenster, PDF, Backup
src/renderer/  React-UI, spricht ausschliesslich HTTP gegen http://127.0.0.1:47100
tools/         print-raw.ps1 (v2), setup-laptop.ps1  (als extraResources im Paket)
resources/     produkte-seed.json, seed.default.json
```

## src/core (Funktionen, die es geben muss)

- `geld.ts`: `formatChf(rappen): string` ("75.00"), `formatEur(cent)`, `rundeAb5Rappen(rappen)`, `eurZuChfRappen(cent, kursX10000)` (= cent × kurs ÷ 10 000, dann auf 5 Rappen **abgerundet**), `chfZuEurCentAufgerundet(rappen, kursX10000)` (auf 10 Cent **aufgerundet**), `parseBetrag(text): number | null` (Eingabe "12.5", "12,50", "12" -> Rappen).
- `warenkorb.ts`: `leererWarenkorb()`, `hinzufuegen(w, produkt)` (erneutes Antippen erhöht die Menge), `mengeAendern(w, produktId, delta)` (0 entfernt die Zeile), `entfernen`, `total(w)`.
- `zahlung.ts`: `berechneZahlung(e: ZahlungsEingabe): ZahlungsErgebnis` nach Fachregeln 1 bis 8:
  - `bar_chf`: gegebenChf = gegeben; gedeckt = gegeben ≥ total; rueckgeld = gegeben − total; `spendeBehalten` -> spende = rueckgeld, rueckgeld = 0, spendeTyp `bar_chf`; Warnung `rueckgeld_ueber_200` bei rueckgeld > 20 000.
  - `bar_eur`: gegebenChf = eurZuChfRappen(gegeben); gleiche Regeln; spendeTyp `bar_eur`; `totalEurCent` = chfZuEurCentAufgerundet(total).
  - `twint`: gegebenChf = gegeben; gedeckt = gegeben ≥ total; Überzahlung = spende (`twint`), rueckgeld immer 0; Warnung `spende_ueber_200` bei spende > 20 000.
  - `helfer`: alles 0, gedeckt true.
- `abschluss.ts`: `berechneAbschluss(input): AbschlussBericht` mit `input = { kassentag, verkaeufe, positionen, zahlungen, storni (des Kassentags des Stornos!), nachdrucke: number, istChfRappen, istEurCent }`. Formeln exakt wie Roadmap Abschnitt 4 (brutto, Storni nur als Gegenbuchung, Soll CHF = Startgeld + Bar-CHF + Bar-Spende-CHF − Rückgeld aus EUR − Storno-Auszahlungen; Soll EUR = Startgeld EUR + Σ gegeben EUR). Kontrollfälle aus der Roadmap als Tests.
- `bon.ts`: `bonModellVerkauf(verkauf, positionen, zahlung, opts: { nachdruck: 'alles'|'coupons'|'bon'|null }): DruckModell`; `bonModellAbschluss(bericht): DruckModell`; `bonModellTest(): DruckModell`. Layout (80 mm, 48 Zeichen Font A):
  - Coupon je Position der Gruppe `coupon`: Zeile 1 `"{anzahl}x"` dreifach, Zeile 2 Name doppelt, Leerzeile, `"Sa 19.09.2026  14:32"`, `"{belegnr}   Coupon {n}/{m}"`; bei Nachdruck zusätzlich `"NACHDRUCK"` doppelt fett als erste Zeile. Kein Standname.
  - Bon 1: Positionszeilen `{anzahl:>3} {name:<34}{betrag:>10}`, Trennlinie 48 `-`, `TOTAL CHF` / `Gegeben CHF` (bei EUR `Gegeben EUR` und `Kurs 0.90`) / `RÜCKGELD CHF` doppelt; bei Twint statt Rückgeld `Spende CHF` (nur wenn > 0); bei Helfer Zeile `HELFER`; Leerzeile; Fusszeile rechtsbündig `"{belegnr}  {HH:MM}"`. Kein Logo, kein Datum im Kopf.
  - Schublade: `schublade = zahlart in (bar_chf, bar_eur)` beim Beleg; beim Nachdruck nie; beim Storno separater Auftrag `typ = schublade` mit leerem Dokument.
  - Abschluss-Bon: alle Zeilen des Berichts, Stück je Produkt, Kassier, Unterschriftslinie.

## src/print

- `escpos.ts`: `baueBytes(modell: DruckModell): Uint8Array`. Immer `ESC @` und `ESC t 13` zuerst; Text mit iconv-lite `cp857`, nicht kodierbare Zeichen -> `?`; `GS ! 0x00/0x11/0x22` für normal/doppelt/dreifach; `ESC a 0/1/2`; `ESC E 1/0`; nach jedem Dokument 3 × LF und `GS V 66 0`; Schublade `ESC p 0 25 250` **vor** den Dokumenten. Zeilen länger als die Spaltenzahl werden hart abgeschnitten (Bon-Modell ist dafür verantwortlich, dass es nicht passiert). Byte-Snapshot-Tests.
- `transport.ts`: `interface DruckTransport { name: 'winspool'|'simulator'; senden(bytes: Uint8Array, bezeichnung: string): Promise<DruckErgebnis> }`, `DruckErgebnis = { ok: boolean; status: 'accepted'|'removed'|'error'; jobId: number|null; fehler: string|null }`.
- `winspool.ts`: schreibt die Bytes nach `%TEMP%\kasse\job-<uuid>.bin`, ruft `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <tools>/print-raw.ps1 -Printer <name> -File <bin>` per `execFile` (timeout 20 s, windowsHide) und parst das JSON `{jobId, bytes, status}` von stdout; Exit 0 = accepted, 2 = removed, 1 = error. Temp-Datei danach löschen.
- `tools/print-raw.ps1` **Fassung 2**: wie Fassung 1 (`../../tools/print-raw.ps1` im Projektordner), zusätzlich `$ErrorActionPreference='Stop'`, Job-ID aus `StartDocPrinterW` behalten, nach `EndDocPrinter` bis 10 s alle 500 ms `Get-PrintJob -PrinterName $Printer -ID $jobId` pollen; Auftrag verschwunden -> Exit 0; bleibt stehen oder JobStatus enthält Error/Offline/PaperOut/Blocked -> `Remove-PrintJob`, Exit 2; Exceptions -> Exit 1 mit Meldung auf stderr. Ausgabe stdout JSON.
- `simulator.ts`: schreibt Bytes und eine Textvorschau (`.txt`, ESC/POS-Subset decodiert: Text, Grösse, Ausrichtung, Schnitt als `--------✂--------`) nach `<archiv>/simulator/`. Aktiv nur bei `KASSE_PRINT=sim` oder im Dev-Modus.
- `worker.ts`: `startDruckWorker({ repo, transport, bytesOrdner })`: arbeitet `druckauftrag` mit Status `queued` sequenziell ab (ein Auftrag nach dem anderen, `sent` -> `done`/`failed` mit Fehlertext), hält den letzten Status für `/api/status`. Beim Start: alle Spooler-Aufträge der Warteschlange per `Get-PrintJob | Remove-PrintJob` verwerfen (Funktion `verwerfeSpoolerAuftraege(druckerName)` in winspool.ts) und `queued`/`sent` auf `failed` setzen (Grund `app_neustart`).

## src/server

- `db.ts`: `oeffneDb(pfad | ':memory:'): DatabaseSync` mit `PRAGMA journal_mode=WAL`, `PRAGMA synchronous=FULL`, `PRAGMA foreign_keys=ON`; `migriere(db)` führt `migrations/*.sql` nummeriert aus (Tabelle `schema_version`).
- Schema (Migration 001):

```sql
CREATE TABLE produkt (id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) <= 24), preis_rappen INTEGER,
  gruppe TEXT NOT NULL CHECK(gruppe IN ('coupon','kasse')), aktiv INTEGER NOT NULL DEFAULT 1,
  ausverkauft INTEGER NOT NULL DEFAULT 0, reihenfolge INTEGER NOT NULL DEFAULT 0, erstellt_am TEXT NOT NULL);
CREATE TABLE kassentag (id TEXT PRIMARY KEY, datum TEXT NOT NULL, kasse_praefix TEXT NOT NULL, kassier TEXT NOT NULL,
  startgeld_chf_rappen INTEGER NOT NULL, startgeld_eur_cent INTEGER NOT NULL DEFAULT 0, geoeffnet_am TEXT NOT NULL,
  abgeschlossen_am TEXT, ist_chf_rappen INTEGER, ist_eur_cent INTEGER, differenz_chf_rappen INTEGER, differenz_eur_cent INTEGER, bemerkung TEXT);
CREATE TABLE verkauf (id TEXT PRIMARY KEY, kassentag_id TEXT NOT NULL REFERENCES kassentag(id), belegnr TEXT NOT NULL UNIQUE,
  zeit TEXT NOT NULL, zahlart TEXT NOT NULL CHECK(zahlart IN ('bar_chf','bar_eur','twint','helfer')),
  total_rappen INTEGER NOT NULL, storniert_am TEXT, storno_id TEXT);
CREATE TABLE position (id TEXT PRIMARY KEY, verkauf_id TEXT NOT NULL REFERENCES verkauf(id), produkt_id TEXT NOT NULL REFERENCES produkt(id),
  name_snapshot TEXT NOT NULL, preis_snapshot_rappen INTEGER NOT NULL, anzahl INTEGER NOT NULL CHECK(anzahl > 0),
  gruppe_snapshot TEXT NOT NULL CHECK(gruppe_snapshot IN ('coupon','kasse')));
CREATE TABLE zahlung (verkauf_id TEXT PRIMARY KEY REFERENCES verkauf(id), waehrung TEXT NOT NULL CHECK(waehrung IN ('CHF','EUR')),
  kurs_x10000 INTEGER, gegeben INTEGER NOT NULL, gegeben_chf_rappen INTEGER NOT NULL, rueckgeld_chf_rappen INTEGER NOT NULL,
  spende_chf_rappen INTEGER NOT NULL DEFAULT 0, spende_typ TEXT CHECK(spende_typ IN ('bar_chf','bar_eur','twint')));
CREATE TABLE storno (id TEXT PRIMARY KEY, verkauf_id TEXT NOT NULL UNIQUE REFERENCES verkauf(id), kassentag_id TEXT NOT NULL REFERENCES kassentag(id),
  zeit TEXT NOT NULL, grund TEXT NOT NULL CHECK(grund IN ('tippfehler','ausverkauft','abgesprungen')),
  auszahlung_chf_rappen INTEGER NOT NULL, mit_pin INTEGER NOT NULL DEFAULT 0);
CREATE TABLE druckauftrag (id TEXT PRIMARY KEY, verkauf_id TEXT REFERENCES verkauf(id), kassentag_id TEXT REFERENCES kassentag(id),
  typ TEXT NOT NULL, bytes_pfad TEXT, status TEXT NOT NULL CHECK(status IN ('queued','sent','done','failed')),
  spooler_job_id INTEGER, fehler TEXT, erstellt_am TEXT NOT NULL, erledigt_am TEXT);
CREATE TABLE einstellung (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE warenkorb_entwurf (id INTEGER PRIMARY KEY CHECK(id = 1), json TEXT NOT NULL, aktualisiert_am TEXT NOT NULL);
```

- Einstellungen (Tabelle `einstellung`, key/value als Text): `eur_kurs_x10000` (9000), `drucker_name` (TM-T20II), `kassen_praefix` (K1), `belegzaehler` (0), `pin_hash`, `pin_salt`, `backup_pfad_usb`, `port` (47100).
- PIN: `pin_hash = sha256(pin_salt + ':' + pin)` hex (node:crypto). Geschützte Routen erwarten Header `X-Pin`; falsch -> 403 `{fehler:'pin_falsch'}`.
- Seeds (`seed.ts`): beim ersten Start Produkte aus `resources/produkte-seed.json` (nur wenn Tabelle leer), Einstellungen aus `seed.local.json` (falls vorhanden, gitignored) sonst `resources/seed.default.json`.
- Repositories (`repos/`): `produktRepo`, `kassentagRepo`, `verkaufRepo` (legt Verkauf + Positionen + Zahlung + Druckauftrag in **einer Transaktion** an, vergibt Belegnummer aus `belegzaehler`; bei existierender `verkauf.id` -> bestehenden Verkauf zurückgeben), `stornoRepo`, `druckauftragRepo`, `einstellungRepo`, `warenkorbRepo`. Tests gegen `':memory:'`, inkl. "doppelter POST = ein Verkauf".
- `app.ts`: `erstelleApp(deps): Hono` mit Routen (alle JSON, Fehler als `FehlerAntwort` mit passendem HTTP-Status):

| Methode | Pfad | Body / Antwort |
|---|---|---|
| GET | `/api/health` | `{ ok: true, version }` |
| GET | `/api/status` | `StatusAntwort` |
| GET | `/api/produkte?alle=1` | `Produkt[]` (ohne `alle`: nur aktive) |
| POST | `/api/produkte` (PIN) | `Partial<Produkt>` -> `Produkt` |
| PUT | `/api/produkte/:id` (PIN) | `Partial<Produkt>` -> `Produkt` |
| POST | `/api/produkte/:id/ausverkauft` | `{ ausverkauft: boolean }` -> `Produkt` |
| GET | `/api/kassentag/aktuell` | `{ kassentag, vortagOffen, vorschlagStartgeldChfRappen }` |
| POST | `/api/kassentag/start` | `KassentagStartAnfrage` -> `Kassentag` (409, wenn offen) |
| GET | `/api/kassentag/aktuell/bericht` | `AbschlussBericht` (Vorschau ohne Ist) |
| POST | `/api/kassentag/:id/abschluss` | `KassentagAbschlussAnfrage` -> `AbschlussBericht` (+ Druckauftrag `abschluss`, + Callback für PDF) |
| POST | `/api/verkauf` | `VerkaufAnfrage` -> `VerkaufAntwort` (409 `nicht_gedeckt`, 409 `bestaetigung_noetig` bei Warnung ohne Bestätigung, 409 `kein_kassentag`) |
| GET | `/api/verkauf/letzte?limit=20` | `{ verkauf, zahlung, positionen, storno }[]` neueste zuerst |
| POST | `/api/verkauf/:id/storno` (PIN nur, wenn nicht der letzte Beleg) | `StornoAnfrage` -> `Storno` (409 wenn schon storniert) |
| POST | `/api/verkauf/:id/nachdruck` | `NachdruckAnfrage` -> `{ druckauftragId }` (409 wenn storniert) |
| POST | `/api/druck/test` | -> `{ druckauftragId }` |
| GET | `/api/einstellungen` | `Einstellungen` (ohne PIN-Felder) |
| PUT | `/api/einstellungen` (PIN) | `Partial<Einstellungen> & { neuePin?: string }` |
| POST | `/api/pin/pruefen` | `{ pin }` -> `{ ok }` |
| POST | `/api/testdaten-loeschen` (PIN) | -> `{ ok, backupPfad }` |
| GET/PUT | `/api/warenkorb-entwurf` | `Warenkorb` |
| GET | `/*` | statisches Renderer-Build (`out/renderer`), Fallback `index.html` |

- Der Server läuft im Electron-Main auf `127.0.0.1:47100` (`@hono/node-server`). Zusätzlich `npm run server` (Datei `src/server/standalone.ts`) für Plan B ohne Electron.

## src/renderer

- React 19, kein Router-Paket nötig (Zustand `ansicht: 'start'|'verkauf'|'letzte'|'abschluss'|'verwaltung'|'einstellungen'`). Alle Beträge kommen als Rappen und werden mit `formatChf` angezeigt.
- Bildschirme: Kassenstart (Startgeld, Kassier, Vortagswarnung), Verkauf (Kacheln links nach `reihenfolge`, Gruppe als Farbe, Ausverkauft-Toggle per langem Druck oder kleinem Schalter auf der Kachel; Warenkorb rechts mit +/−/Löschen; Zahlartenleiste Bar-CHF / Bar-EUR / Twint / Helfer), Bezahldialog (Ziffernblock, Schnellwahl Passend/10/20/50/100/200, drei Zeilen Total / Gegeben / Rückgeld, Rückgeld am grössten; bei EUR zusätzlich "Total in EUR"; Twint mit Total vorbelegt und Button "Bezahlt, geprüft"; Popups "Betrag nicht gedeckt" (blockierend) und "Rückgeld über 200, sicher?"; Button "stimmt so"), Nach-dem-Bezahlen-Banner (Rückgeld gross, "Sofort ausgeben: …", bleibt bis zum nächsten Antippen), Letzte Verkäufe (Storno letzter Beleg ohne PIN mit Grund, ältere mit PIN, Nachdruck), Abschluss (Bericht, Ist-Zählung CHF/EUR, Differenz farbig, Abschliessen), Verwaltung (PIN-Dialog, Produkte anlegen/ändern/deaktivieren), Einstellungen (Kurs, Druckername, Präfix, PIN ändern, Testdruck, Testdaten löschen).
- Tastatur im Bezahldialog: Ziffern, `.`/`,`, Backspace, Enter = bestätigen, Esc = zurück. Kopfzeile: Kassentag, Kassier, Drucker-Ampel (aus `/api/status`, alle 2 s gepollt), Uhrzeit.
- Touch-tauglich: Kacheln ≥ 72 px hoch, Buttons ≥ 48 px, Schrift ≥ 16 px, Rückgeld ≥ 64 px. Kein externes UI-Framework, eigenes CSS.
- Nach jedem Warenkorb-Änderung `PUT /api/warenkorb-entwurf` (debounced 300 ms); beim Start `GET`.

## src/main

- Startet DB (`C:\Kasse\data\kasse.sqlite`, im Dev `./data/kasse.sqlite`), Migrationen, Seeds, Hono-Server, Druck-Worker (Transport nach `KASSE_PRINT`), Backup-Timer (alle 10 min + bei Abschluss: WAL-Checkpoint, Kopie nach `<daten>/backup/kasse-<zeit>.sqlite` und auf USB, falls `backup_pfad_usb` erreichbar), PDF (`printToPDF` A4 in `<daten>/archiv/`), Kiosk-Fenster auf `http://127.0.0.1:47100`, Single-Instance, `powerSaveBlocker`, Beenden nur `Ctrl+Shift+Q` + PIN, `close` abgefangen.
