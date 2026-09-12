/**
 * PIN-Abfrage (4 Ziffern) mit Ziffernblock und Tastatur. Prueft ueber POST /api/pin/pruefen.
 */
import { useEffect, useState, type JSX } from 'react'
import { api, fehlerMeldung } from '../api'
import { istGueltigePin, tasteAusTastatur, type Taste } from '../betrag'
import { Ziffernblock } from './Ziffernblock'

interface Props {
  titel?: string
  onOk: (pin: string) => void
  onAbbrechen: () => void
}

export function PinDialog({ titel = 'PIN eingeben', onOk, onAbbrechen }: Props): JSX.Element {
  const [pin, setPin] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const [prueft, setPrueft] = useState(false)

  const taste = (t: Taste): void => {
    setFehler(null)
    if (t === 'clear') setPin('')
    else if (t === 'back') setPin((p) => p.slice(0, -1))
    else if (t !== '.' && t !== '00') setPin((p) => (p.length >= 4 ? p : p + t))
  }

  const pruefen = async (): Promise<void> => {
    if (!istGueltigePin(pin) || prueft) return
    setPrueft(true)
    try {
      const antwort = await api.pinPruefen(pin)
      if (antwort.ok) {
        onOk(pin)
      } else {
        setFehler('PIN falsch')
        setPin('')
      }
    } catch (e) {
      setFehler(fehlerMeldung(e))
      setPin('')
    } finally {
      setPrueft(false)
    }
  }

  useEffect(() => {
    const handler = (ev: KeyboardEvent): void => {
      if (ev.key === 'Enter') {
        ev.preventDefault()
        void pruefen()
        return
      }
      if (ev.key === 'Escape') {
        ev.preventDefault()
        onAbbrechen()
        return
      }
      const t = tasteAusTastatur(ev.key)
      if (t !== null) {
        ev.preventDefault()
        taste(t)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  return (
    <div className="overlay overlay-popup" role="dialog" aria-modal="true" aria-label={titel}>
      <div className="popup popup-pin">
        <h2 className="popup-titel">{titel}</h2>
        <div className="pin-anzeige zahl" aria-label="PIN">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`pin-stelle${pin.length > i ? ' pin-stelle-voll' : ''}`}>
              {pin.length > i ? '●' : '○'}
            </span>
          ))}
        </div>
        {fehler !== null ? <p className="meldung-fehler">{fehler}</p> : null}
        <Ziffernblock onTaste={taste} nurZiffern deaktiviert={prueft} />
        <div className="popup-knoepfe">
          <button type="button" className="knopf knopf-neutral knopf-gross" onClick={onAbbrechen}>
            Abbrechen
          </button>
          <button
            type="button"
            className="knopf knopf-primaer knopf-gross"
            onClick={() => void pruefen()}
            disabled={!istGueltigePin(pin) || prueft}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
