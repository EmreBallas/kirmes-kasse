/**
 * Backup der SQLite-Datei: WAL-Checkpoint (TRUNCATE), Kopie nach <daten>/backup/kasse-<yyyyMMdd-HHmmss>.sqlite
 * und zusaetzlich auf den USB-Stick (backup_pfad_usb), falls der Ordner erreichbar ist.
 * Der Kopiervorgang ist sicher, weil node:sqlite synchron arbeitet und zwischen Checkpoint und Kopie
 * kein anderer Code die Datenbank schreiben kann.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

export interface BackupOptionen {
  db: DatabaseSync
  /** Pfad der Datenbankdatei */
  dbPfad: string
  /** Zielordner fuer die lokalen Kopien */
  backupOrdner: string
  /** liefert den aktuell konfigurierten USB-Pfad (Einstellung backup_pfad_usb) */
  usbPfad: () => string | null
  jetzt?: () => Date
  log?: (meldung: string) => void
}

export interface BackupErgebnis {
  lokalerPfad: string
  usbPfad: string | null
}

function zweistellig(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n)
}

/** Zeitstempel fuer Dateinamen: yyyyMMdd-HHmmss (lokal). */
export function backupZeitstempel(d: Date): string {
  return (
    `${String(d.getFullYear())}${zweistellig(d.getMonth() + 1)}${zweistellig(d.getDate())}` +
    `-${zweistellig(d.getHours())}${zweistellig(d.getMinutes())}${zweistellig(d.getSeconds())}`
  )
}

function fehlerText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Fuehrt ein Backup aus und liefert die Pfade; wirft, wenn die lokale Kopie scheitert. */
export function erstelleBackup(o: BackupOptionen): BackupErgebnis {
  const jetzt = o.jetzt ?? ((): Date => new Date())
  const log = o.log ?? ((m: string): void => console.log(`[backup] ${m}`))
  const dateiname = `kasse-${backupZeitstempel(jetzt())}.sqlite`

  // Alle Aenderungen aus dem WAL in die Hauptdatei schreiben, damit die Kopie vollstaendig ist.
  o.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')

  mkdirSync(o.backupOrdner, { recursive: true })
  const lokalerPfad = join(o.backupOrdner, dateiname)
  copyFileSync(o.dbPfad, lokalerPfad)

  let usbZiel: string | null = null
  const usb = o.usbPfad()
  if (usb !== null && usb.trim() !== '') {
    if (existsSync(usb)) {
      try {
        usbZiel = join(usb, dateiname)
        copyFileSync(o.dbPfad, usbZiel)
      } catch (e) {
        log(`Kopie auf USB (${usb}) fehlgeschlagen: ${fehlerText(e)}`)
        usbZiel = null
      }
    } else {
      log(`USB-Backup-Pfad ${usb} nicht erreichbar, nur lokale Kopie`)
    }
  }
  return { lokalerPfad, usbPfad: usbZiel }
}
