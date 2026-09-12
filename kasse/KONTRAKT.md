# Kontrakt: Module, Datenmodell, API, Druck

Verbindliche Schnittstellen für alle, die parallel an der Kasse bauen. Fachliche Grundlage: `../docs/roadmap-v1.md` (Abschnitte 2, 4, 5) und `../docs/entscheidungen.md`. Typen: `src/core/types.ts` (nicht ändern ohne Absprache; Ergänzungen sind erlaubt, Umbenennungen nicht).

## Grundregeln

- TypeScript strict, keine `any`. Deutsche Fachbegriffe im Code (`verkauf`, `rueckgeld`, `kassentag`), englische Technik (`repo`, `router`, `worker`).
- Geld: CHF in ganzen Rappen, EUR in ganzen Cent, Kurs als `kursX10000`. Nie Fliesskomma für Geld.
- Nichts wird gelöscht. Storno ist eine Gegenbuchung. Produkte werden deaktiviert (einzige Ausnahme: ein Produkt ohne einzige Verkaufsposition darf per `DELETE /api/produkte/:id` entfernt werden).
- Verkauf wird gespeichert (Commit), bevor irgendetwas gedruckt wird.
- Separate Spenden (Tabelle `spende`, Migration 003) werden **nachträglich** erfasst, ohne Bon und ohne Schublade: (a) „Rückgeld als Spende“ zu einem bereits gespeicherten Bar-Beleg (`verkaufId`, `typ = bar_chf`, `betrag` = dessen `rueckgeldChfRappen`; pro Beleg höchstens eine nicht stornierte Spende), (b) freie Spende ohne Kauf (`verkaufId = null`, Bar CHF / Twint in Rappen, Bar EUR in Cent mit Tageskurs). Sie fliessen im Abschluss in die bestehenden Zeilen Bar-Spende CHF / Bar-Spende EUR / Twint-Spende ein und erhöhen den Soll-Bestand (Bar CHF -> Soll CHF, Bar EUR -> Soll EUR, Twint -> kein Bargeld); `spendenSeparatAnzahl`/`spendenSeparatChfRappen` im Bericht sind informativ. Storno nur per `storniert_am` (die zuletzt erfasste ohne PIN, ältere mit PIN, nur solange der Kassentag der Spende offen ist); stornierte Spenden zählen nirgends.
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
- `abschluss.ts`: `berechneAbschluss(input): AbschlussBericht` mit `input = { kassentag, verkaeufe, positionen, zahlungen, storni (des Kassentags des Stornos!), spenden (separate Spenden des Kassentags, stornierte werden ignoriert), nachdrucke: number, istChfRappen, istEurCent }`. Formeln exakt wie Roadmap Abschnitt 4 (Geldsummen brutto, Storni nur als Gegenbuchung, Soll CHF = Startgeld + Bar-CHF + Bar-Spende-CHF − Rückgeld aus EUR − Storno-Auszahlungen; Soll EUR = Startgeld EUR + Σ gegeben EUR). **Stückzahlen** (Produktzeilen verkauft/helfer und Helferessen-Stück/entgangener Umsatz) zählen nur Verkäufe, die nicht am selben Kassentag storniert wurden (Testfall 28: Storno Helfer-Beleg → Helferessen-Stück sinken). Kontrollfälle aus der Roadmap als Tests. `input.veranstaltung` (optional, aus der Einstellung `veranstaltung`) wird getrimmt als `AbschlussBericht.veranstaltung` durchgereicht; `rabatteAnzahl`/`rabatteRappen` zählen die Beleg-Rabatte der nicht (am selben Tag) stornierten Verkäufe. Der Umsatz je Produkt bleibt brutto zu vollen Preisen, die Rabattzeile erklärt die Differenz zu den Einnahmen; Soll CHF und Soll EUR ändern sich dadurch nicht.
- `bon.ts`: `bonModellVerkauf(verkauf, positionen, zahlung, opts: { nachdruck: 'alles'|'coupons'|'bon'|null }): DruckModell`; `bonModellAbschluss(bericht): DruckModell`; `bonModellTest(): DruckModell`. Layout (80 mm, 48 Zeichen Font A):
  - Coupon je Position der Gruppe `coupon`: Zeile 1 `"{anzahl}x"` dreifach, Zeile 2 Name doppelt, Leerzeile, `"Sa 19.09.2026  14:32"`, `"{belegnr}   Coupon {n}/{m}"`; bei Nachdruck zusätzlich `"NACHDRUCK"` doppelt fett als erste Zeile. Kein Standname.
  - Bon 1: Positionszeilen `{anzahl:>3} {name:<34}{betrag:>10}`, Trennlinie 48 `-`, `TOTAL CHF` / `Gegeben CHF` (bei EUR `Gegeben EUR` und `Kurs 0.90`) / `RÜCKGELD CHF` doppelt; bei Twint `Gegeben CHF - TWINT` und statt Rückgeld `Spende CHF - TWINT` (nur wenn > 0), Zeilen bleiben 48 Zeichen; bei Helfer Zeile `HELFER`; Leerzeile; Fusszeile rechtsbündig `"{belegnr}  {HH:MM}"`. Kein Logo, kein Datum im Kopf.
  - Schublade: `schublade = zahlart in (bar_chf, bar_eur)` beim Beleg; beim Nachdruck nie; beim Storno separater Auftrag `typ = schublade` mit leerem Dokument.
  - Abschluss-Bon: alle Zeilen des Berichts, Stück je Produkt, Kassier, Unterschriftslinie. `bonModellAbschluss(bericht, { nachdruck: true })` setzt `"NACHDRUCK"` doppelt fett als erste Zeile (Nachdruck des Abschluss-Bons).

## src/print

- `escpos.ts`: `baueBytes(modell: DruckModell): Uint8Array`. Immer `ESC @` und `ESC t 13` zuerst; Text mit iconv-lite `cp857`, nicht kodierbare Zeichen -> `?`; `GS ! 0x00/0x11/0x22` für normal/doppelt/dreifach; `ESC a 0/1/2`; `ESC E 1/0`; nach jedem Dokument 3 × LF und `GS V 66 0`; Schublade `ESC p 0 25 250` **vor** den Dokumenten. Zeilen länger als die Spaltenzahl werden hart abgeschnitten (Bon-Modell ist dafür verantwortlich, dass es nicht passiert). Byte-Snapshot-Tests.
- `transport.ts`: `interface DruckTransport { name: 'winspool'|'simulator'; senden(bytes: Uint8Array, bezeichnung: string): Promise<DruckErgebnis> }`, `DruckErgebnis = { ok: boolean; status: 'accepted'|'removed'|'error'; jobId: number|null; fehler: string|null }`.
- `winspool.ts`: schreibt die Bytes nach `%TEMP%\kasse\job-<uuid>.bin`, ruft `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <tools>/print-raw.ps1 -Printer <name> -File <bin>` per `execFile` (timeout 20 s, windowsHide) und parst das JSON `{jobId, bytes, status}` von stdout; Exit 0 = accepted, 2 = removed, 1 = error. Temp-Datei danach löschen. Wird das Skript durch den Timeout abgebrochen (`ProzessErgebnis.abgebrochen`), ruft der Transport sofort `verwerfeSpoolerAuftraege(druckerName)` auf (der Spooler-Auftrag ist dann meist schon angelegt und würde sonst beim Anstecken von selbst drucken, Fachregel 18) und hält das Ergebnis im Fehlertext fest.
- `tools/print-raw.ps1` **Fassung 2**: wie Fassung 1 (`../../tools/print-raw.ps1` im Projektordner), zusätzlich `$ErrorActionPreference='Stop'`, Job-ID aus `StartDocPrinterW` behalten, nach `EndDocPrinter` bis 10 s alle 500 ms `Get-PrintJob -PrinterName $Printer -ID $jobId` pollen; Auftrag verschwunden -> Exit 0; bleibt stehen oder JobStatus enthält Error/Offline/PaperOut/Blocked -> `Remove-PrintJob`, Exit 2; Exceptions -> Exit 1 mit Meldung auf stderr. Ausgabe stdout JSON.
- `simulator.ts`: schreibt Bytes und eine Textvorschau (`.txt`, ESC/POS-Subset decodiert: Text, Grösse, Ausrichtung, Schnitt als `--------✂--------`) nach `<archiv>/simulator/`. Aktiv nur bei `KASSE_PRINT=sim` oder im Dev-Modus.
- `worker.ts`: `startDruckWorker({ repo, transport, bytesOrdner })`: arbeitet `druckauftrag` mit Status `queued` sequenziell ab (ein Auftrag nach dem anderen, `sent` -> `done`/`failed` mit Fehlertext), hält den letzten Status für `/api/status`. Beim Start: alle Spooler-Aufträge der Warteschlange per `Get-PrintJob | Remove-PrintJob` verwerfen (Funktion `verwerfeSpoolerAuftraege(druckerName)` in winspool.ts) und `queued`/`sent` auf `failed` setzen (Grund `app_neustart`). Beim winspool-Transport prüft er ausserdem mit `druckerVorhanden(druckerName)`, ob die Warteschlange existiert (Roadmap 2.14: „Druck OK“ nur mit vorhandener Warteschlange): fehlt sie, Ampel `pruefen` mit `letzterFehler = 'Warteschlange "<name>" fehlt'`; die Prüfung wird im Leerlauf alle 60 s wiederholt (`pruefIntervallMs`), und nur dieser Zustand wird wieder grün, sobald die Warteschlange da ist. Ein fehlgeschlagener Auftrag bleibt bis zum nächsten erfolgreichen Auftrag `pruefen`. Der Main startet den Worker erst **nach** dem erfolgreichen Port-Bind des HTTP-Servers, damit eine zweite Instanz nie die Aufträge der laufenden Kasse anfasst.

## src/server

- `db.ts`: `oeffneDb(pfad | ':memory:'): DatabaseSync` mit `PRAGMA journal_mode=WAL`, `PRAGMA synchronous=FULL`, `PRAGMA foreign_keys=ON`; `migriere(db)` führt `migrations/*.sql` nummeriert aus (Tabelle `schema_version`).
- Migration 002 (`002_kassentag_pdf.sql`): `ALTER TABLE kassentag ADD COLUMN pdf_pfad TEXT;` – absoluter Pfad der Abschluss-PDF (`Kassentag.pdfPfad: string | null`), gesetzt vom Server nach dem `nachAbschluss`-Callback (`kassentagRepo.setzePdfPfad(id, pfad)`); NULL, solange keine PDF geschrieben wurde.
- Migration 004 (`004_rabatt.sql`): Beleg-Rabatt am Verkauf (`Verkauf.rabattProzent`, `Verkauf.rabattRappen`):

```sql
ALTER TABLE verkauf ADD COLUMN rabatt_prozent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE verkauf ADD COLUMN rabatt_rappen INTEGER NOT NULL DEFAULT 0;
```

Der Rabatt (angereiste Mitglieder anderer Vereine, Standard 50 %) gilt für den **ganzen Beleg**, nie für einzelne Positionen: `position.preis_snapshot_rappen` bleibt der **volle** Preis, `verkauf.total_rappen` ist der **bereits rabattierte**, kassierte Betrag. Damit bleiben Zahlung, Rückgeld, Storno-Auszahlung und alle Soll-Formeln des Abschlusses unverändert. `rabatt_prozent = 0` heisst kein Rabatt (auch bei `zahlart = helfer`, dort ist der Rabatt wirkungslos und `total_rappen` bleibt 0); `rabatt_rappen` = Zwischensumme (volle Preise) − `total_rappen`. Berechnung im Server über `@core/geld` `rabattBetrag(zwischensumme, prozent)`; bestehende Belege haben über den DEFAULT 0 weiterhin keinen Rabatt.
- Migration 003 (`003_spende.sql`): Tabelle `spende` für separate Spenden (`Spende` in `types.ts`; `betrag` in Rappen bei bar_chf/twint, in Cent bei bar_eur; `betrag_chf_rappen` = CHF-Gegenwert, bei EUR `eurZuChfRappen(betrag, kurs_x10000)`; `mit_pin` = 1, wenn der Storno eine PIN brauchte):

```sql
CREATE TABLE spende (id TEXT PRIMARY KEY, kassentag_id TEXT NOT NULL REFERENCES kassentag(id), verkauf_id TEXT REFERENCES verkauf(id),
  zeit TEXT NOT NULL, typ TEXT NOT NULL CHECK(typ IN ('bar_chf','bar_eur','twint')), betrag INTEGER NOT NULL CHECK(betrag > 0),
  kurs_x10000 INTEGER, betrag_chf_rappen INTEGER NOT NULL, storniert_am TEXT, mit_pin INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_spende_kassentag ON spende(kassentag_id); CREATE INDEX idx_spende_verkauf ON spende(verkauf_id);
```
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

- Einstellungen (Tabelle `einstellung`, key/value als Text): `eur_kurs_x10000` (9000), `drucker_name` (TM-T20II), `kassen_praefix` (K1), `belegzaehler` (0), `pin_hash`, `pin_salt`, `backup_pfad_usb`, `port` (47100), `rabatt_prozent` (Standard 50, erlaubt 1 bis 99 = `RABATT_PROZENT_MIN`/`RABATT_PROZENT_MAX` aus `@core/geld`), `veranstaltung` (Freitext, höchstens 40 Zeichen = `VERANSTALTUNG_MAX_LAENGE` aus `@core/bon`, Standard leer). Fehlt ein Schlüssel in der Tabelle, gilt der Standard (`STANDARD_EINSTELLUNGEN`); ein unsinniger `rabatt_prozent` fällt auf 50 zurück. Der Veranstaltungsname erscheint, wenn gesetzt, im Kopf des Abschluss-Bons und in der Fusszeile der Abschluss-PDF (der Server legt ihn als `AbschlussBericht.veranstaltung` in den Bericht).
- PIN: `pin_hash = sha256(pin_salt + ':' + pin)` hex (node:crypto). Geschützte Routen erwarten Header `X-Pin`; falsch -> 403 `{fehler:'pin_falsch'}`.
- Seeds (`seed.ts`): beim ersten Start Produkte aus `resources/produkte-seed.json` (nur wenn Tabelle leer), Einstellungen aus `seed.local.json` (falls vorhanden, gitignored) sonst `resources/seed.default.json`; die optionalen Schlüssel `rabattProzent` und `veranstaltung` werden übernommen, falls vorhanden (sonst greifen die Standardwerte 50 und leer).
- Repositories (`repos/`): `produktRepo`, `kassentagRepo`, `verkaufRepo` (legt Verkauf + Positionen + Zahlung + Druckauftrag in **einer Transaktion** an, vergibt Belegnummer aus `belegzaehler`; bei existierender `verkauf.id` -> bestehenden Verkauf zurückgeben), `stornoRepo`, `spendeRepo` (`erstelle(anfrage, kassentagId, kursX10000)` idempotent über `id` -> `{ spende, bereitsVorhanden }`; `letzte(limit)` inkl. stornierte mit `belegnr`/`mitPin` (`SpendeEintrag`); `fuerKassentag(id)` und `fuerVerkauf(verkaufId)` nur nicht stornierte; `storno(id, mitPin)` setzt `storniert_am`; `istLetzte(id)` = zuletzt erfasste nicht stornierte Spende), `druckauftragRepo`, `einstellungRepo`, `warenkorbRepo`. Tests gegen `':memory:'`, inkl. "doppelter POST = ein Verkauf". `loescheTestdaten()` leert auch `spende`.
- `app.ts`: `erstelleApp(deps): Hono` mit Routen (alle JSON, Fehler als `FehlerAntwort` mit passendem HTTP-Status):

| Methode | Pfad | Body / Antwort |
|---|---|---|
| GET | `/api/health` | `{ ok: true, version }` |
| GET | `/api/status` | `StatusAntwort` |
| GET | `/api/produkte?alle=1` | `Produkt[]` (ohne `alle`: nur aktive) |
| POST | `/api/produkte` (PIN) | `Partial<Produkt>` -> `Produkt` |
| PUT | `/api/produkte/:id` (PIN) | `Partial<Produkt>` -> `Produkt` |
| DELETE | `/api/produkte/:id` (PIN) | -> `{ ok: true }`; löscht das Produkt nur, wenn keine Position darauf verweist, sonst 409 `produkt_hat_verkaeufe` („Produkt wurde bereits verkauft und kann nur deaktiviert werden.“); 404 `produkt_nicht_gefunden`; danach Reihenfolge normalisiert |
| POST | `/api/produkte/:id/ausverkauft` | `{ ausverkauft: boolean }` -> `Produkt` |
| GET | `/api/kassentag/aktuell` | `{ kassentag, vortagOffen, vorschlagStartgeldChfRappen, letzterAbgeschlossener }` (`letzterAbgeschlossener: Kassentag \| null` für den Nachdruck des Abschluss-Bons und die Anzeige des Abschluss-PDF-Pfads `pdfPfad` im Kassenstart) |
| GET | `/api/kassentag/:id` | `Kassentag` (inkl. `pdfPfad`); 404 `kassentag_nicht_gefunden`. Der Renderer fragt damit nach dem Abschluss alle 1 s (max. 20 s) den PDF-Pfad ab |
| POST | `/api/kassentag/start` | `KassentagStartAnfrage` -> `Kassentag` (409 `kassentag_offen`, wenn offen, auch bei offenem Vortag) |
| GET | `/api/kassentag/aktuell/bericht` | `AbschlussBericht` (Vorschau ohne Ist; separate Spenden des Tages sind eingerechnet) |
| POST | `/api/kassentag/:id/abschluss` | `KassentagAbschlussAnfrage` -> `AbschlussBericht` (+ Druckauftrag `abschluss`). Der `nachAbschluss`-Callback (PDF, Backup) wird gestartet, aber **nicht** abgewartet (Antwort bleibt schnell); liefert er `{ pdfPfad }` (auch als Promise), speichert der Server den Pfad per `setzePdfPfad`; Fehler werden geloggt |
| POST | `/api/archiv/oeffnen` | -> `{ ok: true }`: ruft `deps.oeffneArchiv()` auf (Electron: `shell.openPath(<daten>/archiv)`, Ordner wird angelegt); ohne Callback 501 `nicht_verfuegbar` („Nur in der Kassen-App möglich.“), bei Fehler 500 `archiv_oeffnen_fehlgeschlagen` |
| POST | `/api/kassentag/:id/abschluss/nachdruck` | -> `{ druckauftragId }`: Abschluss-Bon eines abgeschlossenen Tages nachdrucken (Bericht aus gespeichertem Ist neu berechnet, Zeitstempel = Abschlusszeit, Druckauftrag `abschluss` mit Zeile NACHDRUCK, kein PDF/Backup); 409 `nicht_abgeschlossen`, 404 |
| POST | `/api/verkauf` | `VerkaufAnfrage` -> `VerkaufAntwort` (409 `nicht_gedeckt`, 409 `bestaetigung_noetig` bei Warnung ohne Bestätigung, 409 `kein_kassentag`, 409 `vortag_offen`, wenn der offene Kassentag ein früheres Datum hat: zuerst Abschluss nachholen). `rabattProzent` ist optional (fehlt = 0); erlaubt sind nur 0 und genau der in den Einstellungen hinterlegte Satz, sonst 400 `ungueltige_eingabe`. Der Server rechnet die Zwischensumme aus den Positionen, daraus per `rabattBetrag` das rabattierte Total (= `verkauf.total_rappen`, Grundlage der Zahlungsberechnung) und speichert `rabatt_prozent`/`rabatt_rappen` am Beleg; bei `zahlart = helfer` bleiben Total und beide Rabattfelder 0 |
| GET | `/api/verkauf/letzte?limit=20` | `{ verkauf, zahlung, positionen, storno, spende }[]` neueste zuerst (`spende`: verknüpfte nicht stornierte Rückgeld-Spende oder `null`) |
| POST | `/api/spende` | `SpendeAnfrage` -> `{ spende: Spende, bereitsVorhanden }` (201 neu, 200 bei gleicher `id`; kein Bon, keine Schublade). 400 bei `betrag <= 0` oder unbekanntem `typ`; 409 `kein_kassentag`, 409 `vortag_offen`; mit `verkaufId`: 404 `verkauf_nicht_gefunden`, 409 `verkauf_storniert`, 409 `bereits_gespendet` (Beleg hat schon eine nicht stornierte Spende), 409 `kein_rueckgeld` (Beleg ohne Rückgeld, z. B. passend/Twint/Helfer), 409 `betrag_ungleich_rueckgeld` (`typ` muss `bar_chf` und `betrag` = `rueckgeldChfRappen` des Belegs sein) |
| GET | `/api/spende/letzte?limit=20` | `SpendeEintrag[]` = `(Spende & { belegnr: string \| null, mitPin })[]` neueste zuerst, inkl. stornierte |
| POST | `/api/spende/:id/storno` (PIN nur, wenn nicht die zuletzt erfasste nicht stornierte Spende) | kein Body -> `Spende & { mitPin }` mit `storniertAm`; 404 `spende_nicht_gefunden`, 409 `bereits_storniert`, 409 `kassentag_abgeschlossen` (Kassentag der Spende ist abgeschlossen), 403 `pin_falsch` |
| POST | `/api/verkauf/:id/storno` (PIN nur, wenn nicht der letzte Beleg) | `StornoAnfrage` -> `Storno` (409 wenn schon storniert, 409 `kein_kassentag`, 409 `vortag_offen`) |
| POST | `/api/verkauf/:id/nachdruck` | `NachdruckAnfrage` -> `{ druckauftragId }` (409 wenn storniert) |
| GET | `/api/druck/:id` | `Druckauftrag` (404 `druckauftrag_nicht_gefunden`); der Renderer verfolgt damit den eigenen Beleg-Auftrag im Banner |
| POST | `/api/druck/test` | -> `{ druckauftragId }` |
| GET | `/api/einstellungen` | `Einstellungen` (ohne PIN-Felder) |
| PUT | `/api/einstellungen` (PIN) | `Partial<Einstellungen> & { neuePin?: string }`; `rabattProzent` muss eine ganze Zahl von 1 bis 99 sein, `veranstaltung` höchstens 40 Zeichen (wird getrimmt, leer erlaubt), sonst 400 `ungueltige_eingabe` |
| POST | `/api/pin/pruefen` | `{ pin }` -> `{ ok }` |
| POST | `/api/testdaten-loeschen` (PIN) | -> `{ ok, backupPfad }` |
| GET/PUT | `/api/warenkorb-entwurf` | `WarenkorbEntwurf` = `Warenkorb & { rabattAktiv: boolean }`. Der Beleg-Rabatt gilt für den ganzen Korb und gehört deshalb zum Entwurf; im PUT ist `rabattAktiv` optional (fehlt = `false`, so verhält sich ein älterer Renderer wie bisher), die Antwort und der GET nennen den Zustand immer ausdrücklich. Damit steht der Rabatt-Knopf nach einem Neustart wieder so, wie der Kassier ihn gesetzt hat |
| GET | `/*` | statisches Renderer-Build (`out/renderer`), Fallback `index.html` |

- Reihenfolge mit Einfüge-Semantik: `reihenfolge` in POST/PUT ist die Zielposition (1 = ganz oben, Werte ≥ 1, im Repo auf 1..N begrenzt). Bekommt ein Produkt die Position n, rutschen alle anderen Produkte ab Position n um eins nach unten; anschliessend werden alle Produkte (aktive und inaktive) lücken- und doppelfrei auf 1..N durchnummeriert (Sortierung `reihenfolge`, `erstellt_am`). POST ohne `reihenfolge`: ans Ende; PUT ohne `reihenfolge`: Position bleibt. Alles in einer Transaktion (`produktRepo.setzeReihenfolge(id, n)`, `produktRepo.normalisiereReihenfolge()`, `produktRepo.loesche(id)`).

- Der Server läuft im Electron-Main auf `127.0.0.1:47100` (`@hono/node-server`). Zusätzlich `npm run server` (Datei `src/server/standalone.ts`) für Plan B ohne Electron.

## src/renderer

- React 19, kein Router-Paket nötig (Zustand `ansicht: 'start'|'verkauf'|'letzte'|'abschluss'|'verwaltung'|'einstellungen'`). Alle Beträge kommen als Rappen und werden mit `formatChf` angezeigt. Meldet `/api/kassentag/aktuell` bzw. `/api/status` einen `vortagOffen`, bleibt die Ansicht `start` (Warnung, „Abschluss nachholen“, Kassentag-Start gesperrt); der Verkaufsbildschirm ist erst nach dem nachgeholten Abschluss und einem neuen Kassentag erreichbar.
- `api.ts`: `API_BASE` ist relativ (`''`), sobald der Renderer per http vom Kassen-Server ausgeliefert wird (beliebiger Port aus Einstellungen/`KASSE_PORT`); nur im Vite-Dev-Server (Port 5173) absolut `http://127.0.0.1:47100`. Jede Anfrage hat ein Zeitlimit (`ZEITLIMITS`: 10 s Standard, 4 s Status, 60 s Abschluss/Testdaten löschen) über `AbortController`; Ablauf wird als `NetzFehler` mit `zeitueberschreitung = true` geworfen, damit der Bezahldialog „Nochmals senden“ (gleiche Verkaufs-UUID) anbieten kann.
- Banner nach dem Bezahlen: verfolgt den eigenen Druckauftrag über `GET /api/druck/:id` (jede Sekunde): „Druck läuft …“, nach 5 s ohne `done` bereits „Drucker prüfen“ mit Handschreib-Liste, bei `failed` mit Fehlertext. Zeigt es ein Druckproblem, schliesst es nicht durch Antippen einer Kachel, sondern nur über den Schliessen-Knopf (oder den nächsten Verkauf).
- Nachdruck des Abschluss-Bons: Knopf im Abschluss-Fertig-Bildschirm und im Kassenstart (für `letzterAbgeschlossener`).
- Abschluss-PDF: Der Fertig-Bildschirm zeigt „Abschluss-PDF wird erstellt …“ und fragt `GET /api/kassentag/:id` alle 1 s (max. 20 s) ab, bis `pdfPfad` gesetzt ist; dann „Abschluss-PDF gespeichert: <pfad>“ (Monospace, umbrechend) und der Knopf „Archivordner öffnen“ (`POST /api/archiv/oeffnen`; nur wenn `window.kasse` existiert, im Browser nur der Pfad). Der Kassenstart zeigt dasselbe für `letzterAbgeschlossener.pdfPfad` (Komponente `AbschlussPdf.tsx`).
- Bildschirme: Kassenstart (Startgeld, Kassier, Vortagswarnung), Verkauf (Kacheln links nach `reihenfolge`, Gruppe als Farbe, Ausverkauft-Toggle per langem Druck oder kleinem Schalter auf der Kachel; Warenkorb rechts mit +/−/Löschen; Zahlartenleiste Bar-CHF / Bar-EUR / Twint / Helfer), Bezahldialog (Ziffernblock, Schnellwahl Passend/10/20/50/100/200, drei Zeilen Total / Gegeben / Rückgeld, Rückgeld am grössten; bei EUR zusätzlich "Total in EUR"; Twint mit Total vorbelegt und Button "Bezahlt, geprüft"; Popups "Betrag nicht gedeckt" (blockierend) und "Rückgeld über 200, sicher?"; Button "stimmt so"), Nach-dem-Bezahlen-Banner (Rückgeld gross, "Sofort ausgeben: …", bleibt bis zum nächsten Antippen), Letzte Verkäufe (Storno letzter Beleg ohne PIN mit Grund, ältere mit PIN, Nachdruck), Abschluss (Bericht, Ist-Zählung CHF/EUR, Differenz farbig, Abschliessen), Verwaltung (PIN-Dialog, Produkte anlegen/ändern/deaktivieren), Einstellungen (Kurs, Druckername, Präfix, PIN ändern, Testdruck, Testdaten löschen).
- Tastatur im Bezahldialog: Ziffern, `.`/`,`, Backspace, Enter = bestätigen, Esc = zurück. Kopfzeile: Kassentag, Kassier, Drucker-Ampel (aus `/api/status`, alle 2 s gepollt), Uhrzeit.
- Touch-tauglich: Kacheln ≥ 72 px hoch, Buttons ≥ 48 px, Schrift ≥ 16 px, Rückgeld ≥ 64 px. Kein externes UI-Framework, eigenes CSS.
- Nach jedem Warenkorb-Änderung `PUT /api/warenkorb-entwurf` (debounced 300 ms); beim Start `GET`.

## src/main

- Single-Instance: `requestSingleInstanceLock()` wird in einer Variablen gehalten; ohne Sperre wird sofort `app.quit()` aufgerufen und **nichts** weiter registriert (kein `whenReady`, keine DB, kein Worker). Startet DB (`C:\Kasse\data\kasse.sqlite`, im Dev `./data/kasse.sqlite`), Migrationen, Seeds, Hono-Server (Port-Bind **vor** dem Druck-Worker), Druck-Worker (Transport nach `KASSE_PRINT`), Backup-Timer (alle 10 min + bei Abschluss: WAL-Checkpoint, Kopie nach `<daten>/backup/kasse-<zeit>.sqlite` und auf USB, falls `backup_pfad_usb` erreichbar), PDF (`printToPDF` A4 nach `<daten>/archiv/Kassenabschluss_<datum>_<praefix>[_n].pdf`; `nachAbschluss` liefert `{ pdfPfad }` mit dem absoluten Pfad, bei Fehler `null` und Eintrag im Log), `oeffneArchiv` (= `shell.openPath(<daten>/archiv)`), Kiosk-Fenster auf `http://127.0.0.1:47100`, Single-Instance, `powerSaveBlocker`, Beenden nur `Ctrl+Shift+Q` + PIN, `close` abgefangen.
