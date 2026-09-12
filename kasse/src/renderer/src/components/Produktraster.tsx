/**
 * Produktkacheln: Name + Preis, Gruppe als Farbe, Menge im Warenkorb als Badge,
 * Ausverkauft-Toggle als kleiner Schalter auf der Kachel (ohne PIN).
 * Spaltenzahl und Zeilenhoehe werden aus der gemessenen Rastergroesse berechnet (waehleRaster),
 * damit die Kacheln auf grossen wie kleinen Bildschirmen ein aehnliches Seitenverhaeltnis haben.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import type { Produkt, Warenkorb } from '@core/types'
import { formatChf } from '@core/geld'
import { STANDARD_RASTER, waehleRaster } from '../raster'

interface Props {
  produkte: Produkt[]
  warenkorb: Warenkorb
  onAntippen: (produkt: Produkt) => void
  onAusverkauft: (produkt: Produkt, ausverkauft: boolean) => void
}

interface Mass {
  breite: number
  hoehe: number
}

/**
 * Beobachtet Breite/Hoehe eines Elements per ResizeObserver; null, bis die erste Messung vorliegt.
 * Callback-Ref, weil das Rasterelement erst erscheint, wenn Produkte geladen sind.
 */
function useMass<T extends HTMLElement>(): [(el: T | null) => void, Mass | null] {
  const beobachter = useRef<ResizeObserver | null>(null)
  const element = useRef<T | null>(null)
  const [mass, setMass] = useState<Mass | null>(null)

  const ref = useCallback((el: T | null): void => {
    beobachter.current?.disconnect()
    beobachter.current = null
    element.current = el
    if (el === null || typeof ResizeObserver === 'undefined') return
    const melden = (breite: number, hoehe: number): void => {
      setMass((alt) =>
        alt !== null && alt.breite === breite && alt.hoehe === hoehe ? alt : { breite, hoehe }
      )
    }
    const b = new ResizeObserver((eintraege) => {
      const e = eintraege[0]
      if (e !== undefined) melden(Math.floor(e.contentRect.width), Math.floor(e.contentRect.height))
    })
    b.observe(el)
    beobachter.current = b
    melden(Math.floor(el.clientWidth), Math.floor(el.clientHeight))
  }, [])

  // Sicherheitsnetz: bei Fenstergroessen-Aenderung (Vollbild an/aus, Monitorwechsel) zusaetzlich
  // direkt nachmessen, falls der ResizeObserver einmal spaet oder gar nicht meldet.
  useEffect(() => {
    const nachmessen = (): void => {
      const el = element.current
      if (el === null) return
      const breite = Math.floor(el.clientWidth)
      const hoehe = Math.floor(el.clientHeight)
      setMass((alt) =>
        alt !== null && alt.breite === breite && alt.hoehe === hoehe ? alt : { breite, hoehe }
      )
    }
    window.addEventListener('resize', nachmessen)
    return () => {
      window.removeEventListener('resize', nachmessen)
      beobachter.current?.disconnect()
    }
  }, [])

  return [ref, mass]
}

export function Produktraster({
  produkte,
  warenkorb,
  onAntippen,
  onAusverkauft
}: Props): JSX.Element {
  const [rasterRef, mass] = useMass<HTMLDivElement>()

  const mengen = new Map<string, number>()
  for (const z of warenkorb.zeilen) mengen.set(z.produktId, z.anzahl)

  const sichtbar = produkte
    .filter((p) => p.aktiv && p.preisRappen !== null)
    .sort((a, b) => a.reihenfolge - b.reihenfolge || a.name.localeCompare(b.name, 'de-CH'))

  if (sichtbar.length === 0) {
    return (
      <div className="produktraster-leer">
        <p>Keine aktiven Produkte. Produkte in der Verwaltung anlegen oder aktivieren.</p>
      </div>
    )
  }

  // Bis zur ersten Messung gelten die CSS-Regeln (auto-fill) als Fallback.
  let stil: CSSProperties | undefined
  if (mass !== null && mass.breite > 0 && mass.hoehe > 0) {
    const r = waehleRaster(sichtbar.length, mass.breite, mass.hoehe, STANDARD_RASTER)
    stil = {
      gridTemplateColumns: `repeat(${r.spalten}, minmax(0, 1fr))`,
      gridAutoRows: `${r.zeilenHoehe}px`,
      alignContent: 'start'
    }
  }

  return (
    <div className="produktraster" ref={rasterRef} style={stil}>
      {sichtbar.map((p) => {
        const menge = mengen.get(p.id) ?? 0
        return (
          <div
            key={p.id}
            className={`kachel kachel-${p.gruppe}${p.ausverkauft ? ' kachel-ausverkauft' : ''}`}
          >
            <button
              type="button"
              className="kachel-flaeche"
              onClick={() => onAntippen(p)}
              disabled={p.ausverkauft}
              aria-label={`${p.name}, CHF ${formatChf(p.preisRappen ?? 0)}${p.ausverkauft ? ', ausverkauft' : ''}`}
            >
              <span className="kachel-name">{p.name}</span>
              <span className="kachel-preis zahl">{formatChf(p.preisRappen ?? 0)}</span>
              {menge > 0 ? <span className="kachel-badge zahl">{menge}</span> : null}
              {p.ausverkauft ? <span className="kachel-stempel">AUSVERKAUFT</span> : null}
            </button>
            <button
              type="button"
              className={`kachel-schalter${p.ausverkauft ? ' kachel-schalter-an' : ''}`}
              onClick={(ev) => {
                ev.stopPropagation()
                onAusverkauft(p, !p.ausverkauft)
              }}
              title={p.ausverkauft ? 'Wieder verfügbar' : 'Als ausverkauft markieren'}
              aria-label={p.ausverkauft ? `${p.name} wieder verfügbar` : `${p.name} ausverkauft`}
            >
              {p.ausverkauft ? 'verfügbar' : 'ausverkauft'}
            </button>
          </div>
        )
      })}
    </div>
  )
}
