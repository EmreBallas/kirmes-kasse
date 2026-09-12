import { afterEach, describe, expect, it } from 'vitest'
import { inTransaktion, migriere, oeffneDb, schemaVersion, type DatabaseSync } from './db'
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
    expect(migriere(d, MIGRATIONEN_ORDNER)).toBe(1)
    expect(schemaVersion(d)).toBe(1)
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
