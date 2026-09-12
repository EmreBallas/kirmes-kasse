/**
 * Electron-Main der Vereins-Kasse.
 *
 * Reihenfolge beim Start: Single-Instance-Sperre -> Datenordner -> SQLite (Migrationen, Seeds) -> Hono-App
 * -> HTTP-Server auf 127.0.0.1:<port> (Port-Bind vor allem, was Daten anfasst) -> Druck-Transport und
 * Druck-Worker (Start-Aufraeumung) -> Kiosk-Fenster auf http://127.0.0.1:<port>/.
 * Dazu: Backup-Timer (alle 10 Minuten, bei Abschluss, beim Beenden), Abschluss-PDF, Single-Instance,
 * powerSaveBlocker, Beenden nur ueber Ctrl+Shift+Q bzw. Alt+F4 mit PIN im Renderer.
 *
 * Umgebungsvariablen: KASSE_DATEN (Datenordner), KASSE_PORT (ueberschreibt die Einstellung),
 * KASSE_PRINT (sim | winspool), KASSE_KIOSK=0 (kein Vollbild, auch im Paket), ELECTRON_RENDERER_URL (Dev).
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  powerSaveBlocker,
  shell
} from 'electron'
import { optimizer } from '@electron-toolkit/utils'
import { serve, type ServerType } from '@hono/node-server'
import { erstelleTransport, startDruckWorker, type DruckWorker } from '@print/index'
import {
  erstelleDruckQuelle,
  erstelleKassenApp,
  fuehreSeedAus,
  migriere,
  oeffneDb,
  type DatabaseSync,
  type Repos
} from '@server/index'
import { erstelleBackup } from './backup'
import { schreibeAbschlussPdf } from './pdf'

const BACKUP_INTERVALL_MS = 10 * 60 * 1000
const BEENDEN_SHORTCUT = 'CommandOrControl+Shift+Q'

// ---------------------------------------------------------------- Pfade

const datenOrdner =
  process.env['KASSE_DATEN'] !== undefined && process.env['KASSE_DATEN'] !== ''
    ? resolve(process.env['KASSE_DATEN'])
    : app.isPackaged
      ? 'C:\\Kasse\\data'
      : join(process.cwd(), 'data')
const bytesOrdner = join(datenOrdner, 'bytes')
const backupOrdner = join(datenOrdner, 'backup')
const archivOrdner = join(datenOrdner, 'archiv')
const simulatorOrdner = join(archivOrdner, 'simulator')
const dbPfad = join(datenOrdner, 'kasse.sqlite')
const logPfad = join(datenOrdner, 'kasse.log')

/** Wurzel der mitgelieferten Dateien: im Paket process.resourcesPath, im Dev der Projektordner. */
const ressourcenWurzel = app.isPackaged ? process.resourcesPath : process.cwd()
const migrationsOrdner = app.isPackaged
  ? join(process.resourcesPath, 'migrations')
  : resolve(process.cwd(), 'src/server/migrations')
const produktePfad = join(ressourcenWurzel, 'resources', 'produkte-seed.json')
const seedDefaultPfad = join(ressourcenWurzel, 'resources', 'seed.default.json')
const skriptPfad = join(ressourcenWurzel, 'tools', 'print-raw.ps1')
const rendererOrdner = join(__dirname, '../renderer')

// ---------------------------------------------------------------- Protokoll

function zeitstempel(): string {
  const d = new Date()
  const z = (n: number): string => (n < 10 ? `0${String(n)}` : String(n))
  return `${String(d.getFullYear())}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`
}

function log(meldung: string): void {
  const zeile = `${zeitstempel()} ${meldung}`
  console.log(zeile)
  try {
    appendFileSync(logPfad, `${zeile}\n`)
  } catch {
    // Protokolldatei ist Komfort, kein Muss
  }
}

function fehlerText(e: unknown): string {
  return e instanceof Error ? (e.stack ?? e.message) : String(e)
}

// ---------------------------------------------------------------- Zustand

interface Laufzeit {
  db: DatabaseSync
  repos: Repos
  worker: DruckWorker
  server: ServerType
  port: number
}

let laufzeit: Laufzeit | null = null
let hauptfenster: BrowserWindow | null = null
let beendenErlaubt = false
let backupTimer: ReturnType<typeof setInterval> | null = null
let powerSaveId: number | null = null
let aufgeraeumt = false

// ---------------------------------------------------------------- Single-Instance

/**
 * Sperre der ersten Instanz. Ohne Sperre darf NICHTS weiter laufen: app.quit() ist asynchron, whenReady
 * koennte noch feuern und die zweite Instanz wuerde die DB der laufenden Kasse oeffnen, deren offene
 * Druckauftraege auf failed setzen und ihre Spooler-Auftraege verwerfen. Deshalb wird der gesamte
 * Lebenszyklus (siehe Ende der Datei) nur registriert, wenn die Sperre da ist.
 */
const habeLock = app.requestSingleInstanceLock()

// ---------------------------------------------------------------- Backup

function backupAusfuehren(anlass: string): string | null {
  if (laufzeit === null) return null
  const { db, repos } = laufzeit
  const ergebnis = erstelleBackup({
    db,
    dbPfad,
    backupOrdner,
    usbPfad: () => repos.einstellung.einstellungen().backupPfadUsb,
    log
  })
  log(
    `Backup (${anlass}): ${ergebnis.lokalerPfad}` +
      (ergebnis.usbPfad !== null ? ` und ${ergebnis.usbPfad}` : '')
  )
  return ergebnis.lokalerPfad
}

function backupSicher(anlass: string): void {
  try {
    backupAusfuehren(anlass)
  } catch (e) {
    log(`Backup (${anlass}) fehlgeschlagen: ${fehlerText(e)}`)
  }
}

// ---------------------------------------------------------------- Server + Worker

function starteServer(
  fetch: (req: Request) => Response | Promise<Response>,
  port: number
): Promise<ServerType> {
  return new Promise((resolveServer, rejectServer) => {
    const server = serve({ fetch, hostname: '127.0.0.1', port }, (info) => {
      log(`Server laeuft auf http://127.0.0.1:${String(info.port)}`)
      resolveServer(server)
    })
    server.on('error', (e: Error) => {
      rejectServer(
        new Error(`HTTP-Server auf Port ${String(port)} konnte nicht starten: ${e.message}`)
      )
    })
  })
}

async function starteLaufzeit(): Promise<Laufzeit> {
  for (const ordner of [datenOrdner, bytesOrdner, backupOrdner, archivOrdner, simulatorOrdner]) {
    mkdirSync(ordner, { recursive: true })
  }
  log(
    `Start Kasse ${app.getVersion()} (${app.isPackaged ? 'Paket' : 'Dev'}), Daten: ${datenOrdner}`
  )

  const db = oeffneDb(dbPfad)
  const neueMigrationen = migriere(db, migrationsOrdner)
  const seedLokalKandidaten = [
    join(process.cwd(), 'seed.local.json'),
    join(dirname(app.getPath('exe')), 'seed.local.json')
  ]
  const seed = fuehreSeedAus({
    db,
    produktePfad,
    einstellungsPfade: [...new Set(seedLokalKandidaten), seedDefaultPfad]
  })
  log(
    `DB ${dbPfad}: Migrationen neu ${String(neueMigrationen)}, Produkte angelegt ${String(seed.produkteAngelegt)}, ` +
      `Einstellungen aus ${seed.einstellungsDatei ?? 'keiner Datei'}` +
      (seed.pinGesetzt ? ', PIN gesetzt' : '')
  )

  // Die App bekommt den Worker-Status als Funktion, deshalb darf der Worker danach erzeugt werden.
  // Reihenfolge: zuerst den Port binden (schlaegt bei einer bereits laufenden Kasse fehl), erst dann
  // der Druck-Worker mit seiner Start-Aufraeumung (queued/sent -> failed, Spooler leeren).
  let worker: DruckWorker | null = null
  const { app: honoApp, repos } = erstelleKassenApp({
    db,
    bytesOrdner,
    version: app.getVersion(),
    dev: !app.isPackaged,
    rendererOrdner,
    druckStatus: () =>
      worker?.status() ?? {
        ampel: 'pruefen',
        letzterFehler: 'Druck-Worker startet noch',
        transport: 'simulator'
      },
    nachDruckauftrag: () => {
      void worker?.verarbeiteOffene()
    },
    // Läuft nach der Antwort der Abschluss-Route; der Pfad landet über den Server in kassentag.pdf_pfad.
    nachAbschluss: async (bericht) => {
      let pdfPfad: string | null = null
      try {
        pdfPfad = await schreibeAbschlussPdf(bericht, archivOrdner)
        log(`Abschluss-PDF geschrieben: ${pdfPfad}`)
      } catch (e) {
        log(`Abschluss-PDF fehlgeschlagen: ${fehlerText(e)}`)
      }
      backupSicher('Abschluss')
      return { pdfPfad }
    },
    oeffneArchiv: async () => {
      mkdirSync(archivOrdner, { recursive: true })
      const problem = await shell.openPath(archivOrdner)
      if (problem !== '') throw new Error(problem)
      log(`Archivordner geöffnet: ${archivOrdner}`)
    },
    backup: () => backupAusfuehren('Testdaten loeschen'),
    log: (m) => log(`[server] ${m}`)
  })

  const einstellungen = repos.einstellung.einstellungen()
  const portEnv = Number(process.env['KASSE_PORT'] ?? '')
  const port = Number.isInteger(portEnv) && portEnv > 0 ? portEnv : einstellungen.port
  let server: ServerType
  try {
    server = await starteServer(honoApp.fetch, port)
  } catch (e) {
    db.close()
    throw e
  }

  const transport = erstelleTransport({
    KASSE_PRINT: process.env['KASSE_PRINT'],
    devModus: !app.isPackaged,
    druckerName: einstellungen.druckerName,
    skriptPfad,
    archivOrdner
  })
  worker = startDruckWorker({
    quelle: erstelleDruckQuelle(db, bytesOrdner),
    transport,
    bytesOrdner,
    druckerName: einstellungen.druckerName,
    log: (m) => log(`[druck] ${m}`)
  })
  await worker.bereit
  log(
    `Druck-Transport ${transport.name}, Drucker "${einstellungen.druckerName}", Skript ${skriptPfad}`
  )

  return { db, repos, worker, server, port }
}

// ---------------------------------------------------------------- Beenden

function beendenAnfragen(): void {
  if (hauptfenster === null || hauptfenster.isDestroyed()) {
    beenden()
    return
  }
  if (hauptfenster.isMinimized()) hauptfenster.restore()
  hauptfenster.focus()
  hauptfenster.webContents.send('beenden-anfragen')
}

function beenden(): void {
  beendenErlaubt = true
  app.quit()
}

function aufraeumen(): void {
  if (aufgeraeumt) return
  aufgeraeumt = true
  globalShortcut.unregisterAll()
  if (backupTimer !== null) {
    clearInterval(backupTimer)
    backupTimer = null
  }
  if (powerSaveId !== null && powerSaveBlocker.isStarted(powerSaveId)) {
    powerSaveBlocker.stop(powerSaveId)
  }
  if (laufzeit !== null) {
    backupSicher('Beenden')
    laufzeit.worker.stop()
    try {
      laufzeit.server.close()
    } catch (e) {
      log(`Server schliessen: ${fehlerText(e)}`)
    }
    try {
      laufzeit.db.close()
    } catch (e) {
      log(`DB schliessen: ${fehlerText(e)}`)
    }
    laufzeit = null
  }
  log('Kasse beendet')
}

// ---------------------------------------------------------------- Fenster

function erstelleFenster(port: number): BrowserWindow {
  const kiosk = app.isPackaged && process.env['KASSE_KIOSK'] !== '0'
  const fenster = new BrowserWindow({
    width: 1366,
    height: 768,
    show: false,
    kiosk,
    fullscreen: kiosk,
    autoHideMenuBar: true,
    backgroundColor: '#f4f4f4',
    title: 'Kasse',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  hauptfenster = fenster

  fenster.on('ready-to-show', () => {
    fenster.show()
    if (kiosk) fenster.focus()
  })

  // Alt+F4 / Fenster schliessen: nur mit bestaetigter PIN (IPC), sonst PIN-Dialog im Renderer.
  fenster.on('close', (ereignis) => {
    if (!beendenErlaubt) {
      ereignis.preventDefault()
      beendenAnfragen()
    }
  })
  fenster.on('closed', () => {
    hauptfenster = null
  })

  // Keine fremden Seiten, keine neuen Fenster, kein Zoom per Geste.
  fenster.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  const eigeneAdresse = `http://127.0.0.1:${String(port)}/`
  const devAdresse = process.env['ELECTRON_RENDERER_URL']
  fenster.webContents.on('will-navigate', (ereignis, url) => {
    const erlaubt =
      url.startsWith(eigeneAdresse) || (devAdresse !== undefined && url.startsWith(devAdresse))
    if (!erlaubt) ereignis.preventDefault()
  })
  fenster.webContents.on('did-finish-load', () => {
    void fenster.webContents.setVisualZoomLevelLimits(1, 1)
  })
  fenster.webContents.on('render-process-gone', (_e, details) => {
    log(`Renderer abgestuerzt (${details.reason}), Seite wird neu geladen`)
    fenster.webContents.reload()
  })

  if (!app.isPackaged && devAdresse !== undefined) {
    void fenster.loadURL(devAdresse)
  } else {
    void fenster.loadURL(eigeneAdresse)
  }
  return fenster
}

// ---------------------------------------------------------------- App-Lebenszyklus

if (!habeLock) {
  // Zweite Instanz: sofort beenden, ohne DB, Worker oder Server anzufassen.
  // Die erste Instanz bekommt 'second-instance' und holt ihr Fenster nach vorn.
  beendenErlaubt = true
  app.quit()
} else {
  registriereLebenszyklus()
}

function registriereLebenszyklus(): void {
  app.on('second-instance', () => {
    if (hauptfenster !== null) {
      if (hauptfenster.isMinimized()) hauptfenster.restore()
      hauptfenster.focus()
    }
  })

  app.on('window-all-closed', () => {
    beenden()
  })

  app.on('will-quit', () => {
    aufraeumen()
  })

  process.on('uncaughtException', (e) => {
    log(`Unbehandelte Ausnahme: ${fehlerText(e)}`)
  })
  process.on('unhandledRejection', (e) => {
    log(`Unbehandelte Promise-Ablehnung: ${fehlerText(e)}`)
  })

  void app.whenReady().then(bereit)
}

async function bereit(): Promise<void> {
  if (!habeLock) return
  app.setAppUserModelId('ch.kibw.kasse')
  if (app.isPackaged) {
    // Kein Standardmenue: keine Tastenkuerzel wie Ctrl+W, Ctrl+R oder DevTools im Kiosk.
    Menu.setApplicationMenu(null)
  } else {
    app.on('browser-window-created', (_ereignis, fenster) => {
      optimizer.watchWindowShortcuts(fenster)
    })
  }

  try {
    laufzeit = await starteLaufzeit()
  } catch (e) {
    const text = fehlerText(e)
    log(`Start fehlgeschlagen: ${text}`)
    dialog.showErrorBox(
      'Kasse kann nicht starten',
      `${text}\n\nDatenordner: ${datenOrdner}\nProtokoll: ${logPfad}`
    )
    beenden()
    return
  }

  powerSaveId = powerSaveBlocker.start('prevent-display-sleep')
  backupTimer = setInterval(() => backupSicher('Timer'), BACKUP_INTERVALL_MS)

  // PIN-bestaetigtes Beenden aus dem Renderer; nur das eigene Fenster darf das ausloesen.
  ipcMain.on('beenden-bestaetigt', (ereignis) => {
    if (hauptfenster !== null && ereignis.sender === hauptfenster.webContents) {
      log('Beenden per PIN bestaetigt')
      beenden()
    }
  })
  if (!globalShortcut.register(BEENDEN_SHORTCUT, beendenAnfragen)) {
    log(`Tastenkuerzel ${BEENDEN_SHORTCUT} konnte nicht registriert werden`)
  }

  erstelleFenster(laufzeit.port)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && laufzeit !== null) {
      erstelleFenster(laufzeit.port)
    }
  })
}
