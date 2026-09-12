/**
 * Gemeinsamer Kontext aller Repositories: Datenbank, Uhr und ID-Erzeuger (beide injizierbar für Tests).
 */
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { systemUhr, type Uhr } from '../zeit'

export interface RepoKontext {
  db: DatabaseSync
  uhr: Uhr
  neueId: () => string
}

export function erstelleKontext(
  db: DatabaseSync,
  uhr: Uhr = systemUhr,
  neueId: () => string = randomUUID
): RepoKontext {
  return { db, uhr, neueId }
}
