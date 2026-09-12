/**
 * Einstellungen (key/value als Text) inkl. PIN (sha256(salt + ':' + pin), hex) und Belegzähler.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Einstellungen } from '@core/types'
import { text } from '../sql'
import type { RepoKontext } from './kontext'

export const STANDARD_EINSTELLUNGEN: Einstellungen = {
  eurKursX10000: 9000,
  druckerName: 'TM-T20II',
  kassenPraefix: 'K1',
  belegzaehler: 0,
  backupPfadUsb: null,
  port: 47100
}

/** Felder, die über PUT /api/einstellungen geändert werden dürfen (belegzaehler nicht). */
export type EinstellungenAenderung = Partial<Omit<Einstellungen, 'belegzaehler'>>

export interface EinstellungRepo {
  lies(key: string): string | null
  setze(key: string, value: string): void
  /** Setzt den Wert nur, wenn der Schlüssel fehlt; true, wenn gesetzt. */
  setzeFallsFehlt(key: string, value: string): boolean
  einstellungen(): Einstellungen
  aktualisiere(a: EinstellungenAenderung): Einstellungen
  hatPin(): boolean
  setzePin(pin: string): void
  pruefePin(pin: string | null | undefined): boolean
  /** Erhöht den Belegzähler um 1 und liefert die neue Belegnummer "<praefix>-<nnnn>". In einer Transaktion aufrufen. */
  naechsteBelegnummer(): string
  setzeBelegzaehler(wert: number): void
}

export function hashPin(salt: string, pin: string): string {
  return createHash('sha256').update(`${salt}:${pin}`).digest('hex')
}

export function erzeugeSalt(): string {
  return randomBytes(16).toString('hex')
}

/** "K1-0042": Präfix, Bindestrich, mindestens vierstellig. */
export function formatBelegnummer(praefix: string, nummer: number): string {
  return `${praefix}-${String(nummer).padStart(4, '0')}`
}

function ganzzahlOder(wert: string | null, standard: number): number {
  if (wert === null) return standard
  const n = Number(wert)
  return Number.isSafeInteger(n) ? n : standard
}

export function erstelleEinstellungRepo(k: RepoKontext): EinstellungRepo {
  const { db } = k

  function lies(key: string): string | null {
    const z = db.prepare('SELECT value FROM einstellung WHERE key = ?').get(key)
    return z === undefined ? null : text(z, 'value')
  }

  function setze(key: string, value: string): void {
    db.prepare(
      'INSERT INTO einstellung (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, value)
  }

  function einstellungen(): Einstellungen {
    const backup = lies('backup_pfad_usb')
    return {
      eurKursX10000: ganzzahlOder(lies('eur_kurs_x10000'), STANDARD_EINSTELLUNGEN.eurKursX10000),
      druckerName: lies('drucker_name') ?? STANDARD_EINSTELLUNGEN.druckerName,
      kassenPraefix: lies('kassen_praefix') ?? STANDARD_EINSTELLUNGEN.kassenPraefix,
      belegzaehler: ganzzahlOder(lies('belegzaehler'), STANDARD_EINSTELLUNGEN.belegzaehler),
      backupPfadUsb: backup === null || backup === '' ? null : backup,
      port: ganzzahlOder(lies('port'), STANDARD_EINSTELLUNGEN.port)
    }
  }

  return {
    lies,
    setze,
    setzeFallsFehlt(key, value) {
      const r = db
        .prepare('INSERT OR IGNORE INTO einstellung (key, value) VALUES (?, ?)')
        .run(key, value)
      return r.changes > 0
    },
    einstellungen,
    aktualisiere(a) {
      if (a.eurKursX10000 !== undefined) setze('eur_kurs_x10000', String(a.eurKursX10000))
      if (a.druckerName !== undefined) setze('drucker_name', a.druckerName)
      if (a.kassenPraefix !== undefined) setze('kassen_praefix', a.kassenPraefix)
      if (a.backupPfadUsb !== undefined) setze('backup_pfad_usb', a.backupPfadUsb ?? '')
      if (a.port !== undefined) setze('port', String(a.port))
      return einstellungen()
    },
    hatPin() {
      return lies('pin_hash') !== null
    },
    setzePin(pin) {
      const salt = erzeugeSalt()
      setze('pin_salt', salt)
      setze('pin_hash', hashPin(salt, pin))
    },
    pruefePin(pin) {
      if (pin === null || pin === undefined || pin === '') return false
      const salt = lies('pin_salt')
      const hash = lies('pin_hash')
      if (salt === null || hash === null) return false
      const a = Buffer.from(hashPin(salt, pin), 'hex')
      const b = Buffer.from(hash, 'hex')
      return a.length === b.length && timingSafeEqual(a, b)
    },
    naechsteBelegnummer() {
      const e = einstellungen()
      const nummer = e.belegzaehler + 1
      setze('belegzaehler', String(nummer))
      return formatBelegnummer(e.kassenPraefix, nummer)
    },
    setzeBelegzaehler(wert) {
      setze('belegzaehler', String(wert))
    }
  }
}
