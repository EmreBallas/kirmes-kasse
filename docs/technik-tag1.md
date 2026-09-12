# Technische Entscheidungen Tag 1 (Sonntag 13.9.2026)

Stand der Recherche: Samstag 12.9.2026. Alle Versionsnummern sind von den npm-Registry-JSONs bzw. releases.electronjs.org abgelesen; lokale Messungen auf dem Dev-Rechner (Windows 11 IoT LTSC, Windows PowerShell 5.1.26100).

## 1. Electron + SQLite

**Befund**
- Aktuelles Stable: **Electron 44.3.0** (8.9.2026), Chromium 152.0.7977.78, **Node 24.20.0**. Weitere unterstuetzte Linien: 43.7.0 (Node 24.21.0), 42.11.3 (Node 24.19.0). 44 wird bis 2.3.2027 unterstuetzt. npm `electron@latest` = 44.3.0, verlangt Node >= 22.12 auf dem Dev-Rechner (wir haben 24.15).
- `node:sqlite` in Node 24 (Doku v24.21.0): Stabilitaet **1.2 "Release candidate"**, **kein CLI-Flag**, **keine ExperimentalWarning**, `DatabaseSync` mit `prepare/run/get/all`, Option `enableForeignKeyConstraints` (Default true).
- Electron hatte das Modul anfangs nicht eingebaut; PR #47706 "fix: missing SQLite builtin support in Node.js" wurde im Juli 2025 gemerged und bis 36.x zurueckportiert (36.7.3: "Fixed an issue where require('node:sqlite') didn't work"). Electron 44 enthaelt den Fix also seit Generationen. **Nicht selbst ausgefuehrt** (kein Electron-Download in dieser Session) -> Rauchtest ist der erste Befehl am Sonntag.
- Fallback **better-sqlite3 13.0.3** (5.8.2026): seit 13.0.0 (21.7.2026) auf **Node-API**, Prebuilds liegen im npm-Paket selbst (`exports` `./win32-x64`), `prebuild-install` entfernt, `engines.node >= 22`. Laut Release-Notes sollen die Prebuilds "theoretisch" ueber Node- und Electron-Versionen hinweg laufen; die eigene Doku sagt weiterhin "If you're using Electron, use electron-rebuild". `@electron/rebuild` aktuell 4.2.0. Rebuild braucht Visual Studio Build Tools (C++), die auf dem Dev-Rechner nicht installiert sind.

**Entscheidung**
- **Electron 44.3.0 pinnen** (`"electron": "44.3.0"`, kein Caret). Datenzugang ausschliesslich ueber `node:sqlite` im Main-Prozess. Kein natives Modul, kein Rebuild, kein VS-Build-Tools-Risiko.
- Rauchtest Sonntag 08:00, vor allem anderen:
  ```js
  // smoke.js
  const { app } = require('electron');
  const { DatabaseSync } = require('node:sqlite');
  app.whenReady().then(() => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t(x INTEGER) STRICT');
    db.prepare('INSERT INTO t VALUES (?)').run(42);
    console.log(process.versions.electron, process.versions.node, db.prepare('SELECT x FROM t').get());
    app.quit();
  });
  ```
  `npx electron@44.3.0 smoke.js` muss `44.3.0 24.20.0 { x: 42 }` ohne Warnung ausgeben. Falls eine ExperimentalWarning erscheint: akzeptieren (nur Konsole). Falls `ERR_UNKNOWN_BUILTIN_MODULE`: sofort Fallback.
- Fallback: `npm i better-sqlite3@13.0.3`, Rauchtest wiederholen. Wenn der Prebuild unter Electron laedt: fertig, `asarUnpack: ["**/*.node"]` in electron-builder. Wenn nicht: `npx @electron/rebuild` (braucht VS Build Tools -> ~1 h Installationszeit einplanen). Beide Wege haben dieselbe synchrone API-Form (prepare/run/get/all), der Repository-Layer bleibt austauschbar.
- DB-Datei: `app.getPath('userData')/kasse.sqlite` bzw. fester Ordner `C:\Kasse\data` (siehe Packaging), `PRAGMA journal_mode=WAL`, Foreign Keys an. Backup = Dateikopie (WAL vorher mit `PRAGMA wal_checkpoint(TRUNCATE)` zurueckschreiben).

## 2. Projektgeruest (electron-vite)

- Scaffold: `npm create @quick-start/electron@latest kasse -- --template react-ts` (create-electron 1.0.30; Templates vanilla/vue/react/svelte/solid je mit `-ts`; das `--` ist bei npm 7+ noetig).
- Das Template bringt heute: electron-vite ^5.0.0, vite ^7.2.6, electron ^39.2.6, electron-builder ^26.0.12, react ^19.2.1, typescript ^5.9.3, @electron-toolkit/utils + /preload, tsconfig.node.json + tsconfig.web.json, Scripts `dev`, `build`, `build:unpack` (= `electron-builder --dir`), `build:win`, `postinstall: electron-builder install-app-deps`.
- Nach dem Scaffold anpassen: `electron` auf `44.3.0` heben, `electron-builder` auf 26.15.3, **vite auf 7.x lassen** (electron-vite 5.0.0 erlaubt vite ^5||^6||^7, nicht 8; vite@latest ist 8.3.0). electron-vite 5 verlangt Node ^20.19 || >=22.12.
- Struktur: `src/main/index.ts` (Electron-Main: Fenster, HTTP-Server, DB, Druckwarteschlange), `src/preload/index.ts` (in unserem Fall fast leer, die UI spricht HTTP), `src/renderer/` (React), zusaetzlich **`src/core/`** (reine Geldlogik, Integer-Rappen, keine Electron-Imports) und `src/server/` (Hono-Routen + Repositories), beide vom Main importiert. Build-Ausgabe `out/main`, `out/preload`, `out/renderer`.
- Abhaengigkeiten: electron-vite externalisiert im Main/Preload alle `dependencies` aus package.json (werden aus node_modules mitgepackt), Renderer-Deps werden gebuendelt (deshalb React & Co. als devDependencies installieren, damit electron-builder sie nicht mitkopiert). Node-Builtins wie `node:sqlite` sind im Node-Build von Vite extern (nicht separat belegt, aber Standardverhalten fuer `node:`-Imports).
- **HTTP-Server im Main-Prozess: ja.** Ein Prozess, eine DB-Verbindung, kein separates Node auf dem Kassen-PC, kein zweiter Startvorgang. Empfehlung **Hono 4.13.7 + @hono/node-server 2.1.1** (Hono hat 0 Laufzeit-Abhaengigkeiten, node-server verlangt Node >= 20 und peer hono ^4) statt Fastify 5.12.4 (12+ Abhaengigkeiten, mehr Bundling-Ueberraschungen in Electron). Muster:
  ```ts
  import { serve } from '@hono/node-server';
  import { Hono } from 'hono';
  const api = new Hono();
  api.get('/api/health', c => c.json({ ok: true }));
  const server = serve({ fetch: api.fetch, port: 47100, hostname: '127.0.0.1' });
  app.on('before-quit', () => server.close());
  ```
  2026 nur `127.0.0.1`; fuer die spaetere Browser-Zweitkasse auf `0.0.0.0` umstellen (dann Firewall-Freigabe noetig). Renderer laedt im Dev den Vite-Dev-Server, im Build `out/renderer/index.html`, und spricht `http://127.0.0.1:47100` (Port in Settings-Tabelle). WebSocket fuer Live-Updates ueber `ws` auf demselben `node:http`-Server, den `serve()` zurueckgibt.
- `app.requestSingleInstanceLock()` im Main: verhindert eine zweite Kasseninstanz (Doppelklick auf die Verknuepfung), `second-instance` fokussiert das Fenster.

## 3. Abschluss-PDF mit printToPDF

`webContents.printToPDF(options)` liefert `Promise<Buffer>`; Optionen u.a. `pageSize` ('A4' ...), `margins` (Zoll), `printBackground`, `landscape`, `displayHeaderFooter` mit `headerTemplate/footerTemplate`, `preferCSSPageSize`. Ein `@page`-CSS uebersteuert `landscape`.

```ts
import { BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';

export async function abschlussPdf(html: string, zielPfad: string) {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pdf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
    });
    await writeFile(zielPfad, pdf);
  } finally {
    win.destroy();
  }
}
```
HTML wird im Main aus den Abschlussdaten gerendert (gleiche Template-Funktion wie fuer den Bon-Text, nur als Tabelle). Dateiname `Archiv/Kassenabschluss_2026-09-19_K1.pdf`. pdfkit/pdfmake sind unnoetig; printToPDF ist eingebaut und deckt A4 mit Tabellen und Unterschriftslinie ab.

## 4. RAW-Druck ohne natives Modul

**Messung auf dem Dev-Rechner (Windows PowerShell 5.1):** `tools/print-raw.ps1` komplett (Prozessstart + Add-Type-Kompilierung + Aufruf) **0.64 bis 0.74 s** pro Aufruf, Add-Type allein 0.55 s. Die Annahme "1-2 s" ist auf diesem Rechner zu pessimistisch; auf dem Kirmes-Laptop erneut messen. Die Warteschlange `TM-T20II` (Generic / Text Only, USB001) existiert (Get-Printer). Fehlerfall geprueft: nicht vorhandener Drucker -> Exception "OpenPrinter fehlgeschlagen, Win32-Fehler 1801" auf stderr, Exit-Code != 0.

**Alternativen geprueft und verworfen**
- `@grandchef/node-printer` 0.8.0 (Juli 2024): auf `nan` (nicht N-API), Prebuilds nur bis Electron ABI 125 (Electron 31); fuer Electron 44 waere ein node-gyp-Build mit VS Build Tools noetig. Nein.
- `@thesusheer/electron-printer` 4.0.2: N-API (node-addon-api 8, napi_versions 8), Prebuilds ueber node-pre-gyp von GitHub, win32-x64 gelistet. Technisch moeglich, aber unbekannte Qualitaet und ein weiterer Download-Pfad -> nur Stufe 2, falls PowerShell Probleme macht.
- `pdf-to-printer`: nur PDF, ungeeignet fuer ESC/POS.
- Dauerhaft laufender PowerShell-Prozess mit stdin: spart die 0.6 s, kostet Prozess-Ueberwachung. Bei 20 Kunden/Stunde nicht noetig.

**Entscheidung: PowerShell-Helfer per `child_process.execFile`, asynchron ueber eine `print_jobs`-Tabelle.**
- Verkauf speichern -> Jobs (Schublade, Coupons, Bon 1) mit Status `queued` in `print_jobs` eintragen -> HTTP-Antwort an die UI -> Worker im Main arbeitet die Jobs sequenziell ab (ein Aufruf pro Beleg mit allen Bytes in einer Datei; ESC/POS-Bytes in `%TEMP%\kasse\job-<uuid>.bin`).
- Aufruf: `execFile('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File', scriptPfad, '-Printer','TM-T20II','-File', binPfad], { timeout: 15000, windowsHide: true })`. Windows PowerShell 5.1 ist auf jedem Windows vorhanden; `pwsh` (7) ist auf dem Dev-Rechner nur als Store-App da und auf dem Kirmes-Laptop nicht garantiert -> 5.1 verwenden.
- Skript haerten: `$ErrorActionPreference='Stop'`, `try/catch` mit `exit 1`, Bytes gesendet auf stdout. Exit-Code 0 -> Job `done`, sonst `failed` mit Fehlertext; UI zeigt Druckerausfall-Hinweis und den Nachdruck-Button. Nach `done` Temp-Datei loeschen.
- Im Paket liegt das Skript als `extraResources` (`process.resourcesPath/tools/print-raw.ps1`), nicht im asar, weil `powershell -File` eine echte Datei braucht.
- Simulator-Transport: gleiche Job-Schnittstelle, schreibt die Bytes in `Archiv/simulator/` und rendert eine Bon-Vorschau (ESC/POS-Subset decodieren: Text, GS ! Groesse, ESC a Ausrichtung, GS V Schnitt).

## 5. Packaging, Autostart, Kiosk, Energie

- **electron-builder 26.15.3.** Empfohlenes Ziel: **`dir`** (`electron-builder --win dir` bzw. `--dir`, "Build unpacked dir") -> Ordner `dist/win-unpacked` nach `C:\Kasse` kopieren. Kein Installer, kein Signieren (`win.sign: false`), Start ueber `C:\Kasse\Kasse.exe`. Zusaetzlich `zip` als Transportformat auf den USB-Stick.
- **Warum nicht `portable`:** Der portable-Launcher (NSIS-Template `portable.nsi`) entpackt die App bei jedem Start nach `%TEMP%` (bzw. `unpackDirName`) und **loescht den Ordner nach dem Beenden wieder** (`RMDir /r $INSTDIR`); er setzt `PORTABLE_EXECUTABLE_DIR/FILE/APP_FILENAME`. Fuer eine Kasse mit DB, Archivordner und Backup ist das unnoetiges Risiko und verlaengert jeden Start. Falls doch portable: DB niemals neben der exe, sondern `process.env.PORTABLE_EXECUTABLE_DIR` oder `userData`.
- Konfiguration (electron-builder.yml):
  ```yaml
  appId: ch.kibw.kasse
  productName: Kasse
  directories: { output: dist }
  files: ['out/**', 'package.json']
  extraResources: [{ from: tools, to: tools }]
  win: { target: [dir, zip], sign: false }
  ```
- **Autostart:** Verknuepfung in `shell:startup` = `C:\Users\<user>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup` (lokal per `[Environment]::GetFolderPath('Startup')` bestaetigt). Am einfachsten von Hand: Win+R, `shell:startup`, Verknuepfung auf `C:\Kasse\Kasse.exe` hineinziehen. Programmatisch moeglich mit `shell.writeShortcutLink(pfad, 'create', { target, cwd })` (Windows only) oder `app.setLoginItemSettings({ openAtLogin: true })` (Registry Run-Key). Empfehlung: manuell, sichtbar, ohne Code.
- **Kiosk:** `new BrowserWindow({ kiosk: true, autoHideMenuBar: true, backgroundColor: '#111' })`; `win.setKiosk(false)` hinter dem PIN-Dialog (Beenden/Fenster) und als Tastenkombination fuer den Kassier (Ctrl+Shift+Q). Waehrend der Entwicklung `fullscreen: false`. Fenster mit `show: false` erstellen und auf `ready-to-show` zeigen (kein weisser Blitz).
- **Energie (als Admin, auf dem Kirmes-Laptop, Donnerstag):**
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
  Die GUIDs sind lokal per `powercfg /q` verifiziert (USB-Einstellungen / "Einstellung fuer selektives USB-Energiesparen", 0 = Deaktiviert; auf dem Dev-Rechner steht sie aktuell auf 1). `/change` nimmt Minuten, 0 = Nie. Zuklappen-Aktion (`SUB_BUTTONS` / `LIDACTION`) auf dem Laptop zusaetzlich auf "Nichts tun" setzen; auf dem Dev-Rechner (Desktop) ist kein Deckel-Setting vorhanden, deshalb dort nicht pruefbar. Zusaetzlich im Main `powerSaveBlocker.start('prevent-display-sleep')` als zweiter Schutz.

## 6. vitest in electron-vite

- **vitest 5.0.0** verlangt Node ^22.12 || ^24 || >=26 und vite ^6.4 || ^7 || ^8 -> mit vite 7 aus dem Template kompatibel. vitest liest `vite.config.*`, **nicht** `electron.vite.config.ts`, deshalb eine eigene `vitest.config.ts`:
  ```ts
  import { defineConfig } from 'vitest/config';
  export default defineConfig({
    test: {
      environment: 'node',
      include: ['src/core/**/*.test.ts', 'src/server/**/*.test.ts'],
    },
  });
  ```
- `npm i -D vitest@5.0.0`, Scripts: `"test": "vitest run"`, `"test:watch": "vitest"`. `src/core` bleibt ohne Electron-Imports, damit die Tests ohne Electron laufen; Repository-Tests gegen `new DatabaseSync(':memory:')` laufen mit Node 24 direkt (gleiches Modul wie in Electron).
- Typen: `@types/node` ^24 (Electron 44 bringt `@types/node ^24.9.0` als Dependency mit) enthaelt `node:sqlite`.

## Reihenfolge Sonntag 13.9.
1. `npx electron@44.3.0 smoke.js` (node:sqlite-Test) -> Entscheidung SQLite in 10 Minuten.
2. Scaffold `react-ts`, Versionen pinnen, `npm run dev` gruen.
3. `src/core` Geldlogik + vitest.
4. Hono-Server im Main, `/api/health`, Renderer holt ihn.
5. `print_jobs`-Worker mit execFile -> Testdruck auf TM-T20II ueber die App.
6. `electron-builder --win dir`, Start aus `C:\Kasse`.