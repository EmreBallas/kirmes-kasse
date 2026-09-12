/**
 * Simulator-Transport: schreibt die Bytes und eine lesbare Textvorschau in einen Ordner,
 * statt zu drucken. Nur fuer Entwicklung und Tests (KASSE_PRINT=sim oder Dev-Modus).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import iconv from 'iconv-lite'
import { CODEPAGE, ESC, GS, LF, SPALTEN } from './escpos'
import type { DruckErgebnis, DruckTransport } from './transport'

export const SCHNITT_ZEILE = '--------------- ✂ ---------------'
export const SCHUBLADE_ZEILE = '[SCHUBLADE]'

type VorschauAusrichtung = 'links' | 'mitte' | 'rechts'
type VorschauFaktor = 1 | 2 | 3

function faktorAusGsByte(n: number): VorschauFaktor {
  // Breite steckt in den oberen 4 Bit (0 = einfach, 1 = doppelt, 2 = dreifach)
  const breite = (n >> 4) & 0x0f
  if (breite >= 2) return 3
  if (breite === 1) return 2
  return 1
}

function formatiereZeile(
  text: string,
  faktor: VorschauFaktor,
  ausrichtung: VorschauAusrichtung
): string {
  const praefix = faktor === 3 ? '[x3] ' : faktor === 2 ? '[x2] ' : ''
  if (text === '') return praefix.trimEnd()
  const breite = SPALTEN.normal
  const sichtbar = Array.from(text).length * faktor
  let einzug = 0
  if (ausrichtung === 'mitte') einzug = Math.max(0, Math.floor((breite - sichtbar) / 2))
  if (ausrichtung === 'rechts') einzug = Math.max(0, breite - sichtbar)
  return praefix + ' '.repeat(einzug) + text
}

/**
 * Dekodiert das von baueBytes erzeugte ESC/POS-Subset zu Text:
 * Text via cp857, GS ! als "[x2]"/"[x3]"-Praefix, ESC a als Einzug, GS V als Schnittlinie, ESC p als [SCHUBLADE].
 * Unbekannte Steuerzeichen werden ignoriert.
 */
export function dekodiereVorschau(bytes: Uint8Array): string {
  const zeilen: string[] = []
  let puffer: number[] = []
  let faktor: VorschauFaktor = 1
  let ausrichtung: VorschauAusrichtung = 'links'

  const flush = (): void => {
    const text = puffer.length === 0 ? '' : iconv.decode(Buffer.from(puffer), CODEPAGE)
    zeilen.push(formatiereZeile(text, faktor, ausrichtung))
    puffer = []
  }

  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]
    if (b === ESC) {
      const cmd = bytes[i + 1]
      if (cmd === 0x40) {
        i += 2 // ESC @
      } else if (cmd === 0x74 || cmd === 0x45) {
        i += 3 // ESC t n, ESC E n
      } else if (cmd === 0x61) {
        const n = bytes[i + 2]
        ausrichtung = n === 1 ? 'mitte' : n === 2 ? 'rechts' : 'links'
        i += 3
      } else if (cmd === 0x70) {
        zeilen.push(SCHUBLADE_ZEILE)
        i += 5 // ESC p m t1 t2
      } else {
        i += 2
      }
      continue
    }
    if (b === GS) {
      const cmd = bytes[i + 1]
      if (cmd === 0x21) {
        faktor = faktorAusGsByte(bytes[i + 2] ?? 0)
        i += 3
      } else if (cmd === 0x56) {
        const m = bytes[i + 2]
        if (puffer.length > 0) flush()
        zeilen.push(SCHNITT_ZEILE)
        i += m === 0x41 || m === 0x42 ? 4 : 3 // GS V 65/66 n  bzw. GS V 0/1
      } else {
        i += 2
      }
      continue
    }
    if (b === LF) {
      flush()
      i += 1
      continue
    }
    if (b < 0x20 && b !== 0x09) {
      i += 1 // sonstige Steuerzeichen ignorieren
      continue
    }
    puffer.push(b)
    i += 1
  }
  if (puffer.length > 0) flush()
  return zeilen.join('\n') + '\n'
}

function zeitStempelDateiname(zeit: Date): string {
  const p = (n: number, l: number = 2): string => String(n).padStart(l, '0')
  return (
    `${zeit.getFullYear()}${p(zeit.getMonth() + 1)}${p(zeit.getDate())}-` +
    `${p(zeit.getHours())}${p(zeit.getMinutes())}${p(zeit.getSeconds())}-${p(zeit.getMilliseconds(), 3)}`
  )
}

export function sichererDateiname(bezeichnung: string): string {
  const bereinigt = bezeichnung.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  return bereinigt === '' ? 'auftrag' : bereinigt.slice(0, 60)
}

export interface SimulatorOptionen {
  /** Zielordner, z. B. <archiv>/simulator */
  ordner: string
  /** nur fuer Tests: feste Zeitquelle */
  jetzt?: () => Date
}

export class SimulatorTransport implements DruckTransport {
  readonly name = 'simulator' as const
  readonly ordner: string
  private readonly jetzt: () => Date

  constructor(optionen: SimulatorOptionen) {
    this.ordner = optionen.ordner
    this.jetzt = optionen.jetzt ?? ((): Date => new Date())
  }

  async senden(bytes: Uint8Array, bezeichnung: string): Promise<DruckErgebnis> {
    try {
      await mkdir(this.ordner, { recursive: true })
      const basis = `${zeitStempelDateiname(this.jetzt())}-${sichererDateiname(bezeichnung)}`
      await writeFile(join(this.ordner, `${basis}.bin`), bytes)
      await writeFile(join(this.ordner, `${basis}.txt`), dekodiereVorschau(bytes), 'utf8')
      return { ok: true, status: 'accepted', jobId: null, fehler: null }
    } catch (e) {
      const meldung = e instanceof Error ? e.message : String(e)
      return {
        ok: false,
        status: 'error',
        jobId: null,
        fehler: `Simulator konnte nicht schreiben: ${meldung}`
      }
    }
  }
}
