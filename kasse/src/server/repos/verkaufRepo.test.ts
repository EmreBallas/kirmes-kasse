import { afterEach, describe, expect, it } from 'vitest'
import type { Druckauftrag } from '@core/types'
import { erstelleTestUmgebung, type TestUmgebung } from '../testumgebung'
import type { VerkaufNeu } from './verkaufRepo'

let u: TestUmgebung

afterEach(() => {
  u.aufraeumen()
})

function neuerVerkauf(id: string, kassentagId: string, u2: TestUmgebung): VerkaufNeu {
  return {
    id,
    kassentagId,
    zahlart: 'bar_chf',
    totalRappen: 1350,
    positionen: [
      {
        produktId: u2.produktId('Winti Burger'),
        nameSnapshot: 'Winti Burger',
        preisSnapshotRappen: 1100,
        anzahl: 1,
        gruppeSnapshot: 'coupon'
      },
      {
        produktId: u2.produktId('Kaffee'),
        nameSnapshot: 'Kaffee',
        preisSnapshotRappen: 250,
        anzahl: 1,
        gruppeSnapshot: 'kasse'
      }
    ],
    zahlung: {
      waehrung: 'CHF',
      kursX10000: null,
      gegeben: 2000,
      gegebenChfRappen: 2000,
      rueckgeldChfRappen: 650,
      spendeChfRappen: 0,
      spendeTyp: null
    }
  }
}

describe('verkaufRepo.erstelle', () => {
  it('vergibt K1-0001 und K1-0002 und speichert Positionen und Zahlung', () => {
    u = erstelleTestUmgebung()
    const tag = u.repos.kassentag.starte({
      datum: '2026-09-19',
      kassePraefix: 'K1',
      kassier: 'EB',
      startgeldChfRappen: 0,
      startgeldEurCent: 0
    })
    const a = u.repos.verkauf.erstelle(neuerVerkauf('v1', tag.id, u))
    const b = u.repos.verkauf.erstelle(neuerVerkauf('v2', tag.id, u))
    expect(a.verkauf.belegnr).toBe('K1-0001')
    expect(b.verkauf.belegnr).toBe('K1-0002')
    expect(a.bereitsVorhanden).toBe(false)
    expect(a.verkauf.zeit).toBe('2026-09-19T14:32:05')
    expect(a.positionen).toHaveLength(2)
    expect(a.positionen[0]?.verkaufId).toBe('v1')
    expect(a.zahlung.rueckgeldChfRappen).toBe(650)
    expect(a.druckauftrag).toBeNull()
    expect(u.repos.einstellung.einstellungen().belegzaehler).toBe(2)
  })

  it('liefert bei bestehender id den bestehenden Verkauf (doppelter POST = ein Verkauf)', () => {
    u = erstelleTestUmgebung()
    const tag = u.repos.kassentag.starte({
      datum: '2026-09-19',
      kassePraefix: 'K1',
      kassier: 'EB',
      startgeldChfRappen: 0,
      startgeldEurCent: 0
    })
    let druckAufrufe = 0
    const druck = (): Druckauftrag => {
      druckAufrufe += 1
      return u.repos.druckauftrag.erstelle({
        typ: 'beleg',
        verkaufId: 'v1',
        kassentagId: tag.id,
        bytesPfad: 'x.bin'
      })
    }
    const a = u.repos.verkauf.erstelle(neuerVerkauf('v1', tag.id, u), druck)
    const b = u.repos.verkauf.erstelle(neuerVerkauf('v1', tag.id, u), druck)
    expect(b.bereitsVorhanden).toBe(true)
    expect(b.verkauf.belegnr).toBe(a.verkauf.belegnr)
    expect(b.druckauftrag?.id).toBe(a.druckauftrag?.id)
    expect(druckAufrufe).toBe(1)
    expect(u.repos.einstellung.einstellungen().belegzaehler).toBe(1)
    expect(u.db.prepare('SELECT COUNT(*) AS n FROM verkauf').get()?.['n']).toBe(1)
  })

  it('rollt alles zurück, wenn der Druck-Callback wirft', () => {
    u = erstelleTestUmgebung()
    const tag = u.repos.kassentag.starte({
      datum: '2026-09-19',
      kassePraefix: 'K1',
      kassier: 'EB',
      startgeldChfRappen: 0,
      startgeldEurCent: 0
    })
    expect(() =>
      u.repos.verkauf.erstelle(neuerVerkauf('v1', tag.id, u), () => {
        throw new Error('kaputt')
      })
    ).toThrow('kaputt')
    expect(u.repos.verkauf.finde('v1')).toBeNull()
    expect(u.repos.einstellung.einstellungen().belegzaehler).toBe(0)
    expect(u.db.isTransaction).toBe(false)
  })

  it('desKassentags liefert nur Verkäufe des Tages; letzte() neueste zuerst', () => {
    u = erstelleTestUmgebung()
    const tag1 = u.repos.kassentag.starte({
      datum: '2026-09-19',
      kassePraefix: 'K1',
      kassier: 'EB',
      startgeldChfRappen: 0,
      startgeldEurCent: 0
    })
    const tag2 = u.repos.kassentag.starte({
      datum: '2026-09-20',
      kassePraefix: 'K1',
      kassier: 'EB',
      startgeldChfRappen: 0,
      startgeldEurCent: 0
    })
    u.repos.verkauf.erstelle(neuerVerkauf('v1', tag1.id, u))
    u.uhr.setze('2026-09-20T10:00:00')
    u.repos.verkauf.erstelle(neuerVerkauf('v2', tag2.id, u))
    const tag1Daten = u.repos.verkauf.desKassentags(tag1.id)
    expect(tag1Daten.verkaeufe.map((v) => v.id)).toEqual(['v1'])
    expect(tag1Daten.positionen).toHaveLength(2)
    expect(tag1Daten.zahlungen).toHaveLength(1)
    expect(u.repos.verkauf.letzte(10).map((d) => d.verkauf.id)).toEqual(['v2', 'v1'])
    expect(u.repos.verkauf.letzter()?.id).toBe('v2')
  })
})

describe('verkaufRepo: Rabattspalten', () => {
  it('schreibt und liest rabatt_prozent und rabatt_rappen (ohne Angabe 0)', () => {
    u = erstelleTestUmgebung()
    const tag = u.repos.kassentag.starte({
      datum: '2026-09-19',
      kassePraefix: 'K1',
      kassier: 'EB',
      startgeldChfRappen: 0,
      startgeldEurCent: 0
    })
    const ohne = u.repos.verkauf.erstelle(neuerVerkauf('v1', tag.id, u))
    expect(ohne.verkauf).toMatchObject({ rabattProzent: 0, rabattRappen: 0 })

    const mit = u.repos.verkauf.erstelle({
      ...neuerVerkauf('v2', tag.id, u),
      rabattProzent: 50,
      rabattRappen: 1350
    })
    expect(mit.verkauf).toMatchObject({
      totalRappen: 1350,
      rabattProzent: 50,
      rabattRappen: 1350
    })
    expect(u.repos.verkauf.finde('v2')).toMatchObject({ rabattProzent: 50, rabattRappen: 1350 })
    expect(u.repos.verkauf.detail('v2')?.verkauf.rabattRappen).toBe(1350)
    expect(u.repos.verkauf.letzte(2)[0]?.verkauf.rabattRappen).toBe(1350)
    expect(u.repos.verkauf.desKassentags(tag.id).verkaeufe[1]).toMatchObject({
      rabattProzent: 50,
      rabattRappen: 1350
    })
  })
})
