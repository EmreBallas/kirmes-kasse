/**
 * Warenkorb rechts: Zeilen mit Name, Anzahl, +/-, Loeschen, Betrag; Total gross; Zahlartenleiste.
 */
import type { JSX } from 'react'
import type { Warenkorb, Zahlart } from '@core/types'
import { formatChf } from '@core/geld'
import { anzahlArtikel, total } from '@core/warenkorb'
import { ZAHLART_NAME } from '../bezahlen'

interface Props {
  warenkorb: Warenkorb
  eurMoeglich: boolean
  onMenge: (produktId: string, delta: number) => void
  onEntfernen: (produktId: string) => void
  onLeeren: () => void
  onZahlart: (zahlart: Zahlart) => void
}

const ZAHLARTEN: Zahlart[] = ['bar_chf', 'bar_eur', 'twint', 'helfer']

export function WarenkorbPanel({ warenkorb, eurMoeglich, onMenge, onEntfernen, onLeeren, onZahlart }: Props): JSX.Element {
  const leer = warenkorb.zeilen.length === 0
  return (
    <aside className="warenkorb">
      <div className="warenkorb-kopf">
        <h2>Warenkorb</h2>
        <span className="warenkorb-anzahl zahl">{anzahlArtikel(warenkorb)} Artikel</span>
        <button type="button" className="knopf knopf-neutral knopf-klein" onClick={onLeeren} disabled={leer}>
          Leeren
        </button>
      </div>
      <ul className="warenkorb-zeilen">
        {warenkorb.zeilen.map((z) => (
          <li key={z.produktId} className={`warenkorb-zeile gruppe-${z.gruppe}`}>
            <span className="wz-name">{z.name}</span>
            <span className="wz-einzel zahl">{formatChf(z.preisRappen)}</span>
            <div className="wz-menge">
              <button type="button" className="knopf knopf-neutral knopf-quadrat" onClick={() => onMenge(z.produktId, -1)} aria-label={`${z.name} eins weniger`}>
                −
              </button>
              <span className="wz-anzahl zahl">{z.anzahl}</span>
              <button type="button" className="knopf knopf-neutral knopf-quadrat" onClick={() => onMenge(z.produktId, 1)} aria-label={`${z.name} eins mehr`}>
                +
              </button>
              <button type="button" className="knopf knopf-gefahr knopf-quadrat" onClick={() => onEntfernen(z.produktId)} aria-label={`${z.name} entfernen`}>
                ×
              </button>
            </div>
            <span className="wz-betrag zahl">{formatChf(z.preisRappen * z.anzahl)}</span>
          </li>
        ))}
        {leer ? <li className="warenkorb-leer">Produkt antippen, um zu beginnen.</li> : null}
      </ul>
      <div className="warenkorb-total">
        <span>Total CHF</span>
        <span className="total-betrag zahl">{formatChf(total(warenkorb))}</span>
      </div>
      <div className="zahlarten">
        {ZAHLARTEN.map((za) => (
          <button
            key={za}
            type="button"
            className={`knopf knopf-zahlart zahlart-${za}`}
            disabled={leer || (za === 'bar_eur' && !eurMoeglich)}
            onClick={() => onZahlart(za)}
            title={za === 'bar_eur' && !eurMoeglich ? 'EUR-Kurs fehlt (Einstellungen)' : undefined}
          >
            {ZAHLART_NAME[za]}
          </button>
        ))}
      </div>
    </aside>
  )
}
