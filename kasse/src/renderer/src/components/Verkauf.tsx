/**
 * Verkaufsbildschirm: Kopfzeile, Produktraster links, Warenkorb rechts, Banner nach dem Bezahlen,
 * Bezahldialog als Overlay. Dazu die freie Spende ohne Kauf (Knopf "Spende" im Warenkorb-Panel,
 * Spendedialog als Overlay, danach eigener Banner "Spende CHF 5.00 (Twint) erfasst"; Warenkorb bleibt).
 *
 * Zahlart «Helfer» oeffnet den Helferdialog (Name, dann «Gleich zahlen» oder «Spaeter zahlen»).
 * «Gleich zahlen» fuehrt in den bestehenden Bezahldialog mit dem Helfernamen im Kopf; «Spaeter zahlen»
 * speichert den Verkauf mit zahlart helfer (offene Schuld) und zeigt das Banner mit Sofort-ausgeben-Hinweis.
 */
import { useCallback, useEffect, useState, type JSX } from 'react'
import type { Einstellungen, Kassentag, Produkt, Spende, StatusAntwort, VerkaufAntwort, Warenkorb } from '@core/types'
import { entfernen, hinzufuegen, leererWarenkorb, mengeAendern } from '@core/warenkorb'
import { api, fehlerMeldung } from '../api'
import type { BannerZustand, BarOderTwint } from '../bezahlen'
import { rabattSatz, wirksamerSatz } from '../rabatt'
import { spendeBannerText } from '../spende'
import { Banner } from './Banner'
import { Bezahldialog } from './Bezahldialog'
import { Helferdialog } from './Helferdialog'
import { Kopfzeile } from './Kopfzeile'
import { Produktraster } from './Produktraster'
import { Spendedialog } from './Spendedialog'
import { WarenkorbPanel } from './WarenkorbPanel'

interface Props {
  kassentag: Kassentag | null
  status: StatusAntwort | null
  verbunden: boolean
  einstellungen: Einstellungen | null
  warenkorb: Warenkorb
  onWarenkorb: (w: Warenkorb) => void
  /** Rabatt-Knopf im Warenkorb gedrueckt (gilt fuer den ganzen Beleg) */
  rabattAktiv: boolean
  onRabatt: (aktiv: boolean) => void
  banner: BannerZustand | null
  onBanner: (b: VerkaufAntwort | null) => void
  /** "Rueckgeld als Spende" zum Beleg im Banner wurde erfasst */
  onSpendeErfasst: (spende: Spende) => void
  /** Kasse beenden (PIN); nur im Electron-Fenster vorhanden */
  onBeenden?: () => void
  onLetzte: () => void
  onHelfer: () => void
  onAbschluss: () => void
  onVerwaltung: () => void
  onEinstellungen: () => void
}

/** Offener Bezahldialog: Zahlart mit Geld, bei Helfer «gleich zahlen» mit Namen. */
interface Bezahlen {
  zahlart: BarOderTwint
  helferName: string | null
}

export function Verkauf(p: Props): JSX.Element {
  const [produkte, setProdukte] = useState<Produkt[]>([])
  const [ladeFehler, setLadeFehler] = useState<string | null>(null)
  const [bezahlen, setBezahlen] = useState<Bezahlen | null>(null)
  const [helferDialog, setHelferDialog] = useState(false)
  const [meldung, setMeldung] = useState<string | null>(null)
  /** true, solange das Banner ein Druckproblem zeigt: dann schliesst es nur ueber den Knopf */
  const [bannerFest, setBannerFest] = useState(false)
  const [spendeDialog, setSpendeDialog] = useState(false)
  /** zuletzt erfasste freie Spende (Banner, bis zum naechsten Antippen) */
  const [spendeBanner, setSpendeBanner] = useState<Spende | null>(null)

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
    setSpendeBanner(null)
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
  const satz = rabattSatz(p.einstellungen)
  const rabattProzent = wirksamerSatz(p.rabattAktiv, satz)

  /** Nach jedem gespeicherten Verkauf (Bezahldialog oder Helfer «spaeter zahlen»). */
  const verkaufGespeichert = (antwort: VerkaufAntwort): void => {
    setBezahlen(null)
    setHelferDialog(false)
    p.onWarenkorb(leererWarenkorb())
    // Rabatt gilt immer nur fuer einen Beleg: naechster Kunde faengt ohne Rabatt an.
    p.onRabatt(false)
    setBannerFest(false)
    p.onBanner(antwort)
    void ladeProdukte()
  }

  return (
    <div className="seite seite-verkauf">
      <Kopfzeile
        kassentag={p.kassentag}
        status={p.status}
        verbunden={p.verbunden}
        onBeenden={p.onBeenden}
        onLetzte={p.onLetzte}
        onHelfer={p.onHelfer}
        onAbschluss={p.onAbschluss}
        onVerwaltung={p.onVerwaltung}
        onEinstellungen={p.onEinstellungen}
      />
      {p.banner !== null ? (
        <Banner
          key={p.banner.antwort.verkauf.id}
          antwort={p.banner.antwort}
          storno={p.banner.storno}
          druck={p.status?.druck ?? null}
          spende={p.banner.spende}
          onDruckProblem={setBannerFest}
          onSpende={p.onSpendeErfasst}
          onSchliessen={() => {
            setBannerFest(false)
            p.onBanner(null)
          }}
        />
      ) : null}
      {spendeBanner !== null ? (
        <div className="banner banner-spende-frei" role="status">
          <div className="banner-links">
            <div className="banner-rueckgeld banner-rueckgeld-klein">{spendeBannerText(spendeBanner)}</div>
            <div className="banner-druck banner-druck-ok">Kein Bon. Die Spende zählt im Abschluss zu den Spenden-Zeilen.</div>
          </div>
          <button type="button" className="knopf knopf-neutral" onClick={() => setSpendeBanner(null)} aria-label="Spenden-Banner schliessen">
            ×
          </button>
        </div>
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
          onLeeren={() => {
            p.onWarenkorb(leererWarenkorb())
            p.onRabatt(false)
          }}
          rabattSatz={satz}
          rabattAktiv={p.rabattAktiv}
          onRabatt={p.onRabatt}
          onZahlart={(za) => {
            if (p.warenkorb.zeilen.length === 0) return
            if (!bannerFest) p.onBanner(null)
            setSpendeBanner(null)
            if (za === 'helfer') setHelferDialog(true)
            else setBezahlen({ zahlart: za, helferName: null })
          }}
          spendeMoeglich={p.kassentag !== null}
          onSpende={() => {
            setSpendeBanner(null)
            setSpendeDialog(true)
          }}
        />
      </div>
      {spendeDialog ? (
        <Spendedialog
          kursX10000={kurs}
          onAbbrechen={() => setSpendeDialog(false)}
          onErfolg={(spende) => {
            setSpendeDialog(false)
            if (!bannerFest) p.onBanner(null)
            setSpendeBanner(spende)
          }}
        />
      ) : null}
      {helferDialog ? (
        <Helferdialog
          warenkorb={p.warenkorb}
          rabattProzent={rabattProzent}
          eurMoeglich={eurMoeglich}
          verdeckt={bezahlen !== null}
          onAbbrechen={() => setHelferDialog(false)}
          onSpaeterGespeichert={verkaufGespeichert}
          onGleichZahlen={(name, za) => setBezahlen({ zahlart: za, helferName: name })}
        />
      ) : null}
      {bezahlen !== null ? (
        <Bezahldialog
          zahlart={bezahlen.zahlart}
          helferName={bezahlen.helferName}
          warenkorb={p.warenkorb}
          kursX10000={kurs > 0 ? kurs : 1}
          rabattProzent={rabattProzent}
          // Zurueck aus «gleich zahlen» fuehrt in den Helferdialog (bleibt offen), sonst in den Warenkorb
          onAbbrechen={() => setBezahlen(null)}
          onErfolg={verkaufGespeichert}
        />
      ) : null}
    </div>
  )
}
