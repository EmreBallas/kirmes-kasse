/**
 * Produkte (Stammdaten). Produkte werden nie gelöscht, nur deaktiviert (Fachregel 15).
 * Ein Produkt ohne Preis (null) bleibt zwingend inaktiv.
 */
import type { Gruppe, Produkt } from '@core/types'
import { anzahlAus, bit, text, wahr, zahl, zahlOderNull, type Zeile } from '../sql'
import { isoLokal } from '../zeit'
import type { RepoKontext } from './kontext'

export interface ProduktNeu {
  id?: string
  name: string
  preisRappen: number | null
  gruppe: Gruppe
  aktiv?: boolean
  ausverkauft?: boolean
  reihenfolge?: number
}

export type ProduktAenderung = Partial<Omit<Produkt, 'id' | 'erstelltAm'>>

export interface ProduktRepo {
  alle(nurAktive: boolean): Produkt[]
  finde(id: string): Produkt | null
  anzahl(): number
  erstelle(neu: ProduktNeu): Produkt
  aktualisiere(id: string, aenderung: ProduktAenderung): Produkt | null
  setzeAusverkauft(id: string, ausverkauft: boolean): Produkt | null
}

const SPALTEN = 'id, name, preis_rappen, gruppe, aktiv, ausverkauft, reihenfolge, erstellt_am'

export function istGruppe(g: unknown): g is Gruppe {
  return g === 'coupon' || g === 'kasse'
}

function zuProdukt(z: Zeile): Produkt {
  const gruppe = text(z, 'gruppe')
  if (!istGruppe(gruppe)) throw new Error(`Unbekannte Produktgruppe "${gruppe}"`)
  return {
    id: text(z, 'id'),
    name: text(z, 'name'),
    preisRappen: zahlOderNull(z, 'preis_rappen'),
    gruppe,
    aktiv: wahr(z, 'aktiv'),
    ausverkauft: wahr(z, 'ausverkauft'),
    reihenfolge: zahl(z, 'reihenfolge'),
    erstelltAm: text(z, 'erstellt_am')
  }
}

export function erstelleProduktRepo(k: RepoKontext): ProduktRepo {
  const { db } = k

  function finde(id: string): Produkt | null {
    const z = db.prepare(`SELECT ${SPALTEN} FROM produkt WHERE id = ?`).get(id)
    return z === undefined ? null : zuProdukt(z)
  }

  function naechsteReihenfolge(): number {
    return anzahlAus(db.prepare('SELECT COALESCE(MAX(reihenfolge), 0) + 1 AS n FROM produkt').get())
  }

  return {
    alle(nurAktive) {
      const sql = nurAktive
        ? `SELECT ${SPALTEN} FROM produkt WHERE aktiv = 1 ORDER BY reihenfolge, name`
        : `SELECT ${SPALTEN} FROM produkt ORDER BY reihenfolge, name`
      return db.prepare(sql).all().map(zuProdukt)
    },
    finde,
    anzahl() {
      return anzahlAus(db.prepare('SELECT COUNT(*) AS n FROM produkt').get())
    },
    erstelle(neu) {
      const id = neu.id ?? k.neueId()
      const aktiv = neu.preisRappen === null ? false : (neu.aktiv ?? true)
      db.prepare(`INSERT INTO produkt (${SPALTEN}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id,
        neu.name,
        neu.preisRappen,
        neu.gruppe,
        bit(aktiv),
        bit(neu.ausverkauft ?? false),
        neu.reihenfolge ?? naechsteReihenfolge(),
        isoLokal(k.uhr())
      )
      const p = finde(id)
      if (p === null) throw new Error('Produkt konnte nach dem Anlegen nicht gelesen werden')
      return p
    },
    aktualisiere(id, a) {
      const alt = finde(id)
      if (alt === null) return null
      const preisRappen = a.preisRappen !== undefined ? a.preisRappen : alt.preisRappen
      const aktiv = preisRappen === null ? false : (a.aktiv ?? alt.aktiv)
      db.prepare(
        'UPDATE produkt SET name = ?, preis_rappen = ?, gruppe = ?, aktiv = ?, ausverkauft = ?, reihenfolge = ? WHERE id = ?'
      ).run(
        a.name ?? alt.name,
        preisRappen,
        a.gruppe ?? alt.gruppe,
        bit(aktiv),
        bit(a.ausverkauft ?? alt.ausverkauft),
        a.reihenfolge ?? alt.reihenfolge,
        id
      )
      return finde(id)
    },
    setzeAusverkauft(id, ausverkauft) {
      const r = db
        .prepare('UPDATE produkt SET ausverkauft = ? WHERE id = ?')
        .run(bit(ausverkauft), id)
      if (r.changes === 0) return null
      return finde(id)
    }
  }
}
