import { describe, expect, it } from 'vitest'
import { STANDARD_RASTER, waehleRaster } from './raster'

/** Breite/Hoehe einer Kachel fuer das gewaehlte Raster (Abstand wie in den Standardoptionen). */
function kachelVerhaeltnis(spalten: number, zeilenHoehe: number, breite: number): number {
  const kachelBreite = (breite - STANDARD_RASTER.abstand * (spalten - 1)) / spalten
  return kachelBreite / zeilenHoehe
}

describe('waehleRaster', () => {
  it('15 Produkte auf 1366 x 680: 5 oder 6 Spalten, Zeilenhoehe zwischen 180 und 230', () => {
    const r = waehleRaster(15, 1366, 680)
    expect([5, 6]).toContain(r.spalten)
    expect(r.zeilenHoehe).toBeGreaterThanOrEqual(180)
    expect(r.zeilenHoehe).toBeLessThanOrEqual(230)
    expect(r.zeilen).toBe(Math.ceil(15 / r.spalten))
  })

  it('15 Produkte auf 2000 x 1050: 5 bis 7 Spalten, Zeilenhoehe auf 260 gedeckelt, Verhaeltnis 1.0 bis 2.2', () => {
    const r = waehleRaster(15, 2000, 1050)
    expect(r.spalten).toBeGreaterThanOrEqual(5)
    expect(r.spalten).toBeLessThanOrEqual(7)
    expect(r.zeilenHoehe).toBe(260)
    const v = kachelVerhaeltnis(r.spalten, r.zeilenHoehe, 2000)
    expect(v).toBeGreaterThanOrEqual(1.0)
    expect(v).toBeLessThanOrEqual(2.2)
  })

  it('30 Produkte auf 1366 x 680: Zeilenhoehe mindestens 88 und alle Zeilen passen in 680 px', () => {
    const r = waehleRaster(30, 1366, 680)
    expect(r.zeilenHoehe).toBeGreaterThanOrEqual(88)
    expect(r.zeilen).toBe(Math.ceil(30 / r.spalten))
    expect(r.zeilen * r.zeilenHoehe + STANDARD_RASTER.abstand * (r.zeilen - 1)).toBeLessThanOrEqual(
      680
    )
  })

  it('4 Produkte auf 1366 x 680: Zeilenhoehe 260', () => {
    const r = waehleRaster(4, 1366, 680)
    expect(r.zeilenHoehe).toBe(260)
    expect(r.spalten).toBeGreaterThanOrEqual(STANDARD_RASTER.minSpalten)
    expect(r.spalten).toBeLessThanOrEqual(STANDARD_RASTER.maxSpalten)
  })

  it('0 Produkte: keine Ausnahme, minSpalten und eine Zeile', () => {
    expect(() => waehleRaster(0, 1366, 680)).not.toThrow()
    const r = waehleRaster(0, 1366, 680)
    expect(r.spalten).toBe(STANDARD_RASTER.minSpalten)
    expect(r.zeilen).toBe(1)
    expect(Number.isFinite(r.zeilenHoehe)).toBe(true)
  })

  it('Flaeche 0 x 0 oder unsinnige Werte: keine Ausnahme, Zeilenhoehe endlich', () => {
    for (const [n, b, h] of [
      [12, 0, 0],
      [12, -5, 10],
      [12, Number.NaN, 500],
      [Number.NaN, 800, 600]
    ]) {
      const r = waehleRaster(n, b, h)
      expect(Number.isFinite(r.zeilenHoehe)).toBe(true)
      expect(r.zeilenHoehe).toBeGreaterThanOrEqual(STANDARD_RASTER.minZeilenHoehe)
      expect(r.spalten).toBeGreaterThanOrEqual(STANDARD_RASTER.minSpalten)
    }
  })

  it('zu viele Produkte fuer die Hoehe: Zeilenhoehe bleibt bei minZeilenHoehe, die Spalte scrollt', () => {
    const r = waehleRaster(200, 1366, 680)
    expect(r.zeilenHoehe).toBe(STANDARD_RASTER.minZeilenHoehe)
    expect(r.zeilen * r.zeilenHoehe).toBeGreaterThan(680)
  })

  it('Gleichstand: weniger Spalten gewinnen', () => {
    // 2 Produkte auf 400 x 200 ohne Abstand: 1 Spalte -> Kachel 400 x 100 (Verhaeltnis 4),
    // 2 Spalten -> Kachel 200 x 200 (Verhaeltnis 1). Bei Zielverhaeltnis 2 sind beide
    // Bewertungen ln 2 -> Gleichstand, die kleinere Spaltenzahl gewinnt.
    const opt = {
      minSpalten: 1,
      maxSpalten: 2,
      abstand: 0,
      minZeilenHoehe: 1,
      maxZeilenHoehe: 1000,
      zielVerhaeltnis: 2
    }
    expect(waehleRaster(2, 400, 200, opt).spalten).toBe(1)
    // Bei Zielverhaeltnis 1.5 liegt 2 Spalten naeher dran
    expect(waehleRaster(2, 400, 200, { ...opt, zielVerhaeltnis: 1.5 }).spalten).toBe(2)
  })
})
