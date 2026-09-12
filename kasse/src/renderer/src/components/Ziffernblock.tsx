/**
 * Ziffernblock fuer Touch: 0-9, 00, Punkt, Backspace, Loeschen.
 */
import type { JSX } from 'react'
import type { Taste } from '../betrag'

interface Props {
  onTaste: (taste: Taste) => void
  /** Punkt und 00 ausblenden (PIN-Eingabe) */
  nurZiffern?: boolean
  deaktiviert?: boolean
}

const REIHEN: Taste[][] = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
  ['0', '00', '.']
]

function beschriftung(t: Taste): string {
  if (t === 'back') return '⌫'
  if (t === 'clear') return 'C'
  return t
}

export function Ziffernblock({ onTaste, nurZiffern = false, deaktiviert = false }: Props): JSX.Element {
  const tasten: Taste[] = REIHEN.flat().filter((t) => !nurZiffern || (t !== '00' && t !== '.'))
  return (
    <div className={`ziffernblock${nurZiffern ? ' ziffernblock-pin' : ''}`}>
      {tasten.map((t) => (
        <button
          key={t}
          type="button"
          className={`knopf knopf-ziffer${t === '0' && nurZiffern ? ' ziffer-null-breit' : ''}`}
          onClick={() => onTaste(t)}
          disabled={deaktiviert}
        >
          {beschriftung(t)}
        </button>
      ))}
      <button type="button" className="knopf knopf-ziffer knopf-ziffer-funktion" onClick={() => onTaste('back')} disabled={deaktiviert} aria-label="Backspace">
        ⌫
      </button>
      <button type="button" className="knopf knopf-ziffer knopf-ziffer-funktion" onClick={() => onTaste('clear')} disabled={deaktiviert} aria-label="Löschen">
        C
      </button>
    </div>
  )
}
