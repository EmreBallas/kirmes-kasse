/**
 * Verkaufsbildschirm: Kopfzeile, Produktraster links, Warenkorb rechts, Banner nach dem Bezahlen,
 * Bezahldialog als Overlay.
 */
import { useCallback, useEffect, useState, type JSX } from 'react'
import type { Einstellungen, Kassentag, Produkt, StatusAntwort, VerkaufAntwort, Warenkorb, Zahlart } from '@core/types'
import { entfernen, hinzufuegen, leererWarenkorb, mengeAendern } from '@core/warenkorb'
import { api, fehlerMeldung } from '../api'
import { Banner } from './Banner'
import { Bezahldialog } from './Bezahldialog'
import { Kopfzeile } from './Kopfzeile'
import { Produktraster } from './Produktraster'
import { WarenkorbPanel } from './WarenkorbPanel'

interface Props {
  kassentag: Kassentag | null
  status: StatusAntwort | null
  verbunden: boolean
  einstellungen: Einstellungen | null
  warenkorb: Warenkorb
  onWarenkorb: (w: Warenkorb) => void
  banner: VerkaufAntwort | null
  onBanner: (b: VerkaufAntwort | null) => void
  onLetzte: () => void
  onAbschluss: () => void
  onVerwaltung: () => void
  onEinstellungen: () => void
}

export function Verkauf(p: Props): JSX.Element {
  const [produkte, setProdukte] = useState<Produkt[]>([])
  const [ladeFehler, setLadeFehler] = useState<string | null>(null)
  const [zahlart, setZahlart] = useState<Zahlart | null>(null)
  const [meldung, setMeldung] = useState<string | null>(null)
  /** true, solange das Banner ein Druckproblem zeigt: dann schliesst es nur ueber den Knopf */
  const [bannerFest, setBannerFest] = useState(false)

  const ladeProdukte = useCallback(async (): Promise<void> => {
    try {
      setProdukte(await api.produkte())
      setLadeFehler(null)
    } catch (e) {
      setLadeFehler(fehlerMeldung(e))
    }
  }, [])

  useEffect(() => {
    void ladeProdukte()
  }, [ladeProdukte])

  const antippen = (produkt: Produkt): void => {
    if (produkt.preisRappen === null) return
    // Banner bleibt bis zum naechsten Antippen einer Kachel; bei Druckproblem nur ueber den Knopf
    if (!bannerFest) p.onBanner(null)
    setMeldung(null)
    p.onWarenkorb(hinzufuegen(p.warenkorb, produkt))
  }

  const ausverkauft = async (produkt: Produkt, wert: boolean): Promise<void> => {
    // optimistisch anzeigen, dann Server
    setProdukte((alt) => alt.map((x) => (x.id === produkt.id ? { ...x, ausverkauft: wert } : x)))
    try {
      const neu = await api.ausverkauftSetzen(produkt.id, wert)
      setProdukte((alt) => alt.map((x) => (x.id === neu.id ? neu : x)))
    } catch (e) {
      setMeldung(fehlerMeldung(e))
      void ladeProdukte()
    }
  }

  const kurs = p.einstellungen?.eurKursX10000 ?? 0
  const eurMoeglich = kurs > 0

  return (
    <div className="seite seite-verkauf">
      <Kopfzeile
        kassentag={p.kassentag}
        status={p.status}
        verbunden={p.verbunden}
        onLetzte={p.onLetzte}
        onAbschluss={p.onAbschluss}
        onVerwaltung={p.onVerwaltung}
        onEinstellungen={p.onEinstellungen}
      />
      {p.banner !== null ? (
        <Banner
          key={p.banner.verkauf.id}
          antwort={p.banner}
          druck={p.status?.druck ?? null}
          onDruckProblem={setBannerFest}
          onSchliessen={() => {
            setBannerFest(false)
            p.onBanner(null)
          }}
        />
      ) : null}
      {meldung !== null ? (
        <div className="meldung-fehler meldung-leiste" role="alert">
          {meldung}
          <button type="button" className="knopf knopf-neutral knopf-klein" onClick={() => setMeldung(null)}>
            OK
          </button>
        </div>
      ) : null}
      <div className="verkauf-inhalt">
        <section className="verkauf-links">
          {ladeFehler !== null ? (
            <div className="karte karte-fehler">
              <p>Produkte konnten nicht geladen werden: {ladeFehler}</p>
              <button type="button" className="knopf knopf-primaer" onClick={() => void ladeProdukte()}>
                Nochmals laden
              </button>
            </div>
          ) : (
            <Produktraster produkte={produkte} warenkorb={p.warenkorb} onAntippen={antippen} onAusverkauft={(pr, w) => void ausverkauft(pr, w)} />
          )}
        </section>
        <WarenkorbPanel
          warenkorb={p.warenkorb}
          eurMoeglich={eurMoeglich}
          onMenge={(id, delta) => p.onWarenkorb(mengeAendern(p.warenkorb, id, delta))}
          onEntfernen={(id) => p.onWarenkorb(entfernen(p.warenkorb, id))}
          onLeeren={() => p.onWarenkorb(leererWarenkorb())}
          onZahlart={(za) => {
            if (p.warenkorb.zeilen.length === 0) return
            if (!bannerFest) p.onBanner(null)
            setZahlart(za)
          }}
        />
      </div>
      {zahlart !== null ? (
        <Bezahldialog
          zahlart={zahlart}
          warenkorb={p.warenkorb}
          kursX10000={kurs > 0 ? kurs : 1}
          onAbbrechen={() => setZahlart(null)}
          onErfolg={(antwort) => {
            setZahlart(null)
            p.onWarenkorb(leererWarenkorb())
            setBannerFest(false)
            p.onBanner(antwort)
            void ladeProdukte()
          }}
        />
      ) : null}
    </div>
  )
}
