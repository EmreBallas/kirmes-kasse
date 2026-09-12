/**
 * Typsichere Helfer zum Lesen von node:sqlite-Zeilen (Record<string, SQLOutputValue>).
 * Jede Funktion wirft mit deutscher Meldung, wenn der Spaltentyp nicht passt.
 */
import type { SQLOutputValue } from 'node:sqlite'

export type Zeile = Record<string, SQLOutputValue>

export function text(z: Zeile, spalte: string): string {
  const v = z[spalte]
  if (typeof v === 'string') return v
  throw new Error(`Spalte "${spalte}": Text erwartet, erhalten ${typeof v}`)
}

export function textOderNull(z: Zeile, spalte: string): string | null {
  const v = z[spalte]
  if (v === null || v === undefined) return null
  return text(z, spalte)
}

export function zahl(z: Zeile, spalte: string): number {
  const v = z[spalte]
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  throw new Error(`Spalte "${spalte}": Zahl erwartet, erhalten ${typeof v}`)
}

export function zahlOderNull(z: Zeile, spalte: string): number | null {
  const v = z[spalte]
  if (v === null || v === undefined) return null
  return zahl(z, spalte)
}

export function wahr(z: Zeile, spalte: string): boolean {
  return zahl(z, spalte) !== 0
}

/** Liest COUNT(*)-Ergebnisse: `SELECT COUNT(*) AS n ...`. */
export function anzahlAus(z: Zeile | undefined, spalte = 'n'): number {
  return z === undefined ? 0 : zahl(z, spalte)
}

export function bit(b: boolean): number {
  return b ? 1 : 0
}
