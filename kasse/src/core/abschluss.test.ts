import { describe, expect, it } from 'vitest'
import { berechneAbschluss, type AbschlussInput } from './abschluss'
import type { HelferSaldo, HelferZahlung, Kassentag, Position, Spende, SpendeTyp, Storno, Verkauf, Zahlart, Zahlung } from './types'
import { eurZuChfRappen, rabattBetrag } from './geld'
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
  opts: { kurs?: number; spendeBehalten?: boolean; zeit?: string; rabattProzent?: number; helferName?: string } = {}
): { verkauf: Verkauf; positionen: Position[]; zahlung: Zahlung } {
  const zwischensumme = artikel.reduce((s, a) => s + a.preis * a.anzahl, 0)
  // Wie der Server: Rabatt auf den ganzen Beleg (auch bei Helfer); Positionen behalten volle Preise.
  const rabattProzent = opts.rabattProzent ?? 0
  const r = rabattBetrag(zwischensumme, rabattProzent)
  // Helfer «später zahlen»: der Server speichert das volle (rabattierte) Total als Schuld
  const totalRappen = r.total
  // Helfer «später zahlen» braucht immer einen Namen; Tests ohne Namen bekommen einen Standard
  const helferName = opts.helferName ?? (zahlart === 'helfer' ? 'Helfer Test' : null)
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
      rabattProzent: r.rabatt === 0 ? 0 : rabattProzent,
      rabattRappen: r.rabatt,
      helferName,
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

/** Separat erfasste Spende wie der Server sie anlegt (CHF-Gegenwert bei EUR auf 5 Rappen abgerundet). */
function spende(
  id: string,
  tag: Kassentag,
  typ: SpendeTyp,
  betrag: number,
  opts: { verkaufId?: string; kurs?: number; storniert?: boolean } = {}
): Spende {
  const kurs = typ === 'bar_eur' ? (opts.kurs ?? 9000) : null
  return {
    id,
    kassentagId: tag.id,
    verkaufId: opts.verkaufId ?? null,
    zeit: `${tag.datum}T12:05:00`,
    typ,
    betrag,
    kursX10000: kurs,
    betragChfRappen: kurs === null ? betrag : eurZuChfRappen(betrag, kurs),
    storniertAm: opts.storniert === true ? `${tag.datum}T12:06:00` : null
  }
}

/** Helfer-Zahlung wie der Server sie anlegt (CHF-Gegenwert bei EUR auf 5 Rappen abgerundet). */
function helferZahlung(
  id: string,
  tag: Kassentag,
  helferName: string,
  typ: SpendeTyp,
  betrag: number,
  opts: { kurs?: number; storniert?: boolean } = {}
): HelferZahlung {
  const kurs = typ === 'bar_eur' ? (opts.kurs ?? 9000) : null
  return {
    id,
    kassentagId: tag.id,
    helferName,
    zeit: `${tag.datum}T18:00:00`,
    typ,
    betrag,
    kursX10000: kurs,
    betragChfRappen: kurs === null ? betrag : eurZuChfRappen(betrag, kurs),
    storniertAm: opts.storniert === true ? `${tag.datum}T18:01:00` : null
  }
}

function saldo(name: string, offenRappen: number, verkaeufeAnzahl = 1): HelferSaldo {
  return { name, offenRappen, verkaeufeAnzahl, letzteZeit: '2026-09-19T12:00:00' }
}

function input(tag: Kassentag, vs: ReturnType<typeof verkauf>[], storni: Storno[] = [], rest: Partial<AbschlussInput> = {}): AbschlussInput {
  return {
    kassentag: tag,
    verkaeufe: vs.map((v) => v.verkauf),
    positionen: vs.flatMap((v) => v.positionen),
    zahlungen: vs.map((v) => v.zahlung),
    storni,
    spenden: [],
    helferZahlungen: [],
    helferSalden: [],
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

  it('Helfer (später zahlen) storniert -> Auszahlung 0, Soll unverändert, Helferessen zählen nicht', () => {
    const v = verkauf('4', SAMSTAG, 'helfer', [BURGER], 0)
    expect(v.verkauf.totalRappen).toBe(1100) // Schuld in voller Höhe gespeichert
    const st = storno(v.verkauf, SAMSTAG, 0)
    const b = berechneAbschluss(input(SAMSTAG, [v], [st]))
    expect(b.storniAnzahl).toBe(1)
    expect(b.storniAuszahlungRappen).toBe(0)
    expect(b.sollChfRappen).toBe(20000)
    // Testfall 28: Helferessen-Stück und -Betrag sinken, konsistent zur Helfer-Spalte der Produktzeilen
    expect(b.helferessenStueck).toBe(0)
    expect(b.helferessenBetragRappen).toBe(0)
    expect(b.helferSpaeterRappen).toBe(0)
    expect(b.helferSofortRappen).toBe(0)
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

describe('berechneAbschluss – separate Spenden (nachträglich erfasst)', () => {
  it('Rückgeld als Spende: Verkauf 98.00 bar, 100 gegeben, danach Spende 2.00 -> Soll = Start + 98 + 2', () => {
    const v = verkauf('s1', SAMSTAG, 'bar_chf', [{ produktId: 'menu', name: 'Menü', preis: 9800, anzahl: 1 }], 10000)
    expect(v.zahlung.rueckgeldChfRappen).toBe(200)
    const sp = spende('sp1', SAMSTAG, 'bar_chf', 200, { verkaufId: 's1' })
    const b = berechneAbschluss(input(SAMSTAG, [v], [], { spenden: [sp] }))
    expect(b.barEinnahmenChfRappen).toBe(9800)
    expect(b.barSpendeChfRappen).toBe(200)
    expect(b.sollChfRappen).toBe(20000 + 9800 + 200)
    expect(b.sollEurCent).toBe(0)
    expect(b.spendenSeparatAnzahl).toBe(1)
    expect(b.spendenSeparatChfRappen).toBe(200)
    expect(b.anzahlBelege).toBe(1) // Spende ist kein Beleg
  })

  it('freie Twint-Spende 5.00 -> Twint-Spende 5.00, Soll CHF unverändert', () => {
    const sp = spende('sp2', SAMSTAG, 'twint', 500)
    const b = berechneAbschluss(input(SAMSTAG, [], [], { spenden: [sp] }))
    expect(b.twintSpendeRappen).toBe(500)
    expect(b.twintUmsatzRappen).toBe(0)
    expect(b.barSpendeChfRappen).toBe(0)
    expect(b.sollChfRappen).toBe(20000)
    expect(b.sollEurCent).toBe(0)
    expect(b.spendenSeparatAnzahl).toBe(1)
    expect(b.spendenSeparatChfRappen).toBe(500)
  })

  it('EUR-Spende 5 EUR bei Kurs 0.90 -> 4.50 CHF, Soll EUR + 5.00, Stück EUR aus Verkäufen unverändert', () => {
    const sp = spende('sp3', SAMSTAG, 'bar_eur', 500)
    expect(sp.betragChfRappen).toBe(450)
    const b = berechneAbschluss(input(SAMSTAG, [], [], { spenden: [sp] }))
    expect(b.barSpendeEurChfRappen).toBe(450)
    expect(b.barEinnahmenEurCent).toBe(0) // nur Verkäufe
    expect(b.barEinnahmenEurChfRappen).toBe(0)
    expect(b.sollEurCent).toBe(500)
    expect(b.sollChfRappen).toBe(20000) // EUR-Spende bleibt im EUR-Fach
    expect(b.spendenSeparatChfRappen).toBe(450)
  })

  it('EUR-Spende mit krummem Gegenwert wird auf 5 Rappen abgerundet (1.23 EUR -> 1.10 CHF)', () => {
    const sp = spende('sp3b', SAMSTAG, 'bar_eur', 123)
    expect(sp.betragChfRappen).toBe(110)
    const b = berechneAbschluss(input(SAMSTAG, [], [], { spenden: [sp] }))
    expect(b.barSpendeEurChfRappen).toBe(110)
    expect(b.sollEurCent).toBe(123)
  })

  it('stornierte Spende zählt nirgends', () => {
    const aktiv = spende('sp4', SAMSTAG, 'bar_chf', 300)
    const storniert = spende('sp5', SAMSTAG, 'bar_chf', 1000, { storniert: true })
    const storniertTwint = spende('sp6', SAMSTAG, 'twint', 700, { storniert: true })
    const storniertEur = spende('sp7', SAMSTAG, 'bar_eur', 500, { storniert: true })
    const b = berechneAbschluss(input(SAMSTAG, [], [], { spenden: [aktiv, storniert, storniertTwint, storniertEur] }))
    expect(b.barSpendeChfRappen).toBe(300)
    expect(b.twintSpendeRappen).toBe(0)
    expect(b.barSpendeEurChfRappen).toBe(0)
    expect(b.sollChfRappen).toBe(20300)
    expect(b.sollEurCent).toBe(0)
    expect(b.spendenSeparatAnzahl).toBe(1)
    expect(b.spendenSeparatChfRappen).toBe(300)
  })

  it('Spenden anderer Kassentage werden ignoriert', () => {
    const fremd = spende('sp8', SONNTAG, 'bar_chf', 900)
    const b = berechneAbschluss(input(SAMSTAG, [], [], { spenden: [fremd] }))
    expect(b.barSpendeChfRappen).toBe(0)
    expect(b.sollChfRappen).toBe(20000)
    expect(b.spendenSeparatAnzahl).toBe(0)
    expect(b.spendenSeparatChfRappen).toBe(0)
  })

  it('separate Spenden addieren sich zu "stimmt so"-Spenden aus Verkäufen; Bericht-Felder zählen nur separate', () => {
    const v = verkauf('s9', SAMSTAG, 'bar_chf', [DOENER], 1500, { spendeBehalten: true }) // Spende 3.00 im Beleg
    const spChf = spende('sp9', SAMSTAG, 'bar_chf', 200)
    const spTwint = spende('sp10', SAMSTAG, 'twint', 500)
    const spEur = spende('sp11', SAMSTAG, 'bar_eur', 500)
    const b = berechneAbschluss(input(SAMSTAG, [v], [], { spenden: [spChf, spTwint, spEur] }))
    expect(b.barSpendeChfRappen).toBe(300 + 200)
    expect(b.twintSpendeRappen).toBe(500)
    expect(b.barSpendeEurChfRappen).toBe(450)
    expect(b.sollChfRappen).toBe(20000 + 1200 + 300 + 200)
    expect(b.sollEurCent).toBe(500)
    expect(b.spendenSeparatAnzahl).toBe(3)
    expect(b.spendenSeparatChfRappen).toBe(200 + 500 + 450)
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
    expect(b.helferessenBetragRappen).toBe(1100 + 250)
    expect(b.helferSpaeterRappen).toBe(1100 + 250)
    expect(b.helferSofortRappen).toBe(0)
    expect(b.helferZahlungenBarChfRappen).toBe(0)
    expect(b.helferZahlungenEurCent).toBe(0)
    expect(b.helferZahlungenEurChfRappen).toBe(0)
    expect(b.helferZahlungenTwintRappen).toBe(0)
    expect(b.helferOffenGesamtRappen).toBe(0)
    expect(b.helferOffen).toEqual([])
    expect(b.nachdrucke).toBe(2)
    expect(b.spendenSeparatAnzahl).toBe(0)
    expect(b.spendenSeparatChfRappen).toBe(0)
    expect(b.sollChfRappen).toBe(20000 + 3300 + 300 - 500 - 500)
    expect(b.sollEurCent).toBe(4500)
    expect(b.istChfRappen).toBe(25000)
    expect(b.differenzChfRappen).toBe(25000 - b.sollChfRappen)
    expect(b.differenzEurCent).toBe(0)
    expect(b.anzahlBelege).toBe(7)
    expect(b.erstelltAm).toBe('2026-09-19T22:00:00')
  })

  it('Stück je Produkt: verkauft/helfer getrennt, Umsatz beide zusammen zu vollen Preisen, ohne stornierte', () => {
    const b = berechneAbschluss(input(SAMSTAG, alle, [st8]))
    expect(b.produkte).toEqual([
      { produktId: 'doener', name: 'Döner Kebap', verkauft: 3, helfer: 0, umsatzRappen: 3600 },
      { produktId: 'dose', name: 'Getränk Dose', verkauft: 4, helfer: 1, umsatzRappen: 5 * 250 },
      { produktId: 'burger', name: 'Winti Burger', verkauft: 4, helfer: 1, umsatzRappen: 5 * 1100 }
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

describe('berechneAbschluss – Beleg-Rabatte', () => {
  const MENUE: Artikel = { produktId: 'menue', name: 'Menü', preis: 2700, anzahl: 1 }

  it('Bar-Beleg mit 50% Rabatt: Einnahmen rabattiert, Rabattzeile ausgewiesen, Soll = Startgeld + kassiert', () => {
    const v = verkauf('r1', SAMSTAG, 'bar_chf', [MENUE], 1350, { rabattProzent: 50 })
    expect(v.verkauf.totalRappen).toBe(1350)
    expect(v.verkauf.rabattRappen).toBe(1350)
    const b = berechneAbschluss(input(SAMSTAG, [v]))
    expect(b.barEinnahmenChfRappen).toBe(1350)
    expect(b.rabatteAnzahl).toBe(1)
    expect(b.rabatteRappen).toBe(1350)
    expect(b.sollChfRappen).toBe(20000 + 1350)
    expect(b.sollEurCent).toBe(0)
    // Umsatz je Produkt bleibt brutto zu vollen Preisen; die Rabattzeile erklärt die Differenz
    expect(b.produkte).toEqual([{ produktId: 'menue', name: 'Menü', verkauft: 1, helfer: 0, umsatzRappen: 2700 }])
  })

  it('stornierter Rabattbeleg zählt nicht in der Rabattzeile', () => {
    const v = verkauf('r2', SAMSTAG, 'bar_chf', [MENUE], 1350, { rabattProzent: 50 })
    const st = storno(v.verkauf, SAMSTAG)
    const b = berechneAbschluss(input(SAMSTAG, [v], [st]))
    expect(b.rabatteAnzahl).toBe(0)
    expect(b.rabatteRappen).toBe(0)
    expect(b.barEinnahmenChfRappen).toBe(1350) // brutto
    expect(b.storniAuszahlungRappen).toBe(1350) // ausbezahlt wird der kassierte Betrag
    expect(b.sollChfRappen).toBe(20000)
  })

  it('mehrere Belege: Anzahl und Summe nur der rabattierten', () => {
    const v1 = verkauf('r3', SAMSTAG, 'bar_chf', [MENUE], 1350, { rabattProzent: 50 })
    const v2 = verkauf('r4', SAMSTAG, 'twint', [BURGER], 550, { rabattProzent: 50 }) // 11.00 -> 5.50
    const v3 = verkauf('r5', SAMSTAG, 'bar_chf', [BURGER], 1100) // ohne Rabatt
    expect(v2.verkauf.totalRappen).toBe(550)
    const b = berechneAbschluss(input(SAMSTAG, [v1, v2, v3]))
    expect(b.rabatteAnzahl).toBe(2)
    expect(b.rabatteRappen).toBe(1350 + 550)
    expect(b.twintUmsatzRappen).toBe(550)
    expect(b.sollChfRappen).toBe(20000 + 1350 + 1100)
    expect(b.anzahlBelege).toBe(3)
  })

  it('Helfer-Beleg (später zahlen) mit Rabatt: Schuld rabattiert, Rabattzeile zählt, Soll unverändert', () => {
    const v = verkauf('r6', SAMSTAG, 'helfer', [MENUE], 0, { rabattProzent: 50 })
    expect(v.verkauf.totalRappen).toBe(1350)
    expect(v.verkauf.rabattProzent).toBe(50)
    expect(v.verkauf.rabattRappen).toBe(1350)
    const b = berechneAbschluss(input(SAMSTAG, [v]))
    expect(b.rabatteAnzahl).toBe(1)
    expect(b.rabatteRappen).toBe(1350)
    expect(b.helferessenBetragRappen).toBe(1350) // die rabattierte Schuld
    expect(b.helferSpaeterRappen).toBe(1350)
    expect(b.sollChfRappen).toBe(20000)
    // Umsatz je Produkt bleibt brutto zu vollen Preisen, auch in der Helfer-Spalte
    expect(b.produkte).toEqual([{ produktId: 'menue', name: 'Menü', verkauft: 0, helfer: 1, umsatzRappen: 2700 }])
  })

  it('Bar-EUR mit Rabatt: Rückgeld und Soll rechnen mit dem rabattierten Total', () => {
    const v = verkauf('r7', SAMSTAG, 'bar_eur', [MENUE], 2000, { rabattProzent: 50 }) // 20 EUR -> 18.00 CHF
    expect(v.verkauf.totalRappen).toBe(1350)
    expect(v.zahlung.rueckgeldChfRappen).toBe(450)
    const b = berechneAbschluss(input(SAMSTAG, [v]))
    expect(b.rabatteRappen).toBe(1350)
    expect(b.sollChfRappen).toBe(20000 - 450)
    expect(b.sollEurCent).toBe(2000)
  })

  it('Veranstaltung wird durchgereicht, leer bleibt weg', () => {
    const ohne = berechneAbschluss(input(SAMSTAG, []))
    expect(ohne.veranstaltung).toBeUndefined()
    const leer = berechneAbschluss(input(SAMSTAG, [], [], { veranstaltung: '   ' }))
    expect(leer.veranstaltung).toBeUndefined()
    const mit = berechneAbschluss(input(SAMSTAG, [], [], { veranstaltung: ' Dorffest Musterhausen ' }))
    expect(mit.veranstaltung).toBe('Dorffest Musterhausen')
  })
})

describe('berechneAbschluss – Helfer zahlen ihr Essen (sofort oder später)', () => {
  it('Helfer später zahlen 12.00 -> Helferessen 12.00 = später 12.00, Bar-Einnahmen und Soll unverändert', () => {
    const v = verkauf('h1', SAMSTAG, 'helfer', [DOENER], 0, { helferName: 'Anna' })
    expect(v.verkauf.totalRappen).toBe(1200)
    expect(v.zahlung.gegeben).toBe(0)
    const b = berechneAbschluss(input(SAMSTAG, [v]))
    expect(b.helferessenStueck).toBe(1)
    expect(b.helferessenBetragRappen).toBe(1200)
    expect(b.helferSpaeterRappen).toBe(1200)
    expect(b.helferSofortRappen).toBe(0)
    expect(b.barEinnahmenChfRappen).toBe(0)
    expect(b.twintUmsatzRappen).toBe(0)
    expect(b.sollChfRappen).toBe(20000)
    expect(b.sollEurCent).toBe(0)
    expect(b.anzahlBelege).toBe(1)
  })

  it('Helfer gleich zahlen bar 12.00 -> in Bar-Einnahmen und Soll enthalten, Helferessen sofort 12.00', () => {
    const v = verkauf('h2', SAMSTAG, 'bar_chf', [DOENER], 2000, { helferName: 'Anna' })
    const b = berechneAbschluss(input(SAMSTAG, [v]))
    expect(b.barEinnahmenChfRappen).toBe(1200)
    expect(b.sollChfRappen).toBe(20000 + 1200)
    expect(b.helferessenStueck).toBe(1)
    expect(b.helferessenBetragRappen).toBe(1200)
    expect(b.helferSofortRappen).toBe(1200)
    expect(b.helferSpaeterRappen).toBe(0)
  })

  it('Helfer gleich zahlen per Twint und EUR: Helferessen sofort, Geldsummen wie normale Verkäufe', () => {
    const twint = verkauf('h3', SAMSTAG, 'twint', [BURGER], 1100, { helferName: 'Beat' })
    const eur = verkauf('h4', SAMSTAG, 'bar_eur', [DOENER], 2000, { helferName: 'Cem' }) // 18.00 CHF, Rückgeld 6.00
    const b = berechneAbschluss(input(SAMSTAG, [twint, eur]))
    expect(b.twintUmsatzRappen).toBe(1100)
    expect(b.barEinnahmenEurCent).toBe(2000)
    expect(b.rueckgeldAusEurRappen).toBe(600)
    expect(b.helferessenStueck).toBe(2)
    expect(b.helferessenBetragRappen).toBe(1100 + 1200)
    expect(b.helferSofortRappen).toBe(2300)
    expect(b.helferSpaeterRappen).toBe(0)
    expect(b.sollChfRappen).toBe(20000 - 600)
    expect(b.sollEurCent).toBe(2000)
  })

  it('Helfer-Zahlung bar CHF 12.00 heute -> Soll CHF + 12.00, Zeile Helfer-Zahlungen Bar CHF', () => {
    const z = helferZahlung('hz1', SAMSTAG, 'Anna', 'bar_chf', 1200)
    const b = berechneAbschluss(input(SAMSTAG, [], [], { helferZahlungen: [z] }))
    expect(b.helferZahlungenBarChfRappen).toBe(1200)
    expect(b.helferZahlungenTwintRappen).toBe(0)
    expect(b.sollChfRappen).toBe(20000 + 1200)
    expect(b.sollEurCent).toBe(0)
    expect(b.barEinnahmenChfRappen).toBe(0) // keine Verkaufs-Einnahme
    expect(b.barSpendeChfRappen).toBe(0) // keine Spende
    expect(b.anzahlBelege).toBe(0) // kein Beleg
  })

  it('Helfer-Zahlung Twint -> Soll unverändert, Zeile Helfer-Zahlungen Twint', () => {
    const z = helferZahlung('hz2', SAMSTAG, 'Anna', 'twint', 1200)
    const b = berechneAbschluss(input(SAMSTAG, [], [], { helferZahlungen: [z] }))
    expect(b.helferZahlungenTwintRappen).toBe(1200)
    expect(b.helferZahlungenBarChfRappen).toBe(0)
    expect(b.sollChfRappen).toBe(20000)
    expect(b.sollEurCent).toBe(0)
    expect(b.twintUmsatzRappen).toBe(0)
  })

  it('Helfer-Zahlung 10 EUR bei 0.90 -> Soll EUR + 10.00, CHF-Gegenwert 9.00, Soll CHF unverändert', () => {
    const z = helferZahlung('hz3', SAMSTAG, 'Anna', 'bar_eur', 1000)
    expect(z.betragChfRappen).toBe(900)
    const b = berechneAbschluss(input(SAMSTAG, [], [], { helferZahlungen: [z] }))
    expect(b.helferZahlungenEurCent).toBe(1000)
    expect(b.helferZahlungenEurChfRappen).toBe(900)
    expect(b.sollEurCent).toBe(1000)
    expect(b.sollChfRappen).toBe(20000)
    expect(b.barEinnahmenEurCent).toBe(0) // Stück EUR aus Verkäufen unverändert
  })

  it('stornierte Helfer-Zahlung und Zahlungen anderer Kassentage zählen nicht', () => {
    const storniert = helferZahlung('hz4', SAMSTAG, 'Anna', 'bar_chf', 1200, { storniert: true })
    const fremd = helferZahlung('hz5', SONNTAG, 'Anna', 'bar_chf', 500)
    const b = berechneAbschluss(input(SAMSTAG, [], [], { helferZahlungen: [storniert, fremd] }))
    expect(b.helferZahlungenBarChfRappen).toBe(0)
    expect(b.sollChfRappen).toBe(20000)
  })

  it('Teilzahlung: Helfer schuldet 12.00, zahlt 5.00 bar -> Soll + 5.00, Saldo vom Server übernommen', () => {
    const v = verkauf('h5', SAMSTAG, 'helfer', [DOENER], 0, { helferName: 'Anna' })
    const z = helferZahlung('hz6', SAMSTAG, 'Anna', 'bar_chf', 500)
    const b = berechneAbschluss(input(SAMSTAG, [v], [], { helferZahlungen: [z], helferSalden: [saldo('Anna', 700)] }))
    expect(b.helferSpaeterRappen).toBe(1200)
    expect(b.helferZahlungenBarChfRappen).toBe(500)
    expect(b.sollChfRappen).toBe(20000 + 500)
    expect(b.helferOffenGesamtRappen).toBe(700)
    expect(b.helferOffen).toEqual([saldo('Anna', 700)])
  })

  it('stornierter Helfer-Verkauf (später zahlen) zählt nicht bei Helferessen, Storno-Auszahlung 0', () => {
    const v = verkauf('h6', SAMSTAG, 'helfer', [BURGER], 0, { helferName: 'Beat' })
    const bleibt = verkauf('h7', SAMSTAG, 'helfer', [DOENER], 0, { helferName: 'Beat' })
    const st = storno(v.verkauf, SAMSTAG, 0)
    const b = berechneAbschluss(input(SAMSTAG, [v, bleibt], [st]))
    expect(b.helferessenStueck).toBe(1)
    expect(b.helferessenBetragRappen).toBe(1200)
    expect(b.helferSpaeterRappen).toBe(1200)
    expect(b.storniAuszahlungRappen).toBe(0)
    expect(b.sollChfRappen).toBe(20000)
    expect(b.produkte).toEqual([{ produktId: 'doener', name: 'Döner Kebap', verkauft: 0, helfer: 1, umsatzRappen: 1200 }])
  })

  it('stornierter sofort bezahlter Helfer-Verkauf: wie normaler Storno (brutto + Auszahlung), Helferessen sinken', () => {
    const v = verkauf('h8', SAMSTAG, 'bar_chf', [BURGER], 1100, { helferName: 'Beat' })
    const st = storno(v.verkauf, SAMSTAG)
    const b = berechneAbschluss(input(SAMSTAG, [v], [st]))
    expect(b.barEinnahmenChfRappen).toBe(1100)
    expect(b.storniAuszahlungRappen).toBe(1100)
    expect(b.sollChfRappen).toBe(20000)
    expect(b.helferessenStueck).toBe(0)
    expect(b.helferSofortRappen).toBe(0)
  })

  it('offene Helfer-Schulden: nur Saldo > 0, nach Name sortiert, Gesamtsumme', () => {
    const salden = [saldo('Zoe', 1200, 1), saldo('anna', 0, 1), saldo('Beat', 550, 2), saldo('Cem', -100, 1)]
    const b = berechneAbschluss(input(SAMSTAG, [], [], { helferSalden: salden }))
    expect(b.helferOffen.map((s) => s.name)).toEqual(['Beat', 'Zoe'])
    expect(b.helferOffenGesamtRappen).toBe(1200 + 550)
    expect(b.helferOffen[0]).toEqual(saldo('Beat', 550, 2))
  })

  it('Produktzeile: Spalte Helfer zählt sofort und später, verkauft die übrigen, Umsatz alle zu vollen Preisen', () => {
    const normal = verkauf('h9', SAMSTAG, 'bar_chf', [DOENER], 1200)
    const sofort = verkauf('h10', SAMSTAG, 'twint', [DOENER], 1200, { helferName: 'Anna' })
    const spaeter = verkauf('h11', SAMSTAG, 'helfer', [{ ...DOENER, anzahl: 2 }], 0, { helferName: 'Beat' })
    const b = berechneAbschluss(input(SAMSTAG, [normal, sofort, spaeter]))
    expect(b.produkte).toEqual([{ produktId: 'doener', name: 'Döner Kebap', verkauft: 1, helfer: 3, umsatzRappen: 4 * 1200 }])
    expect(b.helferessenStueck).toBe(3)
    expect(b.helferessenBetragRappen).toBe(1200 + 2400)
    expect(b.helferSofortRappen).toBe(1200)
    expect(b.helferSpaeterRappen).toBe(2400)
  })

  it('älterer Helfer-Beleg ohne Namen (zahlart helfer, helferName null) zählt weiterhin als «später zahlen»', () => {
    const v = verkauf('h12', SAMSTAG, 'helfer', [BURGER], 0)
    v.verkauf.helferName = null
    const b = berechneAbschluss(input(SAMSTAG, [v]))
    expect(b.helferessenStueck).toBe(1)
    expect(b.helferSpaeterRappen).toBe(1100)
    expect(b.produkte[0]?.helfer).toBe(1)
  })
})
