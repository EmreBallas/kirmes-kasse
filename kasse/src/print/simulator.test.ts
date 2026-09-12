import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DruckModell } from '@core/types'
import { baueBytes } from './escpos'
import {
  SCHNITT_ZEILE,
  SCHUBLADE_ZEILE,
  SimulatorTransport,
  dekodiereVorschau,
  sichererDateiname
} from './simulator'

const modell: DruckModell = {
  schublade: true,
  dokumente: [
    {
      zeilen: [
        { text: '2x', groesse: 'dreifach', ausrichtung: 'mitte' },
        { text: 'Dürüm', groesse: 'doppelt', ausrichtung: 'mitte' },
        { text: '' },
        { text: 'Sa 19.09.2026  14:32' },
        { text: 'K1-0042   Coupon 1/1' }
      ]
    },
    {
      zeilen: [
        { text: '  2 Dürüm                              CHF 24.00' },
        { text: '-'.repeat(48) },
        { text: 'TOTAL CHF 24.00', fett: true },
        { text: 'RÜCKGELD CHF 26.00', groesse: 'doppelt' },
        { text: 'K1-0042  14:32', ausrichtung: 'rechts' }
      ]
    }
  ]
}

describe('dekodiereVorschau (Round-Trip mit baueBytes)', () => {
  it('zeigt Schublade, Groessen, Ausrichtung und Schnitte', () => {
    const text = dekodiereVorschau(baueBytes(modell))
    const zeilen = text.split('\n')
    expect(zeilen[0]).toBe(SCHUBLADE_ZEILE)
    expect(zeilen[1]).toBe('[x3] ' + ' '.repeat(21) + '2x') // 48 - 2*3 = 42, / 2 = 21
    expect(zeilen[2]).toBe('[x2] ' + ' '.repeat(19) + 'Dürüm') // 48 - 5*2 = 38, / 2 = 19
    expect(zeilen[3]).toBe('')
    expect(zeilen[4]).toBe('Sa 19.09.2026  14:32')
    expect(zeilen[5]).toBe('K1-0042   Coupon 1/1')
    // 3 Leerzeilen Vorschub, dann Schnitt
    expect(zeilen.slice(6, 9)).toEqual(['', '', ''])
    expect(zeilen[9]).toBe(SCHNITT_ZEILE)
    // Bon
    expect(zeilen[10]).toBe('  2 Dürüm                              CHF 24.00')
    expect(zeilen[11]).toBe('-'.repeat(48))
    expect(zeilen[12]).toBe('TOTAL CHF 24.00')
    expect(zeilen[13]).toBe('[x2] RÜCKGELD CHF 26.00')
    expect(zeilen[14]).toBe(' '.repeat(48 - 14) + 'K1-0042  14:32')
    expect(zeilen.filter((z) => z === SCHNITT_ZEILE)).toHaveLength(2)
    expect(text.endsWith(SCHNITT_ZEILE + '\n')).toBe(true)
  })

  it('ohne Schublade kein [SCHUBLADE]', () => {
    const text = dekodiereVorschau(baueBytes({ ...modell, schublade: false }))
    expect(text).not.toContain(SCHUBLADE_ZEILE)
  })

  it('dekodiert tuerkische Zeichen zurueck', () => {
    const text = dekodiereVorschau(
      baueBytes({ schublade: false, dokumente: [{ zeilen: [{ text: 'Gözleme Çay İçli' }] }] })
    )
    expect(text.split('\n')[0]).toBe('Gözleme Çay İçli')
  })

  it('kommt mit unbekannten Steuerbytes und Text ohne LF am Ende zurecht', () => {
    const bytes = Uint8Array.from([0x1b, 0x40, 0x07, 0x41, 0x42])
    expect(dekodiereVorschau(bytes)).toBe('AB\n')
  })
})

describe('sichererDateiname', () => {
  it('ersetzt Sonderzeichen', () => {
    expect(sichererDateiname('Kasse beleg 1234abcd')).toBe('Kasse_beleg_1234abcd')
    expect(sichererDateiname('///')).toBe('auftrag')
  })
})

describe('SimulatorTransport', () => {
  let ordner: string
  beforeEach(async () => {
    ordner = join(await mkdtemp(join(tmpdir(), 'kasse-sim-test-')), 'simulator')
  })
  afterEach(async () => {
    await rm(join(ordner, '..'), { recursive: true, force: true })
  })

  it('schreibt .bin und .txt und meldet accepted', async () => {
    const transport = new SimulatorTransport({
      ordner,
      jetzt: () => new Date(2026, 8, 19, 14, 32, 5, 7)
    })
    expect(transport.name).toBe('simulator')
    const bytes = baueBytes(modell)
    const ergebnis = await transport.senden(bytes, 'Kasse beleg abcd1234')
    expect(ergebnis).toEqual({ ok: true, status: 'accepted', jobId: null, fehler: null })

    const dateien = (await readdir(ordner)).sort()
    expect(dateien).toEqual([
      '20260919-143205-007-Kasse_beleg_abcd1234.bin',
      '20260919-143205-007-Kasse_beleg_abcd1234.txt'
    ])
    const bin = await readFile(join(ordner, dateien[0]))
    expect(Buffer.from(bytes).equals(bin)).toBe(true)
    const txt = await readFile(join(ordner, dateien[1]), 'utf8')
    expect(txt).toBe(dekodiereVorschau(bytes))
    expect(txt).toContain('Dürüm')
    expect(txt).toContain(SCHNITT_ZEILE)
  })

  it('meldet error statt zu werfen, wenn der Ordner nicht anlegbar ist', async () => {
    // Datei statt Ordner als Ziel: mkdir schlaegt fehl
    const dateiAlsOrdner = join(ordner, '..', 'datei')
    await (await import('node:fs/promises')).writeFile(dateiAlsOrdner, 'x')
    const transport = new SimulatorTransport({ ordner: join(dateiAlsOrdner, 'unter') })
    const e = await transport.senden(Uint8Array.from([1]), 'x')
    expect(e.ok).toBe(false)
    expect(e.status).toBe('error')
    expect(e.fehler).toContain('Simulator')
  })
})
