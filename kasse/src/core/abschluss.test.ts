import { describe, expect, it } from 'vitest'
import { berechneAbschluss, type AbschlussInput } from './abschluss'
import type { Kassentag, Position, Storno, Verkauf, Zahlart, Zahlung } from './types'
import { berechneZahlung } from './zahlung'

const SAMSTAG: Kassentag = {
  id: 'tag-sa',
  datum: '2026-09-19',
  kassePraefix: 'K1',
  kassier: 'MK',
  startgeldChfRappen: 20000,
  startgeldEurCent: 0,
  geoeffnetAm: '2026-09-19T10:00:00',
  abgeschlossenAm: null,
  istChfRappen: null,
  istEurCent: null,
  differenzChfRappen: null,
  differenzEurCent: null,
  bemerkung: null,
  pdfPfad: null
}
const SONNTAG: Kassentag = { ...SAMSTAG, id: 'tag-so', datum: '2026-09-20', startgeldChfRappen: 30000, startgeldEurCent: 2000 }

interface Artikel {
  produktId: string
  name: string
  preis: number
  anzahl: number
  gruppe?: 'coupon' | 'kasse'
}

/** Baut Verkauf + Positionen + Zahlung wie der Server (über berechneZahlung). */
function verkauf(
  id: string,
  tag: Kassentag,
  zahlart: Zahlart,
  artikel: Artikel[],
  gegeben: number,
  opts: { kurs?: number; spendeBehalten?: boolean; zeit?: string } = {}
): { verkauf: Verkauf; positionen: Position[]; zahlung: Zahlung } {
  const totalRappen = artikel.reduce((s, a) => s + a.preis * a.anzahl, 0)
  const z = berechneZahlung({
    zahlart,
    totalRappen,
    gegeben,
    kursX10000: opts.kurs ?? 9000,
    spendeBehalten: opts.spendeBehalten ?? false
  })
  if (!z.gedeckt) throw new Error('Testdaten: nicht gedeckt')
  return {
    verkauf: {
      id,
      kassentagId: tag.id,
      belegnr: `K1-${id}`,
      zeit: opts.zeit ?? `${tag.datum}T12:00:00`,
      zahlart,
      totalRappen,
      storniertAm: null,
      stornoId: null
    },
    positionen: artikel.map((a, i) => ({
      id: `${id}-p${String(i)}`,
      verkaufId: id,
      produktId: a.produktId,
      nameSnapshot: a.name,
      preisSnapshotRappen: a.preis,
      anzahl: a.anzahl,
      gruppeSnapshot: a.gruppe ?? 'coupon'
    })),
    zahlung: {
      verkaufId: id,
      waehrung: z.waehrung,
      kursX10000: z.kursX10000,
      gegeben: z.gegeben,
      gegebenChfRappen: z.gegebenChfRappen,
      rueckgeldChfRappen: z.rueckgeldChfRappen,
      spendeChfRappen: z.spendeChfRappen,
      spendeTyp: z.spendeTyp
    }
  }
}

function storno(v: Verkauf, tag: Kassentag, auszahlung: number = v.totalRappen): Storno {
  v.storniertAm = `${tag.datum}T13:00:00`
  v.stornoId = `st-${v.id}`
  return {
    id: `st-${v.id}`,
    verkaufId: v.id,
    kassentagId: tag.id,
    zeit: `${tag.datum}T13:00:00`,
    grund: 'tippfehler',
    auszahlungChfRappen: auszahlung,
    mitPin: false
  }
}

function input(tag: Kassentag, vs: ReturnType<typeof verkauf>[], storni: Storno[] = [], rest: Partial<AbschlussInput> = {}): AbschlussInput {
  return {
    kassentag: tag,
    verkaeufe: vs.map((v) => v.verkauf),
    positionen: vs.flatMap((v) => v.positionen),
    zahlungen: vs.map((v) => v.zahlung),
    storni,
    nachdrucke: 0,
    istChfRappen: null,
    istEurCent: null,
    ...rest
  }
}

const BURGER: Artikel = { produktId: 'burger', name: 'Winti Burger', preis: 1100, anzahl: 1 }
const DOENER: Artikel = { produktId: 'doener', name: 'Döner Kebap', preis: 1200, anzahl: 1 }
const DOSE: Artikel = { produktId: 'dose', name: 'Getränk Dose', preis: 250, anzahl: 2, gruppe: 'kasse' }

describe('berechneAbschluss – leerer Tag', () => {
  it('Soll = Startgeld, alles andere 0', () => {
    const b = berechneAbschluss(input(SAMSTAG, []))
    expect(b.sollChfRappen).toBe(20000)
    expect(b.sollEurCent).toBe(0)
    expect(b.anzahlBelege).toBe(0)
    expect(b.produkte).toEqual([])
    expect(b.differenzChfRappen).toBeNull()
    expect(b.kassier).toBe('MK')
    expect(b.datum).toBe('2026-09-19')
    expect(b.kassePraefix).toBe('K1')
  })
})

describe('berechneAbschluss – Kontrollfälle Roadmap Abschnitt 4', () => {
  it('Bar-CHF 11.00 verkauft und storniert -> Soll = Startgeld', () => {
    const v = verkauf('1', SAMSTAG, 'bar_chf', [BURGER], 2000)
    const st = storno(v.verkauf, SAMSTAG)
    const b = berechneAbschluss(input(SAMSTAG, [v], [st]))
    expect(b.barEinnahmenChfRappen).toBe(1100) // brutto
    expect(b.storniAnzahl).toBe(1)
    expect(b.storniAuszahlungRappen).toBe(1100)
    expect(b.sollChfRappen).toBe(20000)
    expect(b.anzahlBelege).toBe(0)
    expect(b.produkte).toEqual([]) // Stück nur nicht stornierte
  })

  it('Bar-EUR: Total 12.00, 20 EUR bei 0.90, storniert -> Soll CHF = Start − 6.00 − 12.00, Soll EUR = +20', () => {
    const v = verkauf('2', SAMSTAG, 'bar_eur', [DOENER], 2000)
    expect(v.zahlung.gegebenChfRappen).toBe(1800)
    expect(v.zahlung.rueckgeldChfRappen).toBe(600)
    const st = storno(v.verkauf, SAMSTAG)
    const b = berechneAbschluss(input(SAMSTAG, [v], [st]))
    expect(b.barEinnahmenEurCent).toBe(2000)
    expect(b.barEinnahmenEurChfRappen).toBe(1800)
    expect(b.rueckgeldAusEurRappen).toBe(600)
    expect(b.sollChfRappen).toBe(20000 - 600 - 1200)
    expect(b.sollEurCent).toBe(2000)
  })

  it('Twint 12.00 storniert -> Soll CHF = Start − 12.00, Twint brutto 12.00, davon storniert 12.00', () => {
    const v = verkauf('3', SAMSTAG, 'twint', [DOENER], 1200)
    const st = storno(v.verkauf, SAMSTAG)
    const b = berechneAbschluss(input(SAMSTAG, [v], [st]))
    expect(b.twintUmsatzRappen).toBe(1200)
    expect(b.twintStorniertRappen).toBe(1200)
    expect(b.storniAuszahlungRappen).toBe(1200)
    expect(b.sollChfRappen).toBe(20000 - 1200)
  })

  it('Helfer storniert -> Auszahlung 0, Soll unverändert', () => {
    const v = verkauf('4', SAMSTAG, 'helfer', [BURGER], 0)
    const st = storno(v.verkauf, SAMSTAG, 0)
    const b = berechneAbschluss(input(SAMSTAG, [v], [st]))
    expect(b.storniAnzahl).toBe(1)
    expect(b.storniAuszahlungRappen).toBe(0)
    expect(b.sollChfRappen).toBe(20000)
    // Testfall 28: Helferessen-Stück sinken, konsistent zur Helfer-Spalte der Produktzeilen
    expect(b.helferessenStueck).toBe(0)
    expect(b.helferessenEntgangenRappen).toBe(0)
    expect(b.produkte).toEqual([]) // Stückzahl je Produkt ohne stornierte
  })

  it('Helfer-Beleg vom Samstag am Sonntag storniert -> Samstag behält seine Helferessen-Stück', () => {
    const v = verkauf('4b', SAMSTAG, 'helfer', [BURGER], 0)
    const st = storno(v.verkauf, SONNTAG, 0)
    const bSa = berechneAbschluss(input(SAMSTAG, [v], []))
    expect(bSa.helferessenStueck).toBe(1)
    const bSo = berechneAbschluss(input(SONNTAG, [v], [st]))
    expect(bSo.helferessenStueck).toBe(0)
    expect(bSo.storniAnzahl).toBe(1)
  })

  it('Vortags-Storno: Samstag-Beleg am Sonntag storniert -> nur Sonntag trägt die Auszahlung', () => {
    const sa = verkauf('5', SAMSTAG, 'bar_chf', [BURGER], 1100)
    const so = verkauf('6', SONNTAG, 'bar_chf', [DOENER], 1200)
    const st = storno(sa.verkauf, SONNTAG) // storno.kassentagId = Sonntag

    // Sonntag: Auszahlung 11.00 belastet Sonntag; Samstag-Verkauf zählt nicht als Sonntag-Beleg
    const bSo = berechneAbschluss(input(SONNTAG, [so, sa], [st]))
    expect(bSo.storniAnzahl).toBe(1)
    expect(bSo.storniAuszahlungRappen).toBe(1100)
    expect(bSo.barEinnahmenChfRappen).toBe(1200)
    expect(bSo.sollChfRappen).toBe(30000 + 1200 - 1100)
    expect(bSo.anzahlBelege).toBe(1)
    expect(bSo.produkte.map((p) => [p.name, p.verkauft])).toEqual([['Döner Kebap', 1]])

    // Samstag (neu berechnet): Stückzahlen bleiben, wie sie abgeschlossen wurden, kein Storno
    const bSa = berechneAbschluss(input(SAMSTAG, [sa], []))
    expect(bSa.storniAnzahl).toBe(0)
    expect(bSa.sollChfRappen).toBe(20000 + 1100)
    expect(bSa.anzahlBelege).toBe(1)
    expect(bSa.produkte.map((p) => [p.name, p.verkauft])).toEqual([['Winti Burger', 1]])
  })
})

describe('berechneAbschluss – gemischter Tag', () => {
  const v1 = verkauf('a', SAMSTAG, 'bar_chf', [BURGER, DOSE], 2000) // 16.00, Rückgeld 4.00
  const v2 = verkauf('b', SAMSTAG, 'bar_chf', [DOENER], 1500, { spendeBehalten: true }) // Spende 3.00
  const v3 = verkauf('c', SAMSTAG, 'bar_eur', [{ ...BURGER, anzahl: 2 }], 3000) // 22.00, 30 EUR -> 27.00, Rückgeld 5.00
  const v4 = verkauf('d', SAMSTAG, 'bar_eur', [DOENER], 1500, { spendeBehalten: true }) // 15 EUR -> 13.50, Spende 1.50
  const v5 = verkauf('e', SAMSTAG, 'twint', [DOENER, DOSE], 2000) // 17.00, Spende 3.00
  const v6 = verkauf('f', SAMSTAG, 'twint', [BURGER], 1100)
  const v7 = verkauf('g', SAMSTAG, 'helfer', [BURGER, { ...DOSE, anzahl: 1 }], 0)
  const v8 = verkauf('h', SAMSTAG, 'bar_chf', [DOSE], 500) // storniert
  const st8 = storno(v8.verkauf, SAMSTAG)
  const alle = [v1, v2, v3, v4, v5, v6, v7, v8]

  it('Summen brutto, Storno als Gegenbuchung, Soll/Ist/Differenz', () => {
    const b = berechneAbschluss(input(SAMSTAG, alle, [st8], { nachdrucke: 2, istChfRappen: 25000, istEurCent: 4500, erstelltAm: '2026-09-19T22:00:00' }))
    expect(b.barEinnahmenChfRappen).toBe(1600 + 1200 + 500)
    expect(b.barSpendeChfRappen).toBe(300)
    expect(b.barEinnahmenEurCent).toBe(4500)
    expect(b.barEinnahmenEurChfRappen).toBe(2700 + 1350)
    expect(b.rueckgeldAusEurRappen).toBe(500)
    expect(b.barSpendeEurChfRappen).toBe(150)
    expect(b.twintUmsatzRappen).toBe(1700 + 1100)
    expect(b.twintStorniertRappen).toBe(0)
    expect(b.twintSpendeRappen).toBe(300)
    expect(b.storniAnzahl).toBe(1)
    expect(b.storniAuszahlungRappen).toBe(500)
    expect(b.helferessenStueck).toBe(2)
    expect(b.helferessenEntgangenRappen).toBe(1100 + 250)
    expect(b.nachdrucke).toBe(2)
    expect(b.sollChfRappen).toBe(20000 + 3300 + 300 - 500 - 500)
    expect(b.sollEurCent).toBe(4500)
    expect(b.istChfRappen).toBe(25000)
    expect(b.differenzChfRappen).toBe(25000 - b.sollChfRappen)
    expect(b.differenzEurCent).toBe(0)
    expect(b.anzahlBelege).toBe(7)
    expect(b.erstelltAm).toBe('2026-09-19T22:00:00')
  })

  it('Stück je Produkt: verkauft/helfer getrennt, Umsatz nur zahlart != helfer, ohne stornierte', () => {
    const b = berechneAbschluss(input(SAMSTAG, alle, [st8]))
    expect(b.produkte).toEqual([
      { produktId: 'doener', name: 'Döner Kebap', verkauft: 3, helfer: 0, umsatzRappen: 3600 },
      { produktId: 'dose', name: 'Getränk Dose', verkauft: 4, helfer: 1, umsatzRappen: 1000 },
      { produktId: 'burger', name: 'Winti Burger', verkauft: 4, helfer: 1, umsatzRappen: 4400 }
    ])
  })

  it('ignoriert Verkäufe und Storni anderer Kassentage', () => {
    const fremd = verkauf('x', SONNTAG, 'bar_chf', [BURGER], 1100)
    const fremdStorno = storno(fremd.verkauf, SONNTAG)
    const b = berechneAbschluss(input(SAMSTAG, [v1, fremd], [fremdStorno]))
    expect(b.barEinnahmenChfRappen).toBe(1600)
    expect(b.storniAnzahl).toBe(0)
    expect(b.anzahlBelege).toBe(1)
  })
})
