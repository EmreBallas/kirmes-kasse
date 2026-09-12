/**
 * Storni: Gegenbuchung, dem Kassentag des Stornos zugeordnet (Fachregel 9). Ein Storno pro Beleg (UNIQUE).
 */
import type { Storno, StornoGrund } from '@core/types'
import { bit, text, wahr, zahl, type Zeile } from '../sql'
import { isoLokal } from '../zeit'
import type { RepoKontext } from './kontext'

export interface StornoNeu {
  verkaufId: string
  kassentagId: string
  grund: StornoGrund
  auszahlungChfRappen: number
  mitPin: boolean
}

export interface StornoRepo {
  erstelle(neu: StornoNeu): Storno
  finde(id: string): Storno | null
  fuerVerkauf(verkaufId: string): Storno | null
  /** Storni, die an diesem Kassentag gebucht wurden (storno.kassentag_id). */
  desKassentags(kassentagId: string): Storno[]
}

const SPALTEN = 'id, verkauf_id, kassentag_id, zeit, grund, auszahlung_chf_rappen, mit_pin'

const STORNO_GRUENDE: readonly string[] = ['tippfehler', 'ausverkauft', 'abgesprungen']

export function istStornoGrund(g: unknown): g is StornoGrund {
  return typeof g === 'string' && STORNO_GRUENDE.includes(g)
}

export function zuStorno(z: Zeile): Storno {
  const grund = text(z, 'grund')
  if (!istStornoGrund(grund)) throw new Error(`Unbekannter Stornogrund "${grund}"`)
  return {
    id: text(z, 'id'),
    verkaufId: text(z, 'verkauf_id'),
    kassentagId: text(z, 'kassentag_id'),
    zeit: text(z, 'zeit'),
    grund,
    auszahlungChfRappen: zahl(z, 'auszahlung_chf_rappen'),
    mitPin: wahr(z, 'mit_pin')
  }
}

export function erstelleStornoRepo(k: RepoKontext): StornoRepo {
  const { db } = k

  function finde(id: string): Storno | null {
    const z = db.prepare(`SELECT ${SPALTEN} FROM storno WHERE id = ?`).get(id)
    return z === undefined ? null : zuStorno(z)
  }

  return {
    erstelle(neu) {
      const id = k.neueId()
      db.prepare(`INSERT INTO storno (${SPALTEN}) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        id,
        neu.verkaufId,
        neu.kassentagId,
        isoLokal(k.uhr()),
        neu.grund,
        neu.auszahlungChfRappen,
        bit(neu.mitPin)
      )
      const s = finde(id)
      if (s === null) throw new Error('Storno konnte nach dem Anlegen nicht gelesen werden')
      return s
    },
    finde,
    fuerVerkauf(verkaufId) {
      const z = db.prepare(`SELECT ${SPALTEN} FROM storno WHERE verkauf_id = ?`).get(verkaufId)
      return z === undefined ? null : zuStorno(z)
    },
    desKassentags(kassentagId) {
      return db
        .prepare(`SELECT ${SPALTEN} FROM storno WHERE kassentag_id = ? ORDER BY zeit, rowid`)
        .all(kassentagId)
        .map(zuStorno)
    }
  }
}
