import { describe, expect, it } from 'vitest'
import type { Einstellungen, Warenkorb } from '@core/types'
import { RABATT_PROZENT_STANDARD } from '@core/geld'
import {
  entwurfMitRabatt,
  istGueltigerSatz,
  parseRabattSatz,
  rabattAusEntwurf,
  rabattKnopfText,
  rabattKopfText,
  rabattSatz,
  rabattZeileLabel,
  warenkorbSumme,
  wirksamerSatz
} from './rabatt'

const einstellungen: Einstellungen = {
  eurKursX10000: 9000,
  druckerName: 'TM-T20II',
  kassenPraefix: 'K1',
  belegzaehler: 12,
  backupPfadUsb: null,
  port: 47100,
  rabattProzent: 50,
  veranstaltung: ''
}

/** Warenkorb mit Zwischensumme 2700 Rappen (2 x 10.00 + 1 x 7.00). */
const warenkorb: Warenkorb = {
  zeilen: [
    { produktId: 'p1', name: 'Bratwurst', preisRappen: 1000, gruppe: 'coupon', anzahl: 2 },
    { produktId: 'p2', name: 'Kaffee', preisRappen: 700, gruppe: 'kasse', anzahl: 1 }
  ]
}

describe('istGueltigerSatz', () => {
  it('nimmt ganze Zahlen von 1 bis 99, sonst nichts', () => {
    expect(istGueltigerSatz(1)).toBe(true)
    expect(istGueltigerSatz(50)).toBe(true)
    expect(istGueltigerSatz(99)).toBe(true)
    expect(istGueltigerSatz(0)).toBe(false)
    expect(istGueltigerSatz(100)).toBe(false)
    expect(istGueltigerSatz(-5)).toBe(false)
    expect(istGueltigerSatz(12.5)).toBe(false)
    expect(istGueltigerSatz(Number.NaN)).toBe(false)
  })
})

describe('rabattSatz aus den Einstellungen', () => {
  it('nimmt den eingestellten Satz', () => {
    expect(rabattSatz(einstellungen)).toBe(50)
    expect(rabattSatz({ ...einstellungen, rabattProzent: 30 })).toBe(30)
  })

  it('faellt auf den Standard 50 zurueck, wenn die Einstellung fehlt oder unsinnig ist', () => {
    expect(rabattSatz(null)).toBe(RABATT_PROZENT_STANDARD)
    // alter Server ohne das neue Feld
    const ohneFeld = { ...einstellungen } as Partial<Einstellungen>
    delete ohneFeld.rabattProzent
    expect(rabattSatz(ohneFeld as Einstellungen)).toBe(RABATT_PROZENT_STANDARD)
    expect(rabattSatz({ ...einstellungen, rabattProzent: 0 })).toBe(RABATT_PROZENT_STANDARD)
    expect(rabattSatz({ ...einstellungen, rabattProzent: 120 })).toBe(RABATT_PROZENT_STANDARD)
  })
})

describe('wirksamerSatz', () => {
  it('gilt nur bei gedruecktem Knopf, dann fuer jede Zahlart (auch Helfer)', () => {
    expect(wirksamerSatz(true, 50)).toBe(50)
    expect(wirksamerSatz(false, 50)).toBe(0)
    expect(wirksamerSatz(true, 30)).toBe(30)
  })

  it('ignoriert einen unsinnigen Satz, statt zu rechnen', () => {
    expect(wirksamerSatz(true, 0)).toBe(0)
    expect(wirksamerSatz(true, 100)).toBe(0)
  })
})

describe('warenkorbSumme (Rechnung aus @core)', () => {
  it('ohne Rabatt bleibt alles wie bisher', () => {
    expect(warenkorbSumme(warenkorb, 0)).toEqual({
      zwischensummeRappen: 2700,
      rabattProzent: 0,
      rabattRappen: 0,
      totalRappen: 2700
    })
  })

  it('50 Prozent auf 2700 ergibt Total 1350 und Rabatt 1350', () => {
    expect(warenkorbSumme(warenkorb, 50)).toEqual({
      zwischensummeRappen: 2700,
      rabattProzent: 50,
      rabattRappen: 1350,
      totalRappen: 1350
    })
  })

  it('50 Prozent auf 2705 rundet auf 5 Rappen ab: Total 1350, Rabatt 1355', () => {
    const korb: Warenkorb = {
      zeilen: [{ produktId: 'p3', name: 'Menü', preisRappen: 2705, gruppe: 'kasse', anzahl: 1 }]
    }
    expect(warenkorbSumme(korb, 50)).toEqual({
      zwischensummeRappen: 2705,
      rabattProzent: 50,
      rabattRappen: 1355,
      totalRappen: 1350
    })
  })

  it('leerer Warenkorb bleibt bei 0, auch mit Rabatt', () => {
    expect(warenkorbSumme({ zeilen: [] }, 50)).toEqual({
      zwischensummeRappen: 0,
      rabattProzent: 0,
      rabattRappen: 0,
      totalRappen: 0
    })
  })

  it('unsinniger Satz (defekte Einstellung) rechnet ohne Rabatt statt zu werfen', () => {
    expect(warenkorbSumme(warenkorb, 250).totalRappen).toBe(2700)
    expect(warenkorbSumme(warenkorb, -1).rabattRappen).toBe(0)
  })
})

describe('Bildschirmtexte', () => {
  it('Knopf, Zeile und Kopfzeile nennen den eingestellten Satz', () => {
    expect(rabattKnopfText(50)).toBe('50% Rabatt')
    expect(rabattKnopfText(30)).toBe('30% Rabatt')
    expect(rabattZeileLabel(50)).toBe('Rabatt 50%')
    expect(rabattKopfText(50, 1350)).toBe('inkl. 50% Rabatt (− CHF 13.50)')
  })
})

describe('Warenkorb-Entwurf mit Rabatt-Zustand', () => {
  it('sichert Zeilen und rabattAktiv', () => {
    expect(entwurfMitRabatt(warenkorb, true)).toEqual({
      zeilen: warenkorb.zeilen,
      rabattAktiv: true
    })
    expect(entwurfMitRabatt(warenkorb, false)).toEqual({
      zeilen: warenkorb.zeilen,
      rabattAktiv: false
    })
  })

  it('liest tolerant: fehlendes oder fremdes Feld ergibt keinen Rabatt', () => {
    expect(rabattAusEntwurf({ zeilen: [], rabattAktiv: true })).toBe(true)
    expect(rabattAusEntwurf({ zeilen: [], rabattAktiv: false })).toBe(false)
    expect(rabattAusEntwurf({ zeilen: [] })).toBe(false)
    expect(rabattAusEntwurf({ zeilen: [], rabattAktiv: 'ja' })).toBe(false)
    expect(rabattAusEntwurf(null)).toBe(false)
    expect(rabattAusEntwurf(undefined)).toBe(false)
    expect(rabattAusEntwurf('kein Objekt')).toBe(false)
  })
})

describe('parseRabattSatz (Einstellungen)', () => {
  it('nimmt ganze Zahlen von 1 bis 99', () => {
    expect(parseRabattSatz('50')).toBe(50)
    expect(parseRabattSatz(' 1 ')).toBe(1)
    expect(parseRabattSatz('99')).toBe(99)
  })

  it('lehnt leer, 0, ueber 99 und Kommazahlen ab', () => {
    expect(parseRabattSatz('')).toBeNull()
    expect(parseRabattSatz('0')).toBeNull()
    expect(parseRabattSatz('100')).toBeNull()
    expect(parseRabattSatz('12.5')).toBeNull()
    expect(parseRabattSatz('-5')).toBeNull()
    expect(parseRabattSatz('fünfzig')).toBeNull()
  })
})
