import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import iconv from 'iconv-lite'
import { describe, expect, it } from 'vitest'
import type { DruckModell } from '@core/types'
import { BEFEHL, CODEPAGE, baueBytes, kodiereText, schneideZeile } from './escpos'

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex')
const enthaelt = (haystack: Uint8Array, needle: readonly number[]): boolean =>
  Buffer.from(haystack).includes(Buffer.from(needle))

describe('kodiereText (cp857)', () => {
  it('kodiert Umlaute und tuerkische Zeichen mit den Referenz-Bytes', () => {
    const referenz: Record<string, number> = {
      ä: 0x84,
      ö: 0x94,
      ü: 0x81,
      Ä: 0x8e,
      Ö: 0x99,
      Ü: 0x9a,
      ß: 0xe1,
      ş: 0x9f,
      ğ: 0xa7,
      ı: 0x8d,
      ç: 0x87,
      İ: 0x98,
      Ş: 0x9e,
      Ğ: 0xa6,
      Ç: 0x80
    }
    for (const [zeichen, byte] of Object.entries(referenz)) {
      expect(hex(kodiereText(zeichen)), zeichen).toBe(byte.toString(16).padStart(2, '0'))
      // und gegen iconv-lite selbst
      expect(iconv.encode(zeichen, CODEPAGE)[0], zeichen).toBe(byte)
    }
  })

  it('laesst ASCII unveraendert', () => {
    expect(hex(kodiereText('Total CHF 75.00'))).toBe(
      Buffer.from('Total CHF 75.00', 'ascii').toString('hex')
    )
  })

  it('ersetzt nicht kodierbare Zeichen durch ?', () => {
    expect(hex(kodiereText('a€b✂c'))).toBe(Buffer.from('a?b?c', 'ascii').toString('hex'))
    expect(kodiereText('日本').length).toBe(2)
    expect(hex(kodiereText('日本'))).toBe('3f3f')
  })

  it('Round-Trip fuer eine gemischte Zeile', () => {
    const text = 'Gözleme  Dürüm  Lahmacun Ä Ö Ü ß'
    expect(iconv.decode(Buffer.from(kodiereText(text)), CODEPAGE)).toBe(text)
  })
})

describe('schneideZeile', () => {
  it('schneidet nach Spaltenzahl der Groesse', () => {
    const lang = 'x'.repeat(60)
    expect(schneideZeile(lang, 'normal')).toHaveLength(48)
    expect(schneideZeile(lang, 'doppelt')).toHaveLength(24)
    expect(schneideZeile(lang, 'dreifach')).toHaveLength(16)
    expect(schneideZeile('kurz', 'dreifach')).toBe('kurz')
  })
})

describe('baueBytes', () => {
  it('leeres Modell: nur Initialisierung und Codepage', () => {
    expect(hex(baueBytes({ schublade: false, dokumente: [] }))).toBe('1b40' + '1b740d')
  })

  it('Schubladenimpuls direkt nach der Initialisierung, vor den Dokumenten', () => {
    const bytes = baueBytes({ schublade: true, dokumente: [{ zeilen: [{ text: 'A' }] }] })
    expect(hex(bytes).startsWith('1b40' + '1b740d' + '1b700019fa')).toBe(true)
  })

  it('leeres Dokument mit Schnitt: 3 x LF und GS V 66 0', () => {
    const bytes = baueBytes({ schublade: false, dokumente: [{ zeilen: [] }] })
    expect(hex(bytes)).toBe('1b40' + '1b740d' + '0a0a0a' + '1d564200')
  })

  it('Byte-Snapshot: Coupon mit Groessen, Ausrichtung und Fett', () => {
    const modell: DruckModell = {
      schublade: true,
      dokumente: [
        {
          zeilen: [
            { text: 'NACHDRUCK', groesse: 'doppelt', fett: true, ausrichtung: 'mitte' },
            { text: '2x', groesse: 'dreifach', ausrichtung: 'mitte' },
            { text: 'Dürüm', groesse: 'doppelt', ausrichtung: 'mitte' },
            { text: '' },
            { text: 'Sa 19.09.2026  14:32' },
            { text: 'K1-0042   Coupon 1/2' }
          ]
        }
      ]
    }
    const erwartet = [
      '1b40', // ESC @
      '1b740d', // ESC t 13
      '1b700019fa', // ESC p 0 25 250
      '1b6101', // ESC a 1 (mitte)
      '1b4501', // ESC E 1 (fett)
      '1d2111', // GS ! 0x11 (doppelt)
      Buffer.from('NACHDRUCK', 'ascii').toString('hex'),
      '0a',
      '1b4500', // ESC E 0
      '1d2122', // GS ! 0x22 (dreifach)
      '3278', // "2x"
      '0a',
      '1d2111', // doppelt
      '44' + '81' + '72' + '81' + '6d', // Dürüm mit ü = 0x81
      '0a',
      '1b6100', // ESC a 0 (links)
      '1d2100', // GS ! 0 (normal)
      '0a', // Leerzeile
      Buffer.from('Sa 19.09.2026  14:32', 'ascii').toString('hex'),
      '0a',
      Buffer.from('K1-0042   Coupon 1/2', 'ascii').toString('hex'),
      '0a',
      '0a0a0a', // Vorschub
      '1d564200' // GS V 66 0
    ].join('')
    expect(hex(baueBytes(modell))).toBe(erwartet)
  })

  it('Byte-Snapshot: zwei Dokumente, jedes beginnt mit expliziter Formatierung', () => {
    const modell: DruckModell = {
      schublade: false,
      dokumente: [{ zeilen: [{ text: 'A' }] }, { zeilen: [{ text: 'B', ausrichtung: 'rechts' }] }]
    }
    const erwartet = [
      '1b40',
      '1b740d',
      '1b6100',
      '1b4500',
      '1d2100',
      '41',
      '0a',
      '0a0a0a',
      '1d564200',
      '1b6102',
      '1b4500',
      '1d2100',
      '42',
      '0a',
      '1b6100',
      '0a0a0a',
      '1d564200'
    ].join('')
    expect(hex(baueBytes(modell))).toBe(erwartet)
  })

  it('setzt Formatbefehle nur bei Aenderung', () => {
    const bytes = baueBytes({
      schublade: false,
      dokumente: [
        {
          zeilen: [
            { text: 'a' },
            { text: 'b' },
            { text: 'c', fett: true },
            { text: 'd', fett: true }
          ]
        }
      ]
    })
    const h = hex(bytes)
    // ESC E 1 genau einmal, ESC E 0 zweimal (Anfang + Reset am Dokumentende)
    expect(h.split('1b4501').length - 1).toBe(1)
    expect(h.split('1b4500').length - 1).toBe(2)
    // ESC a 0 genau einmal
    expect(h.split('1b6100').length - 1).toBe(1)
  })

  it('schneidet zu lange Zeilen hart ab', () => {
    const bytes = baueBytes({
      schublade: false,
      dokumente: [{ zeilen: [{ text: 'z'.repeat(100), groesse: 'doppelt' }] }]
    })
    const textTeil = Buffer.from(bytes).toString('latin1')
    expect(textTeil.match(/z+/)?.[0].length).toBe(24)
  })

  it('erzeugt keine Fliesskomma- oder Out-of-Range-Bytes', () => {
    const bytes = baueBytes({ schublade: true, dokumente: [{ zeilen: [{ text: 'Ç İ Ş €' }] }] })
    for (const b of bytes) {
      expect(Number.isInteger(b) && b >= 0 && b <= 255).toBe(true)
    }
  })
})

// Unabhaengige Referenz eines echten Testdrucks (nicht von baueBytes erzeugt, Schubladenimpuls steht
// am Ende). Neu erzeugen mit: node tools/testdruck-bin.mjs
describe('Referenz tools/testdruck.bin', () => {
  const referenz = new Uint8Array(
    readFileSync(join(__dirname, '..', '..', 'tools', 'testdruck.bin'))
  )

  it('ist 205 Bytes gross und beginnt mit ESC @ ESC t 13', () => {
    expect(referenz.length).toBe(205)
    expect(hex(referenz).startsWith('1b401b740d')).toBe(true)
  })

  it('traegt eine neutrale Kopfzeile: KASSE doppelt zentriert, darunter TESTDRUCK', () => {
    // ESC a 1 (mitte), GS ! 0x11 (doppelt), "KASSE", LF, GS ! 0x00 (normal), "TESTDRUCK", LF
    const kopf = [
      '1b6101',
      '1d2111',
      Buffer.from('KASSE', 'ascii').toString('hex'),
      '0a',
      '1d2100',
      Buffer.from('TESTDRUCK', 'ascii').toString('hex'),
      '0a'
    ].join('')
    expect(hex(referenz).includes(kopf)).toBe(true)
  })

  it('Builder erzeugt dieselben Befehlsfolgen wie die Referenz', () => {
    const bytes = baueBytes({
      schublade: true,
      dokumente: [{ zeilen: [{ text: 'KASSE', groesse: 'doppelt', ausrichtung: 'mitte' }] }]
    })
    for (const befehl of [
      BEFEHL.init,
      BEFEHL.codepage,
      BEFEHL.schublade,
      BEFEHL.schnitt,
      [0x1d, 0x21, 0x11]
    ]) {
      expect(enthaelt(referenz, befehl), hex(Uint8Array.from(befehl))).toBe(true)
      expect(enthaelt(bytes, befehl), hex(Uint8Array.from(befehl))).toBe(true)
    }
  })

  it('Umlaut-Bytes der Referenz stimmen mit dem Encoder ueberein', () => {
    const umlaute = kodiereText('Umlaute: äöü ÄÖÜ ß')
    const tuerkisch = kodiereText('Türkçe: ş ğ ı ç İ Ş Ğ Ç')
    expect(enthaelt(referenz, Array.from(umlaute))).toBe(true)
    expect(enthaelt(referenz, Array.from(tuerkisch))).toBe(true)
  })
})
