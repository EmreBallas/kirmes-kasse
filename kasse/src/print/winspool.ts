/**
 * Transport ueber den Windows-Druckspooler (RAW, Treiber wird umgangen).
 * Die eigentliche Arbeit macht tools/print-raw.ps1 (Fassung 2); hier werden nur
 * Temp-Datei, Prozessaufruf und Auswertung des JSON auf stdout erledigt.
 *
 * Exit-Codes des Skripts: 0 = accepted, 2 = removed (hing im Spooler, wurde entfernt), 1 = error.
 */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DruckerInfo } from '@core/types'
import type { DruckErgebnis, DruckTransport } from './transport'

export const POWERSHELL = 'powershell.exe'
export const SKRIPT_TIMEOUT_MS = 20_000

/** Ergebnis eines PowerShell-Aufrufs, unabhaengig von execFile (fuer Tests austauschbar). */
export interface ProzessErgebnis {
  stdout: string
  stderr: string
  /** null, wenn der Prozess durch Timeout/Signal beendet wurde oder gar nicht startete */
  exitCode: number | null
  /** Fehler beim Start oder Abbruch (ENOENT, Timeout), sonst null */
  prozessFehler: string | null
  /**
   * true, wenn der Prozess nach dem Start abgebrochen wurde (Timeout). Dann ist der Spooler-Auftrag
   * meist schon angelegt und muss verworfen werden (Regel 18: nie automatischer Nachdruck).
   */
  abgebrochen?: boolean
}

export type PowershellAusfuehrer = (argumente: string[]) => Promise<ProzessErgebnis>

interface ExecFileFehler extends Error {
  code?: number | string
  killed?: boolean
  signal?: NodeJS.Signals | null
  stdout?: string
  stderr?: string
}

function istExecFileFehler(e: unknown): e is ExecFileFehler {
  return typeof e === 'object' && e !== null && 'message' in e
}

/** Standard-Ausfuehrer: powershell.exe per execFile ohne Shell, versteckt, mit Timeout. */
export function fuehrePowershellAus(
  argumente: string[],
  timeoutMs: number = SKRIPT_TIMEOUT_MS
): Promise<ProzessErgebnis> {
  return new Promise((resolve) => {
    execFile(
      POWERSHELL,
      argumente,
      { timeout: timeoutMs, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      (fehler, stdout, stderr) => {
        if (fehler === null) {
          resolve({ stdout, stderr, exitCode: 0, prozessFehler: null })
          return
        }
        if (!istExecFileFehler(fehler)) {
          resolve({ stdout, stderr, exitCode: null, prozessFehler: 'Unbekannter Prozessfehler' })
          return
        }
        if (typeof fehler.code === 'number') {
          // Normales Ende mit Exit-Code != 0
          resolve({ stdout, stderr, exitCode: fehler.code, prozessFehler: null })
          return
        }
        const abgebrochen = fehler.killed === true
        const grund = abgebrochen
          ? `PowerShell nach ${Math.round(timeoutMs / 1000)} s abgebrochen (Timeout)`
          : `PowerShell konnte nicht gestartet werden: ${fehler.message}`
        resolve({ stdout, stderr, exitCode: null, prozessFehler: grund, abgebrochen })
      }
    )
  })
}

/** Argumente fuer print-raw.ps1 (ohne Shell, daher keine Anfuehrungszeichen noetig). */
export function baueSkriptArgumente(
  skriptPfad: string,
  druckerName: string,
  binPfad: string,
  bezeichnung: string
): string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    skriptPfad,
    '-Printer',
    druckerName,
    '-File',
    binPfad,
    '-DocName',
    bezeichnung
  ]
}

/** Rohes JSON-Objekt, wie es print-raw.ps1 auf stdout schreibt. */
export interface SkriptAusgabe {
  jobId: number | null
  bytes: number
  status: string | null
  fehler: string | null
}

function leseZahl(objekt: Record<string, unknown>, feld: string): number | null {
  const wert = objekt[feld]
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : null
}

function leseText(objekt: Record<string, unknown>, feld: string): string | null {
  const wert = objekt[feld]
  if (typeof wert !== 'string') return null
  const getrimmt = wert.trim()
  return getrimmt === '' ? null : getrimmt
}

/** Sucht die letzte JSON-Zeile in stdout und liest die bekannten Felder heraus. */
export function parseSkriptJson(stdout: string): SkriptAusgabe | null {
  const zeilen = stdout
    .replace(/^\uFEFF/, '') // BOM von PowerShell entfernen
    .split(/\r?\n/)
    .map((z) => z.trim())
    .filter((z) => z.startsWith('{') && z.endsWith('}'))
  for (let i = zeilen.length - 1; i >= 0; i--) {
    try {
      const roh: unknown = JSON.parse(zeilen[i])
      if (typeof roh !== 'object' || roh === null || Array.isArray(roh)) continue
      const objekt = roh as Record<string, unknown>
      return {
        jobId: leseZahl(objekt, 'jobId'),
        bytes: leseZahl(objekt, 'bytes') ?? 0,
        status: leseText(objekt, 'status'),
        fehler: leseText(objekt, 'fehler')
      }
    } catch {
      // keine gueltige JSON-Zeile, weitersuchen
    }
  }
  return null
}

/**
 * Wertet Exit-Code, stdout-JSON und stderr des Skripts zu einem DruckErgebnis aus.
 * Exit 0 -> accepted, Exit 2 -> removed, alles andere (inkl. null) -> error.
 */
export function parseSkriptAusgabe(
  stdout: string,
  exitCode: number | null,
  stderr: string = '',
  prozessFehler: string | null = null
): DruckErgebnis {
  const json = parseSkriptJson(stdout)
  const jobId = json !== null && json.jobId !== null && json.jobId > 0 ? json.jobId : null
  const stderrText = stderr.trim() === '' ? null : stderr.trim()

  if (exitCode === 0) {
    return { ok: true, status: 'accepted', jobId, fehler: null }
  }
  if (exitCode === 2) {
    return {
      ok: false,
      status: 'removed',
      jobId,
      fehler: json?.fehler ?? stderrText ?? 'Auftrag hing im Spooler und wurde entfernt'
    }
  }
  const fehler =
    prozessFehler ??
    json?.fehler ??
    stderrText ??
    (exitCode === null
      ? 'Druckskript ohne Exit-Code beendet'
      : `Druckskript mit Exit-Code ${exitCode} beendet`)
  return { ok: false, status: 'error', jobId, fehler }
}

/** Einfach-quotierter PowerShell-String (Hochkommas werden verdoppelt). */
export function psString(text: string): string {
  return `'${text.replace(/'/g, "''")}'`
}

/** PowerShell-Befehl: alle Auftraege der Warteschlange entfernen, Anzahl ausgeben. */
export function baueVerwerfenBefehl(druckerName: string): string {
  const n = psString(druckerName)
  return (
    `$j = @(Get-PrintJob -PrinterName ${n} -ErrorAction SilentlyContinue); ` +
    `$j | Remove-PrintJob -ErrorAction SilentlyContinue; ` +
    `Write-Output $j.Count`
  )
}

/** PowerShell-Befehl: prueft, ob die Warteschlange existiert; gibt 'ja' oder 'nein' aus. */
export function baueVorhandenBefehl(druckerName: string): string {
  const n = psString(druckerName)
  return `if (Get-Printer -Name ${n} -ErrorAction SilentlyContinue) { Write-Output 'ja' } else { Write-Output 'nein' }`
}

export function baueBefehlArgumente(befehl: string): string[] {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', befehl]
}

/** Liest die Anzahl aus der Ausgabe von baueVerwerfenBefehl (letzte Ganzzahl-Zeile). */
export function parseAnzahl(stdout: string): number {
  const zeilen = stdout
    .split(/\r?\n/)
    .map((z) => z.trim())
    .filter((z) => /^\d+$/.test(z))
  if (zeilen.length === 0) return 0
  return Number.parseInt(zeilen[zeilen.length - 1], 10)
}

export function parseVorhanden(stdout: string): boolean {
  return /(^|\n)\s*ja\s*(\r?\n|$)/.test(stdout)
}

/** Entfernt alle Spooler-Auftraege der Warteschlange (Regel 18). Liefert die Anzahl der entfernten Auftraege. */
export async function verwerfeSpoolerAuftraege(
  druckerName: string,
  ausfuehren: PowershellAusfuehrer = (a) => fuehrePowershellAus(a)
): Promise<number> {
  const ergebnis = await ausfuehren(baueBefehlArgumente(baueVerwerfenBefehl(druckerName)))
  if (ergebnis.prozessFehler !== null) {
    throw new Error(`Spooler-Auftraege konnten nicht verworfen werden: ${ergebnis.prozessFehler}`)
  }
  return parseAnzahl(ergebnis.stdout)
}

/** true, wenn eine Warteschlange mit diesem Namen existiert. */
export async function druckerVorhanden(
  druckerName: string,
  ausfuehren: PowershellAusfuehrer = (a) => fuehrePowershellAus(a)
): Promise<boolean> {
  const ergebnis = await ausfuehren(baueBefehlArgumente(baueVorhandenBefehl(druckerName)))
  if (ergebnis.prozessFehler !== null) return false
  return parseVorhanden(ergebnis.stdout)
}

// ---------------------------------------------------------------- Installierte Drucker

/**
 * PowerShell-Befehl: alle installierten Warteschlangen als JSON (Einzelobjekt oder Array).
 * PrinterStatus wird als Text ausgegeben ("Normal", "Offline" ...), nicht als Enum-Zahl.
 */
export function baueListeBefehl(): string {
  return (
    'Get-Printer | Select-Object Name,PortName,DriverName,' +
    "@{n='PrinterStatus';e={[string]$_.PrinterStatus}} | ConvertTo-Json -Compress"
  )
}

function leseTextOderLeer(objekt: Record<string, unknown>, feld: string): string {
  const wert = objekt[feld]
  if (typeof wert === 'string') return wert.trim()
  if (typeof wert === 'number' && Number.isFinite(wert)) return String(wert)
  return ''
}

function druckerInfoAus(roh: unknown): DruckerInfo | null {
  if (typeof roh !== 'object' || roh === null || Array.isArray(roh)) return null
  const objekt = roh as Record<string, unknown>
  const name = leseTextOderLeer(objekt, 'Name')
  if (name === '') return null
  return {
    name,
    port: leseTextOderLeer(objekt, 'PortName'),
    treiber: leseTextOderLeer(objekt, 'DriverName'),
    status: leseTextOderLeer(objekt, 'PrinterStatus')
  }
}

/**
 * Liest die Ausgabe von baueListeBefehl: ein Objekt (genau ein Drucker), ein Array oder nichts.
 * Unbrauchbare Ausgabe ergibt eine leere Liste, nie eine Ausnahme.
 */
export function parseDruckerListe(stdout: string): DruckerInfo[] {
  const text = stdout.replace(/^\uFEFF/, '').trim()
  const start = text.search(/[[{]/)
  if (start < 0) return []
  let roh: unknown
  try {
    roh = JSON.parse(text.slice(start))
  } catch {
    return []
  }
  const eintraege = Array.isArray(roh) ? roh : [roh]
  const liste: DruckerInfo[] = []
  for (const e of eintraege) {
    const info = druckerInfoAus(e)
    if (info !== null) liste.push(info)
  }
  return liste
}

/** Alle installierten Warteschlangen; leere Liste, wenn PowerShell scheitert. */
export async function listeDrucker(
  ausfuehren: PowershellAusfuehrer = (a) => fuehrePowershellAus(a)
): Promise<DruckerInfo[]> {
  let ergebnis: ProzessErgebnis
  try {
    ergebnis = await ausfuehren(baueBefehlArgumente(baueListeBefehl()))
  } catch {
    return []
  }
  if (ergebnis.prozessFehler !== null) return []
  return parseDruckerListe(ergebnis.stdout)
}

/** Namens-/Treibermuster, an denen ein Epson-Bondrucker zu erkennen ist (case-insensitiv). */
export const EPSON_MUSTER = ['tm-t', 'tm-m', 'tm-u', 'epson tm'] as const
/** Port-Praefixe eines direkt angeschlossenen Bondruckers (USB001, ESDPRT001 des Epson-Treibers). */
export const BON_PORT_PRAEFIXE = ['usb', 'esdprt'] as const

function gleicherName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** true, wenn die Warteschlange nach einem Epson-Bondrucker aussieht (Name, Treiber oder Port). */
export function istBondruckerKandidat(d: DruckerInfo): boolean {
  const name = d.name.toLowerCase()
  const treiber = d.treiber.toLowerCase()
  const port = d.port.toLowerCase()
  if (EPSON_MUSTER.some((m) => name.includes(m) || treiber.includes(m))) return true
  return BON_PORT_PRAEFIXE.some((p) => port.startsWith(p))
}

/**
 * Schlaegt bei einer Namensabweichung den passenden Drucker vor:
 * - null, wenn ein Eintrag bereits so heisst wie gewuenscht (Windows vergleicht Namen ohne
 *   Gross-/Kleinschreibung, deshalb auch hier) - dann ist alles gut;
 * - sonst der EINZIGE Kandidat nach istBondruckerKandidat; bei mehreren oder keinem null.
 */
export function schlageDruckerVor(liste: DruckerInfo[], gewuenscht: string): DruckerInfo | null {
  if (liste.some((d) => gleicherName(d.name, gewuenscht))) return null
  const kandidaten = liste.filter(istBondruckerKandidat)
  return kandidaten.length === 1 ? kandidaten[0] : null
}

/**
 * Darf der Main den Vorschlag ohne Zutun uebernehmen? Nur, wenn es einen Vorschlag gibt UND die
 * Einstellung noch auf dem Standardwert aus seed.default.json steht (niemand hat je einen Namen
 * gewaehlt). Ein bewusst eingetragener Name wird nie automatisch ueberschrieben.
 */
export function sollAutomatischUebernehmen(
  eingestellt: string,
  standard: string,
  vorschlag: string | null
): boolean {
  if (vorschlag === null || vorschlag.trim() === '') return false
  if (standard.trim() === '') return false
  return gleicherName(eingestellt, standard) && !gleicherName(eingestellt, vorschlag)
}

export interface WinspoolOptionen {
  druckerName: string
  /** absoluter Pfad zu tools/print-raw.ps1 */
  skriptPfad: string
  /** Ordner fuer die Job-Dateien, Standard %TEMP%\kasse */
  tempOrdner?: string
  /** nur fuer Tests: ersetzt den echten PowerShell-Aufruf */
  ausfuehren?: PowershellAusfuehrer
}

export class WinspoolTransport implements DruckTransport {
  readonly name = 'winspool' as const
  readonly skriptPfad: string
  readonly tempOrdner: string
  private readonly ausfuehren: PowershellAusfuehrer
  private aktuellerDruckerName: string

  constructor(optionen: WinspoolOptionen) {
    this.aktuellerDruckerName = optionen.druckerName
    this.skriptPfad = optionen.skriptPfad
    this.tempOrdner = optionen.tempOrdner ?? join(tmpdir(), 'kasse')
    this.ausfuehren = optionen.ausfuehren ?? ((a) => fuehrePowershellAus(a))
  }

  /** Warteschlange, an die gesendet wird (aus den Einstellungen, zur Laufzeit wechselbar). */
  get druckerName(): string {
    return this.aktuellerDruckerName
  }

  /** Wechselt die Warteschlange fuer alle folgenden Auftraege (DruckTransport.setzeDruckerName). */
  setzeDruckerName(name: string): void {
    this.aktuellerDruckerName = name
  }

  async senden(bytes: Uint8Array, bezeichnung: string): Promise<DruckErgebnis> {
    const binPfad = join(this.tempOrdner, `job-${randomUUID()}.bin`)
    try {
      await mkdir(this.tempOrdner, { recursive: true })
      await writeFile(binPfad, bytes)
    } catch (e) {
      return {
        ok: false,
        status: 'error',
        jobId: null,
        fehler: `Job-Datei konnte nicht geschrieben werden: ${fehlerText(e)}`
      }
    }

    try {
      const argumente = baueSkriptArgumente(this.skriptPfad, this.druckerName, binPfad, bezeichnung)
      const prozess = await this.ausfuehren(argumente)
      const ergebnis = parseSkriptAusgabe(
        prozess.stdout,
        prozess.exitCode,
        prozess.stderr,
        prozess.prozessFehler
      )
      if (prozess.abgebrochen === true) {
        // Skript abgebrochen (haengender Spooler, blockierter USB-Port): der Auftrag steht vermutlich
        // noch in der Warteschlange und wuerde beim naechsten Anstecken von selbst drucken.
        // Deshalb sofort alle Auftraege der Warteschlange verwerfen (Regel 18).
        const zusatz = await this.verwerfeNachAbbruch()
        return { ...ergebnis, fehler: `${ergebnis.fehler ?? 'Druckskript abgebrochen'}; ${zusatz}` }
      }
      return ergebnis
    } catch (e) {
      return {
        ok: false,
        status: 'error',
        jobId: null,
        fehler: `Druckskript fehlgeschlagen: ${fehlerText(e)}`
      }
    } finally {
      await rm(binPfad, { force: true }).catch(() => undefined)
    }
  }

  /** Verwirft nach einem Abbruch alle Spooler-Auftraege; liefert den Text fuer die Fehlermeldung. */
  private async verwerfeNachAbbruch(): Promise<string> {
    try {
      const anzahl = await verwerfeSpoolerAuftraege(this.druckerName, this.ausfuehren)
      return `${String(anzahl)} Spooler-Auftraege verworfen`
    } catch (e) {
      return `Spooler-Auftraege konnten nicht verworfen werden (${fehlerText(e)}), bitte Warteschlange "${this.druckerName}" von Hand leeren`
    }
  }
}

function fehlerText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
