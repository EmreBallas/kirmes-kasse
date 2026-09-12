import { describe, expect, it } from 'vitest'
import {
  chfZuEurCentAufgerundet,
  eurZuChfRappen,
  formatAbzug,
  formatChf,
  formatEur,
  formatKurs,
  parseBetrag,
  rabattBetrag,
  rundeAb5Rappen
} from './geld'

describe('formatChf / formatEur', () => {
  it('formatiert Rappen mit zwei Nachkommastellen', () => {
    expect(formatChf(7500)).toBe('75.00')
    expect(formatChf(5)).toBe('0.05')
    expect(formatChf(0)).toBe('0.00')
    expect(formatChf(1205)).toBe('12.05')
    expect(formatChf(100000)).toBe('1000.00')
  })
  it('formatiert negative Beträge (Differenz im Abschluss)', () => {
    expect(formatChf(-150)).toBe('-1.50')
    expect(formatChf(-5)).toBe('-0.05')
  })
  it('formatiert EUR gleich', () => {
    expect(formatEur(2000)).toBe('20.00')
    expect(formatEur(1300)).toBe('13.00')
  })
})

describe('formatAbzug', () => {
  it('zeigt Abzüge mit Minus', () => {
    expect(formatAbzug(500)).toBe('-5.00')
    expect(formatAbzug(1700)).toBe('-17.00')
    expect(formatAbzug(5)).toBe('-0.05')
  })
  it('zeigt 0 und -0 ohne Minus (kein "-0.00")', () => {
    expect(formatAbzug(0)).toBe('0.00')
    expect(formatAbzug(-0)).toBe('0.00')
    expect(formatAbzug(0.2)).toBe('0.00')
  })
  it('kehrt negative Abzüge um (Gutschrift)', () => {
    expect(formatAbzug(-150)).toBe('1.50')
  })
})

describe('formatKurs', () => {
  it('zeigt 0.90 für 9000 und 0.93 für 9300', () => {
    expect(formatKurs(9000)).toBe('0.90')
    expect(formatKurs(9300)).toBe('0.93')
    expect(formatKurs(10000)).toBe('1.00')
  })
  it('zeigt krumme Kurse mit vier Stellen', () => {
    expect(formatKurs(9250)).toBe('0.9250')
  })
})

describe('rundeAb5Rappen', () => {
  it('rundet auf 5 Rappen ab', () => {
    expect(rundeAb5Rappen(651)).toBe(650)
    expect(rundeAb5Rappen(1209)).toBe(1205)
    expect(rundeAb5Rappen(1800)).toBe(1800)
    expect(rundeAb5Rappen(4)).toBe(0)
    expect(rundeAb5Rappen(0)).toBe(0)
  })
  it('lehnt Fliesskomma ab', () => {
    expect(() => rundeAb5Rappen(12.5)).toThrow()
  })
})

describe('eurZuChfRappen', () => {
  it('Wächter-Tests aus der Roadmap', () => {
    expect(eurZuChfRappen(2000, 9000)).toBe(1800)
    expect(eurZuChfRappen(700, 9300)).toBe(650) // 651 -> 650
    expect(eurZuChfRappen(1300, 9300)).toBe(1205) // 1209 -> 1205
  })
  it('krumme Cent-Beträge', () => {
    expect(eurZuChfRappen(1, 9000)).toBe(0) // 0.9 Rappen -> 0
    expect(eurZuChfRappen(999, 9000)).toBe(895) // 899.1 -> 899 -> 895
    expect(eurZuChfRappen(0, 9000)).toBe(0)
  })
  it('lehnt ungültige Kurse und negative Beträge ab', () => {
    expect(() => eurZuChfRappen(100, 0)).toThrow()
    expect(() => eurZuChfRappen(100, -9000)).toThrow()
    expect(() => eurZuChfRappen(-100, 9000)).toThrow()
    expect(() => eurZuChfRappen(10.5, 9000)).toThrow()
  })
})

describe('chfZuEurCentAufgerundet', () => {
  it('rundet auf 10 Cent auf', () => {
    expect(chfZuEurCentAufgerundet(1200, 9300)).toBe(1300) // 12.903 -> 13.00
    expect(chfZuEurCentAufgerundet(500, 9000)).toBe(560) // 5.556 -> 5.60
    expect(chfZuEurCentAufgerundet(1200, 9000)).toBe(1340) // 13.333 -> 13.40
  })
  it('exakte Werte werden nicht aufgerundet', () => {
    expect(chfZuEurCentAufgerundet(900, 9000)).toBe(1000)
    expect(chfZuEurCentAufgerundet(0, 9000)).toBe(0)
  })
  it('lehnt ungültigen Kurs ab', () => {
    expect(() => chfZuEurCentAufgerundet(1200, 0)).toThrow()
  })
})

describe('parseBetrag', () => {
  it('liest Punkt, Komma und ganze Zahlen', () => {
    expect(parseBetrag('12.5')).toBe(1250)
    expect(parseBetrag('12,50')).toBe(1250)
    expect(parseBetrag('12')).toBe(1200)
    expect(parseBetrag('0.05')).toBe(5)
    expect(parseBetrag('.5')).toBe(50)
    expect(parseBetrag('12.')).toBe(1200)
    expect(parseBetrag(' 20 ')).toBe(2000)
  })
  it("liest Tausendertrennzeichen (1'000)", () => {
    expect(parseBetrag("1'000")).toBe(100000)
    expect(parseBetrag("1'000.50")).toBe(100050)
  })
  it('lehnt ungültige Eingaben ab', () => {
    expect(parseBetrag('abc')).toBeNull()
    expect(parseBetrag('')).toBeNull()
    expect(parseBetrag('-5')).toBeNull()
    expect(parseBetrag('12.345')).toBeNull()
    expect(parseBetrag('1.2.3')).toBeNull()
    expect(parseBetrag('.')).toBeNull()
  })
})

describe('rabattBetrag – Beleg-Rabatt auf die ganze Zwischensumme', () => {
  it('50 Prozent: halbiert und auf 5 Rappen abgerundet', () => {
    expect(rabattBetrag(2700, 50)).toEqual({ total: 1350, rabatt: 1350 })
    expect(rabattBetrag(2705, 50)).toEqual({ total: 1350, rabatt: 1355 }) // 13.525 -> 13.50
    expect(rabattBetrag(500, 50)).toEqual({ total: 250, rabatt: 250 })
    expect(rabattBetrag(2505, 50)).toEqual({ total: 1250, rabatt: 1255 }) // 12.525 -> 12.50
  })
  it('andere Sätze und 0 Prozent', () => {
    expect(rabattBetrag(1000, 20)).toEqual({ total: 800, rabatt: 200 })
    expect(rabattBetrag(2700, 0)).toEqual({ total: 2700, rabatt: 0 })
    expect(rabattBetrag(0, 50)).toEqual({ total: 0, rabatt: 0 })
    expect(rabattBetrag(1000, 99)).toEqual({ total: 10, rabatt: 990 })
    expect(rabattBetrag(2700, 1)).toEqual({ total: 2670, rabatt: 30 }) // 26.73 -> 26.70
  })
  it('Summe bleibt erhalten und total ist immer ein 5-Rappen-Betrag', () => {
    for (let zwischensumme = 0; zwischensumme <= 5000; zwischensumme += 5) {
      const r = rabattBetrag(zwischensumme, 50)
      expect(r.total + r.rabatt).toBe(zwischensumme)
      expect(r.total % 5).toBe(0)
      expect(r.total).toBeLessThanOrEqual(zwischensumme)
    }
  })
  it('wirft bei ungültigem Satz oder ungültiger Zwischensumme', () => {
    expect(() => rabattBetrag(1000, 100)).toThrow()
    expect(() => rabattBetrag(1000, -1)).toThrow()
    expect(() => rabattBetrag(1000, 12.5)).toThrow()
    expect(() => rabattBetrag(1000.5, 50)).toThrow()
    expect(() => rabattBetrag(-100, 50)).toThrow()
  })
})
