/**
 * Rueckfrage "CHF 2.00 als Spende behalten?" fuer einen bereits abgeschlossenen Bar-Beleg (Banner und
 * Letzte Verkaeufe). "Ja, Spende" sendet POST /api/spende mit typ bar_chf, Betrag = Rueckgeld des Belegs.
 * Die Spenden-UUID wird beim Oeffnen erzeugt und bei "Nochmals senden" wiederverwendet (Idempotenz).
 * 409 bereits_gespendet zeigt die feste Meldung, andere Fehler den Servertext. Kein Druck.
 */
import { useState, type JSX } from 'react'
import type { Spende, Verkauf, Zahlung } from '@core/types'
import { formatChf } from '@core/geld'
import { ApiFehler, NetzFehler, api, fehlerMeldung } from '../api'
import { BEREITS_GESPENDET_TEXT, baueRueckgeldSpende, neueSpendeId } from '../spende'
import { Popup } from './Popup'

interface Props {
  verkauf: Pick<Verkauf, 'id' | 'belegnr'>
  zahlung: Pick<Zahlung, 'rueckgeldChfRappen'>
  onErfasst: (spende: Spende) => void
  onAbbrechen: () => void
}

type Zustand = { art: 'frage' } | { art: 'netzfehler' } | { art: 'fehler'; meldung: string }

export function RueckgeldSpendeFrage({ verkauf, zahlung, onErfasst, onAbbrechen }: Props): JSX.Element {
  const [spendeId] = useState(() => neueSpendeId())
  const [zustand, setZustand] = useState<Zustand>({ art: 'frage' })
  const [sendet, setSendet] = useState(false)

  const senden = async (): Promise<void> => {
    if (sendet) return
    setSendet(true)
    try {
      const antwort = await api.spendeErfassen(baueRueckgeldSpende(spendeId, verkauf, zahlung))
      onErfasst(antwort.spende)
    } catch (e) {
      if (e instanceof NetzFehler) setZustand({ art: 'netzfehler' })
      else if (e instanceof ApiFehler && e.fehler === 'bereits_gespendet') setZustand({ art: 'fehler', meldung: BEREITS_GESPENDET_TEXT })
      else setZustand({ art: 'fehler', meldung: fehlerMeldung(e) })
    } finally {
      setSendet(false)
    }
  }

  if (zustand.art === 'fehler') {
    return (
      <Popup titel="Spende nicht erfasst" art="fehler" knoepfe={[{ text: 'OK', art: 'primaer', autoFokus: true, onClick: onAbbrechen }]}>
        <p>{zustand.meldung}</p>
      </Popup>
    )
  }

  if (zustand.art === 'netzfehler') {
    return (
      <Popup
        titel="Keine Verbindung zum Kassen-Server"
        art="fehler"
        knoepfe={[
          { text: 'Abbrechen', art: 'neutral', onClick: onAbbrechen },
          { text: 'Nochmals senden', art: 'primaer', autoFokus: true, onClick: () => void senden() }
        ]}
      >
        <p>Die Spende wurde vielleicht nicht gespeichert. «Nochmals senden» wiederholt dieselbe Spende (keine doppelte Buchung).</p>
      </Popup>
    )
  }

  return (
    <Popup
      titel={`CHF ${formatChf(zahlung.rueckgeldChfRappen)} als Spende behalten?`}
      art="frage"
      knoepfe={[
        { text: 'Abbrechen', art: 'neutral', onClick: onAbbrechen },
        { text: sendet ? 'Wird gespeichert …' : 'Ja, Spende', art: 'primaer', autoFokus: true, onClick: () => void senden() }
      ]}
    >
      <p>
        Rückgeld zu Beleg <span className="zahl">{verkauf.belegnr}</span> bleibt als Bar-Spende in der Kasse. Es wird kein Bon gedruckt.
      </p>
    </Popup>
  )
}
