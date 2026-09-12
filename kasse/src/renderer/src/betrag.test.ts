import { describe, expect, it } from 'vitest'
import { betragAusText, istGueltigePin, parseKurs, tasteAusTastatur, textAusBetrag, tippe, type Taste } from './betrag'

function tippeFolge(tasten: Taste[]): string {
  return tasten.reduce((text, t) => tippe(text, t), '')
}

describe('tippe (Ziffernblock)', () => {
  it('tippt Ziffern und Punkt', () => {
    expect(tippeFolge(['1', '2', '.', '5'])).toBe('12.5')
    expect(betragAusText('12.5')).toBe(1250)
  })

  it('00 haengt zwei Nullen an', () => {
    expect(tippeFolge(['5', '00'])).toBe('500')
    expect(betragAusText('500')).toBe(50000)
  })

  it('fuehrende Null wird ersetzt, 00 auf leer ergibt 0', () => {
    expect(tippeFolge(['0', '5'])).toBe('5')
    expect(tippeFolge(['00'])).toBe('0')
    expect(tippeFolge(['0', '0', '0'])).toBe('0')
  })

  it('Punkt auf leer ergibt "0.", zweiter Punkt wird ignoriert', () => {
    expect(tippeFolge(['.'])).toBe('0.')
    expect(tippeFolge(['1', '.', '.', '5'])).toBe('1.5')
  })

  it('hoechstens zwei Nachkommastellen', () => {
    expect(tippeFolge(['1', '.', '2', '3', '4'])).toBe('1.23')
    expect(tippeFolge(['1', '.', '2', '00'])).toBe('1.20')
  })

  it('hoechstens sechs Vorkommastellen', () => {
    expect(tippeFolge(['1', '2', '3', '4', '5', '6', '7'])).toBe('123456')
  })

  it('back loescht das letzte Zeichen, clear alles', () => {
    expect(tippe('12.5', 'back')).toBe('12.')
    expect(tippe('', 'back')).toBe('')
    expect(tippe('12.5', 'clear')).toBe('')
  })
})

describe('tasteAusTastatur', () => {
  it('bildet Tastaturtasten ab', () => {
    expect(tasteAusTastatur('7')).toBe('7')
    expect(tasteAusTastatur(',')).toBe('.')
    expect(tasteAusTastatur('.')).toBe('.')
    expect(tasteAusTastatur('Backspace')).toBe('back')
    expect(tasteAusTastatur('Delete')).toBe('clear')
    expect(tasteAusTastatur('Enter')).toBeNull()
    expect(tasteAusTastatur('a')).toBeNull()
  })
})

describe('betragAusText / textAusBetrag', () => {
  it('ungueltige oder leere Eingabe ergibt 0', () => {
    expect(betragAusText('')).toBe(0)
    expect(betragAusText('abc')).toBe(0)
    expect(betragAusText('0.')).toBe(0)
  })

  it('Schnellwahl-Text ist die Franken-Schreibweise', () => {
    expect(textAusBetrag(5000)).toBe('50.00')
    expect(betragAusText(textAusBetrag(1700))).toBe(1700)
  })
})

describe('parseKurs', () => {
  it('akzeptiert zwei und vier Nachkommastellen', () => {
    expect(parseKurs('0.90')).toBe(9000)
    expect(parseKurs('0,93')).toBe(9300)
    expect(parseKurs('0.9250')).toBe(9250)
    expect(parseKurs('1')).toBe(10000)
  })

  it('lehnt Unsinn, null und mehr als vier Nachkommastellen ab', () => {
    expect(parseKurs('')).toBeNull()
    expect(parseKurs('abc')).toBeNull()
    expect(parseKurs('0')).toBeNull()
    expect(parseKurs('0.12345')).toBeNull()
    expect(parseKurs('-1')).toBeNull()
  })
})

describe('istGueltigePin', () => {
  it('genau vier Ziffern', () => {
    expect(istGueltigePin('1234')).toBe(true)
    expect(istGueltigePin('123')).toBe(false)
    expect(istGueltigePin('12345')).toBe(false)
    expect(istGueltigePin('12a4')).toBe(false)
  })
})
