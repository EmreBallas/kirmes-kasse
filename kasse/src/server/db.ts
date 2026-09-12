/**
 * SQLite-Zugriff über node:sqlite (Electron 44 / Node 24): Öffnen, Migrationen, Transaktionen.
 * Migrationen liegen als nummerierte SQL-Dateien (001_init.sql, 002_....sql) in einem Ordner,
 * dessen Pfad der Aufrufer übergibt (im Electron-Paket ein extraResources-Ordner).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { isoLokal, systemUhr, type Uhr } from './zeit'

export { DatabaseSync }

/** Öffnet die Datenbank (Datei oder ':memory:') mit WAL, synchronous=FULL und Fremdschlüsseln. */
export function oeffneDb(pfad: string): DatabaseSync {
  const db = new DatabaseSync(pfad)
  db.exec('PRAGMA journal_mode=WAL')
  db.exec('PRAGMA synchronous=FULL')
  db.exec('PRAGMA foreign_keys=ON')
  return db
}

export interface Migration {
  version: number
  name: string
  sql: string
}

const MIGRATIONS_MUSTER = /^(\d+)_([^.]+)\.sql$/

/** Liest alle Migrationsdateien eines Ordners, sortiert nach Versionsnummer. */
export function leseMigrationen(ordner: string): Migration[] {
  const dateien = readdirSync(ordner)
  const migrationen: Migration[] = []
  for (const datei of dateien) {
    const m = MIGRATIONS_MUSTER.exec(datei)
    if (m === null) continue
    migrationen.push({
      version: Number(m[1]),
      name: m[2] ?? '',
      sql: readFileSync(join(ordner, datei), 'utf8')
    })
  }
  migrationen.sort((a, b) => a.version - b.version)
  const versionen = new Set<number>()
  for (const mig of migrationen) {
    if (versionen.has(mig.version)) {
      throw new Error(`Doppelte Migrationsversion ${String(mig.version)} im Ordner ${ordner}`)
    }
    versionen.add(mig.version)
  }
  return migrationen
}

/** Führt alle noch nicht angewendeten Migrationen aus; liefert die Anzahl der neu angewendeten. */
export function migriere(db: DatabaseSync, migrationsOrdner: string, uhr: Uhr = systemUhr): number {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, name TEXT NOT NULL, angewendet_am TEXT NOT NULL)'
  )
  const angewendet = new Set<number>()
  for (const zeile of db.prepare('SELECT version FROM schema_version').all()) {
    const v = zeile['version']
    if (typeof v === 'number') angewendet.add(v)
    else if (typeof v === 'bigint') angewendet.add(Number(v))
  }
  let neu = 0
  for (const mig of leseMigrationen(migrationsOrdner)) {
    if (angewendet.has(mig.version)) continue
    inTransaktion(db, () => {
      db.exec(mig.sql)
      db.prepare('INSERT INTO schema_version (version, name, angewendet_am) VALUES (?, ?, ?)').run(
        mig.version,
        mig.name,
        isoLokal(uhr())
      )
    })
    neu += 1
  }
  return neu
}

/** Aktuelle Schemaversion (0, wenn noch keine Migration lief). */
export function schemaVersion(db: DatabaseSync): number {
  const z = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_version').get()
  const v = z?.['v']
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  return 0
}

/**
 * Führt fn in einer Transaktion (BEGIN IMMEDIATE) aus. Läuft bereits eine Transaktion,
 * wird fn direkt darin ausgeführt (kein Nesting, der äussere Aufruf entscheidet über Commit/Rollback).
 */
export function inTransaktion<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn()
  db.exec('BEGIN IMMEDIATE')
  try {
    const ergebnis = fn()
    db.exec('COMMIT')
    return ergebnis
  } catch (e) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // Rollback-Fehler verdecken den eigentlichen Fehler nicht
    }
    throw e
  }
}
