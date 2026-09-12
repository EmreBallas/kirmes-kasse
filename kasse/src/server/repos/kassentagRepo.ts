/**
 * Kassentage: Start, offener Tag, Abschluss mit Ist/Differenz.
 */
import type { Kassentag } from '@core/types'
import { text, textOderNull, zahl, zahlOderNull, type Zeile } from '../sql'
import { isoLokal } from '../zeit'
import type { RepoKontext } from './kontext'

export interface KassentagNeu {
  datum: string
  kassePraefix: string
  kassier: string
  startgeldChfRappen: number
  startgeldEurCent: number
}

export interface KassentagAbschlussDaten {
  istChfRappen: number
  istEurCent: number
  differenzChfRappen: number
  differenzEurCent: number
  bemerkung: string | null
}

export interface KassentagRepo {
  finde(id: string): Kassentag | null
  /** Der offene Kassentag (abgeschlossen_am IS NULL), der zuletzt geöffnet wurde. */
  offener(): Kassentag | null
  /** Zuletzt abgeschlossener Kassentag (für den Startgeld-Vorschlag). */
  letzterAbgeschlossener(): Kassentag | null
  alle(): Kassentag[]
  starte(neu: KassentagNeu): Kassentag
  /** Schliesst einen offenen Kassentag ab; null, wenn er fehlt oder schon abgeschlossen ist. */
  schliesseAb(id: string, a: KassentagAbschlussDaten): Kassentag | null
  /** Merkt den Pfad der geschriebenen Abschluss-PDF; null, wenn der Kassentag fehlt. */
  setzePdfPfad(id: string, pfad: string | null): Kassentag | null
}

const SPALTEN =
  'id, datum, kasse_praefix, kassier, startgeld_chf_rappen, startgeld_eur_cent, geoeffnet_am, abgeschlossen_am, ' +
  'ist_chf_rappen, ist_eur_cent, differenz_chf_rappen, differenz_eur_cent, bemerkung, pdf_pfad'

export function zuKassentag(z: Zeile): Kassentag {
  return {
    id: text(z, 'id'),
    datum: text(z, 'datum'),
    kassePraefix: text(z, 'kasse_praefix'),
    kassier: text(z, 'kassier'),
    startgeldChfRappen: zahl(z, 'startgeld_chf_rappen'),
    startgeldEurCent: zahl(z, 'startgeld_eur_cent'),
    geoeffnetAm: text(z, 'geoeffnet_am'),
    abgeschlossenAm: textOderNull(z, 'abgeschlossen_am'),
    istChfRappen: zahlOderNull(z, 'ist_chf_rappen'),
    istEurCent: zahlOderNull(z, 'ist_eur_cent'),
    differenzChfRappen: zahlOderNull(z, 'differenz_chf_rappen'),
    differenzEurCent: zahlOderNull(z, 'differenz_eur_cent'),
    bemerkung: textOderNull(z, 'bemerkung'),
    pdfPfad: textOderNull(z, 'pdf_pfad')
  }
}

export function erstelleKassentagRepo(k: RepoKontext): KassentagRepo {
  const { db } = k

  function finde(id: string): Kassentag | null {
    const z = db.prepare(`SELECT ${SPALTEN} FROM kassentag WHERE id = ?`).get(id)
    return z === undefined ? null : zuKassentag(z)
  }

  return {
    finde,
    offener() {
      const z = db
        .prepare(
          `SELECT ${SPALTEN} FROM kassentag WHERE abgeschlossen_am IS NULL ORDER BY geoeffnet_am DESC, rowid DESC LIMIT 1`
        )
        .get()
      return z === undefined ? null : zuKassentag(z)
    },
    letzterAbgeschlossener() {
      const z = db
        .prepare(
          `SELECT ${SPALTEN} FROM kassentag WHERE abgeschlossen_am IS NOT NULL ORDER BY abgeschlossen_am DESC, rowid DESC LIMIT 1`
        )
        .get()
      return z === undefined ? null : zuKassentag(z)
    },
    alle() {
      return db
        .prepare(`SELECT ${SPALTEN} FROM kassentag ORDER BY geoeffnet_am, rowid`)
        .all()
        .map(zuKassentag)
    },
    starte(neu) {
      const id = k.neueId()
      db.prepare(
        'INSERT INTO kassentag (id, datum, kasse_praefix, kassier, startgeld_chf_rappen, startgeld_eur_cent, geoeffnet_am) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(
        id,
        neu.datum,
        neu.kassePraefix,
        neu.kassier,
        neu.startgeldChfRappen,
        neu.startgeldEurCent,
        isoLokal(k.uhr())
      )
      const t = finde(id)
      if (t === null) throw new Error('Kassentag konnte nach dem Anlegen nicht gelesen werden')
      return t
    },
    schliesseAb(id, a) {
      const r = db
        .prepare(
          'UPDATE kassentag SET abgeschlossen_am = ?, ist_chf_rappen = ?, ist_eur_cent = ?, differenz_chf_rappen = ?, ' +
            'differenz_eur_cent = ?, bemerkung = ? WHERE id = ? AND abgeschlossen_am IS NULL'
        )
        .run(
          isoLokal(k.uhr()),
          a.istChfRappen,
          a.istEurCent,
          a.differenzChfRappen,
          a.differenzEurCent,
          a.bemerkung,
          id
        )
      if (r.changes === 0) return null
      return finde(id)
    },
    setzePdfPfad(id, pfad) {
      const r = db.prepare('UPDATE kassentag SET pdf_pfad = ? WHERE id = ?').run(pfad, id)
      if (r.changes === 0) return null
      return finde(id)
    }
  }
}
