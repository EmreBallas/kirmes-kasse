import { describe, expect, it } from 'vitest'
import {
  HELFER_NAME_MAX,
  HELFER_OFFEN_TEXT,
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
  rabattProzent: 0,
  rabattRappen: 0,
  helferName: null,
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

/** Zahlung eines «später zahlen»-Belegs: keine Zahlung an der Kasse. */
const ZAHLUNG_HELFER: Zahlung = { ...ZAHLUNG_BAR, gegeben: 0, gegebenChfRappen: 0, rueckgeldChfRappen: 0 }

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
    expect(t).toContain('Gegeben CHF - TWINT                        50.00')
    expect(t).toContain('Spende CHF - TWINT                          5.00')
    expect(t.some((x) => x.startsWith('RÜCKGELD'))).toBe(false)
    pruefeBreiten(m)

    const ohneSpende: Zahlung = { ...z, gegeben: 4500, gegebenChfRappen: 4500, spendeChfRappen: 0, spendeTyp: null }
    const t2 = texte(letztes(bonModellVerkauf(v, POSITIONEN, ohneSpende, { nachdruck: null })))
    expect(t2).toContain('Gegeben CHF - TWINT                        45.00')
    expect(t2.some((x) => x.startsWith('Spende'))).toBe(false)
    expect(t2.some((x) => x.startsWith('RÜCKGELD'))).toBe(false)
  })

  it('Twint-Kennzeichnung nur bei Twint: Bar CHF, Bar EUR und Helfer enthalten kein TWINT', () => {
    const barChf = texte(letztes(bonModellVerkauf(VERKAUF, POSITIONEN, ZAHLUNG_BAR, { nachdruck: null })))
    expect(barChf.some((x) => x.includes('TWINT'))).toBe(false)
    expect(barChf).toContain('Gegeben CHF                                50.00')

    const vEur: Verkauf = { ...VERKAUF, zahlart: 'bar_eur', totalRappen: 1200 }
    const zEur: Zahlung = { verkaufId: 'v1', waehrung: 'EUR', kursX10000: 9000, gegeben: 2000, gegebenChfRappen: 1800, rueckgeldChfRappen: 500, spendeChfRappen: 100, spendeTyp: 'bar_eur' }
    const barEur = texte(letztes(bonModellVerkauf(vEur, POSITIONEN, zEur, { nachdruck: null })))
    expect(barEur.some((x) => x.includes('TWINT'))).toBe(false)
    expect(barEur).toContain('Spende CHF                                  1.00')

    const vHelfer: Verkauf = { ...VERKAUF, zahlart: 'helfer', helferName: 'Anna' }
    const helfer = texte(letztes(bonModellVerkauf(vHelfer, POSITIONEN, ZAHLUNG_HELFER, { nachdruck: null })))
    expect(helfer.some((x) => x.includes('TWINT'))).toBe(false)
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

  it('Helfer später zahlen: HELFER: <Name> und OFFEN statt Gegeben/Rückgeld, keine Schublade, Coupons gedruckt', () => {
    const v: Verkauf = { ...VERKAUF, zahlart: 'helfer', helferName: 'Anna Muster' }
    const m = bonModellVerkauf(v, POSITIONEN, ZAHLUNG_HELFER, { nachdruck: null })
    expect(m.schublade).toBe(false)
    expect(m.dokumente).toHaveLength(4)
    pruefeBreiten(m)
    const bon = letztes(m)
    expect(texte(bon)).toEqual([
      '  1 Winti Burger                           11.00',
      '  1 Lahmacun                                5.00',
      '  2 Döner Kebap                            24.00',
      '  2 Getränk Dose                            5.00',
      '-'.repeat(48),
      labelWert('TOTAL CHF', '45.00'),
      'HELFER: Anna Muster',
      HELFER_OFFEN_TEXT,
      '',
      'K1-0042  14:32'
    ])
    expect(bon.zeilen[6]).toEqual({ text: 'HELFER: Anna Muster', groesse: 'doppelt', ausrichtung: 'mitte', fett: true })
    expect(bon.zeilen[7]).toEqual({ text: 'OFFEN - zahlt später', groesse: 'doppelt', ausrichtung: 'mitte', fett: true })
    expect(texte(bon).some((x) => x.startsWith('Gegeben'))).toBe(false)
    expect(texte(bon).some((x) => x.startsWith('RÜCKGELD'))).toBe(false)
    expect(texte(bon).some((x) => x.startsWith('Helfer:'))).toBe(false) // keine zweite Namenszeile
    // Coupons unverändert
    expect(texte(m.dokumente[0] ?? { zeilen: [] })).toEqual(['1x', 'Winti Burger', '', 'Sa 19.09.2026  14:32', 'K1-0042   Coupon 1/3'])
  })

  it('Helfer später zahlen mit Rabatt: Zwischensumme, Rabatt, rabattiertes TOTAL als Schuld', () => {
    const v: Verkauf = { ...VERKAUF, zahlart: 'helfer', helferName: 'Anna', totalRappen: 2250, rabattProzent: 50, rabattRappen: 2250 }
    const t = texte(letztes(bonModellVerkauf(v, POSITIONEN, ZAHLUNG_HELFER, { nachdruck: null })))
    expect(t).toContain(labelWert('Zwischensumme', '45.00'))
    expect(t).toContain(labelWert('Rabatt 50%', '-22.50'))
    expect(t).toContain(labelWert('TOTAL CHF', '22.50'))
    expect(t).toContain('HELFER: Anna')
    expect(t).toContain(HELFER_OFFEN_TEXT)
  })

  it('Helfer später zahlen: langer Name auf zwei Zeilen (HELFER: und Name auf 24 Zeichen gekürzt)', () => {
    const v: Verkauf = { ...VERKAUF, zahlart: 'helfer', helferName: 'Maximiliane Musterfrau-Beispiel' }
    const m = bonModellVerkauf(v, POSITIONEN, ZAHLUNG_HELFER, { nachdruck: null })
    pruefeBreiten(m)
    const t = texte(letztes(m))
    const i = t.indexOf('HELFER:')
    expect(i).toBeGreaterThan(-1)
    expect(t[i + 1]).toBe('Maximiliane Musterfrau-Beispiel'.slice(0, HELFER_NAME_MAX))
    expect(t[i + 1]).toHaveLength(24)
    expect(t[i + 2]).toBe(HELFER_OFFEN_TEXT)
    expect(letztes(m).zeilen[i + 1]).toEqual({ text: 'Maximiliane Musterfrau-B', groesse: 'doppelt', ausrichtung: 'mitte', fett: true })
  })

  it('Helfer später zahlen ohne Namen (älterer Beleg): Zeile HELFER wie bisher', () => {
    const v: Verkauf = { ...VERKAUF, zahlart: 'helfer', helferName: null }
    const bon = letztes(bonModellVerkauf(v, POSITIONEN, ZAHLUNG_HELFER, { nachdruck: null }))
    expect(bon.zeilen).toContainEqual({ text: 'HELFER', groesse: 'doppelt', ausrichtung: 'mitte', fett: true })
    expect(texte(bon)).toContain(HELFER_OFFEN_TEXT)
  })

  it('Helfer gleich zahlen bar: normale Zahlungszeilen plus Zeile Helfer: <Name>, Schublade auf', () => {
    const v: Verkauf = { ...VERKAUF, helferName: 'Anna Muster' }
    const m = bonModellVerkauf(v, POSITIONEN, ZAHLUNG_BAR, { nachdruck: null })
    expect(m.schublade).toBe(true)
    pruefeBreiten(m)
    expect(texte(letztes(m))).toEqual([
      '  1 Winti Burger                           11.00',
      '  1 Lahmacun                                5.00',
      '  2 Döner Kebap                            24.00',
      '  2 Getränk Dose                            5.00',
      '-'.repeat(48),
      labelWert('TOTAL CHF', '45.00'),
      labelWert('Gegeben CHF', '50.00'),
      'RÜCKGELD CHF        5.00',
      'Helfer: Anna Muster',
      '',
      'K1-0042  14:32'
    ])
    expect(letztes(m).zeilen[8]).toEqual({ text: 'Helfer: Anna Muster' })
  })

  it('Helfer gleich zahlen per Twint: Twint-Zeilen plus Helfer-Zeile, keine Schublade; Name gekürzt', () => {
    const v: Verkauf = { ...VERKAUF, zahlart: 'twint', helferName: 'Maximiliane Musterfrau-Beispiel' }
    const z: Zahlung = { ...ZAHLUNG_BAR, gegeben: 4500, gegebenChfRappen: 4500, rueckgeldChfRappen: 0 }
    const m = bonModellVerkauf(v, POSITIONEN, z, { nachdruck: null })
    expect(m.schublade).toBe(false)
    const t = texte(letztes(m))
    expect(t).toContain('Gegeben CHF - TWINT                        45.00')
    expect(t).toContain('Helfer: Maximiliane Musterfrau-B')
    expect(t.some((x) => x.startsWith('HELFER'))).toBe(false)
  })

  it('ohne Helfername bleibt der Bon exakt wie bisher (keine Helfer-Zeile)', () => {
    const t = texte(letztes(bonModellVerkauf(VERKAUF, POSITIONEN, ZAHLUNG_BAR, { nachdruck: null })))
    expect(t.some((x) => x.includes('Helfer') || x.includes('HELFER'))).toBe(false)
    const leer = texte(letztes(bonModellVerkauf({ ...VERKAUF, helferName: '   ' }, POSITIONEN, ZAHLUNG_BAR, { nachdruck: null })))
    expect(leer).toEqual(t)
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
    spendenSeparatAnzahl: 3,
    spendenSeparatChfRappen: 650,
    storniAnzahl: 2,
    storniAuszahlungRappen: 1700,
    helferessenStueck: 5,
    helferessenBetragRappen: 5500,
    helferSofortRappen: 2200,
    helferSpaeterRappen: 3300,
    helferZahlungenBarChfRappen: 1200,
    helferZahlungenEurCent: 1000,
    helferZahlungenEurChfRappen: 900,
    helferZahlungenTwintRappen: 500,
    helferOffenGesamtRappen: 1750,
    helferOffen: [
      { name: 'Anna Muster', offenRappen: 1200, verkaeufeAnzahl: 1, letzteZeit: '2026-09-19T12:00:00' },
      { name: 'Beat', offenRappen: 550, verkaeufeAnzahl: 2, letzteZeit: '2026-09-19T13:00:00' }
    ],
    rabatteAnzahl: 2,
    rabatteRappen: 2700,
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
    expect(t).toContain(labelWert('  davon separat erfasst (3)', '6.50'))
    expect(t.indexOf(labelWert('  davon separat erfasst (3)', '6.50'))).toBe(t.indexOf(labelWert('Spende Twint CHF', '3.00')) + 1)
    expect(t).toContain(labelWert('Storni (2)', '-17.00'))
    // Helferessen und Helfer-Zahlungen des Tages, in dieser Reihenfolge nach den Storni
    const iHelfer = t.indexOf(labelWert('Helferessen (5 Stück)', '55.00'))
    expect(iHelfer).toBe(t.indexOf(labelWert('Storni (2)', '-17.00')) + 1)
    expect(t.slice(iHelfer, iHelfer + 7)).toEqual([
      labelWert('Helferessen (5 Stück)', '55.00'),
      labelWert('  davon sofort bezahlt', '22.00'),
      labelWert('  davon später zahlen (heute offen)', '33.00'),
      labelWert('Helfer-Zahlungen Bar CHF', '12.00'),
      labelWert('Helfer-Zahlungen Bar EUR (CHF-Gegenwert)', '9.00'),
      labelWert('  davon Stück EUR', 'EUR 10.00'),
      labelWert('Helfer-Zahlungen Twint', '5.00')
    ])
    expect(t.some((x) => x.includes('entgangen'))).toBe(false)
    expect(t).toContain(labelWert('Rabatte (2 Belege)', '27.00'))
    expect(t.indexOf(labelWert('Rabatte (2 Belege)', '27.00'))).toBe(iHelfer + 7)
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

  it('Abschnitt Offene Helfer-Schulden: Gesamtsumme und eine Zeile je Helfer, nach den Produktzeilen', () => {
    const m = bonModellAbschluss(bericht)
    const bon = letztes(m)
    const t = texte(bon)
    const i = t.indexOf('OFFENE HELFER-SCHULDEN')
    expect(i).toBeGreaterThan(t.indexOf(labelWert('Umsatz Produkte CHF', '811.00')))
    expect(bon.zeilen[i]).toEqual({ text: 'OFFENE HELFER-SCHULDEN', fett: true })
    expect(bon.zeilen[i + 1]).toEqual({ text: labelWert('Gesamt CHF', '17.50'), fett: true })
    expect(t[i + 2]).toBe(labelWert('  Anna Muster', '12.00'))
    expect(t[i + 3]).toBe(labelWert('  Beat', '5.50'))
    expect(t[i + 4]).toBe('-'.repeat(48))
    expect(t.indexOf('Kassier: MK', i)).toBeGreaterThan(i + 4)
    expect(t.some((x) => x.includes('keine'))).toBe(false)
  })

  it('ohne offene Helfer-Schulden: Gesamt 0.00 und Zeile "keine"', () => {
    const t = texte(letztes(bonModellAbschluss({ ...bericht, helferOffenGesamtRappen: 0, helferOffen: [] })))
    const i = t.indexOf('OFFENE HELFER-SCHULDEN')
    expect(t[i + 1]).toBe(labelWert('Gesamt CHF', '0.00'))
    expect(t[i + 2]).toBe('  keine')
  })

  it('langer Helfername in der Schuldenliste wird gekürzt, Zeile bleibt 48 Zeichen', () => {
    const lang = { name: 'Maximiliane Musterfrau-Beispiel von Irgendwo', offenRappen: 123456, verkaeufeAnzahl: 3, letzteZeit: null }
    const m = bonModellAbschluss({ ...bericht, helferOffen: [lang], helferOffenGesamtRappen: 123456 })
    pruefeBreiten(m)
    const t = texte(letztes(m))
    expect(t).toContain(labelWert('  Maximiliane Musterfrau-B', '1234.56'))
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

describe('bonModellVerkauf – Beleg-Rabatt', () => {
  // 27.00 Zwischensumme, 50% -> Total 13.50, Rabatt 13.50
  const RABATT_POSITIONEN: Position[] = [pos('menue', 'Menü', 2700, 1)]
  const V_RABATT: Verkauf = { ...VERKAUF, totalRappen: 1350, rabattProzent: 50, rabattRappen: 1350 }
  const Z_RABATT: Zahlung = { ...ZAHLUNG_BAR, gegeben: 2000, gegebenChfRappen: 2000, rueckgeldChfRappen: 650 }

  it('zeigt Zwischensumme, Rabatt als Abzug und danach das rabattierte TOTAL', () => {
    const m = bonModellVerkauf(V_RABATT, RABATT_POSITIONEN, Z_RABATT, { nachdruck: null })
    pruefeBreiten(m)
    const t = texte(letztes(m))
    expect(t).toEqual([
      positionsZeile(1, 'Menü', '27.00'),
      '-'.repeat(48),
      labelWert('Zwischensumme', '27.00'),
      labelWert('Rabatt 50%', '-13.50'),
      labelWert('TOTAL CHF', '13.50'),
      labelWert('Gegeben CHF', '20.00'),
      'RÜCKGELD CHF        6.50',
      '',
      'K1-0042  14:32'
    ])
    // Position behält den vollen Preis, der Rabatt steht am Beleg
    expect(t[0]).toBe(positionsZeile(1, 'Menü', '27.00'))
    const total = letztes(m).zeilen[4]
    expect(total).toEqual({ text: labelWert('TOTAL CHF', '13.50'), fett: true })
  })

  it('nennt den eingestellten Satz im Rabatt-Label', () => {
    const v: Verkauf = { ...VERKAUF, totalRappen: 800, rabattProzent: 20, rabattRappen: 200 }
    const t = texte(letztes(bonModellVerkauf(v, [pos('menue', 'Menü', 1000, 1)], { ...ZAHLUNG_BAR, gegeben: 1000, gegebenChfRappen: 1000, rueckgeldChfRappen: 200 }, { nachdruck: null })))
    expect(t).toContain(labelWert('Zwischensumme', '10.00'))
    expect(t).toContain(labelWert('Rabatt 20%', '-2.00'))
    expect(t).toContain(labelWert('TOTAL CHF', '8.00'))
  })

  it('ohne Rabatt bleibt der Bon exakt wie bisher', () => {
    const ohne = texte(letztes(bonModellVerkauf(VERKAUF, POSITIONEN, ZAHLUNG_BAR, { nachdruck: null })))
    expect(ohne.some((x) => x.startsWith('Zwischensumme') || x.startsWith('Rabatt'))).toBe(false)
    expect(ohne[4]).toBe('-'.repeat(48))
    expect(ohne[5]).toBe(labelWert('TOTAL CHF', '45.00'))
  })

  it('Coupons bleiben unverändert', () => {
    const m = bonModellVerkauf(V_RABATT, RABATT_POSITIONEN, Z_RABATT, { nachdruck: null })
    expect(m.dokumente).toHaveLength(2)
    expect(texte(m.dokumente[0] ?? { zeilen: [] })).toEqual(['1x', 'Menü', '', 'Sa 19.09.2026  14:32', 'K1-0042   Coupon 1/1'])
  })
})

describe('bonModellAbschluss – Rabatte und Veranstaltung', () => {
  const BASIS: AbschlussBericht = {
    kassentagId: 'tag-sa',
    datum: '2026-09-19',
    kassier: 'MK',
    kassePraefix: 'K1',
    startgeldChfRappen: 20000,
    startgeldEurCent: 0,
    barEinnahmenChfRappen: 1350,
    barSpendeChfRappen: 0,
    barEinnahmenEurCent: 0,
    barEinnahmenEurChfRappen: 0,
    rueckgeldAusEurRappen: 0,
    barSpendeEurChfRappen: 0,
    twintUmsatzRappen: 0,
    twintStorniertRappen: 0,
    twintSpendeRappen: 0,
    spendenSeparatAnzahl: 0,
    spendenSeparatChfRappen: 0,
    storniAnzahl: 0,
    storniAuszahlungRappen: 0,
    helferessenStueck: 0,
    helferessenBetragRappen: 0,
    helferSofortRappen: 0,
    helferSpaeterRappen: 0,
    helferZahlungenBarChfRappen: 0,
    helferZahlungenEurCent: 0,
    helferZahlungenEurChfRappen: 0,
    helferZahlungenTwintRappen: 0,
    helferOffenGesamtRappen: 0,
    helferOffen: [],
    rabatteAnzahl: 1,
    rabatteRappen: 1350,
    nachdrucke: 0,
    sollChfRappen: 21350,
    sollEurCent: 0,
    istChfRappen: null,
    istEurCent: null,
    differenzChfRappen: null,
    differenzEurCent: null,
    anzahlBelege: 1,
    produkte: [{ produktId: 'menue', name: 'Menü', verkauft: 1, helfer: 0, umsatzRappen: 2700 }],
    erstelltAm: ''
  }

  it('Rabattzeile direkt nach dem Helfer-Block (letzte Zeile Helfer-Zahlungen Twint)', () => {
    const t = texte(letztes(bonModellAbschluss(BASIS)))
    expect(t).toContain(labelWert('Helferessen (0 Stück)', '0.00'))
    const i = t.indexOf(labelWert('Helfer-Zahlungen Twint', '0.00'))
    expect(i).toBeGreaterThan(-1)
    expect(t[i + 1]).toBe(labelWert('Rabatte (1 Belege)', '13.50'))
    // Umsatz je Produkt bleibt brutto; die Rabattzeile erklärt die Differenz zu den Einnahmen
    expect(t).toContain(labelWert('Umsatz Produkte CHF', '27.00'))
    expect(t).toContain(labelWert('SOLL CHF', '213.50'))
  })

  it('Veranstaltung steht zentriert und doppelt gross über KASSENABSCHLUSS', () => {
    const m = bonModellAbschluss({ ...BASIS, veranstaltung: 'Dorffest Musterhausen' })
    pruefeBreiten(m)
    const z = letztes(m).zeilen
    expect(z[0]).toEqual({ text: 'Dorffest Musterhausen', groesse: 'doppelt', ausrichtung: 'mitte', fett: true })
    expect(z[1]?.text).toBe('KASSENABSCHLUSS')
  })

  it('Veranstaltung beim Nachdruck nach der NACHDRUCK-Zeile', () => {
    const z = letztes(bonModellAbschluss({ ...BASIS, veranstaltung: 'Dorffest' }, { nachdruck: true })).zeilen
    expect(z[0]?.text).toBe('NACHDRUCK')
    expect(z[1]?.text).toBe('Dorffest')
    expect(z[2]?.text).toBe('KASSENABSCHLUSS')
  })

  it('ohne oder mit leerer Veranstaltung beginnt der Bon wie bisher', () => {
    expect(texte(letztes(bonModellAbschluss(BASIS)))[0]).toBe('KASSENABSCHLUSS')
    expect(texte(letztes(bonModellAbschluss({ ...BASIS, veranstaltung: '' })))[0]).toBe('KASSENABSCHLUSS')
    expect(texte(letztes(bonModellAbschluss({ ...BASIS, veranstaltung: '   ' })))[0]).toBe('KASSENABSCHLUSS')
  })

  it('langer Veranstaltungsname wird auf die Spaltenbreite gekürzt', () => {
    const m = bonModellAbschluss({ ...BASIS, veranstaltung: 'Ein sehr langer Name eines Vereinsfestes 2026' })
    pruefeBreiten(m)
    expect(letztes(m).zeilen[0]?.text).toHaveLength(SPALTEN.doppelt)
  })
})

describe('bonModellTest – ohne festen Projektnamen', () => {
  it('nennt nur eine neutrale Bezeichnung, keinen festen Veranstaltungsnamen', () => {
    const t = bonModellTest().dokumente[0]?.zeilen.map((z) => z.text) ?? []
    expect(t[0]).toBe('TESTDRUCK')
    expect(t[1]).toBe('Vereins-Kasse')
  })
})
