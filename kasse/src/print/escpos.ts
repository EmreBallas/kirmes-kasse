/**
 * ESC/POS-Builder: DruckModell -> Bytes fuer den Epson TM-T20II.
 * Reine Funktion, keine Seiteneffekte. Byte-Snapshots in escpos.test.ts.
 *
 * Sequenz:
 *   ESC @            Initialisierung
 *   ESC t 13         Codepage PC857 (Tuerkisch, enthaelt auch die deutschen Umlaute)
 *   ESC p 0 25 250   Schubladenimpuls (nur wenn modell.schublade), direkt nach der Initialisierung
 *   je Dokument:     je Zeile ESC a n / ESC E n / GS ! n (nur bei Aenderung), Text cp857, LF
 *                    danach Formatierung zuruecksetzen, 3 x LF, GS V 66 0 (Teilschnitt mit Vorschub)
 */
import iconv from 'iconv-lite'
import type { BonAusrichtung, BonGroesse, BonZeile, DruckModell } from '@core/types'

export const ESC = 0x1b
export const GS = 0x1d
export const LF = 0x0a

/** Codepage des Druckers; Tabelle 13 im Befehl ESC t entspricht PC857. */
export const CODEPAGE = 'cp857'
export const CODEPAGE_TABELLE = 13

/** Spaltenzahl je Schriftgroesse bei 80 mm Papier und Font A. */
export const SPALTEN: Record<BonGroesse, number> = { normal: 48, doppelt: 24, dreifach: 16 }

/** Feste Befehlsfolgen, auch fuer Tests und den Simulator exportiert. */
export const BEFEHL = {
  init: [ESC, 0x40],
  codepage: [ESC, 0x74, CODEPAGE_TABELLE],
  schublade: [ESC, 0x70, 0x00, 0x19, 0xfa],
  schnitt: [GS, 0x56, 0x42, 0x00]
} as const

const GROESSE_BYTE: Record<BonGroesse, number> = { normal: 0x00, doppelt: 0x11, dreifach: 0x22 }
const AUSRICHTUNG_BYTE: Record<BonAusrichtung, number> = { links: 0, mitte: 1, rechts: 2 }

if (!iconv.encodingExists(CODEPAGE)) {
  throw new Error(`Codepage ${CODEPAGE} wird von iconv-lite nicht unterstuetzt`)
}

/**
 * Kodiert Text nach cp857. Zeichen, die die Codepage nicht kennt, werden durch '?' ersetzt.
 * iconv-lite tut das bereits selbst; der Round-Trip-Check faengt Abweichungen ab
 * (z. B. Zeichen, die iconv auf ein anderes Zeichen abbilden wuerde).
 */
export function kodiereText(text: string): Uint8Array {
  const ganz = iconv.encode(text, CODEPAGE)
  if (iconv.decode(ganz, CODEPAGE) === text) {
    return new Uint8Array(ganz)
  }
  const bytes: number[] = []
  for (const zeichen of text) {
    const kodiert = iconv.encode(zeichen, CODEPAGE)
    if (kodiert.length === 1 && iconv.decode(kodiert, CODEPAGE) === zeichen) {
      bytes.push(kodiert[0])
    } else {
      bytes.push(0x3f) // '?'
    }
  }
  return Uint8Array.from(bytes)
}

/** Schneidet eine Zeile hart auf die Spaltenzahl der Groesse ab (nach Codepoints, nicht nach Bytes). */
export function schneideZeile(text: string, groesse: BonGroesse): string {
  const zeichen = Array.from(text)
  const spalten = SPALTEN[groesse]
  return zeichen.length > spalten ? zeichen.slice(0, spalten).join('') : text
}

class ByteSchreiber {
  private readonly teile: number[] = []

  push(...bytes: readonly number[]): void {
    for (const b of bytes) this.teile.push(b & 0xff)
  }

  pushArray(bytes: Uint8Array): void {
    for (const b of bytes) this.teile.push(b)
  }

  fertig(): Uint8Array {
    return Uint8Array.from(this.teile)
  }
}

interface FormatZustand {
  ausrichtung: BonAusrichtung | null
  fett: boolean | null
  groesse: BonGroesse | null
}

function schreibeZeile(w: ByteSchreiber, zeile: BonZeile, zustand: FormatZustand): void {
  const ausrichtung = zeile.ausrichtung ?? 'links'
  const fett = zeile.fett ?? false
  const groesse = zeile.groesse ?? 'normal'

  if (zustand.ausrichtung !== ausrichtung) {
    w.push(ESC, 0x61, AUSRICHTUNG_BYTE[ausrichtung])
    zustand.ausrichtung = ausrichtung
  }
  if (zustand.fett !== fett) {
    w.push(ESC, 0x45, fett ? 1 : 0)
    zustand.fett = fett
  }
  if (zustand.groesse !== groesse) {
    w.push(GS, 0x21, GROESSE_BYTE[groesse])
    zustand.groesse = groesse
  }
  w.pushArray(kodiereText(schneideZeile(zeile.text, groesse)))
  w.push(LF)
}

/** Baut die komplette Bytefolge fuer EINEN Druckauftrag (ein WritePrinter). */
export function baueBytes(modell: DruckModell): Uint8Array {
  const w = new ByteSchreiber()
  w.push(...BEFEHL.init)
  w.push(...BEFEHL.codepage)
  if (modell.schublade) {
    w.push(...BEFEHL.schublade)
  }

  for (const dokument of modell.dokumente) {
    // Jedes Dokument beginnt mit explizit gesetzter Formatierung.
    const zustand: FormatZustand = { ausrichtung: null, fett: null, groesse: null }
    for (const zeile of dokument.zeilen) {
      schreibeZeile(w, zeile, zustand)
    }
    // Formatierung zuruecksetzen, damit Vorschub und Schnitt in normaler Hoehe erfolgen.
    if (zustand.fett === true) w.push(ESC, 0x45, 0)
    if (zustand.groesse !== null && zustand.groesse !== 'normal') w.push(GS, 0x21, 0x00)
    if (zustand.ausrichtung !== null && zustand.ausrichtung !== 'links') w.push(ESC, 0x61, 0)
    w.push(LF, LF, LF)
    w.push(...BEFEHL.schnitt)
  }

  return w.fertig()
}
