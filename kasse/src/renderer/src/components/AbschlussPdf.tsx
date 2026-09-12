/**
 * Anzeige der Abschluss-PDF: Pfad in Monospace (umbrechend) und Knopf "Archivordner oeffnen".
 * Der Knopf erscheint nur in der Kassen-App (window.kasse vorhanden); im Browser (Plan B) kann der
 * Server keinen Explorer oeffnen, dort steht nur der Pfad.
 */
import { useState, type JSX } from 'react'
import { api, fehlerMeldung } from '../api'

interface Props {
  /** Pfad der PDF; null = wird noch erstellt (oder unbekannt) */
  pfad: string | null
  /** Text, solange kein Pfad da ist */
  wartetText?: string
}

export function archivKnopfMoeglich(): boolean {
  return typeof window !== 'undefined' && window.kasse !== undefined
}

export function ArchivOeffnenKnopf(): JSX.Element {
  const [laeuft, setLaeuft] = useState(false)
  const [meldung, setMeldung] = useState<string | null>(null)

  const oeffnen = async (): Promise<void> => {
    if (laeuft) return
    setLaeuft(true)
    setMeldung(null)
    try {
      await api.archivOeffnen()
    } catch (e) {
      setMeldung(fehlerMeldung(e))
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <>
      <button type="button" className="knopf knopf-neutral knopf-gross" onClick={() => void oeffnen()} disabled={laeuft}>
        Archivordner öffnen
      </button>
      {meldung !== null ? (
        <span className="meldung-fehler" role="status">
          {meldung}
        </span>
      ) : null}
    </>
  )
}

export function AbschlussPdf({ pfad, wartetText = 'Abschluss-PDF wird erstellt …' }: Props): JSX.Element {
  if (pfad === null) {
    return (
      <div className="abschluss-pdf" role="status">
        <span>{wartetText}</span>
      </div>
    )
  }
  return (
    <div className="abschluss-pdf">
      <span>
        Abschluss-PDF gespeichert: <span className="pdf-pfad">{pfad}</span>
      </span>
      {archivKnopfMoeglich() ? <ArchivOeffnenKnopf /> : null}
    </div>
  )
}
