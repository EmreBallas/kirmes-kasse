/**
 * Rasterwahl fuer das Produktraster (reine Logik, ohne DOM).
 * Waehlt zu Anzahl und verfuegbarer Flaeche die Spaltenzahl, bei der die Kacheln
 * dem Zielverhaeltnis (Breite/Hoehe) am naechsten kommen. So bleiben die Kacheln auf
 * grossen Monitoren nicht schmal und turmhoch, auf kleinen nicht flach und winzig.
 */

export interface RasterOptionen {
  minSpalten: number
  maxSpalten: number
  /** kleinste sinnvolle Kachelhoehe in px; darunter scrollt die Spalte lieber */
  minZeilenHoehe: number
  /** Deckel der Kachelhoehe in px (bei wenigen Produkten auf grossen Bildschirmen) */
  maxZeilenHoehe: number
  /** Abstand zwischen den Kacheln in px (CSS gap) */
  abstand: number
  /** angestrebtes Verhaeltnis Breite/Hoehe einer Kachel */
  zielVerhaeltnis: number
}

export interface Raster {
  spalten: number
  zeilen: number
  /** Hoehe einer Zeile in px, ganzzahlig */
  zeilenHoehe: number
}

export const STANDARD_RASTER: RasterOptionen = {
  minSpalten: 3,
  maxSpalten: 8,
  minZeilenHoehe: 88,
  maxZeilenHoehe: 260,
  abstand: 10,
  zielVerhaeltnis: 1.5
}

interface Kandidat extends Raster {
  bewertung: number
  passt: boolean
}

/**
 * Bewertet jede Spaltenzahl von minSpalten bis maxSpalten und liefert die beste.
 * Kandidaten, deren Kachelhoehe unter minZeilenHoehe faellt, werden nur genommen,
 * wenn kein anderer bleibt (dann Hoehe = minZeilenHoehe, die Spalte scrollt).
 * Gleichstand der Bewertung: weniger Spalten gewinnen.
 */
export function waehleRaster(
  anzahl: number,
  breite: number,
  hoehe: number,
  opt: Partial<RasterOptionen> = {}
): Raster {
  const o: RasterOptionen = { ...STANDARD_RASTER, ...opt }
  const minSpalten = Math.max(1, Math.floor(o.minSpalten))
  const maxSpalten = Math.max(minSpalten, Math.floor(o.maxSpalten))
  const n = Number.isFinite(anzahl) ? Math.max(0, Math.floor(anzahl)) : 0
  const b = Number.isFinite(breite) ? Math.max(0, breite) : 0
  const h = Number.isFinite(hoehe) ? Math.max(0, hoehe) : 0

  if (n === 0) {
    const kachelHoehe = Math.min(o.maxZeilenHoehe, h)
    return {
      spalten: minSpalten,
      zeilen: 1,
      zeilenHoehe: Math.floor(Math.max(o.minZeilenHoehe, kachelHoehe))
    }
  }

  let bester: Kandidat | null = null
  for (let s = minSpalten; s <= maxSpalten; s++) {
    const zeilen = Math.max(1, Math.ceil(n / s))
    // Nenner und Zaehler gegen 0 absichern, sonst gaebe ln() NaN/Infinity
    const kachelBreite = Math.max(1, (b - o.abstand * (s - 1)) / s)
    const roheHoehe = (h - o.abstand * (zeilen - 1)) / zeilen
    const kachelHoehe = Math.max(1, Math.min(o.maxZeilenHoehe, roheHoehe))
    const passt = kachelHoehe >= o.minZeilenHoehe
    const bewertung = Math.abs(Math.log(kachelBreite / kachelHoehe / o.zielVerhaeltnis))
    const kandidat: Kandidat = {
      spalten: s,
      zeilen,
      zeilenHoehe: Math.floor(kachelHoehe),
      bewertung,
      passt
    }

    if (bester === null) {
      bester = kandidat
      continue
    }
    // passende Kandidaten schlagen nicht passende; sonst kleinste Bewertung, bei Gleichstand weniger Spalten
    if (kandidat.passt !== bester.passt) {
      if (kandidat.passt) bester = kandidat
      continue
    }
    if (kandidat.bewertung < bester.bewertung) bester = kandidat
  }

  // Schleife laeuft immer mindestens einmal (maxSpalten >= minSpalten)
  const gewaehlt = bester as Kandidat
  const zeilenHoehe = gewaehlt.passt ? gewaehlt.zeilenHoehe : Math.floor(o.minZeilenHoehe)
  return { spalten: gewaehlt.spalten, zeilen: gewaehlt.zeilen, zeilenHoehe }
}
