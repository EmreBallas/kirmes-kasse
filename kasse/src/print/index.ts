/**
 * Oeffentliche Schnittstelle des Druckmoduls.
 */
import { join } from 'node:path'
import { SimulatorTransport } from './simulator'
import type { DruckTransport } from './transport'
import { WinspoolTransport } from './winspool'

export { baueBytes, kodiereText, schneideZeile, BEFEHL, CODEPAGE, SPALTEN } from './escpos'
export type { DruckErgebnis, DruckErgebnisStatus, DruckTransport, TransportName } from './transport'
export {
  WinspoolTransport,
  parseSkriptAusgabe,
  parseSkriptJson,
  baueSkriptArgumente,
  verwerfeSpoolerAuftraege,
  druckerVorhanden
} from './winspool'
export type {
  WinspoolOptionen,
  PowershellAusfuehrer,
  ProzessErgebnis,
  SkriptAusgabe
} from './winspool'
export { SimulatorTransport, dekodiereVorschau, SCHNITT_ZEILE, SCHUBLADE_ZEILE } from './simulator'
export type { SimulatorOptionen } from './simulator'
export {
  startDruckWorker,
  bezeichnungFuer,
  fehlerWarteschlangeFehlt,
  GRUND_APP_NEUSTART,
  PRUEF_INTERVALL_MS
} from './worker'
export type {
  DruckQuelle,
  DruckWorker,
  DruckWorkerOptionen,
  DruckWorkerStatus,
  MarkiereFelder
} from './worker'

export interface TransportUmgebung {
  /** Wert von process.env.KASSE_PRINT; 'sim' waehlt den Simulator */
  KASSE_PRINT?: string
  /** Dev-Modus (electron-vite): Simulator, sofern KASSE_PRINT nicht ausdruecklich 'winspool' ist */
  devModus?: boolean
  /** Warteschlangenname aus den Einstellungen (drucker_name) */
  druckerName: string
  /** absoluter Pfad zu tools/print-raw.ps1 */
  skriptPfad: string
  /** Archivordner; der Simulator schreibt nach <archivOrdner>/simulator */
  archivOrdner: string
  /** Ordner fuer Job-Dateien des winspool-Transports, Standard %TEMP%\kasse */
  tempOrdner?: string
}

export function istSimulatorGewuenscht(
  env: Pick<TransportUmgebung, 'KASSE_PRINT' | 'devModus'>
): boolean {
  if (env.KASSE_PRINT === 'sim') return true
  if (env.KASSE_PRINT === 'winspool') return false
  return env.devModus === true
}

/** Waehlt den Transport: Simulator bei KASSE_PRINT=sim (oder Dev-Modus), sonst Windows-Spooler. */
export function erstelleTransport(env: TransportUmgebung): DruckTransport {
  if (istSimulatorGewuenscht(env)) {
    return new SimulatorTransport({ ordner: join(env.archivOrdner, 'simulator') })
  }
  return new WinspoolTransport({
    druckerName: env.druckerName,
    skriptPfad: env.skriptPfad,
    tempOrdner: env.tempOrdner
  })
}
