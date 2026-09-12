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
    expect(migriere(d, MIGRATIONEN_ORDNER)).toBe(3)
    expect(schemaVersion(d)).toBe(3)
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
      'spende',
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

      expect(leseMigrationen(MIGRATIONEN_ORDNER).map((m) => m.version)).toEqual([1, 2, 3])
      expect(migriere(d, MIGRATIONEN_ORDNER)).toBe(2)
      expect(schemaVersion(d)).toBe(3)
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

  it('Migration 003 läuft auf einer DB mit Stand 002 und legt die Tabelle spende an', () => {
    // Ordner mit 001 und 002: Stand einer Kasse vor dem Spenden-Update
    const bis002 = mkdtempSync(join(tmpdir(), 'kasse-mig-'))
    try {
      for (const datei of ['001_init.sql', '002_kassentag_pdf.sql']) {
        copyFileSync(join(MIGRATIONEN_ORDNER, datei), join(bis002, datei))
      }
      const d = db()
      expect(migriere(d, bis002)).toBe(2)
      expect(schemaVersion(d)).toBe(2)
      const tabellenVorher = d
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((z) => z['name'])
      expect(tabellenVorher).not.toContain('spende')
      // Bewegungsdaten mit altem Schema: müssen die Migration überleben und referenzierbar bleiben
      d.prepare(
        "INSERT INTO kassentag (id, datum, kasse_praefix, kassier, startgeld_chf_rappen, geoeffnet_am) VALUES ('alt', '2026-09-19', 'K1', 'EB', 20000, '2026-09-19T10:00:00')"
      ).run()
      d.prepare(
        "INSERT INTO verkauf (id, kassentag_id, belegnr, zeit, zahlart, total_rappen) VALUES ('v', 'alt', 'K1-0001', '2026-09-19T10:05:00', 'bar_chf', 9800)"
      ).run()

      expect(migriere(d, MIGRATIONEN_ORDNER)).toBe(1)
      expect(schemaVersion(d)).toBe(3)
      const spalten = d
        .prepare('PRAGMA table_info(spende)')
        .all()
        .map((z) => z['name'])
      expect(spalten).toEqual([
        'id',
        'kassentag_id',
        'verkauf_id',
        'zeit',
        'typ',
        'betrag',
        'kurs_x10000',
        'betrag_chf_rappen',
        'storniert_am',
        'mit_pin'
      ])
      const indizes = d
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'spende'")
        .all()
        .map((z) => z['name'])
      expect(indizes).toContain('idx_spende_kassentag')

      d.prepare(
        "INSERT INTO spende (id, kassentag_id, verkauf_id, zeit, typ, betrag, betrag_chf_rappen) VALUES ('s', 'alt', 'v', '2026-09-19T10:06:00', 'bar_chf', 200, 200)"
      ).run()
      expect(d.prepare("SELECT mit_pin, storniert_am FROM spende WHERE id = 's'").get()).toEqual({
        mit_pin: 0,
        storniert_am: null
      })
      // CHECK betrag > 0, typ-Liste und Fremdschlüssel greifen
      expect(() =>
        d
          .prepare(
            "INSERT INTO spende (id, kassentag_id, verkauf_id, zeit, typ, betrag, betrag_chf_rappen) VALUES ('s0', 'alt', NULL, 't', 'bar_chf', 0, 0)"
          )
          .run()
      ).toThrow()
      expect(() =>
        d
          .prepare(
            "INSERT INTO spende (id, kassentag_id, verkauf_id, zeit, typ, betrag, betrag_chf_rappen) VALUES ('s1', 'alt', NULL, 't', 'helfer', 100, 100)"
          )
          .run()
      ).toThrow()
      expect(() =>
        d
          .prepare(
            "INSERT INTO spende (id, kassentag_id, verkauf_id, zeit, typ, betrag, betrag_chf_rappen) VALUES ('s2', 'fehlt', NULL, 't', 'twint', 100, 100)"
          )
          .run()
      ).toThrow()
    } finally {
      rmSync(bis002, { recursive: true, force: true })
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
