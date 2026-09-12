/**
 * Banner nach dem Bezahlen: Belegnummer, Rueckgeld gross, "Sofort ausgeben", Druckhinweis.
 *
 * Das Banner verfolgt den eigenen Druckauftrag ueber GET /api/druck/:id (jede Sekunde), statt nur auf
 * die Ampel zu warten: beim winspool-Transport dauert ein scheiternder Auftrag 12-20 s, bis er failed
 * ist. Solange zeigt das Banner "Druck laeuft ...", nach DRUCK_WARTEZEIT_MS ohne "done" bereits die
 * Handschreib-Liste. Bei einem Druckproblem meldet es sich ueber onDruckProblem, damit es nicht durch
 * das Antippen einer Kachel verschwindet, sondern nur ueber den Schliessen-Knopf.
 */
import { useEffect, useRef, useState, type JSX } from 'react'
import type { Druckauftrag, DruckStatus, VerkaufAntwort } from '@core/types'
import { formatChf } from '@core/geld'
import { api } from '../api'
import { DRUCK_POLL_MS, ZAHLART_NAME, bannerDruckProblem, druckVerlauf, handschreibListe, listeAlsText } from '../bezahlen'

interface Props {
  antwort: VerkaufAntwort
  druck: DruckStatus | null
  onSchliessen: () => void
  /** meldet, ob das Banner gerade ein Druckproblem zeigt (dann nur ueber den Knopf schliessen) */
  onDruckProblem?: (problem: boolean) => void
}

export function Banner({ antwort, druck, onSchliessen, onDruckProblem }: Props): JSX.Element {
  const { verkauf, zahlung, sofortAusgeben, positionen } = antwort
  const auftragId = antwort.druckauftragId
  const [auftrag, setAuftrag] = useState<Druckauftrag | null>(null)
  const [vergangenMs, setVergangenMs] = useState(0)
  const start = useRef(Date.now())
  const fertig = auftrag?.status === 'done' || auftrag?.status === 'failed'

  // Eigenen Druckauftrag verfolgen, bis er done oder failed ist
  useEffect(() => {
    if (auftragId === null || fertig) return undefined
    let aktiv = true
    let laeuft = false
    const abfragen = async (): Promise<void> => {
      if (laeuft) return
      laeuft = true
      try {
        const a = await api.druckauftrag(auftragId)
        if (aktiv) setAuftrag(a)
      } catch {
        /* keine Antwort: die Wartezeit laeuft weiter, notfalls entscheidet die Ampel */
      } finally {
        laeuft = false
      }
    }
    void abfragen()
    const timer = window.setInterval(() => {
      setVergangenMs(Date.now() - start.current)
      void abfragen()
    }, DRUCK_POLL_MS)
    return () => {
      aktiv = false
      window.clearInterval(timer)
    }
  }, [auftragId, fertig])

  const verlauf = druckVerlauf(auftrag, auftragId !== null, vergangenMs)
  const druckProblem = bannerDruckProblem(verlauf, druck?.ampel ?? null)
  const druckFehler = auftrag?.fehler ?? druck?.letzterFehler ?? null
  const handschreiben = handschreibListe(positionen)
  const zeigeSpende = zahlung.spendeChfRappen > 0

  useEffect(() => {
    onDruckProblem?.(druckProblem)
  }, [druckProblem, onDruckProblem])

  return (
    <div className={`banner${druckProblem ? ' banner-druckproblem' : ''}`} role="status">
      <div className="banner-links">
        <div className="banner-beleg">
          Beleg <span className="zahl">{verkauf.belegnr}</span> · {ZAHLART_NAME[verkauf.zahlart]}
          {antwort.bereitsVorhanden ? ' · bereits gespeichert' : ''}
        </div>
        {verkauf.zahlart === 'twint' || verkauf.zahlart === 'helfer' ? (
          <div className="banner-rueckgeld banner-rueckgeld-klein">
            {verkauf.zahlart === 'helfer' ? 'Helfer / Gratis' : 'Twint bezahlt'}
            {zeigeSpende ? (
              <span>
                {' '}
                · Spende CHF <span className="zahl">{formatChf(zahlung.spendeChfRappen)}</span>
              </span>
            ) : null}
          </div>
        ) : (
          <div className="banner-rueckgeld">
            Rückgeld CHF <span className="zahl">{formatChf(zahlung.rueckgeldChfRappen)}</span>
            {zeigeSpende ? (
              <span className="banner-spende">
                {' '}
                · Spende CHF <span className="zahl">{formatChf(zahlung.spendeChfRappen)}</span>
              </span>
            ) : null}
          </div>
        )}
        {sofortAusgeben.length > 0 ? (
          <div className="banner-sofort">Sofort ausgeben: {listeAlsText(sofortAusgeben)}</div>
        ) : null}
        {druckProblem ? (
          <div className="banner-druck">
            <strong>Drucker prüfen</strong>
            {verlauf === 'lange' ? ' (Beleg ist noch nicht gedruckt)' : druckFehler !== null ? ` (${druckFehler})` : ''}
            {handschreiben.length > 0 ? ` – Coupons von Hand schreiben: ${listeAlsText(handschreiben)}` : ''}
            {' – Hinweis bleibt bis zum Schliessen mit ×'}
          </div>
        ) : verlauf === 'laeuft' ? (
          <div className="banner-druck banner-druck-laeuft">Druck läuft …</div>
        ) : verlauf === 'done' ? (
          <div className="banner-druck banner-druck-ok">Gedruckt</div>
        ) : null}
      </div>
      <button type="button" className="knopf knopf-neutral" onClick={onSchliessen} aria-label="Banner schliessen">
        ×
      </button>
    </div>
  )
}
