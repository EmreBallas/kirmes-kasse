import { describe, expect, it } from 'vitest'
import {
  SPALTEN,
  bonModellAbschluss,
  bonModellTest,
  bonModellVerkauf,
  formatDatum,
  formatDatumUhrzeit,
  formatUhrzeit,
  labelWert,
  positionsZeile
} from './bon'
import type { AbschlussBericht, BonDokument, DruckModell, Position, Verkauf, Zahlung } from './types'

const VERKAUF: Verkauf = {
  id: 'v1',
  kassentagId: 'tag-sa',
  belegnr: 'K1-0042',
  zeit: '2026-09-19T14:32:05',
  zahlart: 'bar_chf',
  totalRappen: 4500,
  storniertAm: null,
  stornoId: null
}

function pos(produktId: string, name: string, preis: number, anzahl: number, gruppe: 'coupon' | 'kasse' = 'coupon'): Position {
  return { id: `p-${produktId}`, verkaufId: 'v1', produktId, nameSnapshot: name, preisSnapshotRappen: preis, anzahl, gruppeSnapshot: gruppe }
}

const POSITIONEN: Position[] = [
  pos('burger', 'Winti Burger', 1100, 1),
  pos('lahmacun', 'Lahmacun', 500, 1),
  pos('doener', 'Döner Kebap', 1200, 2),
  pos('dose', 'Getränk Dose', 250, 2, 'kasse')
]

const ZAHLUNG_BAR: Zahlung = {
  verkaufId: 'v1',
  waehrung: 'CHF',
  kursX10000: null,
  gegeben: 5000,
  gegebenChfRappen: 5000,
  rueckgeldChfRappen: 500,
  spendeChfRappen: 0,
  spendeTyp: null
}

const texte = (d: BonDokument): string[] => d.zeilen.map((z) => z.text)
const letztes = (m: DruckModell): BonDokument => {
  const d = m.dokumente[m.dokumente.length - 1]
  if (d === undefined) throw new Error('kein Dokument')
  return d
}

/** Keine Zeile länger als ihre Spaltenzahl (48/24/16). */
function pruefeBreiten(m: DruckModell): void {
  for (const d of m.dokumente) {
    for (const z of d.zeilen) {
      expect(z.text.length, `Zeile "${z.text}"`).toBeLessThanOrEqual(SPALTEN[z.groesse ?? 'normal'])
    }
  }
}

describe('Datum / Uhrzeit', () => {
  it('formatiert ISO lokal mit deutschem Wochentag', () => {
    expect(formatDatum('2026-09-19T14:32:05')).toBe('Sa 19.09.2026')
    expect(formatDatum('2026-09-20')).toBe('So 20.09.2026')
    expect(formatDatum('2026-09-14T08:00:00')).toBe('Mo 14.09.2026')
    expect(formatUhrzeit('2026-09-19T14:32:05')).toBe('14:32')
    expect(formatUhrzeit('2026-09-19T09:05:00')).toBe('09:05')
    expect(formatDatumUhrzeit('2026-09-19T14:32:05')).toBe('Sa 19.09.2026  14:32')
  })
  it('gibt Fremdformate unverändert zurück', () => {
    expect(formatDatum('heute')).toBe('heute')
    expect(formatUhrzeit('')).toBe('')
  })
})

describe('Zeilen-Helfer', () => {
  it('positionsZeile hat exakt 48 Zeichen', () => {
    const z = positionsZeile(1, 'Winti Burger', '11.00')
    expect(z).toBe('  1 Winti Burger                           11.00')
    expect(z).toHaveLength(48)
    expect(positionsZeile(12, 'Döner Kebap', '144.00')).toHaveLength(48)
    expect(positionsZeile(1234, 'Sehr langer Produktname mit vielen Zeichen', '1.00')).toHaveLength(48)
  })
  it('labelWert füllt auf und kürzt zu lange Labels', () => {
    expect(labelWert('TOTAL CHF', '45.00')).toBe('TOTAL CHF' + ' '.repeat(34) + '45.00')
    expect(labelWert('RÜCKGELD CHF', '5.00', 24)).toBe('RÜCKGELD CHF        5.00')
    expect(labelWert('x'.repeat(60), '1.00', 24)).toHaveLength(24)
  })
})

describe('bonModellVerkauf – Bar CHF (Beispiel des Auftraggebers)', () => {
  const m = bonModellVerkauf(VERKAUF, POSITIONEN, ZAHLUNG_BAR, { nachdruck: null })

  it('öffnet die Schublade und liefert 3 Coupons + Bon 1', () => {
    expect(m.schublade).toBe(true)
    expect(m.dokumente).toHaveLength(4)
    pruefeBreiten(m)
  })

  it('Coupons nur für Gruppe coupon, Anzahl dreifach, Name doppelt, Datum, Coupon n/3', () => {
    const c1 = m.dokumente[0]
    const c3 = m.dokumente[2]
    if (c1 === undefined || c3 === undefined) throw new Error('Coupons fehlen')
    expect(c1.zeilen).toEqual([
      { text: '1x', groesse: 'dreifach', ausrichtung: 'mitte', fett: true },
      { text: 'Winti Burger', groesse: 'doppelt', ausrichtung: 'mitte', fett: true },
      { text: '' },
      { text: 'Sa 19.09.2026  14:32', ausrichtung: 'mitte' },
      { text: 'K1-0042   Coupon 1/3', ausrichtung: 'mitte' }
    ])
    expect(texte(c3)).toEqual(['2x', 'Döner Kebap', '', 'Sa 19.09.2026  14:32', 'K1-0042   Coupon 3/3'])
    expect(m.dokumente.slice(0, 3).map((d) => d.zeilen[1]?.text)).toEqual(['Winti Burger', 'Lahmacun', 'Döner Kebap'])
  })

  it('Bon 1: Positionszeilen im Format {anzahl:>3} {name:<34}{betrag:>10}', () => {
    const bon = letztes(m)
    expect(texte(bon)).toEqual([
      '  1 Winti Burger                           11.00',
      '  1 Lahmacun                                5.00',
      '  2 Döner Kebap                            24.00',
      '  2 Getränk Dose                            5.00',
      '-'.repeat(48),
      'TOTAL CHF                                  45.00',
      'Gegeben CHF                                50.00',
      'RÜCKGELD CHF        5.00',
      '',
      'K1-0042  14:32'
    ])
    for (let i = 0; i < 4; i++) expect(bon.zeilen[i]?.text).toHaveLength(48)
    expect(bon.zeilen[5]).toEqual({ text: 'TOTAL CHF                                  45.00', fett: true })
    expect(bon.zeilen[7]).toEqual({ text: 'RÜCKGELD CHF        5.00', groesse: 'doppelt', fett: true })
    expect(bon.zeilen[9]).toEqual({ text: 'K1-0042  14:32', ausrichtung: 'rechts' })
  })

  it('Bar "stimmt so": Spende-Zeile und Rückgeld 0.00', () => {
    const z: Zahlung = { ...ZAHLUNG_BAR, gegeben: 4800, gegebenChfRappen: 4800, rueckgeldChfRappen: 0, spendeChfRappen: 300, spendeTyp: 'bar_chf' }
    const t = texte(letztes(bonModellVerkauf(VERKAUF, POSITIONEN, z, { nachdruck: null })))
    expect(t).toContain('Spende CHF                                  3.00')
    expect(t).toContain('RÜCKGELD CHF        0.00')
  })
})

describe('bonModellVerkauf – Nachdruck', () => {
  const alles = bonModellVerkauf(VERKAUF, POSITIONEN, ZAHLUNG_BAR, { nachdruck: 'alles' })

  it('alles: Schublade zu, NACHDRUCK auf Coupons und Bon', () => {
    expect(alles.schublade).toBe(false)
    expect(alles.dokumente).toHaveLength(4)
    for (const d of alles.dokumente) {
      expect(d.zeilen[0]).toEqual({ text: 'NACHDRUCK', groesse: 'doppelt', ausrichtung: 'mitte', fett: true })
    }
    expect(texte(letztes(alles))).toContain('K1-0042  14:32')
    pruefeBreiten(alles)
  })
  it('coupons: nur die 3 Coupons', () => {
    const m = bonModellVerkauf(VERKAUF, POSITIONEN, ZAHLUNG_BAR, { nachdruck: 'coupons' })
    expect(m.schublade).toBe(false)
    expect(m.dokumente).toHaveLength(3)
    expect(m.dokumente.map((d) => d.zeilen[0]?.text)).toEqual(['NACHDRUCK', 'NACHDRUCK', 'NACHDRUCK'])
    expect(m.dokumente[2]?.zeilen.at(-1)?.text).toBe('K1-0042   Coupon 3/3')
  })
  it('bon: nur Bon 1', () => {
    const m = bonModellVerkauf(VERKAUF, POSITIONEN, ZAHLUNG_BAR, { nachdruck: 'bon' })
    expect(m.schublade).toBe(false)
    expect(m.dokumente).toHaveLength(1)
    const t = texte(letztes(m))
    expect(t[0]).toBe('NACHDRUCK')
    expect(t).toContain('TOTAL CHF                                  45.00')
  })
})

describe('bonModellVerkauf – Twint, EUR, Helfer', () => {
  it('Twint: keine Schublade, Spende statt Rückgeld (nur wenn > 0)', () => {
    const v: Verkauf = { ...VERKAUF, zahlart: 'twint' }
    const z: Zahlung = { ...ZAHLUNG_BAR, gegeben: 5000, gegebenChfRappen: 5000, rueckgeldChfRappen: 0, spendeChfRappen: 500, spendeTyp: 'twint' }
    const m = bonModellVerkauf(v, POSITIONEN, z, { nachdruck: null })
    expect(m.schublade).toBe(false)
    const t = texte(letztes(m))
    expect(t).toContain('Gegeben CHF                                50.00')
    expect(t).toContain('Spende CHF                                  5.00')
    expect(t.some((x) => x.startsWith('RÜCKGELD'))).toBe(false)

    const ohneSpende: Zahlung = { ...z, gegeben: 4500, gegebenChfRappen: 4500, spendeChfRappen: 0, spendeTyp: null }
    const t2 = texte(letztes(bonModellVerkauf(v, POSITIONEN, ohneSpende, { nachdruck: null })))
    expect(t2.some((x) => x.startsWith('Spende'))).toBe(false)
    expect(t2.some((x) => x.startsWith('RÜCKGELD'))).toBe(false)
  })

  it('EUR: Gegeben EUR, Kurs 0.90, Rückgeld CHF, Schublade auf', () => {
    const v: Verkauf = { ...VERKAUF, zahlart: 'bar_eur', totalRappen: 1200 }
    const z: Zahlung = { verkaufId: 'v1', waehrung: 'EUR', kursX10000: 9000, gegeben: 2000, gegebenChfRappen: 1800, rueckgeldChfRappen: 600, spendeChfRappen: 0, spendeTyp: null }
    const m = bonModellVerkauf(v, [pos('doener', 'Döner Kebap', 1200, 1)], z, { nachdruck: null })
    expect(m.schublade).toBe(true)
    expect(m.dokumente).toHaveLength(2)
    const t = texte(letztes(m))
    expect(t).toContain('TOTAL CHF                                  12.00')
    expect(t).toContain('Gegeben EUR                                20.00')
    expect(t).toContain('Kurs 0.90                              CHF 18.00')
    expect(t).toContain('RÜCKGELD CHF        6.00')
    pruefeBreiten(m)
  })

  it('Helfer: Zeile HELFER, keine Schublade, Coupons werden gedruckt', () => {
    const v: Verkauf = { ...VERKAUF, zahlart: 'helfer', totalRappen: 0 }
    const z: Zahlung = { ...ZAHLUNG_BAR, gegeben: 0, gegebenChfRappen: 0, rueckgeldChfRappen: 0 }
    const m = bonModellVerkauf(v, POSITIONEN, z, { nachdruck: null })
    expect(m.schublade).toBe(false)
    expect(m.dokumente).toHaveLength(4)
    const bon = letztes(m)
    expect(bon.zeilen).toContainEqual({ text: 'HELFER', groesse: 'doppelt', ausrichtung: 'mitte', fett: true })
    expect(texte(bon).some((x) => x.startsWith('Gegeben'))).toBe(false)
    expect(texte(bon).some((x) => x.startsWith('RÜCKGELD'))).toBe(false)
  })

  it('lange Namen werden auf die Spaltenzahl gekürzt', () => {
    const lang = 'Winti Burger mit Pommes und extra viel Zeug dazu'
    const m = bonModellVerkauf(VERKAUF, [pos('x', lang, 1500, 1)], ZAHLUNG_BAR, { nachdruck: null })
    pruefeBreiten(m)
    expect(m.dokumente[0]?.zeilen[1]?.text).toBe(lang.slice(0, 24))
    expect(m.dokumente[1]?.zeilen[0]?.text).toHaveLength(48)
  })
})

describe('bonModellAbschluss', () => {
  const bericht: AbschlussBericht = {
    kassentagId: 'tag-sa',
    datum: '2026-09-19',
    kassier: 'MK',
    kassePraefix: 'K1',
    startgeldChfRappen: 20000,
    startgeldEurCent: 0,
    barEinnahmenChfRappen: 123400,
    barSpendeChfRappen: 350,
    barEinnahmenEurCent: 4500,
    barEinnahmenEurChfRappen: 4050,
    rueckgeldAusEurRappen: 500,
    barSpendeEurChfRappen: 150,
    twintUmsatzRappen: 45600,
    twintStorniertRappen: 1200,
    twintSpendeRappen: 300,
    storniAnzahl: 2,
    storniAuszahlungRappen: 1700,
    helferessenStueck: 5,
    helferessenEntgangenRappen: 5500,
    nachdrucke: 1,
    sollChfRappen: 141550,
    sollEurCent: 4500,
    istChfRappen: 141500,
    istEurCent: 4500,
    differenzChfRappen: -50,
    differenzEurCent: 0,
    anzahlBelege: 87,
    produkte: [
      { produktId: 'doener', name: 'Döner Kebap', verkauft: 30, helfer: 2, umsatzRappen: 36000 },
      { produktId: 'burger', name: 'Winti Burger', verkauft: 41, helfer: 3, umsatzRappen: 45100 }
    ],
    erstelltAm: '2026-09-19T22:15:00'
  }

  it('enthält alle Zeilen des Berichts, keine Schublade', () => {
    const m = bonModellAbschluss(bericht)
    expect(m.schublade).toBe(false)
    expect(m.dokumente).toHaveLength(1)
    pruefeBreiten(m)
    const t = texte(letztes(m))
    expect(t[0]).toBe('KASSENABSCHLUSS')
    expect(t).toContain('Sa 19.09.2026   Kasse K1')
    expect(t).toContain('Erstellt: Sa 19.09.2026  22:15')
    expect(t).toContain(labelWert('Startgeld CHF', '200.00'))
    expect(t).toContain(labelWert('Bar CHF (brutto)', '1234.00'))
    expect(t).toContain(labelWert('Bar EUR Stück', 'EUR 45.00'))
    expect(t).toContain(labelWert('Bar EUR Gegenwert CHF', '40.50'))
    expect(t).toContain(labelWert('Rückgeld aus EUR CHF', '-5.00'))
    expect(t).toContain(labelWert('Twint brutto CHF', '456.00'))
    expect(t).toContain(labelWert('  davon storniert', '12.00'))
    expect(t).toContain(labelWert('Spende Bar CHF', '3.50'))
    expect(t).toContain(labelWert('Spende Bar EUR (CHF)', '1.50'))
    expect(t).toContain(labelWert('Spende Twint CHF', '3.00'))
    expect(t).toContain(labelWert('Storni (2)', '-17.00'))
    expect(t).toContain(labelWert('Helferessen 5 Stk', '55.00'))
    expect(t).toContain(labelWert('Nachdrucke', '1'))
    expect(t).toContain(labelWert('SOLL CHF', '1415.50'))
    expect(t).toContain(labelWert('IST CHF', '1415.00'))
    expect(t).toContain(labelWert('DIFFERENZ CHF', '-0.50', 24))
    expect(t).toContain(labelWert('SOLL EUR', '45.00'))
    expect(t).toContain(labelWert('IST EUR', '45.00'))
    expect(t).toContain(labelWert('DIFFERENZ EUR', '0.00', 24))
    expect(t).toContain(labelWert('Belege (ohne stornierte)', '87'))
    expect(t).toContain('Döner Kebap                 30     2      360.00')
    expect(t).toContain('Winti Burger                41     3      451.00')
    expect(t).toContain(labelWert('Umsatz Produkte CHF', '811.00'))
    expect(t).toContain('Kassier: MK')
    expect(t).toContain('_'.repeat(48))
    expect(t).toContain('Unterschrift Kassier')
  })

  it('Nachdruck: erste Zeile NACHDRUCK doppelt fett, sonst identisch', () => {
    const m = bonModellAbschluss(bericht, { nachdruck: true })
    expect(m.schublade).toBe(false)
    pruefeBreiten(m)
    const erste = letztes(m).zeilen[0]
    expect(erste).toEqual({ text: 'NACHDRUCK', groesse: 'doppelt', ausrichtung: 'mitte', fett: true })
    expect(texte(letztes(m)).slice(1)).toEqual(texte(letztes(bonModellAbschluss(bericht))))
  })

  it('Vorschau ohne Ist zeigt "offen"', () => {
    const t = texte(letztes(bonModellAbschluss({ ...bericht, istChfRappen: null, istEurCent: null, differenzChfRappen: null, differenzEurCent: null, erstelltAm: '' })))
    expect(t).toContain(labelWert('IST CHF', 'offen'))
    expect(t).toContain(labelWert('DIFFERENZ CHF', 'offen', 24))
    expect(t.some((x) => x.startsWith('Erstellt'))).toBe(false)
  })
})

describe('bonModellTest', () => {
  it('liefert ein Dokument ohne Schublade innerhalb der Spaltenbreiten', () => {
    const m = bonModellTest()
    expect(m.schublade).toBe(false)
    expect(m.dokumente).toHaveLength(1)
    expect(m.dokumente[0]?.zeilen[0]?.text).toBe('TESTDRUCK')
    pruefeBreiten(m)
  })
})
