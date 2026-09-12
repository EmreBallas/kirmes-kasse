/**
 * Produktkacheln: Name + Preis, Gruppe als Farbe, Menge im Warenkorb als Badge,
 * Ausverkauft-Toggle als kleiner Schalter auf der Kachel (ohne PIN).
 */
import type { JSX } from 'react'
import type { Produkt, Warenkorb } from '@core/types'
import { formatChf } from '@core/geld'

interface Props {
  produkte: Produkt[]
  warenkorb: Warenkorb
  onAntippen: (produkt: Produkt) => void
  onAusverkauft: (produkt: Produkt, ausverkauft: boolean) => void
}

export function Produktraster({ produkte, warenkorb, onAntippen, onAusverkauft }: Props): JSX.Element {
  const mengen = new Map<string, number>()
  for (const z of warenkorb.zeilen) mengen.set(z.produktId, z.anzahl)

  const sichtbar = produkte
    .filter((p) => p.aktiv && p.preisRappen !== null)
    .sort((a, b) => a.reihenfolge - b.reihenfolge || a.name.localeCompare(b.name, 'de-CH'))

  if (sichtbar.length === 0) {
    return (
      <div className="produktraster-leer">
        <p>Keine aktiven Produkte. Produkte in der Verwaltung anlegen oder aktivieren.</p>
      </div>
    )
  }

  return (
    <div className="produktraster">
      {sichtbar.map((p) => {
        const menge = mengen.get(p.id) ?? 0
        return (
          <div key={p.id} className={`kachel kachel-${p.gruppe}${p.ausverkauft ? ' kachel-ausverkauft' : ''}`}>
            <button
              type="button"
              className="kachel-flaeche"
              onClick={() => onAntippen(p)}
              disabled={p.ausverkauft}
              aria-label={`${p.name}, CHF ${formatChf(p.preisRappen ?? 0)}${p.ausverkauft ? ', ausverkauft' : ''}`}
            >
              <span className="kachel-name">{p.name}</span>
              <span className="kachel-preis zahl">{formatChf(p.preisRappen ?? 0)}</span>
              {menge > 0 ? <span className="kachel-badge zahl">{menge}</span> : null}
              {p.ausverkauft ? <span className="kachel-stempel">AUSVERKAUFT</span> : null}
            </button>
            <button
              type="button"
              className={`kachel-schalter${p.ausverkauft ? ' kachel-schalter-an' : ''}`}
              onClick={(ev) => {
                ev.stopPropagation()
                onAusverkauft(p, !p.ausverkauft)
              }}
              title={p.ausverkauft ? 'Wieder verfügbar' : 'Als ausverkauft markieren'}
              aria-label={p.ausverkauft ? `${p.name} wieder verfügbar` : `${p.name} ausverkauft`}
            >
              {p.ausverkauft ? 'verfügbar' : 'ausverkauft'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
