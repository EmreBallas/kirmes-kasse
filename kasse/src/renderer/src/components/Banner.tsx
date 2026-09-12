/**
 * Banner nach dem Bezahlen: Belegnummer, Rueckgeld gross, "Sofort ausgeben", Druckhinweis.
 *
 * Das Banner verfolgt den eigenen Druckauftrag ueber GET /api/druck/:id (jede Sekunde), statt nur auf
 * die Ampel zu warten: beim winspool-Transport dauert ein scheiternder Auftrag 12-20 s, bis er failed
 * ist. Solange zeigt das Banner "Druck laeuft ...", nach DRUCK_WARTEZEIT_MS ohne "done" bereits die
 * Handschreib-Liste. Bei einem Druckproblem meldet es sich ueber onDruckProblem, damit es nicht durch
 * das Antippen einer Kachel verschwindet, sondern nur ueber den Schliessen-Knopf.
 *
 * Wurde der Beleg des Banners inzwischen in "Letzte Verkaeufe" storniert (storno != null), zeigt das
 * Banner statt Rueckgeld die Storno-Zeile ("Beleg K1-0004 storniert · Auszahlung CHF 2.50"), verfolgt
 * keinen Druck mehr und schliesst wie gewohnt beim naechsten Antippen einer Kachel.
 *
 * "Rueckgeld als Spende": Bei einem Bar-Beleg mit Rueckgeld > 0 bietet das Banner einen Knopf an, weil der
 * Kunde oft erst nach dem Kassieren "passt schon" sagt. Die Spende wird separat erfasst (POST /api/spende,
 * kein Bon); danach zeigt das Banner "Spende CHF 2.00 erfasst" und der Knopf verschwindet.
 */
import { useEffect, useRef, useState, type JSX } from 'react'
import type { Druckauftrag, DruckStatus, Spende, Storno, VerkaufAntwort } from '@core/types'
import { formatChf } from '@core/geld'
import { api } from '../api'
import { rueckgeldSpendeMoeglich, rueckgeldSpendeText } from '../spende'
import { RueckgeldSpendeFrage } from './RueckgeldSpende'
import {
  DRUCK_POLL_MS,
  STORNO_GRUND_NAME,
  ZAHLART_NAME,
  bannerDruckProblem,
  druckVerlauf,
  handschreibListe,
  listeAlsText,
  stornoBannerText
} from '../bezahlen'

interface Props {
  antwort: VerkaufAntwort
  /** Storno dieses Belegs, falls er nach dem Bezahlen storniert wurde */
  storno?: Storno | null
  druck: DruckStatus | null
  /** nachtraeglich erfasste "Rueckgeld als Spende" zu diesem Beleg (auch stornierte) */
  spende?: Spende | null
  onSchliessen: () => void
  /** meldet, ob das Banner gerade ein Druckproblem zeigt (dann nur ueber den Knopf schliessen) */
  onDruckProblem?: (problem: boolean) => void
  /** "Rueckgeld als Spende" wurde erfasst; fehlt der Callback, gibt es keinen Knopf */
  onSpende?: (spende: Spende) => void
}

export function Banner({ antwort, storno = null, druck, spende = null, onSchliessen, onDruckProblem, onSpende }: Props): JSX.Element {
  const { verkauf, zahlung, sofortAusgeben, positionen } = antwort
  const auftragId = antwort.druckauftragId
  const storniert = storno !== null
  const [auftrag, setAuftrag] = useState<Druckauftrag | null>(null)
  const [vergangenMs, setVergangenMs] = useState(0)
  const [spendeFrage, setSpendeFrage] = useState(false)
  const start = useRef(Date.now())
  const fertig = auftrag?.status === 'done' || auftrag?.status === 'failed'

  // Eigenen Druckauftrag verfolgen, bis er done oder failed ist (nach Storno nicht mehr noetig)
  useEffect(() => {
    if (auftragId === null || fertig || storniert) return undefined
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
  }, [auftragId, fertig, storniert])

  const verlauf = druckVerlauf(auftrag, auftragId !== null, vergangenMs)
  // Ein stornierter Beleg ist kein Druckproblem mehr: das Banner schliesst wieder per Kachel
  const druckProblem = !storniert && bannerDruckProblem(verlauf, druck?.ampel ?? null)
  const druckFehler = auftrag?.fehler ?? druck?.letzterFehler ?? null
  const handschreiben = handschreibListe(positionen)
  const zeigeSpende = zahlung.spendeChfRappen > 0
  const spendeErfasst = spende !== null && spende.storniertAm === null
  const spendeKnopf = onSpende !== undefined && rueckgeldSpendeMoeglich(verkauf, zahlung, storniert, spende)

  useEffect(() => {
    onDruckProblem?.(druckProblem)
  }, [druckProblem, onDruckProblem])

  if (storno !== null) {
    return (
      <div className="banner banner-storniert" role="status">
        <div className="banner-links">
          <div className="banner-beleg">
            Beleg <span className="zahl">{verkauf.belegnr}</span> · {ZAHLART_NAME[verkauf.zahlart]} · Storno ({STORNO_GRUND_NAME[storno.grund]})
          </div>
          <div className="banner-rueckgeld banner-rueckgeld-klein banner-storno-zeile">{stornoBannerText(verkauf.belegnr, storno)}</div>
        </div>
        <button type="button" className="knopf knopf-neutral" onClick={onSchliessen} aria-label="Banner schliessen">
          ×
        </button>
      </div>
    )
  }

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
        {spendeErfasst && spende !== null ? <div className="banner-spende-erfasst">{rueckgeldSpendeText(spende)}</div> : null}
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
      <div className="banner-aktionen">
        <button type="button" className="knopf knopf-neutral" onClick={onSchliessen} aria-label="Banner schliessen">
          ×
        </button>
        {spendeKnopf ? (
          <button type="button" className="knopf knopf-neutral knopf-rueckgeld-spende" onClick={() => setSpendeFrage(true)}>
            Rückgeld als Spende
          </button>
        ) : null}
      </div>
      {spendeFrage && onSpende !== undefined ? (
        <RueckgeldSpendeFrage
          verkauf={verkauf}
          zahlung={zahlung}
          onAbbrechen={() => setSpendeFrage(false)}
          onErfasst={(sp) => {
            setSpendeFrage(false)
            onSpende(sp)
          }}
        />
      ) : null}
    </div>
  )
}
