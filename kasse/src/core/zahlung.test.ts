import { describe, expect, it } from 'vitest'
import type { ZahlungsEingabe } from './types'
import { berechneZahlung } from './zahlung'

function eingabe(teil: Partial<ZahlungsEingabe>): ZahlungsEingabe {
  return { zahlart: 'bar_chf', totalRappen: 7500, gegeben: 0, kursX10000: 9000, spendeBehalten: false, ...teil }
}

describe('bar_chf', () => {
  it('Total 7500, gegeben 10000 -> Rückgeld 2500', () => {
    const r = berechneZahlung(eingabe({ gegeben: 10000 }))
    expect(r).toEqual({
      gedeckt: true,
      warnungen: [],
      waehrung: 'CHF',
      kursX10000: null,
      gegeben: 10000,
      gegebenChfRappen: 10000,
      rueckgeldChfRappen: 2500,
      spendeChfRappen: 0,
      spendeTyp: null,
      totalEurCent: null
    })
  })
  it('gegeben 6000 -> nicht gedeckt, blockierend', () => {
    const r = berechneZahlung(eingabe({ gegeben: 6000 }))
    expect(r.gedeckt).toBe(false)
    expect(r.warnungen).toEqual(['nicht_gedeckt'])
    expect(r.rueckgeldChfRappen).toBe(0)
    expect(r.spendeChfRappen).toBe(0)
  })
  it('passend gegeben -> gedeckt, Rückgeld 0', () => {
    const r = berechneZahlung(eingabe({ gegeben: 7500 }))
    expect(r.gedeckt).toBe(true)
    expect(r.rueckgeldChfRappen).toBe(0)
    expect(r.warnungen).toEqual([])
  })
  it('gegeben 100000 -> Warnung rueckgeld_ueber_200', () => {
    const r = berechneZahlung(eingabe({ gegeben: 100000 }))
    expect(r.gedeckt).toBe(true)
    expect(r.warnungen).toEqual(['rueckgeld_ueber_200'])
    expect(r.rueckgeldChfRappen).toBe(92500)
  })
  it('Rückgeld genau 200.00 -> keine Warnung', () => {
    const r = berechneZahlung(eingabe({ gegeben: 27500 }))
    expect(r.warnungen).toEqual([])
  })
  it('"stimmt so": Total 1700, gegeben 2000 -> Spende 300, Rückgeld 0, spendeTyp bar_chf', () => {
    const r = berechneZahlung(eingabe({ totalRappen: 1700, gegeben: 2000, spendeBehalten: true }))
    expect(r.gedeckt).toBe(true)
    expect(r.rueckgeldChfRappen).toBe(0)
    expect(r.spendeChfRappen).toBe(300)
    expect(r.spendeTyp).toBe('bar_chf')
  })
  it('"stimmt so" ohne Überzahlung -> keine Spende', () => {
    const r = berechneZahlung(eingabe({ totalRappen: 2000, gegeben: 2000, spendeBehalten: true }))
    expect(r.spendeChfRappen).toBe(0)
    expect(r.spendeTyp).toBeNull()
  })
  it('"stimmt so" mit Überzahlung über 200 warnt trotzdem', () => {
    const r = berechneZahlung(eingabe({ totalRappen: 500, gegeben: 50000, spendeBehalten: true }))
    expect(r.warnungen).toEqual(['rueckgeld_ueber_200'])
    expect(r.spendeChfRappen).toBe(49500)
  })
  it('lehnt Fliesskomma und negative Beträge ab', () => {
    expect(() => berechneZahlung(eingabe({ gegeben: 75.5 }))).toThrow()
    expect(() => berechneZahlung(eingabe({ gegeben: -100 }))).toThrow()
  })
})

describe('bar_eur', () => {
  it('20 EUR bei 9000 für Total 1200 -> Gegenwert 1800, Rückgeld 600, totalEurCent 1340', () => {
    const r = berechneZahlung(eingabe({ zahlart: 'bar_eur', totalRappen: 1200, gegeben: 2000, kursX10000: 9000 }))
    expect(r).toEqual({
      gedeckt: true,
      warnungen: [],
      waehrung: 'EUR',
      kursX10000: 9000,
      gegeben: 2000,
      gegebenChfRappen: 1800,
      rueckgeldChfRappen: 600,
      spendeChfRappen: 0,
      spendeTyp: null,
      totalEurCent: 1340
    })
  })
  it('krumme Werte: 7 EUR bei 9300 -> 650; 13 EUR bei 9300 -> 1205', () => {
    expect(berechneZahlung(eingabe({ zahlart: 'bar_eur', totalRappen: 500, gegeben: 700, kursX10000: 9300 })).gegebenChfRappen).toBe(650)
    expect(berechneZahlung(eingabe({ zahlart: 'bar_eur', totalRappen: 500, gegeben: 1300, kursX10000: 9300 })).gegebenChfRappen).toBe(1205)
  })
  it('Total in EUR: 1200 bei 9300 -> 1300; 500 bei 9000 -> 560', () => {
    expect(berechneZahlung(eingabe({ zahlart: 'bar_eur', totalRappen: 1200, gegeben: 2000, kursX10000: 9300 })).totalEurCent).toBe(1300)
    expect(berechneZahlung(eingabe({ zahlart: 'bar_eur', totalRappen: 500, gegeben: 1000, kursX10000: 9000 })).totalEurCent).toBe(560)
  })
  it('nicht gedeckt nach Rundung: Total 1800, 20 EUR bei 8999 -> 1799 -> 1795 < 1800', () => {
    const r = berechneZahlung(eingabe({ zahlart: 'bar_eur', totalRappen: 1800, gegeben: 2000, kursX10000: 8999 }))
    expect(r.gegebenChfRappen).toBe(1795)
    expect(r.gedeckt).toBe(false)
    expect(r.warnungen).toEqual(['nicht_gedeckt'])
  })
  it('"stimmt so" bei EUR -> spendeTyp bar_eur', () => {
    const r = berechneZahlung(eingabe({ zahlart: 'bar_eur', totalRappen: 1700, gegeben: 2000, kursX10000: 9000, spendeBehalten: true }))
    expect(r.rueckgeldChfRappen).toBe(0)
    expect(r.spendeChfRappen).toBe(100)
    expect(r.spendeTyp).toBe('bar_eur')
  })
  it('Warnung über 200 gilt auch für EUR', () => {
    const r = berechneZahlung(eingabe({ zahlart: 'bar_eur', totalRappen: 1000, gegeben: 50000, kursX10000: 9000 }))
    expect(r.warnungen).toEqual(['rueckgeld_ueber_200'])
  })
  it('ohne gültigen Kurs -> Fehler', () => {
    expect(() => berechneZahlung(eingabe({ zahlart: 'bar_eur', gegeben: 1000, kursX10000: 0 }))).toThrow()
  })
})

describe('twint', () => {
  it('8000 bei Total 7500 -> Spende 500, Rückgeld 0', () => {
    const r = berechneZahlung(eingabe({ zahlart: 'twint', gegeben: 8000 }))
    expect(r).toEqual({
      gedeckt: true,
      warnungen: [],
      waehrung: 'CHF',
      kursX10000: null,
      gegeben: 8000,
      gegebenChfRappen: 8000,
      rueckgeldChfRappen: 0,
      spendeChfRappen: 500,
      spendeTyp: 'twint',
      totalEurCent: null
    })
  })
  it('7000 bei Total 7500 -> nicht gedeckt', () => {
    const r = berechneZahlung(eingabe({ zahlart: 'twint', gegeben: 7000 }))
    expect(r.gedeckt).toBe(false)
    expect(r.warnungen).toEqual(['nicht_gedeckt'])
    expect(r.spendeChfRappen).toBe(0)
    expect(r.spendeTyp).toBeNull()
  })
  it('80000 bei Total 7500 -> Warnung spende_ueber_200', () => {
    const r = berechneZahlung(eingabe({ zahlart: 'twint', gegeben: 80000 }))
    expect(r.gedeckt).toBe(true)
    expect(r.warnungen).toEqual(['spende_ueber_200'])
    expect(r.spendeChfRappen).toBe(72500)
  })
  it('passend -> keine Spende, spendeTyp null', () => {
    const r = berechneZahlung(eingabe({ zahlart: 'twint', gegeben: 7500 }))
    expect(r.spendeChfRappen).toBe(0)
    expect(r.spendeTyp).toBeNull()
    expect(r.rueckgeldChfRappen).toBe(0)
  })
  it('spendeBehalten hat bei Twint keine Wirkung', () => {
    const r = berechneZahlung(eingabe({ zahlart: 'twint', gegeben: 8000, spendeBehalten: true }))
    expect(r.spendeTyp).toBe('twint')
    expect(r.spendeChfRappen).toBe(500)
  })
})

describe('helfer', () => {
  it('alles 0, gedeckt', () => {
    const r = berechneZahlung(eingabe({ zahlart: 'helfer', totalRappen: 0, gegeben: 0 }))
    expect(r).toEqual({
      gedeckt: true,
      warnungen: [],
      waehrung: 'CHF',
      kursX10000: null,
      gegeben: 0,
      gegebenChfRappen: 0,
      rueckgeldChfRappen: 0,
      spendeChfRappen: 0,
      spendeTyp: null,
      totalEurCent: null
    })
  })
  it('ignoriert gegeben und Total (Helfer zahlt nie)', () => {
    const r = berechneZahlung(eingabe({ zahlart: 'helfer', totalRappen: 1100, gegeben: 5000 }))
    expect(r.gedeckt).toBe(true)
    expect(r.gegeben).toBe(0)
    expect(r.rueckgeldChfRappen).toBe(0)
  })
})
