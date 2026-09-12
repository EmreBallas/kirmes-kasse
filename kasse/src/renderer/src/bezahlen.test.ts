import { describe, expect, it } from 'vitest'
import { berechneZahlung } from '@core/zahlung'
import type { Position, Warenkorb } from '@core/types'
import {
  DRUCK_WARTEZEIT_MS,
  bannerDruckProblem,
  baueVerkaufAnfrage,
  bestaetigungsWarnung,
  druckVerlauf,
  gegebenAusText,
  handschreibListe,
  listeAlsText,
  neueVerkaufsId,
  pruefeVorSenden
} from './bezahlen'

const warenkorb: Warenkorb = {
  zeilen: [
    { produktId: 'p1', name: 'Winti Burger mit Pommes', preisRappen: 1500, gruppe: 'coupon', anzahl: 2 },
    { produktId: 'p2', name: 'Getränk Dose', preisRappen: 250, gruppe: 'kasse', anzahl: 2 }
  ]
}

describe('gegebenAusText', () => {
  it('Helfer ist immer 0, sonst der geparste Betrag', () => {
    expect(gegebenAusText('helfer', '50')).toBe(0)
    expect(gegebenAusText('bar_chf', '50')).toBe(5000)
    expect(gegebenAusText('bar_eur', '13')).toBe(1300)
    expect(gegebenAusText('twint', '')).toBe(0)
  })
})

describe('pruefeVorSenden', () => {
  it('nicht gedeckt blockiert (Testplan 4)', () => {
    const e = berechneZahlung({ zahlart: 'bar_chf', totalRappen: 7500, gegeben: 6000, kursX10000: 9000, spendeBehalten: false })
    expect(pruefeVorSenden(e, false)).toBe('nicht_gedeckt')
    expect(pruefeVorSenden(e, true)).toBe('nicht_gedeckt')
  })

  it('Rueckgeld ueber 200 verlangt Bestaetigung (Testplan 5)', () => {
    const e = berechneZahlung({ zahlart: 'bar_chf', totalRappen: 1200, gegeben: 100000, kursX10000: 9000, spendeBehalten: false })
    expect(bestaetigungsWarnung(e.warnungen)).toBe('rueckgeld_ueber_200')
    expect(pruefeVorSenden(e, false)).toBe('bestaetigung_noetig')
    expect(pruefeVorSenden(e, true)).toBe('ok')
  })

  it('Twint-Ueberzahlung ueber 200 verlangt Bestaetigung', () => {
    const e = berechneZahlung({ zahlart: 'twint', totalRappen: 1200, gegeben: 30000, kursX10000: 9000, spendeBehalten: false })
    expect(bestaetigungsWarnung(e.warnungen)).toBe('spende_ueber_200')
    expect(pruefeVorSenden(e, false)).toBe('bestaetigung_noetig')
  })

  it('normaler Fall geht direkt zum Senden', () => {
    const e = berechneZahlung({ zahlart: 'bar_chf', totalRappen: 3500, gegeben: 5000, kursX10000: 9000, spendeBehalten: false })
    expect(pruefeVorSenden(e, false)).toBe('ok')
    expect(e.rueckgeldChfRappen).toBe(1500)
  })
})

describe('baueVerkaufAnfrage', () => {
  it('uebernimmt Positionen und Flags', () => {
    const a = baueVerkaufAnfrage('uuid-1', warenkorb, 'bar_chf', 5000, false, true)
    expect(a).toEqual({
      id: 'uuid-1',
      positionen: [
        { produktId: 'p1', anzahl: 2 },
        { produktId: 'p2', anzahl: 2 }
      ],
      zahlart: 'bar_chf',
      gegeben: 5000,
      spendeBehalten: false,
      bestaetigtHohesRueckgeld: true
    })
  })
})

describe('handschreibListe / listeAlsText', () => {
  const positionen: Position[] = [
    { id: 'a', verkaufId: 'v', produktId: 'p1', nameSnapshot: 'Winti Burger', preisSnapshotRappen: 1100, anzahl: 2, gruppeSnapshot: 'coupon' },
    { id: 'b', verkaufId: 'v', produktId: 'p2', nameSnapshot: 'Getränk Dose', preisSnapshotRappen: 250, anzahl: 1, gruppeSnapshot: 'kasse' }
  ]

  it('nur Coupons, als Text', () => {
    const liste = handschreibListe(positionen)
    expect(liste).toEqual([{ name: 'Winti Burger', anzahl: 2 }])
    expect(listeAlsText(liste)).toBe('2x Winti Burger')
    expect(listeAlsText([{ name: 'Getränk Dose', anzahl: 2 }, { name: 'Kaffee', anzahl: 1 }])).toBe('2x Getränk Dose, 1x Kaffee')
  })
})

describe('druckVerlauf / bannerDruckProblem', () => {
  it('verfolgt den eigenen Auftrag: laeuft, lange, done, failed', () => {
    expect(druckVerlauf(null, false, 0)).toBe('unbekannt')
    expect(druckVerlauf(null, true, 0)).toBe('laeuft')
    expect(druckVerlauf({ status: 'queued' }, true, DRUCK_WARTEZEIT_MS - 1)).toBe('laeuft')
    expect(druckVerlauf({ status: 'sent' }, true, DRUCK_WARTEZEIT_MS)).toBe('lange')
    expect(druckVerlauf({ status: 'done' }, true, 99_000)).toBe('done')
    expect(druckVerlauf({ status: 'failed' }, true, 0)).toBe('failed')
  })

  it('Handschreib-Liste bei failed oder lange offen; ohne Auftrag entscheidet die Ampel; done nie', () => {
    expect(bannerDruckProblem('failed', 'ok')).toBe(true)
    expect(bannerDruckProblem('lange', 'ok')).toBe(true)
    expect(bannerDruckProblem('laeuft', 'pruefen')).toBe(false)
    expect(bannerDruckProblem('done', 'pruefen')).toBe(false)
    expect(bannerDruckProblem('unbekannt', 'pruefen')).toBe(true)
    expect(bannerDruckProblem('unbekannt', 'ok')).toBe(false)
    expect(bannerDruckProblem('unbekannt', null)).toBe(false)
  })
})

describe('neueVerkaufsId', () => {
  it('liefert eine UUID v4', () => {
    expect(neueVerkaufsId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(neueVerkaufsId()).not.toBe(neueVerkaufsId())
  })
})
