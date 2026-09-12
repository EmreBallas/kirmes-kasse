/**
 * Separat erfasste Spenden (nachträglich, ohne Bon): "Rückgeld als Spende" zu einem bereits
 * abgeschlossenen Bar-Beleg oder freie Spende ohne Kauf. Idempotent über spende.id (UUID vom Client).
 * Das Geld bleibt in der Lade und erhöht den Soll-Bestand des Kassentags (core/abschluss.ts).
 * Nichts wird gelöscht: Storno setzt storniert_am; stornierte Spenden zählen im Abschluss nicht mehr.
 */
import { eurZuChfRappen } from '@core/geld'
import type { Spende, SpendeAnfrage, SpendeTyp } from '@core/types'
import { inTransaktion } from '../db'
import { bit, text, textOderNull, wahr, zahl, zahlOderNull, type Zeile } from '../sql'
import { isoLokal } from '../zeit'
import type { RepoKontext } from './kontext'

/** Spende in der Liste "letzte Spenden": mit Belegnummer des verknüpften Verkaufs (null bei freier Spende). */
export interface SpendeEintrag extends Spende {
  belegnr: string | null
  /** true, wenn der Storno dieser Spende eine PIN brauchte (ältere Spende) */
  mitPin: boolean
}

export interface SpendeErstellt {
  spende: Spende
  /** true, wenn dieselbe Spende (id) schon existierte; dann wurde nichts neu angelegt. */
  bereitsVorhanden: boolean
}

export type SpendeStornoErgebnis =
  | { ergebnis: 'storniert'; spende: Spende }
  | { ergebnis: 'nicht_gefunden' }
  | { ergebnis: 'bereits_storniert'; spende: Spende }

export interface SpendeRepo {
  /**
   * Legt die Spende an (idempotent über anfrage.id). betragChfRappen: bei bar_eur
   * eurZuChfRappen(betrag, kursX10000) (auf 5 Rappen abgerundet, Kurs wird gespeichert), sonst betrag.
   */
  erstelle(anfrage: SpendeAnfrage, kassentagId: string, kursX10000: number): SpendeErstellt
  finde(id: string): Spende | null
  /** Die neuesten Spenden (inkl. stornierte), neueste zuerst, mit Belegnummer des verknüpften Verkaufs. */
  letzte(limit: number): SpendeEintrag[]
  /** Nicht stornierte Spenden des Kassentags (für den Abschluss), älteste zuerst. */
  fuerKassentag(kassentagId: string): Spende[]
  /** Nicht stornierte Spende zu diesem Verkauf (Rückgeld als Spende) oder null. */
  fuerVerkauf(verkaufId: string): Spende | null
  /** Setzt storniert_am; 'bereits_storniert', wenn die Spende schon storniert ist. */
  storno(id: string, mitPin: boolean): SpendeStornoErgebnis
  /** true, wenn diese Spende die zuletzt erfasste nicht stornierte Spende ist (Storno ohne PIN). */
  istLetzte(id: string): boolean
}

const SPALTEN =
  'id, kassentag_id, verkauf_id, zeit, typ, betrag, kurs_x10000, betrag_chf_rappen, storniert_am, mit_pin'

const SPENDE_TYPEN: readonly string[] = ['bar_chf', 'bar_eur', 'twint']

export function istSpendeTyp(t: unknown): t is SpendeTyp {
  return typeof t === 'string' && SPENDE_TYPEN.includes(t)
}

export function zuSpende(z: Zeile): Spende {
  const typ = text(z, 'typ')
  if (!istSpendeTyp(typ)) throw new Error(`Unbekannter Spendentyp "${typ}"`)
  return {
    id: text(z, 'id'),
    kassentagId: text(z, 'kassentag_id'),
    verkaufId: textOderNull(z, 'verkauf_id'),
    zeit: text(z, 'zeit'),
    typ,
    betrag: zahl(z, 'betrag'),
    kursX10000: zahlOderNull(z, 'kurs_x10000'),
    betragChfRappen: zahl(z, 'betrag_chf_rappen'),
    storniertAm: textOderNull(z, 'storniert_am')
  }
}

function zuSpendeEintrag(z: Zeile): SpendeEintrag {
  return { ...zuSpende(z), belegnr: textOderNull(z, 'belegnr'), mitPin: wahr(z, 'mit_pin') }
}

export function erstelleSpendeRepo(k: RepoKontext): SpendeRepo {
  const { db } = k

  function finde(id: string): Spende | null {
    const z = db.prepare(`SELECT ${SPALTEN} FROM spende WHERE id = ?`).get(id)
    return z === undefined ? null : zuSpende(z)
  }

  return {
    erstelle(anfrage, kassentagId, kursX10000) {
      return inTransaktion(db, (): SpendeErstellt => {
        const vorhanden = finde(anfrage.id)
        if (vorhanden !== null) return { spende: vorhanden, bereitsVorhanden: true }
        if (!Number.isSafeInteger(anfrage.betrag) || anfrage.betrag <= 0) {
          throw new Error('Spendenbetrag muss eine ganze Zahl grösser als 0 sein')
        }
        const eur = anfrage.typ === 'bar_eur'
        const betragChfRappen = eur ? eurZuChfRappen(anfrage.betrag, kursX10000) : anfrage.betrag
        db.prepare(`INSERT INTO spende (${SPALTEN}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)`).run(
          anfrage.id,
          kassentagId,
          anfrage.verkaufId,
          isoLokal(k.uhr()),
          anfrage.typ,
          anfrage.betrag,
          eur ? kursX10000 : null,
          betragChfRappen
        )
        const spende = finde(anfrage.id)
        if (spende === null) throw new Error('Spende konnte nach dem Anlegen nicht gelesen werden')
        return { spende, bereitsVorhanden: false }
      })
    },
    finde,
    letzte(limit) {
      return db
        .prepare(
          `SELECT ${SPALTEN.split(', ')
            .map((s) => `s.${s}`)
            .join(', ')}, v.belegnr AS belegnr ` +
            'FROM spende s LEFT JOIN verkauf v ON v.id = s.verkauf_id ' +
            'ORDER BY s.zeit DESC, s.rowid DESC LIMIT ?'
        )
        .all(limit)
        .map(zuSpendeEintrag)
    },
    fuerKassentag(kassentagId) {
      return db
        .prepare(
          `SELECT ${SPALTEN} FROM spende WHERE kassentag_id = ? AND storniert_am IS NULL ORDER BY zeit, rowid`
        )
        .all(kassentagId)
        .map(zuSpende)
    },
    fuerVerkauf(verkaufId) {
      const z = db
        .prepare(
          `SELECT ${SPALTEN} FROM spende WHERE verkauf_id = ? AND storniert_am IS NULL ORDER BY zeit DESC, rowid DESC LIMIT 1`
        )
        .get(verkaufId)
      return z === undefined ? null : zuSpende(z)
    },
    storno(id, mitPin) {
      return inTransaktion(db, (): SpendeStornoErgebnis => {
        const vorhanden = finde(id)
        if (vorhanden === null) return { ergebnis: 'nicht_gefunden' }
        if (vorhanden.storniertAm !== null)
          return { ergebnis: 'bereits_storniert', spende: vorhanden }
        db.prepare('UPDATE spende SET storniert_am = ?, mit_pin = ? WHERE id = ?').run(
          isoLokal(k.uhr()),
          bit(mitPin),
          id
        )
        const spende = finde(id)
        if (spende === null) throw new Error('Spende konnte nach dem Storno nicht gelesen werden')
        return { ergebnis: 'storniert', spende }
      })
    },
    istLetzte(id) {
      const z = db
        .prepare(
          'SELECT id FROM spende WHERE storniert_am IS NULL ORDER BY zeit DESC, rowid DESC LIMIT 1'
        )
        .get()
      return z !== undefined && text(z, 'id') === id
    }
  }
}
