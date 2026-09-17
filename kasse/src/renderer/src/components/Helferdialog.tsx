/**
 * Helferdialog (Vollbild-Overlay wie der Bezahldialog): Zahlart «Helfer» im Warenkorb.
 *
 * Schritt 1 «Name»: grosse Knoepfe mit allen bekannten Namen (GET /api/helfer, alphabetisch) plus Textfeld
 * «Neuer Name» (max. 24 Zeichen, Enter uebernimmt). Ein neuer Name wird per POST /api/helfer gespeichert
 * (best effort: der Verkauf traegt den Namen ohnehin).
 * Schritt 2 «Weg»: zwei grosse Knoepfe «Gleich zahlen» und «Spaeter zahlen» mit dem Total (rabattiert,
 * falls der Rabatt aktiv ist). «Spaeter zahlen» fragt zurueck und speichert den Verkauf mit zahlart helfer
 * (offene Schuld, Coupons werden gedruckt, kein Geld in der Lade). «Gleich zahlen» fuehrt zu Schritt 3.
 * Schritt 3 «Zahlart»: Bar CHF / Bar EUR / Twint -> der bestehende Bezahldialog mit dem Helfernamen.
 * Esc oder «Zurueck» geht an jeder Stelle einen Schritt zurueck. Verkaufs-UUID beim Oeffnen erzeugt und bei
 * «Nochmals senden» wiederverwendet (Fachregel 17).
 */
import { useEffect, useRef, useState, type JSX } from 'react'
import type { VerkaufAnfrage, Warenkorb } from '@core/types'
import { formatChf } from '@core/geld'
import { ApiFehler, NetzFehler, api, fehlerMeldung } from '../api'
import { ZAHLART_NAME, neueVerkaufsId, type BarOderTwint } from '../bezahlen'
import {
  HELFER_NAME_MAX,
  baueHelferSpaeterAnfrage,
  bereinigeHelferName,
  findeBekanntenNamen,
  helferNamenZurAuswahl,
  istGueltigerHelferName,
  spaeterZahlenFrage,
  type VerkaufAntwortMitSaldo
} from '../helfer'
import { rabattKopfText, rabattZeileLabel, warenkorbSumme } from '../rabatt'
import { Popup } from './Popup'

interface Props {
  warenkorb: Warenkorb
  /** wirksamer Rabattsatz dieses Belegs in Prozent; 0 = kein Rabatt (gilt auch fuer Helfer) */
  rabattProzent: number
  /** EUR-Kurs vorhanden: Bar EUR waehlbar */
  eurMoeglich: boolean
  /** «Spaeter zahlen» wurde gespeichert (zahlart helfer) */
  onSpaeterGespeichert: (antwort: VerkaufAntwortMitSaldo) => void
  /** «Gleich zahlen» mit gewaehlter Zahlart: der Aufrufer oeffnet den Bezahldialog mit dem Namen */
  onGleichZahlen: (helferName: string, zahlart: BarOderTwint) => void
  onAbbrechen: () => void
  /**
   * true, solange der Bezahldialog («gleich zahlen») darueber liegt: der Dialog bleibt mit seinem Zustand
   * (Name, Schritt) erhalten, ist aber unsichtbar und reagiert nicht auf die Tastatur.
   */
  verdeckt?: boolean
}

type Schritt = { art: 'name' } | { art: 'weg'; name: string } | { art: 'zahlart'; name: string }

type PopupZustand =
  | { art: 'frage'; anfrage: VerkaufAnfrage }
  | { art: 'netzfehler'; anfrage: VerkaufAnfrage }
  | { art: 'fehler'; meldung: string }
  | null

const GLEICH_ZAHLARTEN: readonly BarOderTwint[] = ['bar_chf', 'bar_eur', 'twint']

export function Helferdialog({ warenkorb, rabattProzent, eurMoeglich, onSpaeterGespeichert, onGleichZahlen, onAbbrechen, verdeckt = false }: Props): JSX.Element {
  const summe = warenkorbSumme(warenkorb, rabattProzent)
  const totalRappen = summe.totalRappen
  const [verkaufId] = useState(() => neueVerkaufsId())
  const [schritt, setSchritt] = useState<Schritt>({ art: 'name' })
  const [namen, setNamen] = useState<string[]>([])
  const [namenFehler, setNamenFehler] = useState<string | null>(null)
  const [neuerName, setNeuerName] = useState('')
  const [popup, setPopup] = useState<PopupZustand>(null)
  const [sendet, setSendet] = useState(false)
  const eingabe = useRef<HTMLInputElement>(null)

  // Bekannte Namen laden (alter Server ohne Route: nur das Textfeld bleibt)
  useEffect(() => {
    let aktiv = true
    api
      .helfer()
      .then((h) => {
        if (aktiv) setNamen(helferNamenZurAuswahl(h.helfer, h.salden))
      })
      .catch((e: unknown) => {
        if (aktiv) setNamenFehler(fehlerMeldung(e))
      })
    return () => {
      aktiv = false
    }
  }, [])

  /** Name uebernehmen: bekannte Schreibweise wiederverwenden, neuen Namen speichern (best effort). */
  const nameWaehlen = (text: string): void => {
    const bereinigt = bereinigeHelferName(text)
    if (bereinigt === '') return
    const bekannt = findeBekanntenNamen(namen, bereinigt)
    const name = bekannt ?? bereinigt
    if (bekannt === null) {
      setNamen((alt) => helferNamenZurAuswahl(alt.map((n) => ({ name: n })), [{ name }]))
      api.helferAnlegen(name).catch(() => {
        /* Name haengt am Verkauf; ein aelterer Server oder ein Doppel (409) ist kein Fehler fuer den Kassier */
      })
    }
    setNeuerName('')
    setSchritt({ art: 'weg', name })
  }

  /** Sendet «Spaeter zahlen»; bei Netzfehler bleibt dieselbe Anfrage (UUID) fuer «Nochmals senden». */
  const senden = async (anfrage: VerkaufAnfrage): Promise<void> => {
    if (sendet) return
    setSendet(true)
    setPopup(null)
    try {
      const antwort = await api.verkauf(anfrage)
      onSpaeterGespeichert(antwort)
    } catch (e) {
      if (e instanceof NetzFehler) setPopup({ art: 'netzfehler', anfrage })
      else if (e instanceof ApiFehler) setPopup({ art: 'fehler', meldung: e.meldung })
      else setPopup({ art: 'fehler', meldung: fehlerMeldung(e) })
    } finally {
      setSendet(false)
    }
  }

  const spaeterZahlen = (name: string): void => {
    if (sendet) return
    setPopup({ art: 'frage', anfrage: baueHelferSpaeterAnfrage(verkaufId, warenkorb, summe.rabattProzent, name) })
  }

  const zurueck = (): void => {
    if (sendet) return
    if (popup !== null) {
      setPopup(null)
      return
    }
    if (schritt.art === 'name') onAbbrechen()
    else if (schritt.art === 'weg') setSchritt({ art: 'name' })
    else setSchritt({ art: 'weg', name: schritt.name })
  }

  // Tastatur: Esc = zurueck; Enter bestaetigt ein offenes Popup (im Textfeld uebernimmt Enter den Namen, siehe onKeyDown)
  useEffect(() => {
    if (verdeckt) return undefined
    const handler = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        zurueck()
        return
      }
      if (ev.key === 'Enter' && popup !== null) {
        ev.preventDefault()
        if (popup.art === 'frage' || popup.art === 'netzfehler') void senden(popup.anfrage)
        else setPopup(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  // Textfeld fokussieren, sobald der Namensschritt sichtbar ist
  useEffect(() => {
    if (schritt.art === 'name' && !verdeckt) eingabe.current?.focus()
  }, [schritt.art, verdeckt])

  const titel = schritt.art === 'name' ? 'Helfer – wer holt das Essen?' : `Helfer: ${schritt.name}`

  return (
    <div className="overlay overlay-bezahlen" role="dialog" aria-modal="true" aria-label="Helfer" style={verdeckt ? { display: 'none' } : undefined}>
      <div className="bezahlen helferdialog">
        <div className="bezahlen-kopf">
          <h2>{titel}</h2>
          {summe.rabattRappen > 0 ? <span className="bezahlen-rabatt zahl">{rabattKopfText(summe.rabattProzent, summe.rabattRappen)}</span> : null}
          <button type="button" className="knopf knopf-neutral" onClick={zurueck} disabled={sendet}>
            Zurück (Esc)
          </button>
        </div>

        {schritt.art === 'name' ? (
          <div className="helfer-schritt">
            <div className="helfer-neu">
              <label className="feld feld-zeile helfer-neu-feld">
                <span>Neuer Name</span>
                <input
                  ref={eingabe}
                  type="text"
                  className="eingabe eingabe-gross"
                  maxLength={HELFER_NAME_MAX}
                  value={neuerName}
                  placeholder="Vorname (max. 24 Zeichen)"
                  onChange={(ev) => setNeuerName(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') {
                      ev.preventDefault()
                      ev.stopPropagation()
                      nameWaehlen(neuerName)
                    }
                  }}
                  aria-label="Neuer Helfername"
                />
              </label>
              <button type="button" className="knopf knopf-primaer knopf-gross" disabled={!istGueltigerHelferName(neuerName)} onClick={() => nameWaehlen(neuerName)}>
                Übernehmen (Enter)
              </button>
            </div>
            {namenFehler !== null ? <p className="meldung-fehler">Bekannte Namen konnten nicht geladen werden: {namenFehler}</p> : null}
            {namen.length > 0 ? (
              <div className="helfer-namen" role="group" aria-label="Bekannte Helfer">
                {namen.map((n) => (
                  <button key={n} type="button" className="knopf knopf-wahl knopf-helfername" onClick={() => nameWaehlen(n)}>
                    {n}
                  </button>
                ))}
              </div>
            ) : (
              <p className="helfer-hinweis">Noch keine Helfer gespeichert. Namen oben eintippen und mit Enter übernehmen.</p>
            )}
          </div>
        ) : null}

        {schritt.art === 'weg' ? (
          <div className="helfer-schritt">
            <div className="bezahlen-zeilen helfer-total">
              {summe.rabattRappen > 0 ? (
                <>
                  <div className="bz-zeile bz-zeile-klein">
                    <span className="bz-label">Zwischensumme CHF</span>
                    <span className="bz-wert zahl">{formatChf(summe.zwischensummeRappen)}</span>
                  </div>
                  <div className="bz-zeile bz-zeile-klein">
                    <span className="bz-label">{rabattZeileLabel(summe.rabattProzent)}</span>
                    <span className="bz-wert zahl">− {formatChf(summe.rabattRappen)}</span>
                  </div>
                </>
              ) : null}
              <div className="bz-zeile">
                <span className="bz-label">Total CHF</span>
                <span className="bz-wert zahl">{formatChf(totalRappen)}</span>
              </div>
            </div>
            <div className="helfer-wege">
              <button type="button" className="knopf knopf-weg knopf-weg-gleich" onClick={() => setSchritt({ art: 'zahlart', name: schritt.name })} disabled={sendet}>
                <span className="weg-titel">Gleich zahlen</span>
                <span className="weg-betrag zahl">CHF {formatChf(totalRappen)}</span>
                <span className="weg-text">Bar CHF, Bar EUR oder Twint – wie ein normaler Verkauf</span>
              </button>
              <button type="button" className="knopf knopf-weg knopf-weg-spaeter" onClick={() => spaeterZahlen(schritt.name)} disabled={sendet}>
                <span className="weg-titel">Später zahlen</span>
                <span className="weg-betrag zahl">CHF {formatChf(totalRappen)}</span>
                <span className="weg-text">Offene Schuld für {schritt.name}, Coupons werden gedruckt</span>
              </button>
            </div>
          </div>
        ) : null}

        {schritt.art === 'zahlart' ? (
          <div className="helfer-schritt">
            <p className="helfer-hinweis">
              {schritt.name} zahlt CHF <span className="zahl">{formatChf(totalRappen)}</span> gleich. Wie?
            </p>
            <div className="helfer-zahlarten">
              {GLEICH_ZAHLARTEN.map((za) => (
                <button
                  key={za}
                  type="button"
                  className={`knopf knopf-zahlart zahlart-${za} knopf-zahlart-gross`}
                  disabled={za === 'bar_eur' && !eurMoeglich}
                  title={za === 'bar_eur' && !eurMoeglich ? 'EUR-Kurs fehlt (Einstellungen)' : undefined}
                  onClick={() => onGleichZahlen(schritt.name, za)}
                >
                  {ZAHLART_NAME[za]}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {popup?.art === 'frage' && schritt.art !== 'name' ? (
        <Popup
          titel={spaeterZahlenFrage(schritt.name, totalRappen)}
          art="frage"
          knoepfe={[
            { text: 'Abbrechen', art: 'neutral', onClick: () => setPopup(null) },
            { text: sendet ? 'Wird gespeichert …' : 'Ja, speichern (Enter)', art: 'primaer', autoFokus: true, onClick: () => void senden(popup.anfrage) }
          ]}
        >
          <p>Kein Geld in der Lade. {schritt.name} zahlt später im Bildschirm «Helfer». Coupons werden gedruckt.</p>
        </Popup>
      ) : null}

      {popup?.art === 'netzfehler' ? (
        <Popup
          titel="Keine Verbindung zum Kassen-Server"
          art="fehler"
          knoepfe={[
            { text: 'Abbrechen', art: 'neutral', onClick: () => setPopup(null) },
            { text: 'Nochmals senden', art: 'primaer', autoFokus: true, onClick: () => void senden(popup.anfrage) }
          ]}
        >
          <p>Der Verkauf wurde vielleicht nicht gespeichert. «Nochmals senden» wiederholt denselben Verkauf (keine doppelte Belegnummer).</p>
        </Popup>
      ) : null}

      {popup?.art === 'fehler' ? (
        <Popup titel="Nicht gespeichert" art="fehler" knoepfe={[{ text: 'OK', art: 'primaer', autoFokus: true, onClick: () => setPopup(null) }]}>
          <p>{popup.meldung}</p>
        </Popup>
      ) : null}
    </div>
  )
}
