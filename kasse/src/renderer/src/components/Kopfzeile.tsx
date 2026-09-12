/**
 * Kopfzeile des Verkaufsbildschirms: Kassentag, Kassier, Drucker-Ampel, Uhrzeit, Navigation.
 */
import type { JSX } from 'react'
import type { Kassentag, StatusAntwort } from '@core/types'
import { formatDatum } from '@core/bon'
import { useJetzt } from '../hooks'
import { uhrzeitAnzeige } from '../zeit'

interface Props {
  kassentag: Kassentag | null
  status: StatusAntwort | null
  verbunden: boolean
  /** Kasse beenden (PIN); fehlt im normalen Browser (Plan B), dann kein Knopf */
  onBeenden?: () => void
  onLetzte: () => void
  onAbschluss: () => void
  onVerwaltung: () => void
  onEinstellungen: () => void
}

function SchlossSymbol(): JSX.Element {
  return (
    <svg className="symbol" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <rect x="4" y="10" width="16" height="11" rx="2" fill="currentColor" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  )
}

export function Ampel({ status, verbunden }: { status: StatusAntwort | null; verbunden: boolean }): JSX.Element {
  if (!verbunden || status === null) {
    return <span className="ampel ampel-rot">Server?</span>
  }
  const druck = status.druck
  const ok = druck.ampel === 'ok'
  const titel = ok
    ? `${druck.druckerName} (${druck.transport})`
    : `${druck.letzterFehler ?? 'Druck fehlgeschlagen'} (${druck.druckerName})`
  return (
    <span className={`ampel ${ok ? 'ampel-gruen' : 'ampel-rot'}`} title={titel}>
      {ok ? 'Druck OK' : 'Druck prüfen'}
      {druck.transport === 'simulator' ? <span className="ampel-zusatz"> SIM</span> : null}
    </span>
  )
}

export function Kopfzeile(p: Props): JSX.Element {
  const jetzt = useJetzt()
  return (
    <header className="kopfzeile">
      <div className="kopf-links">
        {p.onBeenden !== undefined ? (
          <button type="button" className="knopf knopf-neutral knopf-symbol knopf-beenden" onClick={p.onBeenden} title="Kasse beenden (PIN)">
            <SchlossSymbol /> Beenden
          </button>
        ) : null}
        <span className="kopf-datum">{p.kassentag !== null ? formatDatum(p.kassentag.datum) : '–'}</span>
        <span className="kopf-kassier">{p.kassentag !== null ? p.kassentag.kassier : ''}</span>
        <Ampel status={p.status} verbunden={p.verbunden} />
      </div>
      <div className="kopf-rechts">
        <span className="kopf-uhr zahl">{uhrzeitAnzeige(jetzt)}</span>
        <button type="button" className="knopf knopf-neutral" onClick={p.onLetzte}>
          Letzte Verkäufe
        </button>
        <button type="button" className="knopf knopf-neutral" onClick={p.onAbschluss}>
          Abschluss
        </button>
        <button type="button" className="knopf knopf-neutral knopf-symbol" onClick={p.onVerwaltung}>
          <SchlossSymbol /> Verwaltung
        </button>
        <button type="button" className="knopf knopf-neutral knopf-symbol" onClick={p.onEinstellungen}>
          <SchlossSymbol /> Einstellungen
        </button>
      </div>
    </header>
  )
}
