/**
 * Helfer-Zahlung erfassen (Vollbild-Overlay wie der Spendedialog): ein Helfer begleicht seine offene Schuld.
 * Umschalter Bar CHF / Twint / Bar EUR, Betragszeile gross (vorbelegt mit dem offenen Saldo, bei EUR der
 * aufgerundete Gegenwert), Ziffernblock und Tastatur (Ziffern, Punkt/Komma, Backspace, Enter = erfassen,
 * Esc = zurueck). Teilbetrag erlaubt; ein Betrag ueber dem Saldo ist erlaubt, wird aber als Warnung gezeigt.
 * Bar CHF / Bar EUR: die Schublade oeffnet (Druckauftrag typ schublade), kein Bon. Twint: kein Bargeld.
 * Die Zahlungs-UUID wird beim Oeffnen erzeugt und bei «Nochmals senden» wiederverwendet (Idempotenz).
 */
import { useEffect, useState, type JSX } from 'react'
import type { HelferSaldo, SpendeTyp } from '@core/types'
import { formatChf, formatEur, formatKurs } from '@core/geld'
import { ApiFehler, NetzFehler, api, fehlerMeldung } from '../api'
import { betragAusText, tasteAusTastatur, textAusBetrag, tippe, type Taste } from '../betrag'
import {
  HELFER_ZAHLUNG_TYPEN,
  baueHelferZahlung,
  neueHelferZahlungId,
  saldoAusAntwort,
  ueberSaldo,
  zahlungChfGegenwert,
  zahlungVorschlag,
  type HelferZahlungAntwort
} from '../helfer'
import { SPENDE_TYP_NAME } from '../spende'
import { Popup } from './Popup'
import { Ziffernblock } from './Ziffernblock'

interface Props {
  saldo: HelferSaldo
  /** EUR-Kurs (x10000); 0 = kein Kurs, Bar EUR gesperrt */
  kursX10000: number
  /** Zahlung gespeichert: Antwort des Servers und der daraus abgeleitete offene Saldo (Rappen) */
  onErfolg: (antwort: HelferZahlungAntwort, offenNachher: number) => void
  onAbbrechen: () => void
}

type PopupZustand = { art: 'netzfehler' } | { art: 'fehler'; meldung: string } | null

export function HelferZahlungDialog({ saldo, kursX10000, onErfolg, onAbbrechen }: Props): JSX.Element {
  const [zahlungId] = useState(() => neueHelferZahlungId())
  const [typ, setTyp] = useState<SpendeTyp>('bar_chf')
  const [text, setText] = useState(() => textAusBetrag(zahlungVorschlag('bar_chf', saldo.offenRappen, kursX10000)))
  const [popup, setPopup] = useState<PopupZustand>(null)
  const [sendet, setSendet] = useState(false)

  const eurMoeglich = kursX10000 > 0
  const betrag = betragAusText(text)
  const gegenwertChf = zahlungChfGegenwert(typ, betrag, kursX10000)
  const einheit = typ === 'bar_eur' ? 'EUR' : 'CHF'
  const erfassbar = betrag > 0 && !sendet
  const zuViel = ueberSaldo(gegenwertChf, saldo.offenRappen)

  const taste = (t: Taste): void => {
    if (sendet) return
    setText((alt) => tippe(alt, t))
  }

  /** Zahlart wechseln: der Vorschlag wird in der neuen Einheit neu vorbelegt. */
  const typWaehlen = (neu: SpendeTyp): void => {
    if (sendet) return
    if (neu === 'bar_eur' && !eurMoeglich) return
    setTyp(neu)
    setText(textAusBetrag(zahlungVorschlag(neu, saldo.offenRappen, kursX10000)))
  }

  const senden = async (): Promise<void> => {
    if (sendet || betrag <= 0) return
    setSendet(true)
    setPopup(null)
    try {
      const antwort = await api.helferZahlung(baueHelferZahlung(zahlungId, saldo.name, typ, betrag))
      onErfolg(antwort, saldoAusAntwort(antwort, saldo.offenRappen, antwort.zahlung.betragChfRappen))
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
    <div className="overlay overlay-bezahlen" role="dialog" aria-modal="true" aria-label={`Zahlung von ${saldo.name}`}>
      <div className="bezahlen spendedialog helfer-zahlung">
        <div className="bezahlen-kopf">
          <h2>
            {saldo.name} zahlt · offen CHF <span className="zahl">{formatChf(saldo.offenRappen)}</span>
          </h2>
          <button type="button" className="knopf knopf-neutral" onClick={onAbbrechen} disabled={sendet}>
            Zurück (Esc)
          </button>
        </div>

        <div className="bezahlen-inhalt">
          <div className="bezahlen-zeilen">
            <div className="spende-typen" role="radiogroup" aria-label="Zahlart">
              {HELFER_ZAHLUNG_TYPEN.map((t) => (
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
            <div className="bz-zeile bz-zeile-klein">
              <span className="bz-label">Offen CHF</span>
              <span className="bz-wert zahl">{formatChf(saldo.offenRappen)}</span>
            </div>
            <div className={`bz-zeile bz-zeile-rueckgeld bz-zeile-aktiv${zuViel ? ' bz-zeile-warnung' : ''}`}>
              <span className="bz-label">Zahlt {einheit}</span>
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
            {zuViel ? (
              <p className="helfer-warnung" role="alert">
                Mehr als offen: CHF {formatChf(gegenwertChf)} statt CHF {formatChf(saldo.offenRappen)}. Erlaubt, der Saldo wird dann negativ (Guthaben).
              </p>
            ) : null}
            <p className="spende-hinweis">
              {typ === 'twint'
                ? 'Helfer tippt den Betrag selbst. Bestätigung auf dem Handy prüfen. Kein Bargeld.'
                : typ === 'bar_eur'
                  ? `Der Betrag in EUR bleibt im EUR-Fach (Soll EUR steigt um EUR ${formatEur(betrag)}). Die Schublade öffnet.`
                  : 'Das Geld kommt in die Lade und erhöht den Soll-Bestand CHF. Die Schublade öffnet.'}{' '}
              Teilbetrag erlaubt, es wird kein Bon gedruckt.
            </p>
          </div>

          <div className="bezahlen-eingabe">
            <Ziffernblock onTaste={taste} deaktiviert={sendet} />
          </div>
        </div>

        <div className="bezahlen-fuss">
          <button type="button" className="knopf knopf-primaer knopf-riesig" onClick={() => void senden()} disabled={!erfassbar}>
            {sendet ? 'Wird gespeichert …' : 'Zahlung erfassen (Enter)'}
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
          <p>Die Zahlung wurde vielleicht nicht gespeichert. «Nochmals senden» wiederholt dieselbe Zahlung (keine doppelte Buchung).</p>
        </Popup>
      ) : null}

      {popup?.art === 'fehler' ? (
        <Popup titel="Zahlung nicht erfasst" art="fehler" knoepfe={[{ text: 'OK', art: 'primaer', autoFokus: true, onClick: () => setPopup(null) }]}>
          <p>{popup.meldung}</p>
        </Popup>
      ) : null}
    </div>
  )
}
