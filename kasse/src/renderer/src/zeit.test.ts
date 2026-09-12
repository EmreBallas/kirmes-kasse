import { describe, expect, it } from 'vitest'
import { datumAnzeige, lokalIso, uhrzeitAnzeige, uhrzeitMitSekunden } from './zeit'

describe('zeit', () => {
  const d = new Date(2026, 8, 19, 14, 32, 5) // Sa 19.09.2026 14:32:05 lokal

  it('lokalIso ohne Zeitzone', () => {
    expect(lokalIso(d)).toBe('2026-09-19T14:32:05')
  })

  it('Datum mit Wochentag', () => {
    expect(datumAnzeige(d)).toBe('Sa 19.09.2026')
  })

  it('Uhrzeit', () => {
    expect(uhrzeitAnzeige(d)).toBe('14:32')
    expect(uhrzeitMitSekunden(d)).toBe('14:32:05')
  })
})
