/**
 * Wurzel der Kasse: haelt Ansicht, Kassentag, Einstellungen, Warenkorb (Entwurf) und Banner.
 * Kein Router: ansicht = 'start' | 'verkauf' | 'letzte' | 'abschluss' | 'verwaltung' | 'einstellungen'.
 */
import { useCallback, useEffect, useState, type JSX } from 'react'
import type { Einstellungen as EinstellungenTyp, Kassentag, Warenkorb } from '@core/types'
import { leererWarenkorb } from '@core/warenkorb'
import { api, type KassentagAktuellAntwort } from './api'
import { bannerAusAntwort, bannerNachSpende, bannerNachStorno, type BannerZustand } from './bezahlen'
import { useStatus, useWarenkorbSicherung } from './hooks'
import { rabattAusEntwurf } from './rabatt'
import { Abschluss } from './components/Abschluss'
import { Einstellungen } from './components/Einstellungen'
import { Kassenstart } from './components/Kassenstart'
import { LetzteVerkaeufe } from './components/LetzteVerkaeufe'
import { PinDialog } from './components/PinDialog'
import { Verkauf } from './components/Verkauf'
import { Verwaltung } from './components/Verwaltung'

export type Ansicht = 'start' | 'verkauf' | 'letzte' | 'abschluss' | 'verwaltung' | 'einstellungen'

type Geschuetzt = 'verwaltung' | 'einstellungen'

function App(): JSX.Element {
  const [ansicht, setAnsicht] = useState<Ansicht>('start')
  const [aktuell, setAktuell] = useState<KassentagAktuellAntwort | null>(null)
  const [einstellungen, setEinstellungen] = useState<EinstellungenTyp | null>(null)
  const [warenkorb, setWarenkorb] = useState<Warenkorb>(leererWarenkorb)
  /** Rabatt-Knopf im Warenkorb (ganzer Beleg); ueberlebt dank Entwurf einen Neustart */
  const [rabattAktiv, setRabattAktiv] = useState(false)
  const [entwurfGeladen, setEntwurfGeladen] = useState(false)
  const [banner, setBanner] = useState<BannerZustand | null>(null)
  const [abschlussTag, setAbschlussTag] = useState<Kassentag | null>(null)
  const [pinFuer, setPinFuer] = useState<Geschuetzt | null>(null)
  const [pin, setPin] = useState<string | null>(null)
  const [beendenAnfrage, setBeendenAnfrage] = useState(false)
  const { status, verbunden } = useStatus()

  useWarenkorbSicherung(warenkorb, rabattAktiv, entwurfGeladen)

  /** Beenden ist nur im Electron-Fenster moeglich (Plan B im Browser hat keine Bruecke). */
  const beendenMoeglich = window.kasse !== undefined

  /**
   * Beenden hinter PIN: beide Wege (Knopf "Beenden" in der Kopfzeile und IPC von Electron bei
   * Ctrl+Shift+Q / Alt+F4 / Fenster schliessen) oeffnen denselben PIN-Dialog ueber diese Funktion.
   */
  const beendenAnfragen = useCallback((): void => {
    if (!beendenMoeglich) return
    setBeendenAnfrage(true)
  }, [beendenMoeglich])

  // Electron (preload) bittet um die Beenden-PIN: Ctrl+Shift+Q oder Alt+F4/Fenster schliessen.
  useEffect(() => {
    const bruecke = window.kasse
    if (bruecke === undefined) return undefined
    return bruecke.onBeendenAnfragen(beendenAnfragen)
  }, [beendenAnfragen])

  /**
   * Laedt Kassentag-Status und entscheidet zwischen Kassenstart und Verkauf. Ein offener Vortag
   * (MUSS 10, Testfall 24) erzwingt den Kassenstart mit Warnung und "Abschluss nachholen";
   * der Server lehnt Verkauf und Storno dann ohnehin mit 409 vortag_offen ab.
   */
  const ladeAktuell = useCallback(async (): Promise<void> => {
    try {
      const a = await api.kassentagAktuell()
      setAktuell(a)
      setAnsicht((alt) => {
        if (a.kassentag === null || a.vortagOffen !== null) return alt === 'abschluss' ? alt : 'start'
        return alt === 'start' ? 'verkauf' : alt
      })
    } catch {
      setAktuell(null)
    }
  }, [])

  const ladeEinstellungen = useCallback(async (): Promise<void> => {
    try {
      setEinstellungen(await api.einstellungen())
    } catch {
      /* Anzeige ohne Kurs: Bar-EUR bleibt gesperrt, bis der Server antwortet */
    }
  }, [])

  useEffect(() => {
    void ladeAktuell()
    void ladeEinstellungen()
    api
      .warenkorbEntwurf()
      .then((w) => {
        if (!Array.isArray(w.zeilen)) return
        setWarenkorb({ zeilen: w.zeilen })
        // rabattAktiv fehlt bei alten Entwuerfen und alten Servern: dann kein Rabatt.
        setRabattAktiv(rabattAusEntwurf(w))
      })
      .catch(() => {
        /* kein Entwurf */
      })
      .finally(() => setEntwurfGeladen(true))
  }, [ladeAktuell, ladeEinstellungen])

  // Solange kein Server erreichbar ist, alle 3 s erneut versuchen (App-Start vor Server-Start).
  useEffect(() => {
    if (aktuell !== null) return
    const timer = window.setInterval(() => {
      void ladeAktuell()
      if (einstellungen === null) void ladeEinstellungen()
    }, 3000)
    return () => window.clearInterval(timer)
  }, [aktuell, einstellungen, ladeAktuell, ladeEinstellungen])

  const kassentag: Kassentag | null = status?.kassentag ?? aktuell?.kassentag ?? null
  const vortagIstOffen = (status?.vortagOffen ?? aktuell?.vortagOffen ?? null) !== null

  // Kippt der Status auf "Vortag offen", waehrend der Verkaufsbildschirm offen ist: zurueck zum Kassenstart.
  useEffect(() => {
    if (!vortagIstOffen || ansicht !== 'verkauf') return
    setAnsicht('start')
    void ladeAktuell()
  }, [vortagIstOffen, ansicht, ladeAktuell])

  const zumVerkauf = (): void => {
    setPin(null)
    setAnsicht(kassentag !== null && !vortagIstOffen ? 'verkauf' : 'start')
  }

  const geschuetztOeffnen = (ziel: Geschuetzt): void => {
    setPin(null)
    setPinFuer(ziel)
  }

  const pinDialog = (ziel: Geschuetzt): JSX.Element => (
    <PinDialog
      titel={ziel === 'verwaltung' ? 'PIN für Verwaltung' : 'PIN für Einstellungen'}
      onAbbrechen={() => {
        setPinFuer(null)
        zumVerkauf()
      }}
      onOk={(p) => {
        setPin(p)
        setAnsicht(ziel)
        setPinFuer(null)
      }}
    />
  )

  if (beendenAnfrage) {
    return (
      <PinDialog
        titel="PIN zum Beenden der Kasse"
        onAbbrechen={() => setBeendenAnfrage(false)}
        onOk={() => {
          setBeendenAnfrage(false)
          window.kasse?.beendenBestaetigt()
        }}
      />
    )
  }

  if (pinFuer !== null) return pinDialog(pinFuer)

  switch (ansicht) {
    case 'start':
      return (
        <Kassenstart
          aktuell={aktuell}
          onNeuLaden={() => void ladeAktuell()}
          onGestartet={(k) => {
            setAktuell((alt) => ({
              kassentag: k,
              vortagOffen: null,
              vorschlagStartgeldChfRappen: alt?.vorschlagStartgeldChfRappen ?? 0,
              letzterAbgeschlossener: alt?.letzterAbgeschlossener ?? null
            }))
            setBanner(null)
            setAnsicht('verkauf')
          }}
          onAbschlussNachholen={(k) => {
            setAbschlussTag(k)
            setAnsicht('abschluss')
          }}
        />
      )

    case 'letzte':
      return (
        <LetzteVerkaeufe
          onZurueck={zumVerkauf}
          onStorniert={(storno) => setBanner((alt) => bannerNachStorno(alt, storno))}
          onSpendeGeaendert={(spende) => setBanner((alt) => bannerNachSpende(alt, spende))}
        />
      )

    case 'abschluss': {
      const tag = abschlussTag ?? kassentag
      if (tag === null) {
        // Kein Kassentag mehr (z. B. nach Neuladen): zurueck zum Kassenstart
        return <Kassenstart aktuell={aktuell} onNeuLaden={() => void ladeAktuell()} onGestartet={() => setAnsicht('verkauf')} onAbschlussNachholen={(k) => setAbschlussTag(k)} />
      }
      return (
        <Abschluss
          kassentag={tag}
          onZurueck={() => {
            setAbschlussTag(null)
            zumVerkauf()
          }}
          onFertig={() => {
            setAbschlussTag(null)
            setBanner(null)
            setAnsicht('start')
            void ladeAktuell()
          }}
        />
      )
    }

    case 'verwaltung':
      if (pin === null) return pinDialog('verwaltung')
      return <Verwaltung pin={pin} onZurueck={zumVerkauf} onPinUngueltig={() => geschuetztOeffnen('verwaltung')} />

    case 'einstellungen':
      if (pin === null) return pinDialog('einstellungen')
      return (
        <Einstellungen
          pin={pin}
          status={status}
          einstellungen={einstellungen}
          onGeaendert={(e) => setEinstellungen(e)}
          onZurueck={zumVerkauf}
          onPinUngueltig={() => geschuetztOeffnen('einstellungen')}
        />
      )

    case 'verkauf':
      return (
        <Verkauf
          kassentag={kassentag}
          status={status}
          verbunden={verbunden}
          einstellungen={einstellungen}
          warenkorb={warenkorb}
          onWarenkorb={setWarenkorb}
          rabattAktiv={rabattAktiv}
          onRabatt={setRabattAktiv}
          banner={banner}
          onBanner={(antwort) => setBanner(bannerAusAntwort(antwort))}
          onSpendeErfasst={(spende) => setBanner((alt) => bannerNachSpende(alt, spende))}
          onBeenden={beendenMoeglich ? beendenAnfragen : undefined}
          onLetzte={() => setAnsicht('letzte')}
          onAbschluss={() => {
            setAbschlussTag(null)
            setAnsicht('abschluss')
          }}
          onVerwaltung={() => geschuetztOeffnen('verwaltung')}
          onEinstellungen={() => geschuetztOeffnen('einstellungen')}
        />
      )
  }
}

export default App
