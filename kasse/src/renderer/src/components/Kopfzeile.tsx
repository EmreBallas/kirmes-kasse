/**
 * Kopfzeile des Verkaufsbildschirms: Kassentag, Kassier, Drucker-Ampel, Uhrzeit, Navigation.
 *
 * Die Ampel "Drucker pruefen" ist antippbar und springt direkt in die Einstellungen (PIN-Dialog wie
 * gewohnt); als Untertitel und Tooltip zeigt sie die Meldung aus /api/status, z. B.
 * "Warteschlange fehlt, Vorschlag: EPSON TM-T20 Receipt".
 */
import type { JSX } from 'react'
import type { Kassentag, StatusAntwort } from '@core/types'
import { formatDatum } from '@core/bon'
import { ampelMeldung, type DruckStatusMitVorschlag } from '../drucker'
import { useJetzt } from '../hooks'
import { uhrzeitAnzeige } from '../zeit'

interface Props {
  kassentag: Kassentag | null
  status: StatusAntwort | null
  verbunden: boolean
  /** Kasse beenden (PIN); fehlt im normalen Browser (Plan B), dann kein Knopf */
  onBeenden?: () => void
  onLetzte: () => void
  /** Bildschirm «Helfer»: offene Schulden, Zahlungen erfassen */
  onHelfer: () => void
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

interface AmpelProps {
  status: StatusAntwort | null
  verbunden: boolean
  /** Antippen der roten Ampel: direkt in die Einstellungen (Druckerauswahl); fehlt der Callback, ist sie nur Anzeige */
  onEinstellungen?: () => void
}

export function Ampel({ status, verbunden, onEinstellungen }: AmpelProps): JSX.Element {
  if (!verbunden || status === null) {
    return <span className="ampel ampel-rot">Server?</span>
  }
  const druck: DruckStatusMitVorschlag = status.druck
  const ok = druck.ampel === 'ok'
  const meldung = ampelMeldung(druck)
  const sim = druck.transport === 'simulator' ? <span className="ampel-zusatz"> SIM</span> : null

  if (ok || onEinstellungen === undefined) {
    return (
      <span className={`ampel ${ok ? 'ampel-gruen' : 'ampel-rot'}`} title={meldung}>
        {ok ? 'Druck OK' : 'Druck prüfen'}
        {sim}
      </span>
    )
  }
  return (
    <button
      type="button"
      className="ampel ampel-rot ampel-knopf"
      title={`${meldung} – antippen für die Druckereinstellungen (PIN)`}
      onClick={onEinstellungen}
      aria-label={`Drucker prüfen: ${meldung}. Antippen öffnet die Einstellungen`}
    >
      <span className="ampel-text">
        Druck prüfen{sim}
        <span className="ampel-pfeil" aria-hidden="true">
          {' '}
          ›
        </span>
      </span>
      <span className="ampel-meldung">{meldung}</span>
    </button>
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
        <Ampel status={p.status} verbunden={p.verbunden} onEinstellungen={p.onEinstellungen} />
      </div>
      <div className="kopf-rechts">
        <span className="kopf-uhr zahl">{uhrzeitAnzeige(jetzt)}</span>
        <button type="button" className="knopf knopf-neutral" onClick={p.onLetzte}>
          Letzte Verkäufe
        </button>
        <button type="button" className="knopf knopf-neutral" onClick={p.onHelfer}>
          Helfer
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
