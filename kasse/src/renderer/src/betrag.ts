/**
 * Betragseingabe fuer Ziffernblock und Tastatur (reine Logik, ohne DOM).
 * Der Eingabetext ist die Franken-/Euro-Schreibweise ("12.50"); Umrechnung in Rappen/Cent
 * ueber parseBetrag aus @core/geld.
 */
import { formatChf, parseBetrag } from '@core/geld'

export type Taste = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | '.' | 'back' | 'clear'

const ZIFFERN = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])

/** Maximale Stellen vor dem Punkt (Schutz vor Tippfehlern wie 1000000). */
export const MAX_VORKOMMA = 6

/** Verarbeitet eine Taste auf dem aktuellen Eingabetext und liefert den neuen Text. */
export function tippe(text: string, taste: Taste): string {
  if (taste === 'clear') return ''
  if (taste === 'back') return text.slice(0, -1)
  if (taste === '.') return text.includes('.') ? text : text === '' ? '0.' : `${text}.`

  const ziffern = taste === '00' ? '00' : taste
  let neu = text
  for (const z of ziffern) {
    neu = haengeZifferAn(neu, z)
  }
  return neu
}

function haengeZifferAn(text: string, ziffer: string): string {
  if (!ZIFFERN.has(ziffer)) return text
  const punkt = text.indexOf('.')
  if (punkt >= 0) {
    // hoechstens zwei Nachkommastellen
    if (text.length - punkt - 1 >= 2) return text
    return text + ziffer
  }
  if (text === '0') return ziffer // fuehrende Null ersetzen
  if (text.length >= MAX_VORKOMMA) return text
  return text + ziffer
}

/** Uebersetzt eine Tastaturtaste (KeyboardEvent.key) in eine Ziffernblock-Taste; null = nicht zustaendig. */
export function tasteAusTastatur(key: string): Taste | null {
  if (ZIFFERN.has(key)) return key as Taste
  if (key === '.' || key === ',') return '.'
  if (key === 'Backspace') return 'back'
  if (key === 'Delete') return 'clear'
  return null
}

/** Eingabetext -> Rappen/Cent; leer oder ungueltig ergibt 0. */
export function betragAusText(text: string): number {
  return parseBetrag(text) ?? 0
}

/** Rappen/Cent -> Eingabetext ("50.00"), fuer Schnellwahl und Vorbelegung. */
export function textAusBetrag(einheiten: number): string {
  return formatChf(einheiten)
}

/** Kurs-Eingabe "0.90" oder "0.9250" -> kursX10000 (9000 bzw. 9250); ungueltig -> null. */
export function parseKurs(text: string): number | null {
  const bereinigt = text.trim().replace(',', '.')
  if (!/^\d*(\.\d{0,4})?$/.test(bereinigt) || bereinigt === '' || bereinigt === '.') return null
  const [ganzTeil, dezimalTeil = ''] = bereinigt.split('.')
  const ganz = ganzTeil === '' ? 0 : Number(ganzTeil)
  const dezimal = Number((dezimalTeil + '0000').slice(0, 4))
  const kurs = ganz * 10000 + dezimal
  if (!Number.isSafeInteger(kurs) || kurs <= 0) return null
  return kurs
}

/** Pruefung einer PIN-Eingabe: genau vier Ziffern. */
export function istGueltigePin(pin: string): boolean {
  return /^\d{4}$/.test(pin)
}
