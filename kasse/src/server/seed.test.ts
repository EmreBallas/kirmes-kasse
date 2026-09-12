import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migriere, oeffneDb, type DatabaseSync } from './db'
import { erstelleRepos } from './repos/index'
import { hashPin } from './repos/einstellungRepo'
import { fuehreSeedAus, leseEinstellungsSeed, leseProdukteSeed } from './seed'
import { MIGRATIONEN_ORDNER, PRODUKTE_SEED } from './testumgebung'

const aufraeumen: (() => void)[] = []

afterEach(() => {
  for (const f of aufraeumen.splice(0)) f()
})

function frischeDb(): DatabaseSync {
  const db = oeffneDb(':memory:')
  migriere(db, MIGRATIONEN_ORDNER)
  aufraeumen.push(() => db.close())
  return db
}

function tempOrdner(): string {
  const o = mkdtempSync(join(tmpdir(), 'kasse-seed-'))
  aufraeumen.push(() => rmSync(o, { recursive: true, force: true }))
  return o
}

describe('leseProdukteSeed', () => {
  it('liest die 15 Produkte mit Gruppe und Reihenfolge', () => {
    const produkte = leseProdukteSeed(PRODUKTE_SEED)
    expect(produkte).toHaveLength(15)
    expect(produkte[0]).toEqual({
      name: 'Winti Burger',
      preisRappen: 1100,
      gruppe: 'coupon',
      reihenfolge: 1
    })
    expect(produkte.find((p) => p.name === 'Getränk Dose')?.gruppe).toBe('kasse')
  })

  it('lehnt zu lange Namen ab', () => {
    const o = tempOrdner()
    const pfad = join(o, 'p.json')
    writeFileSync(
      pfad,
      JSON.stringify({ produkte: [{ name: 'x'.repeat(25), preis_rappen: 100, gruppe: 'kasse' }] })
    )
    expect(() => leseProdukteSeed(pfad)).toThrow(/24 Zeichen/)
  })
})

describe('leseEinstellungsSeed', () => {
  it('nimmt die erste vorhandene Datei (seed.local vor seed.default)', () => {
    const o = tempOrdner()
    const lokal = join(o, 'seed.local.json')
    const standard = join(o, 'seed.default.json')
    writeFileSync(standard, JSON.stringify({ pin: '0000', eurKursX10000: 9000 }))
    expect(leseEinstellungsSeed([lokal, standard])).toEqual({
      datei: standard,
      seed: { pin: '0000', eurKursX10000: 9000 }
    })
    writeFileSync(lokal, JSON.stringify({ pin: '1234', kassenPraefix: 'K2', unbekannt: 1 }))
    expect(leseEinstellungsSeed([lokal, standard])).toEqual({
      datei: lokal,
      seed: { pin: '1234', kassenPraefix: 'K2' }
    })
    expect(leseEinstellungsSeed([join(o, 'fehlt.json')])).toEqual({ datei: null, seed: {} })
  })
})

describe('fuehreSeedAus', () => {
  it('ist idempotent: Produkte einmal, PIN einmal, Einstellungen nur wenn fehlend', () => {
    const db = frischeDb()
    const o = tempOrdner()
    const seedPfad = join(o, 'seed.default.json')
    writeFileSync(
      seedPfad,
      JSON.stringify({
        pin: '4711',
        eurKursX10000: 9200,
        kassenPraefix: 'K1',
        druckerName: 'TM-T20II',
        port: 47100
      })
    )
    const repos = erstelleRepos(db)

    const erster = fuehreSeedAus({ db, produktePfad: PRODUKTE_SEED, einstellungsPfade: [seedPfad] })
    expect(erster.produkteAngelegt).toBe(15)
    expect(erster.pinGesetzt).toBe(true)
    expect(erster.einstellungenGesetzt).toEqual([
      'eur_kurs_x10000',
      'kassen_praefix',
      'drucker_name',
      'port',
      'belegzaehler'
    ])
    expect(erster.einstellungsDatei).toBe(seedPfad)

    const salt = repos.einstellung.lies('pin_salt')
    const hash = repos.einstellung.lies('pin_hash')
    expect(salt).toMatch(/^[0-9a-f]{32}$/)
    expect(hash).toBe(hashPin(salt ?? '', '4711'))
    expect(repos.einstellung.pruefePin('4711')).toBe(true)
    expect(repos.einstellung.pruefePin('0000')).toBe(false)

    // Benutzer ändert Kurs und Belegzähler läuft; zweiter Seed darf nichts überschreiben
    repos.einstellung.setze('eur_kurs_x10000', '9500')
    repos.einstellung.setzeBelegzaehler(7)
    repos.produkt.setzeAusverkauft(repos.produkt.alle(false)[0]?.id ?? '', true)

    const zweiter = fuehreSeedAus({
      db,
      produktePfad: PRODUKTE_SEED,
      einstellungsPfade: [seedPfad]
    })
    expect(zweiter.produkteAngelegt).toBe(0)
    expect(zweiter.pinGesetzt).toBe(false)
    expect(zweiter.einstellungenGesetzt).toEqual([])
    expect(repos.produkt.anzahl()).toBe(15)
    expect(repos.einstellung.lies('pin_hash')).toBe(hash)
    expect(repos.einstellung.einstellungen().eurKursX10000).toBe(9500)
    expect(repos.einstellung.einstellungen().belegzaehler).toBe(7)
    expect(repos.produkt.alle(false)[0]?.ausverkauft).toBe(true)
  })

  it('setzt Produkte ohne Preis inaktiv', () => {
    const db = frischeDb()
    const o = tempOrdner()
    const pfad = join(o, 'p.json')
    writeFileSync(
      pfad,
      JSON.stringify({
        produkte: [{ name: 'Offen', preis_rappen: null, gruppe: 'kasse', reihenfolge: 1 }]
      })
    )
    fuehreSeedAus({ db, produktePfad: pfad, einstellungsPfade: [] })
    const p = erstelleRepos(db).produkt.alle(false)[0]
    expect(p?.preisRappen).toBeNull()
    expect(p?.aktiv).toBe(false)
  })
})

describe('Seed: rabattProzent und veranstaltung', () => {
  it('ohne Seed-Datei gelten Standard-Rabatt 50 und leerer Veranstaltungsname', () => {
    const db = frischeDb()
    fuehreSeedAus({ db, produktePfad: PRODUKTE_SEED, einstellungsPfade: [] })
    expect(erstelleRepos(db).einstellung.einstellungen()).toMatchObject({
      rabattProzent: 50,
      veranstaltung: ''
    })
  })

  it('übernimmt rabattProzent und veranstaltung aus der Seed-Datei', () => {
    const db = frischeDb()
    const o = tempOrdner()
    const pfad = join(o, 'seed.local.json')
    writeFileSync(
      pfad,
      JSON.stringify({ rabattProzent: 40, veranstaltung: 'Dorffest Musterhausen' })
    )
    const e = fuehreSeedAus({ db, produktePfad: PRODUKTE_SEED, einstellungsPfade: [pfad] })
    expect(e.einstellungenGesetzt).toContain('rabatt_prozent')
    expect(e.einstellungenGesetzt).toContain('veranstaltung')
    expect(erstelleRepos(db).einstellung.einstellungen()).toMatchObject({
      rabattProzent: 40,
      veranstaltung: 'Dorffest Musterhausen'
    })
    expect(leseEinstellungsSeed([pfad]).seed).toEqual({
      rabattProzent: 40,
      veranstaltung: 'Dorffest Musterhausen'
    })
  })
})
