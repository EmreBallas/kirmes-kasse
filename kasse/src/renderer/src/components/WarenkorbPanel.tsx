/**
 * Warenkorb rechts: Zeilen mit Name, Anzahl, +/-, Loeschen, Betrag; Total gross; Zahlartenleiste.
 * Ueber dem Total der Umschalter "{satz}% Rabatt" fuer den ganzen Beleg (Mitglieder anderer Vereine);
 * ist er aktiv, stehen dort drei Zeilen: Zwischensumme, Rabatt als Abzug und Total CHF. Der Rabatt gilt
 * fuer jede Zahlart, auch fuer Helfer («Helfer» oeffnet den Helferdialog: Name, gleich oder spaeter zahlen).
 * Darunter der dezente Knopf "Spende" (freie Spende ohne Kauf, unabhaengig vom Warenkorb).
 */
import type { JSX } from 'react'
import type { Warenkorb, Zahlart } from '@core/types'
import { formatChf } from '@core/geld'
import { anzahlArtikel } from '@core/warenkorb'
import { ZAHLART_NAME } from '../bezahlen'
import { rabattKnopfText, rabattZeileLabel, warenkorbSumme, wirksamerSatz } from '../rabatt'

interface Props {
  warenkorb: Warenkorb
  eurMoeglich: boolean
  onMenge: (produktId: string, delta: number) => void
  onEntfernen: (produktId: string) => void
  onLeeren: () => void
  onZahlart: (zahlart: Zahlart) => void
  /** eingestellter Rabattsatz in Prozent (Einstellung rabatt_prozent, Standard 50) */
  rabattSatz: number
  /** Rabatt-Knopf gedrueckt: der ganze Beleg wird rabattiert */
  rabattAktiv: boolean
  onRabatt: (aktiv: boolean) => void
  /** Kassentag offen: Spende ohne Kauf moeglich */
  spendeMoeglich: boolean
  onSpende: () => void
}

const ZAHLARTEN: Zahlart[] = ['bar_chf', 'bar_eur', 'twint', 'helfer']

export function WarenkorbPanel({
  warenkorb,
  eurMoeglich,
  onMenge,
  onEntfernen,
  onLeeren,
  onZahlart,
  rabattSatz,
  rabattAktiv,
  onRabatt,
  spendeMoeglich,
  onSpende
}: Props): JSX.Element {
  const leer = warenkorb.zeilen.length === 0
  // Rechnung kommt aus @core (summeMitRabatt -> rabattBetrag); der Renderer rechnet nie selbst.
  const summe = warenkorbSumme(warenkorb, wirksamerSatz(rabattAktiv, rabattSatz))
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
      <div className="warenkorb-rabatt">
        <button
          type="button"
          className={`knopf knopf-rabatt${rabattAktiv ? ' knopf-rabatt-aktiv' : ''}`}
          disabled={leer}
          aria-pressed={rabattAktiv}
          onClick={() => onRabatt(!rabattAktiv)}
          title="Rabatt für den ganzen Beleg (Mitglieder anderer Vereine)"
        >
          <span className="rabatt-haken" aria-hidden="true">
            {rabattAktiv ? '✓' : ''}
          </span>
          {rabattKnopfText(rabattSatz)}
        </button>
      </div>
      {summe.rabattRappen > 0 ? (
        <>
          <div className="warenkorb-zwischensumme">
            <span>Zwischensumme</span>
            <span className="zahl">{formatChf(summe.zwischensummeRappen)}</span>
          </div>
          <div className="warenkorb-abzug">
            <span>{rabattZeileLabel(summe.rabattProzent)}</span>
            <span className="zahl">− {formatChf(summe.rabattRappen)}</span>
          </div>
        </>
      ) : null}
      <div className="warenkorb-total">
        <span>Total CHF</span>
        <span className="total-betrag zahl">{formatChf(summe.totalRappen)}</span>
      </div>
      <div className="zahlarten">
        {ZAHLARTEN.map((za) => (
          <button
            key={za}
            type="button"
            className={`knopf knopf-zahlart zahlart-${za}`}
            disabled={leer || (za === 'bar_eur' && !eurMoeglich)}
            onClick={() => onZahlart(za)}
            title={za === 'bar_eur' && !eurMoeglich ? 'EUR-Kurs fehlt (Einstellungen)' : za === 'helfer' ? 'Helfer: Name erfassen, gleich oder später zahlen' : undefined}
          >
            {ZAHLART_NAME[za]}
          </button>
        ))}
        <button
          type="button"
          className="knopf knopf-neutral knopf-spende"
          disabled={!spendeMoeglich}
          onClick={onSpende}
          title={spendeMoeglich ? 'Spende ohne Kauf erfassen (kein Bon)' : 'Kein Kassentag offen'}
        >
          Spende
        </button>
      </div>
    </aside>
  )
}
