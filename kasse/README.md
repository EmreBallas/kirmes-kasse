# kasse – Entwicklerseite

Diese Seite richtet sich an Entwickler. Installation, Einrichtung und Bedienung stehen auf der
Hauptseite des Repositories: [../README.md](../README.md). Verbindlich für alle Schnittstellen
(Module, Datenmodell, API-Routen, Druckpfad) ist [KONTRAKT.md](KONTRAKT.md).

Technik: electron-vite 5, React 19, TypeScript strict, Electron 44 mit `node:sqlite`, Hono,
vitest, electron-builder. Zielplattform ist Windows. Für Entwicklung und Tests wird Node 24 oder
neuer gebraucht, weil `src/server` `node:sqlite` ohne zusätzlichen Schalter verwendet; die
GitHub-Actions-Workflows laufen ebenfalls auf Node 24.

## Ordnerstruktur

| Ordner | Inhalt |
|---|---|
| `src/core/` | Reine Geldlogik (Beträge, Warenkorb, Zahlung, Abschluss, Bon-Modell). Kein Node-, kein DOM-Import. |
| `src/print/` | Bon-Modell zu ESC/POS-Bytes, Transporte (`winspool` über den Windows-Spooler, `simulator` als Datei) und der Druck-Worker. |
| `src/server/` | SQLite über `node:sqlite`, Migrationen in `src/server/migrations/`, Repositories, Hono-API und Seeds. |
| `src/renderer/` | React-Oberfläche. Sie spricht ausschliesslich HTTP gegen den lokalen Server, kein direkter Datenbankzugriff. |
| `src/main/` | Electron-Hülle: startet Server und Druck-Worker, Kiosk-Fenster, Abschluss-PDF, Backup. |
| `tools/` | `print-raw.ps1` (RAW-Druck über den Spooler), `setup-laptop.ps1`, Hilfsskripte für Paket und Server. |
| `resources/` | `produkte-seed.json` und `seed.default.json` für den Erststart. |

Pfad-Aliase: `@core/*`, `@server/*`, `@print/*`.

## Befehle

| Befehl | Wirkung |
|---|---|
| `npm run dev` | Startet Electron mit electron-vite im Entwicklungsmodus (Renderer mit Hot Reload). |
| `npm test` | Führt alle vitest-Tests einmal aus. |
| `npm run test:watch` | Führt die Tests im Beobachtungsmodus aus. |
| `npm run typecheck` | Prüft die Typen für Node- und Web-Teil (`tsconfig.node.json`, `tsconfig.web.json`), ohne Ausgabe. |
| `npm run build` | Typprüfung und anschliessend `electron-vite build` nach `out/`. |
| `npm run paket` | Packt mit electron-builder einen entpackten Windows-Ordner (`dist/win-unpacked`) und kopiert danach ein vorhandenes `seed.local.json` daneben. |
| `npm run build:win` | Baut und erzeugt das Windows-Paket gemäss `electron-builder.yml` (Ordner und Zip, kein Installer, kein Signing). |
| `npm run server` | Startet nur den HTTP-Server aus `src/server/standalone.ts`, ohne Electron. |
| `npm run lint` | ESLint über das Projekt. |
| `npm run format` | Prettier schreibt die Formatierung im Projekt. |

## Grundregeln für Beiträge

- Geld immer als ganze Rappen (EUR als ganze Cent, Kurs als `kursX10000`). Nie Fliesskomma für Geld.
- TypeScript strict, kein `any`.
- Deutsche Fachbegriffe im Code (`verkauf`, `rueckgeld`, `kassentag`), englische Technikbegriffe
  (`repo`, `router`, `worker`).
- Tests liegen als `*.test.ts` neben dem Code; `npx vitest run src/<modul>` muss grün sein.
- `KONTRAKT.md` ist verbindlich. Ergänzungen an den Typen sind erlaubt, Umbenennungen nur nach Absprache.

## Umgebungsvariablen für die Entwicklung

| Variable | Wirkung |
|---|---|
| `KASSE_PRINT=sim` | Statt zu drucken schreibt der Simulator Bytes und eine Textvorschau in den Archivordner. Entwickeln ohne Drucker. `KASSE_PRINT=winspool` erzwingt umgekehrt den echten Druckweg. |
| `KASSE_KIOSK=0` | Normales Fenster statt Vollbild-Kiosk, auch im gepackten Paket. |
| `KASSE_DATEN` | Anderer Datenordner (Datenbank, Backup, Archiv). |
| `KASSE_PORT` | Überschreibt den Port aus den Einstellungen. |
