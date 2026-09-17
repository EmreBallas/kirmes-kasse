/**
 * Bezahldialog (Vollbild-Overlay): Total / Gegeben / Rueckgeld, Ziffernblock, Schnellwahl,
 * Tastatur (Ziffern, Punkt/Komma, Backspace, Enter, Esc), Live-Vorschau mit berechneZahlung.
 * Verkaufs-UUID wird beim Oeffnen erzeugt und bei "Nochmals senden" wiederverwendet (Fachregel 17).
 *
 * Rabatt: `rabattProzent` ist der fuer diesen Beleg wirksame Satz (0 = keiner). "Total CHF" ist der bereits
 * rabattierte, zu kassierende Betrag; im Kopf steht dann die kleine Zeile "inkl. 50% Rabatt (- CHF 13.50)".
 * Gerechnet wird mit @core, nie im Dialog selbst.
 *
 * Helfer «gleich zahlen»: `helferName` steht im Kopf («Helfer: Anna») und geht mit der Verkaufsanfrage mit;
 * sonst ist der Dialog ein normaler Verkauf. Zahlart helfer («spaeter zahlen») laeuft ueber den Helferdialog.
 */
import { useEffect, useMemo, useState, type JSX } from 'react'
import type { VerkaufAnfrage, VerkaufAntwort, Warenkorb, ZahlungsErgebnis, ZahlungsWarnung } from '@core/types'
import { formatChf, formatEur, formatKurs } from '@core/geld'
import { berechneZahlung } from '@core/zahlung'
import { ApiFehler, NetzFehler, api, fehlerMeldung } from '../api'
import { tasteAusTastatur, textAusBetrag, tippe, type Taste } from '../betrag'
import {
  SCHNELLWAHL,
  ZAHLART_NAME,
  baueVerkaufAnfrage,
  gegebenAusText,
  neueVerkaufsId,
  pruefeVorSenden,
  bestaetigungsWarnung,
  type BarOderTwint
} from '../bezahlen'
import { rabattKopfText, warenkorbSumme } from '../rabatt'
import { Popup } from './Popup'
import { Ziffernblock } from './Ziffernblock'

interface Props {
  zahlart: BarOderTwint
  warenkorb: Warenkorb
  kursX10000: number
  /** wirksamer Rabattsatz dieses Belegs in Prozent; 0 = kein Rabatt */
  rabattProzent: number
  /** Helfer, der gleich zahlt (Beleg traegt den Namen); null bei gewoehnlichen Verkaeufen */
  helferName?: string | null
  onErfolg: (antwort: VerkaufAntwort) => void
  onAbbrechen: () => void
}

type PopupZustand =
  | { art: 'nicht_gedeckt' }
  | { art: 'hoch'; warnung: ZahlungsWarnung; anfrage: VerkaufAnfrage }
  | { art: 'spende_frage'; betrag: number }
  | { art: 'netzfehler'; anfrage: VerkaufAnfrage }
  | { art: 'fehler'; meldung: string }
  | null

export function Bezahldialog({ zahlart, warenkorb, kursX10000, rabattProzent, helferName = null, onErfolg, onAbbrechen }: Props): JSX.Element {
  const summe = warenkorbSumme(warenkorb, rabattProzent)
  // Was kassiert wird: der bereits rabattierte Betrag (Zahlung, Rueckgeld und Storno rechnen damit).
  const totalRappen = summe.totalRappen
  const [verkaufId] = useState(() => neueVerkaufsId())
  const [text, setText] = useState(() => (zahlart === 'twint' ? textAusBetrag(totalRappen) : ''))
  const [twintBearbeiten, setTwintBearbeiten] = useState(false)
  const [popup, setPopup] = useState<PopupZustand>(null)
  const [sendet, setSendet] = useState(false)

  const gegeben = gegebenAusText(zahlart, text)
  const waehrungGegeben = zahlart === 'bar_eur' ? 'EUR' : 'CHF'

  const ergebnis: ZahlungsErgebnis | null = useMemo(() => {
    try {
      return berechneZahlung({ zahlart, totalRappen, gegeben, kursX10000, spendeBehalten: false })
    } catch {
      return null
    }
  }, [zahlart, totalRappen, gegeben, kursX10000])

  const eingabeErlaubt = zahlart === 'bar_chf' || zahlart === 'bar_eur' || (zahlart === 'twint' && twintBearbeiten)

  const taste = (t: Taste): void => {
    if (!eingabeErlaubt || sendet) return
    setText((alt) => tippe(alt, t))
  }

  const schnellwahl = (betrag: number): void => {
    if (!eingabeErlaubt || sendet) return
    setText(textAusBetrag(betrag))
  }

  /** Sendet den Verkauf; bei Netzfehler bleibt dieselbe Anfrage (UUID) fuer "Nochmals senden". */
  const senden = async (anfrage: VerkaufAnfrage): Promise<void> => {
    if (sendet) return
    setSendet(true)
    setPopup(null)
    try {
      const antwort = await api.verkauf(anfrage)
      onErfolg(antwort)
    } catch (e) {
      if (e instanceof NetzFehler) {
        setPopup({ art: 'netzfehler', anfrage })
      } else if (e instanceof ApiFehler && e.fehler === 'nicht_gedeckt') {
        setPopup({ art: 'nicht_gedeckt' })
      } else if (e instanceof ApiFehler && e.fehler === 'bestaetigung_noetig') {
        setPopup({
          art: 'hoch',
          warnung: zahlart === 'twint' ? 'spende_ueber_200' : 'rueckgeld_ueber_200',
          anfrage: { ...anfrage, bestaetigtHohesRueckgeld: true }
        })
      } else {
        setPopup({ art: 'fehler', meldung: fehlerMeldung(e) })
      }
    } finally {
      setSendet(false)
    }
  }

  /** Prueft Deckung und 200er-Schwelle, dann senden. */
  const bestaetigen = (spendeBehalten = false): void => {
    // Kein Popup-Guard hier: die Aufrufer schliessen das Popup im selben Schritt (State ist noch alt).
    if (sendet) return
    let erg: ZahlungsErgebnis
    try {
      erg = berechneZahlung({ zahlart, totalRappen, gegeben, kursX10000, spendeBehalten })
    } catch (e) {
      setPopup({ art: 'fehler', meldung: fehlerMeldung(e) })
      return
    }
    const anfrage = baueVerkaufAnfrage(verkaufId, warenkorb, zahlart, gegeben, spendeBehalten, false, summe.rabattProzent, helferName)
    const entscheid = pruefeVorSenden(erg, false)
    if (entscheid === 'nicht_gedeckt') {
      setPopup({ art: 'nicht_gedeckt' })
      return
    }
    if (entscheid === 'bestaetigung_noetig') {
      const warnung = bestaetigungsWarnung(erg.warnungen) ?? 'rueckgeld_ueber_200'
      setPopup({ art: 'hoch', warnung, anfrage: { ...anfrage, bestaetigtHohesRueckgeld: true } })
      return
    }
    void senden(anfrage)
  }

  const stimmtSo = (): void => {
    if (ergebnis === null || !ergebnis.gedeckt || ergebnis.rueckgeldChfRappen <= 0) return
    setPopup({ art: 'spende_frage', betrag: ergebnis.rueckgeldChfRappen })
  }

  // Tastatur: Ziffern, Punkt/Komma, Backspace, Enter, Esc
  useEffect(() => {
    const handler = (ev: KeyboardEvent): void => {
      if (ev.key === 'Enter') {
        ev.preventDefault()
        if (popup === null) bestaetigen()
        else if (popup.art === 'hoch' || popup.art === 'netzfehler') void senden(popup.anfrage)
        else if (popup.art === 'spende_frage') {
          setPopup(null)
          bestaetigen(true)
        } else setPopup(null)
        return
      }
      if (ev.key === 'Escape') {
        ev.preventDefault()
        if (popup !== null) setPopup(null)
        else if (!sendet) onAbbrechen()
        return
      }
      if (popup !== null) return
      const t = tasteAusTastatur(ev.key)
      if (t !== null) {
        ev.preventDefault()
        taste(t)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  const rueckgeld = ergebnis?.rueckgeldChfRappen ?? 0
  const spende = ergebnis?.spendeChfRappen ?? 0
  const gedeckt = ergebnis?.gedeckt ?? false

  return (
    <div className="overlay overlay-bezahlen" role="dialog" aria-modal="true" aria-label={`Bezahlen ${ZAHLART_NAME[zahlart]}`}>
      <div className={`bezahlen bezahlen-${zahlart}`}>
        <div className="bezahlen-kopf">
          <h2>{ZAHLART_NAME[zahlart]}</h2>
          {helferName !== null ? <span className="bezahlen-helfer">Helfer: {helferName}</span> : null}
          {summe.rabattRappen > 0 ? (
            <span className="bezahlen-rabatt zahl">{rabattKopfText(summe.rabattProzent, summe.rabattRappen)}</span>
          ) : null}
          <button type="button" className="knopf knopf-neutral" onClick={onAbbrechen} disabled={sendet}>
            Zurück (Esc)
          </button>
        </div>

        <div className="bezahlen-inhalt">
          <div className="bezahlen-zeilen">
            <div className="bz-zeile">
              <span className="bz-label">Total CHF</span>
              <span className="bz-wert zahl">{formatChf(totalRappen)}</span>
            </div>
            {zahlart === 'bar_eur' ? (
              <div className="bz-zeile bz-zeile-eur">
                <span className="bz-label">Total in EUR (Kurs {formatKurs(kursX10000)})</span>
                <span className="bz-wert zahl">{formatEur(ergebnis?.totalEurCent ?? 0)}</span>
              </div>
            ) : null}
            <div className={`bz-zeile bz-zeile-gegeben${eingabeErlaubt ? ' bz-zeile-aktiv' : ''}`}>
              <span className="bz-label">{zahlart === 'twint' ? 'Betrag CHF' : `Gegeben ${waehrungGegeben}`}</span>
              <span className="bz-wert zahl">
                {text === '' ? '0.00' : text}
                {eingabeErlaubt ? <span className="cursor" aria-hidden="true">|</span> : null}
              </span>
            </div>
            {zahlart === 'bar_eur' && gegeben > 0 ? (
              <div className="bz-zeile bz-zeile-klein">
                <span className="bz-label">Gegenwert CHF</span>
                <span className="bz-wert zahl">{formatChf(ergebnis?.gegebenChfRappen ?? 0)}</span>
              </div>
            ) : null}
            {zahlart === 'bar_chf' || zahlart === 'bar_eur' ? (
              <div className={`bz-zeile bz-zeile-rueckgeld${!gedeckt ? ' bz-nicht-gedeckt' : ''}`}>
                <span className="bz-label">Rückgeld CHF</span>
                <span className="bz-wert bz-rueckgeld zahl">{gedeckt ? formatChf(rueckgeld) : 'nicht gedeckt'}</span>
              </div>
            ) : null}
            {zahlart === 'twint' ? (
              <div className={`bz-zeile bz-zeile-rueckgeld${!gedeckt ? ' bz-nicht-gedeckt' : ''}`}>
                <span className="bz-label">{gedeckt ? 'Spende CHF' : 'Betrag'}</span>
                <span className="bz-wert bz-rueckgeld zahl">{gedeckt ? formatChf(spende) : 'nicht gedeckt'}</span>
              </div>
            ) : null}
          </div>

          <div className="bezahlen-eingabe">
            {zahlart === 'bar_chf' || zahlart === 'bar_eur' ? (
              <>
                <div className="schnellwahl">
                  <button type="button" className="knopf knopf-neutral knopf-schnell" onClick={() => schnellwahl(zahlart === 'bar_eur' ? (ergebnis?.totalEurCent ?? 0) : totalRappen)} disabled={sendet}>
                    Passend
                  </button>
                  {SCHNELLWAHL.map((b) => (
                    <button key={b} type="button" className="knopf knopf-neutral knopf-schnell zahl" onClick={() => schnellwahl(b)} disabled={sendet}>
                      {b / 100}
                    </button>
                  ))}
                </div>
                <Ziffernblock onTaste={taste} deaktiviert={sendet} />
              </>
            ) : null}

            {zahlart === 'twint' && twintBearbeiten ? <Ziffernblock onTaste={taste} deaktiviert={sendet} /> : null}
            {zahlart === 'twint' && !twintBearbeiten ? (
              <div className="twint-hinweis">
                <p>Kunde tippt den Betrag selbst. Bestätigung auf dem Kundenhandy prüfen.</p>
                <button
                  type="button"
                  className="knopf knopf-neutral knopf-gross"
                  onClick={() => {
                    setTwintBearbeiten(true)
                    setText('')
                  }}
                  disabled={sendet}
                >
                  Betrag ändern
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="bezahlen-fuss">
          {zahlart === 'bar_chf' || zahlart === 'bar_eur' ? (
            <button type="button" className="knopf knopf-neutral knopf-gross" onClick={stimmtSo} disabled={sendet || !gedeckt || rueckgeld <= 0}>
              Stimmt so (Spende)
            </button>
          ) : null}
          <button type="button" className="knopf knopf-primaer knopf-riesig" onClick={() => bestaetigen()} disabled={sendet}>
            {sendet ? 'Wird gespeichert …' : zahlart === 'twint' ? 'Bezahlt, geprüft (Enter)' : 'Bezahlen (Enter)'}
          </button>
        </div>
      </div>

      {popup?.art === 'nicht_gedeckt' ? (
        <Popup titel="Betrag nicht gedeckt" art="fehler" knoepfe={[{ text: 'OK', art: 'primaer', autoFokus: true, onClick: () => setPopup(null) }]}>
          <p>
            Gegeben ist kleiner als das Total CHF <span className="zahl">{formatChf(totalRappen)}</span>. Betrag korrigieren.
          </p>
        </Popup>
      ) : null}

      {popup?.art === 'hoch' ? (
        <Popup
          titel={popup.warnung === 'spende_ueber_200' ? 'Spende über CHF 200. Sicher?' : 'Rückgeld über CHF 200. Sicher?'}
          art="frage"
          knoepfe={[
            { text: 'Abbrechen', art: 'neutral', onClick: () => setPopup(null) },
            { text: 'Ja', art: 'gefahr', onClick: () => void senden(popup.anfrage) }
          ]}
        >
          <p>
            {popup.warnung === 'spende_ueber_200' ? 'Überzahlung' : 'Rückgeld'} CHF{' '}
            <span className="zahl">{formatChf(popup.warnung === 'spende_ueber_200' ? spende : rueckgeld)}</span>
          </p>
        </Popup>
      ) : null}

      {popup?.art === 'spende_frage' ? (
        <Popup
          titel={`CHF ${formatChf(popup.betrag)} als Spende behalten?`}
          art="frage"
          knoepfe={[
            { text: 'Abbrechen', art: 'neutral', onClick: () => setPopup(null) },
            {
              text: 'Ja, Spende',
              art: 'primaer',
              onClick: () => {
                setPopup(null)
                bestaetigen(true)
              }
            }
          ]}
        >
          <p>Das Rückgeld wird als Bar-Spende gebucht, Rückgeld 0.00.</p>
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
        <Popup titel="Fehler" art="fehler" knoepfe={[{ text: 'OK', art: 'primaer', autoFokus: true, onClick: () => setPopup(null) }]}>
          <p>{popup.meldung}</p>
        </Popup>
      ) : null}
    </div>
  )
}
