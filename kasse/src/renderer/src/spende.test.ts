import { describe, expect, it } from 'vitest'
import {
  SPENDE_TYP_NAME,
  baueFreieSpende,
  baueRueckgeldSpende,
  indexOhnePin,
  neueSpendeId,
  rueckgeldSpendeMoeglich,
  rueckgeldSpendeText,
  spendeBannerText,
  spendeBetragText,
  spendeChfGegenwert
} from './spende'

const verkaufBar = { id: 'v1', zahlart: 'bar_chf', storniertAm: null } as const
const zahlung = { rueckgeldChfRappen: 200 }

describe('rueckgeldSpendeMoeglich', () => {
  it('Bar-Beleg mit Rueckgeld, nicht storniert, ohne Spende: ja', () => {
    expect(rueckgeldSpendeMoeglich(verkaufBar, zahlung, false, null)).toBe(true)
    expect(rueckgeldSpendeMoeglich(verkaufBar, zahlung, false, undefined)).toBe(true)
    expect(rueckgeldSpendeMoeglich({ ...verkaufBar, zahlart: 'bar_eur' }, zahlung, false, null)).toBe(true)
  })

  it('Twint/Helfer, Rueckgeld 0, storniert oder schon gespendet: nein', () => {
    expect(rueckgeldSpendeMoeglich({ ...verkaufBar, zahlart: 'twint' }, zahlung, false, null)).toBe(false)
    expect(rueckgeldSpendeMoeglich({ ...verkaufBar, zahlart: 'helfer' }, zahlung, false, null)).toBe(false)
    expect(rueckgeldSpendeMoeglich(verkaufBar, { rueckgeldChfRappen: 0 }, false, null)).toBe(false)
    expect(rueckgeldSpendeMoeglich(verkaufBar, zahlung, true, null)).toBe(false)
    expect(rueckgeldSpendeMoeglich({ ...verkaufBar, storniertAm: '2026-09-19T15:00:00' }, zahlung, false, null)).toBe(false)
    expect(rueckgeldSpendeMoeglich(verkaufBar, zahlung, false, { storniertAm: null })).toBe(false)
  })

  it('eine stornierte Spende (Tippfehler) gibt den Knopf wieder frei', () => {
    expect(rueckgeldSpendeMoeglich(verkaufBar, zahlung, false, { storniertAm: '2026-09-19T15:00:00' })).toBe(true)
  })
})

describe('Anfragen bauen', () => {
  it('Rueckgeld als Spende: immer bar_chf mit dem Rueckgeld in Rappen und der Verkaufs-ID (auch bei EUR-Beleg)', () => {
    expect(baueRueckgeldSpende('sp1', { id: 'v1' }, { rueckgeldChfRappen: 200 })).toEqual({
      id: 'sp1',
      typ: 'bar_chf',
      betrag: 200,
      verkaufId: 'v1'
    })
  })

  it('freie Spende ohne Kauf: verkaufId null, Betrag in der Einheit des Typs', () => {
    expect(baueFreieSpende('sp2', 'twint', 500)).toEqual({ id: 'sp2', typ: 'twint', betrag: 500, verkaufId: null })
    expect(baueFreieSpende('sp3', 'bar_eur', 1000)).toEqual({ id: 'sp3', typ: 'bar_eur', betrag: 1000, verkaufId: null })
  })

  it('neueSpendeId liefert eine UUID', () => {
    expect(neueSpendeId()).toMatch(/^[0-9a-f-]{36}$/)
    expect(neueSpendeId()).not.toBe(neueSpendeId())
  })
})

describe('Anzeige', () => {
  it('CHF-Gegenwert: EUR ueber den Kurs auf 5 Rappen abgerundet, sonst der Betrag; ohne Kurs 0', () => {
    expect(spendeChfGegenwert('bar_chf', 500, 9000)).toBe(500)
    expect(spendeChfGegenwert('twint', 500, 0)).toBe(500)
    expect(spendeChfGegenwert('bar_eur', 1000, 9000)).toBe(900)
    expect(spendeChfGegenwert('bar_eur', 123, 9000)).toBe(110)
    expect(spendeChfGegenwert('bar_eur', 1000, 0)).toBe(0)
  })

  it('Texte fuer Banner und Liste', () => {
    expect(SPENDE_TYP_NAME.bar_eur).toBe('Bar EUR')
    expect(spendeBetragText({ typ: 'bar_chf', betrag: 500, betragChfRappen: 500 })).toBe('CHF 5.00')
    expect(spendeBetragText({ typ: 'bar_eur', betrag: 500, betragChfRappen: 450 })).toBe('EUR 5.00 (CHF 4.50)')
    expect(spendeBannerText({ typ: 'twint', betrag: 500, betragChfRappen: 500 })).toBe('Spende CHF 5.00 (Twint) erfasst')
    expect(spendeBannerText({ typ: 'bar_eur', betrag: 500, betragChfRappen: 450 })).toBe('Spende EUR 5.00 (CHF 4.50) (Bar EUR) erfasst')
    expect(rueckgeldSpendeText({ betragChfRappen: 200 })).toBe('Spende CHF 2.00 erfasst')
  })

  it('indexOhnePin: die neueste nicht stornierte Spende', () => {
    expect(indexOhnePin([])).toBe(-1)
    expect(indexOhnePin([{ storniertAm: '2026-09-19T15:00:00' }, { storniertAm: null }, { storniertAm: null }])).toBe(1)
    expect(indexOhnePin([{ storniertAm: '2026-09-19T15:00:00' }])).toBe(-1)
  })
})
