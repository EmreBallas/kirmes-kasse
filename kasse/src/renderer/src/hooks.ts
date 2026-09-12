/**
 * Kleine React-Hooks: laufende Uhr, Status-Polling (alle 2 s), verzoegerte Warenkorb-Sicherung.
 */
import { useEffect, useRef, useState } from 'react'
import type { StatusAntwort, Warenkorb } from '@core/types'
import { api } from './api'

/** Aktuelle Zeit, jede Sekunde neu. */
export function useJetzt(intervallMs = 1000): Date {
  const [jetzt, setJetzt] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setJetzt(new Date()), intervallMs)
    return () => window.clearInterval(timer)
  }, [intervallMs])
  return jetzt
}

export interface StatusZustand {
  status: StatusAntwort | null
  verbunden: boolean
  neuLaden: () => void
}

/** Pollt /api/status alle 2 s (KONTRAKT). verbunden = letzte Abfrage erfolgreich. */
export function useStatus(intervallMs = 2000): StatusZustand {
  const [status, setStatus] = useState<StatusAntwort | null>(null)
  const [verbunden, setVerbunden] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let aktiv = true
    let laeuft = false
    const abfragen = async (): Promise<void> => {
      if (laeuft) return
      laeuft = true
      try {
        const s = await api.status()
        if (aktiv) {
          setStatus(s)
          setVerbunden(true)
        }
      } catch {
        if (aktiv) setVerbunden(false)
      } finally {
        laeuft = false
      }
    }
    void abfragen()
    const timer = window.setInterval(() => void abfragen(), intervallMs)
    return () => {
      aktiv = false
      window.clearInterval(timer)
    }
  }, [intervallMs, tick])

  return { status, verbunden, neuLaden: () => setTick((t) => t + 1) }
}

/**
 * Sichert den Warenkorb-Entwurf 300 ms nach der letzten Aenderung (PUT), aber erst,
 * wenn der Entwurf beim Start geladen wurde (sonst wuerde ein leerer Korb den gesicherten ueberschreiben).
 */
export function useWarenkorbSicherung(warenkorb: Warenkorb, geladen: boolean, verzoegerungMs = 300): void {
  const ersterLauf = useRef(true)
  useEffect(() => {
    if (!geladen) return
    if (ersterLauf.current) {
      // Der erste Lauf nach dem Laden ist der geladene Zustand selbst: nicht zuruecksichern.
      ersterLauf.current = false
      return
    }
    const timer = window.setTimeout(() => {
      api.warenkorbEntwurfSpeichern(warenkorb).catch(() => {
        /* Entwurf ist nur Komfort; Fehler nicht blockierend */
      })
    }, verzoegerungMs)
    return () => window.clearTimeout(timer)
  }, [warenkorb, geladen, verzoegerungMs])
}
