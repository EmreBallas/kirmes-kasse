/**
 * Kassenstart: Datum/Uhrzeit gross, Kassier-Kuerzel, Startgeld CHF (Vorschlag) und EUR.
 */
import { useEffect, useState, type JSX } from 'react'
import type { Kassentag } from '@core/types'
import { formatChf, formatEur, parseBetrag } from '@core/geld'
import { formatDatum } from '@core/bon'
import { api, fehlerMeldung, type KassentagAktuellAntwort } from '../api'
import { useJetzt } from '../hooks'
import { datumAnzeige, uhrzeitMitSekunden } from '../zeit'

interface Props {
  aktuell: KassentagAktuellAntwort | null
  onGestartet: (kassentag: Kassentag) => void
  onAbschlussNachholen: (kassentag: Kassentag) => void
  onNeuLaden: () => void
}

export function Kassenstart({ aktuell, onGestartet, onAbschlussNachholen, onNeuLaden }: Props): JSX.Element {
  const jetzt = useJetzt()
  const [kassier, setKassier] = useState('')
  const [startgeldChf, setStartgeldChf] = useState('')
  const [startgeldEur, setStartgeldEur] = useState('0')
  const [fehler, setFehler] = useState<string | null>(null)
  const [sendet, setSendet] = useState(false)
  const [nachdruckMeldung, setNachdruckMeldung] = useState<{ text: string; art: 'ok' | 'fehler' } | null>(null)
  const [nachdruckLaeuft, setNachdruckLaeuft] = useState(false)

  useEffect(() => {
    if (aktuell !== null) setStartgeldChf(formatChf(aktuell.vorschlagStartgeldChfRappen))
  }, [aktuell])

  const chfRappen = parseBetrag(startgeldChf)
  const eurCent = parseBetrag(startgeldEur)
  const kuerzel = kassier.trim()
  const gueltig = kuerzel.length > 0 && chfRappen !== null && eurCent !== null

  const starten = async (): Promise<void> => {
    if (!gueltig || sendet || chfRappen === null || eurCent === null) return
    setSendet(true)
    setFehler(null)
    try {
      const kassentag = await api.kassentagStart({ startgeldChfRappen: chfRappen, startgeldEurCent: eurCent, kassier: kuerzel })
      onGestartet(kassentag)
    } catch (e) {
      setFehler(fehlerMeldung(e))
    } finally {
      setSendet(false)
    }
  }

  const vortag = aktuell?.vortagOffen ?? null
  const letzter = aktuell?.letzterAbgeschlossener ?? null

  /** Nachdruck des Abschluss-Bons des zuletzt abgeschlossenen Tages (Testfall 32: Druckerausfall beim Abschluss). */
  const abschlussNachdrucken = async (k: Kassentag): Promise<void> => {
    if (nachdruckLaeuft) return
    setNachdruckLaeuft(true)
    setNachdruckMeldung(null)
    try {
      await api.abschlussNachdruck(k.id)
      setNachdruckMeldung({ text: `Nachdruck des Abschluss-Bons ${formatDatum(k.datum)} gestartet.`, art: 'ok' })
    } catch (e) {
      setNachdruckMeldung({ text: fehlerMeldung(e), art: 'fehler' })
    } finally {
      setNachdruckLaeuft(false)
    }
  }

  return (
    <main className="seite seite-start">
      <div className="start-uhr">
        <div className="start-datum">{datumAnzeige(jetzt)}</div>
        <div className="start-zeit zahl">{uhrzeitMitSekunden(jetzt)}</div>
      </div>

      {aktuell === null ? (
        <div className="karte karte-fehler">
          <p>Keine Verbindung zum Kassen-Server.</p>
          <button type="button" className="knopf knopf-primaer knopf-gross" onClick={onNeuLaden}>
            Nochmals versuchen
          </button>
        </div>
      ) : null}

      {vortag !== null ? (
        <div className="karte karte-warnung" role="alert">
          <p>
            <strong>Vortag nicht abgeschlossen:</strong> Kassentag {formatDatum(vortag.datum)} ({vortag.kassier}) ist noch offen.
          </p>
          <p>Solange ist kein Verkauf und kein neuer Kassentag möglich.</p>
          <button type="button" className="knopf knopf-gefahr knopf-gross" onClick={() => onAbschlussNachholen(vortag)} autoFocus>
            Abschluss nachholen
          </button>
        </div>
      ) : null}

      {letzter !== null ? (
        <div className="karte start-nachdruck">
          <span>
            Letzter Abschluss: {formatDatum(letzter.datum)} ({letzter.kassier})
          </span>
          <button type="button" className="knopf knopf-neutral knopf-gross" onClick={() => void abschlussNachdrucken(letzter)} disabled={nachdruckLaeuft}>
            Abschluss-Bon nachdrucken
          </button>
          {nachdruckMeldung !== null ? (
            <span className={nachdruckMeldung.art === 'ok' ? 'meldung-ok' : 'meldung-fehler'} role="status">
              {nachdruckMeldung.text}
            </span>
          ) : null}
        </div>
      ) : null}

      <form
        className="karte start-formular"
        onSubmit={(ev) => {
          ev.preventDefault()
          void starten()
        }}
      >
        <h1>Kassentag starten</h1>
        <label className="feld">
          <span>Kassier (Kürzel)</span>
          <input
            type="text"
            value={kassier}
            onChange={(ev) => setKassier(ev.target.value)}
            maxLength={12}
            autoFocus={vortag === null}
            autoComplete="off"
            className="eingabe"
          />
        </label>
        <label className="feld">
          <span>Startgeld CHF</span>
          <input
            type="text"
            inputMode="decimal"
            value={startgeldChf}
            onChange={(ev) => setStartgeldChf(ev.target.value)}
            className={`eingabe zahl${chfRappen === null ? ' eingabe-fehler' : ''}`}
          />
          <span className="feld-hinweis zahl">{chfRappen !== null ? `= CHF ${formatChf(chfRappen)}` : 'ungültiger Betrag'}</span>
        </label>
        <label className="feld">
          <span>Startgeld EUR</span>
          <input
            type="text"
            inputMode="decimal"
            value={startgeldEur}
            onChange={(ev) => setStartgeldEur(ev.target.value)}
            className={`eingabe zahl${eurCent === null ? ' eingabe-fehler' : ''}`}
          />
          <span className="feld-hinweis zahl">{eurCent !== null ? `= EUR ${formatEur(eurCent)}` : 'ungültiger Betrag'}</span>
        </label>
        {fehler !== null ? <p className="meldung-fehler">{fehler}</p> : null}
        {vortag !== null ? <p className="feld-hinweis">Zuerst den Abschluss des Vortags nachholen.</p> : null}
        <button type="submit" className="knopf knopf-primaer knopf-riesig" disabled={!gueltig || sendet || aktuell === null || vortag !== null}>
          Kassentag starten
        </button>
      </form>
    </main>
  )
}
