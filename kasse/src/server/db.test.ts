import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inTransaktion, leseMigrationen, migriere, oeffneDb, schemaVersion, type DatabaseSync } from './db'
import { MIGRATIONEN_ORDNER } from './testumgebung'

const offene: DatabaseSync[] = []

function db(): DatabaseSync {
  const d = oeffneDb(':memory:')
  offene.push(d)
  return d
}

afterEach(() => {
  for (const d of offene.splice(0)) d.close()
})

describe('migriere', () => {
  it('legt das Schema an und ist idempotent', () => {
    const d = db()
    expect(migriere(d, MIGRATIONEN_ORDNER)).toBe(2)
    expect(schemaVersion(d)).toBe(2)
    expect(migriere(d, MIGRATIONEN_ORDNER)).toBe(0)
    const tabellen = d
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((z) => z['name'])
    for (const t of [
      'produkt',
      'kassentag',
      'verkauf',
      'position',
      'zahlung',
      'storno',
      'druckauftrag',
      'einstellung',
      'warenkorb_entwurf',
      'schema_version'
    ]) {
      expect(tabellen).toContain(t)
    }
  })

  it('Migration 002 läuft auf einer DB mit Stand 001 und fügt kassentag.pdf_pfad hinzu', () => {
    // Ordner nur mit 001: Stand einer bestehenden Kasse vor dem Update
    const nur001 = mkdtempSync(join(tmpdir(), 'kasse-mig-'))
    try {
      copyFileSync(join(MIGRATIONEN_ORDNER, '001_init.sql'), join(nur001, '001_init.sql'))
      const d = db()
      expect(migriere(d, nur001)).toBe(1)
      expect(schemaVersion(d)).toBe(1)
      const spaltenVorher = d
        .prepare('PRAGMA table_info(kassentag)')
        .all()
        .map((z) => z['name'])
      expect(spaltenVorher).not.toContain('pdf_pfad')
      // Kassentag mit altem Schema anlegen: muss die Migration überleben
      d.prepare(
        "INSERT INTO kassentag (id, datum, kasse_praefix, kassier, startgeld_chf_rappen, geoeffnet_am) VALUES ('alt', '2026-09-19', 'K1', 'EB', 20000, '2026-09-19T10:00:00')"
      ).run()

      expect(leseMigrationen(MIGRATIONEN_ORDNER).map((m) => m.version)).toEqual([1, 2])
      expect(migriere(d, MIGRATIONEN_ORDNER)).toBe(1)
      expect(schemaVersion(d)).toBe(2)
      const spalten = d
        .prepare('PRAGMA table_info(kassentag)')
        .all()
        .map((z) => z['name'])
      expect(spalten).toContain('pdf_pfad')
      expect(d.prepare("SELECT pdf_pfad FROM kassentag WHERE id = 'alt'").get()?.['pdf_pfad']).toBeNull()
      d.prepare("UPDATE kassentag SET pdf_pfad = 'C:/x/a.pdf' WHERE id = 'alt'").run()
      expect(d.prepare("SELECT pdf_pfad FROM kassentag WHERE id = 'alt'").get()?.['pdf_pfad']).toBe('C:/x/a.pdf')
    } finally {
      rmSync(nur001, { recursive: true, force: true })
    }
  })

  it('setzt die Pragmas (foreign_keys an)', () => {
    const d = db()
    expect(d.prepare('PRAGMA foreign_keys').get()?.['foreign_keys']).toBe(1)
  })

  it('erzwingt Fremdschlüssel und CHECK-Constraints', () => {
    const d = db()
    migriere(d, MIGRATIONEN_ORDNER)
    expect(() =>
      d
        .prepare(
          "INSERT INTO verkauf (id, kassentag_id, belegnr, zeit, zahlart, total_rappen) VALUES ('v', 'fehlt', 'K1-0001', 't', 'bar_chf', 0)"
        )
        .run()
    ).toThrow()
    expect(() =>
      d
        .prepare(
          "INSERT INTO produkt (id, name, gruppe, erstellt_am) VALUES ('p', 'x', 'falsch', 't')"
        )
        .run()
    ).toThrow()
  })
})

describe('inTransaktion', () => {
  it('rollt bei Fehler zurück und lässt keine Transaktion offen', () => {
    const d = db()
    migriere(d, MIGRATIONEN_ORDNER)
    expect(() =>
      inTransaktion(d, () => {
        d.prepare("INSERT INTO einstellung (key, value) VALUES ('a', '1')").run()
        throw new Error('abbruch')
      })
    ).toThrow('abbruch')
    expect(d.isTransaction).toBe(false)
    expect(d.prepare('SELECT COUNT(*) AS n FROM einstellung').get()?.['n']).toBe(0)
  })

  it('führt verschachtelte Aufrufe in der äusseren Transaktion aus', () => {
    const d = db()
    migriere(d, MIGRATIONEN_ORDNER)
    const ergebnis = inTransaktion(d, () => {
      d.prepare("INSERT INTO einstellung (key, value) VALUES ('a', '1')").run()
      return inTransaktion(d, () => {
        expect(d.isTransaction).toBe(true)
        return 42
      })
    })
    expect(ergebnis).toBe(42)
    expect(d.isTransaction).toBe(false)
    expect(d.prepare('SELECT COUNT(*) AS n FROM einstellung').get()?.['n']).toBe(1)
  })
})
