/**
 * Spendedialog (Vollbild-Overlay wie der Bezahldialog): freie Spende ohne Kauf.
 * Umschalter Bar CHF / Twint / Bar EUR, Betragszeile gross, Ziffernblock und Tastatur (Ziffern,
 * Punkt/Komma, Backspace, Enter = erfassen, Esc = zurueck). Bei Bar EUR wird der CHF-Gegenwert
 * (eurZuChfRappen, Kurs aus den Einstellungen) angezeigt. Kein Druck, Warenkorb bleibt unveraendert.
 * Die Spenden-UUID wird beim Oeffnen erzeugt und bei "Nochmals senden" wiederverwendet (Idempotenz).
 */
import { useEffect, useState, type JSX } from 'react'
import type { Spende, SpendeTyp } from '@core/types'
import { formatChf, formatEur, formatKurs } from '@core/geld'
import { ApiFehler, NetzFehler, api, fehlerMeldung } from '../api'
import { betragAusText, tasteAusTastatur, tippe, type Taste } from '../betrag'
import { SPENDE_TYPEN, SPENDE_TYP_NAME, baueFreieSpende, neueSpendeId, spendeChfGegenwert } from '../spende'
import { Popup } from './Popup'
import { Ziffernblock } from './Ziffernblock'

interface Props {
  /** EUR-Kurs (x10000); 0 = kein Kurs, Bar EUR gesperrt */
  kursX10000: number
  onErfolg: (spende: Spende) => void
  onAbbrechen: () => void
}

type PopupZustand = { art: 'netzfehler' } | { art: 'fehler'; meldung: string } | null

export function Spendedialog({ kursX10000, onErfolg, onAbbrechen }: Props): JSX.Element {
  const [spendeId] = useState(() => neueSpendeId())
  const [typ, setTyp] = useState<SpendeTyp>('bar_chf')
  const [text, setText] = useState('')
  const [popup, setPopup] = useState<PopupZustand>(null)
  const [sendet, setSendet] = useState(false)

  const eurMoeglich = kursX10000 > 0
  const betrag = betragAusText(text)
  const gegenwertChf = spendeChfGegenwert(typ, betrag, kursX10000)
  const einheit = typ === 'bar_eur' ? 'EUR' : 'CHF'
  const erfassbar = betrag > 0 && !sendet

  const taste = (t: Taste): void => {
    if (sendet) return
    setText((alt) => tippe(alt, t))
  }

  const typWaehlen = (neu: SpendeTyp): void => {
    if (sendet) return
    if (neu === 'bar_eur' && !eurMoeglich) return
    setTyp(neu)
  }

  const senden = async (): Promise<void> => {
    if (sendet || betrag <= 0) return
    setSendet(true)
    setPopup(null)
    try {
      const antwort = await api.spendeErfassen(baueFreieSpende(spendeId, typ, betrag))
      onErfolg(antwort.spende)
    } catch (e) {
      if (e instanceof NetzFehler) setPopup({ art: 'netzfehler' })
      else if (e instanceof ApiFehler) setPopup({ art: 'fehler', meldung: e.meldung })
      else setPopup({ art: 'fehler', meldung: fehlerMeldung(e) })
    } finally {
      setSendet(false)
    }
  }

  // Tastatur: Ziffern, Punkt/Komma, Backspace, Enter, Esc
  useEffect(() => {
    const handler = (ev: KeyboardEvent): void => {
      if (ev.key === 'Enter') {
        ev.preventDefault()
        if (popup === null) void senden()
        else if (popup.art === 'netzfehler') void senden()
        else setPopup(null)
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

  return (
    <div className="overlay overlay-bezahlen" role="dialog" aria-modal="true" aria-label="Spende erfassen">
      <div className="bezahlen spendedialog">
        <div className="bezahlen-kopf">
          <h2>Spende ohne Kauf</h2>
          <button type="button" className="knopf knopf-neutral" onClick={onAbbrechen} disabled={sendet}>
            Zurück (Esc)
          </button>
        </div>

        <div className="bezahlen-inhalt">
          <div className="bezahlen-zeilen">
            <div className="spende-typen" role="radiogroup" aria-label="Zahlart der Spende">
              {SPENDE_TYPEN.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={typ === t}
                  className={`knopf knopf-wahl knopf-gross${typ === t ? ' knopf-wahl-aktiv spende-typ-aktiv' : ''}`}
                  disabled={sendet || (t === 'bar_eur' && !eurMoeglich)}
                  onClick={() => typWaehlen(t)}
                  title={t === 'bar_eur' && !eurMoeglich ? 'EUR-Kurs fehlt (Einstellungen)' : undefined}
                >
                  {SPENDE_TYP_NAME[t]}
                </button>
              ))}
            </div>
            <div className="bz-zeile bz-zeile-rueckgeld bz-zeile-aktiv">
              <span className="bz-label">Spende {einheit}</span>
              <span className="bz-wert bz-rueckgeld zahl">
                {text === '' ? '0.00' : text}
                <span className="cursor" aria-hidden="true">
                  |
                </span>
              </span>
            </div>
            {typ === 'bar_eur' ? (
              <div className="bz-zeile bz-zeile-eur">
                <span className="bz-label">Gegenwert CHF (Kurs {formatKurs(kursX10000)})</span>
                <span className="bz-wert zahl">{formatChf(gegenwertChf)}</span>
              </div>
            ) : null}
            <p className="spende-hinweis">
              {typ === 'twint'
                ? 'Kunde tippt den Betrag selbst. Bestätigung auf dem Kundenhandy prüfen.'
                : typ === 'bar_eur'
                  ? `Der Betrag in EUR bleibt im EUR-Fach (Soll EUR steigt um EUR ${formatEur(betrag)}).`
                  : 'Das Geld bleibt in der Kasse und erhöht den Soll-Bestand.'}{' '}
              Es wird kein Bon gedruckt.
            </p>
          </div>

          <div className="bezahlen-eingabe">
            <Ziffernblock onTaste={taste} deaktiviert={sendet} />
          </div>
        </div>

        <div className="bezahlen-fuss">
          <button type="button" className="knopf knopf-primaer knopf-riesig" onClick={() => void senden()} disabled={!erfassbar}>
            {sendet ? 'Wird gespeichert …' : 'Spende erfassen (Enter)'}
          </button>
        </div>
      </div>

      {popup?.art === 'netzfehler' ? (
        <Popup
          titel="Keine Verbindung zum Kassen-Server"
          art="fehler"
          knoepfe={[
            { text: 'Abbrechen', art: 'neutral', onClick: () => setPopup(null) },
            { text: 'Nochmals senden', art: 'primaer', autoFokus: true, onClick: () => void senden() }
          ]}
        >
          <p>Die Spende wurde vielleicht nicht gespeichert. «Nochmals senden» wiederholt dieselbe Spende (keine doppelte Buchung).</p>
        </Popup>
      ) : null}

      {popup?.art === 'fehler' ? (
        <Popup titel="Spende nicht erfasst" art="fehler" knoepfe={[{ text: 'OK', art: 'primaer', autoFokus: true, onClick: () => setPopup(null) }]}>
          <p>{popup.meldung}</p>
        </Popup>
      ) : null}
    </div>
  )
}
