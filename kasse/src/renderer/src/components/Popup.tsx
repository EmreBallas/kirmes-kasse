/**
 * Modales Popup (Overlay) mit Titel, Text und Knoepfen. Keine Animationen.
 */
import type { JSX, ReactNode } from 'react'

export interface PopupKnopf {
  text: string
  onClick: () => void
  art?: 'primaer' | 'gefahr' | 'neutral'
  autoFokus?: boolean
}

interface Props {
  titel: string
  art?: 'fehler' | 'frage' | 'info'
  children?: ReactNode
  knoepfe: PopupKnopf[]
}

export function Popup({ titel, art = 'info', children, knoepfe }: Props): JSX.Element {
  return (
    <div className="overlay overlay-popup" role="dialog" aria-modal="true" aria-label={titel}>
      <div className={`popup popup-${art}`}>
        <h2 className="popup-titel">{titel}</h2>
        {children !== undefined ? <div className="popup-inhalt">{children}</div> : null}
        <div className="popup-knoepfe">
          {knoepfe.map((k) => (
            <button
              key={k.text}
              type="button"
              className={`knopf knopf-${k.art ?? 'neutral'} knopf-gross`}
              onClick={k.onClick}
              autoFocus={k.autoFokus === true}
            >
              {k.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
