/**
 * Produkte (Stammdaten). Produkte werden deaktiviert, nicht gelöscht (Fachregel 15); einzige Ausnahme:
 * ein Produkt, auf das noch keine Position verweist, darf ganz gelöscht werden (loesche).
 * Ein Produkt ohne Preis (null) bleibt zwingend inaktiv.
 *
 * Reihenfolge mit Einfüge-Semantik: bekommt ein Produkt die Position n, rutschen alle anderen
 * Produkte ab Position n um eins nach unten; anschliessend werden alle Produkte (aktive und
 * inaktive) lücken- und doppelfrei auf 1..N durchnummeriert (Sortierung: reihenfolge, erstellt_am).
 */
import type { Gruppe, Produkt } from '@core/types'
import { inTransaktion } from '../db'
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
  /** Zielposition (1 = ganz oben); fehlt sie, kommt das Produkt ans Ende. */
  reihenfolge?: number
}

export type ProduktAenderung = Partial<Omit<Produkt, 'id' | 'erstelltAm'>>

export type ProduktLoeschErgebnis = 'geloescht' | 'nicht_gefunden' | 'hat_verkaeufe'

export interface ProduktRepo {
  alle(nurAktive: boolean): Produkt[]
  finde(id: string): Produkt | null
  anzahl(): number
  /** Legt das Produkt an; mit `reihenfolge` an dieser Position (Einfüge-Semantik), sonst ans Ende. */
  erstelle(neu: ProduktNeu): Produkt
  /** Ändert Felder; `reihenfolge` im Objekt verschiebt das Produkt an diese Position, sonst bleibt sie. */
  aktualisiere(id: string, aenderung: ProduktAenderung): Produkt | null
  setzeAusverkauft(id: string, ausverkauft: boolean): Produkt | null
  /**
   * Verschiebt das Produkt an Position n (1..N, wird auf diesen Bereich begrenzt). Die anderen
   * Produkte rücken nach; danach ist die Reihenfolge normalisiert. null bei unbekannter id.
   */
  setzeReihenfolge(id: string, n: number): Produkt | null
  /** Nummeriert alle Produkte lücken- und doppelfrei 1..N (Sortierung: reihenfolge, erstellt_am). */
  normalisiereReihenfolge(): void
  /** Anzahl Positionen (Verkaufszeilen), die auf das Produkt verweisen. */
  anzahlVerkaufsPositionen(id: string): number
  /** Löscht das Produkt nur, wenn keine Position darauf verweist; normalisiert danach die Reihenfolge. */
  loesche(id: string): ProduktLoeschErgebnis
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

  function anzahl(): number {
    return anzahlAus(db.prepare('SELECT COUNT(*) AS n FROM produkt').get())
  }

  function naechsteReihenfolge(): number {
    return anzahlAus(db.prepare('SELECT COALESCE(MAX(reihenfolge), 0) + 1 AS n FROM produkt').get())
  }

  /** Alle Produkte 1..N durchnummerieren; Sortierung reihenfolge, erstellt_am, id (stabil). */
  function normalisiereReihenfolge(): void {
    inTransaktion(db, () => {
      const ids = db
        .prepare('SELECT id FROM produkt ORDER BY reihenfolge, erstellt_am, id')
        .all()
        .map((z) => text(z, 'id'))
      const setze = db.prepare(
        'UPDATE produkt SET reihenfolge = ? WHERE id = ? AND reihenfolge <> ?'
      )
      ids.forEach((id, i) => {
        setze.run(i + 1, id, i + 1)
      })
    })
  }

  /**
   * Räumt Platz n frei: alle anderen Produkte ab Position n rutschen um eins nach unten.
   * Erwartet eine bereits normalisierte Reihenfolge ohne das zu setzende Produkt.
   */
  function schiebeAb(n: number, ausserId: string | null): void {
    db.prepare(
      'UPDATE produkt SET reihenfolge = reihenfolge + 1 WHERE reihenfolge >= ? AND id IS NOT ?'
    ).run(n, ausserId)
  }

  function begrenze(n: number, maxPosition: number): number {
    if (!Number.isFinite(n) || n < 1) return 1
    return Math.min(Math.trunc(n), Math.max(1, maxPosition))
  }

  /**
   * Verschiebt ein bestehendes Produkt an Position n. Das Produkt wird gedanklich aus der Liste
   * genommen (die übrigen 1..N-1 normalisiert), dann wird Platz n freigemacht und belegt.
   * So landet das Produkt sowohl beim Hoch- als auch beim Herunterschieben genau auf n.
   */
  function setzeReihenfolge(id: string, n: number): Produkt | null {
    return inTransaktion(db, () => {
      if (finde(id) === null) return null
      // Produkt ans Ende parken, damit die übrigen ohne Lücke 1..N-1 sind
      db.prepare('UPDATE produkt SET reihenfolge = ? WHERE id = ?').run(naechsteReihenfolge(), id)
      normalisiereReihenfolge()
      const ziel = begrenze(n, anzahl())
      schiebeAb(ziel, id)
      db.prepare('UPDATE produkt SET reihenfolge = ? WHERE id = ?').run(ziel, id)
      normalisiereReihenfolge()
      return finde(id)
    })
  }

  return {
    alle(nurAktive) {
      const sql = nurAktive
        ? `SELECT ${SPALTEN} FROM produkt WHERE aktiv = 1 ORDER BY reihenfolge, name`
        : `SELECT ${SPALTEN} FROM produkt ORDER BY reihenfolge, name`
      return db.prepare(sql).all().map(zuProdukt)
    },
    finde,
    anzahl,
    erstelle(neu) {
      return inTransaktion(db, () => {
        const id = neu.id ?? k.neueId()
        const aktiv = neu.preisRappen === null ? false : (neu.aktiv ?? true)
        let position: number
        if (neu.reihenfolge === undefined) {
          position = naechsteReihenfolge()
        } else {
          normalisiereReihenfolge()
          position = begrenze(neu.reihenfolge, anzahl() + 1)
          schiebeAb(position, null)
        }
        db.prepare(`INSERT INTO produkt (${SPALTEN}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          id,
          neu.name,
          neu.preisRappen,
          neu.gruppe,
          bit(aktiv),
          bit(neu.ausverkauft ?? false),
          position,
          isoLokal(k.uhr())
        )
        normalisiereReihenfolge()
        const p = finde(id)
        if (p === null) throw new Error('Produkt konnte nach dem Anlegen nicht gelesen werden')
        return p
      })
    },
    aktualisiere(id, a) {
      return inTransaktion(db, () => {
        const alt = finde(id)
        if (alt === null) return null
        const preisRappen = a.preisRappen !== undefined ? a.preisRappen : alt.preisRappen
        const aktiv = preisRappen === null ? false : (a.aktiv ?? alt.aktiv)
        db.prepare(
          'UPDATE produkt SET name = ?, preis_rappen = ?, gruppe = ?, aktiv = ?, ausverkauft = ? WHERE id = ?'
        ).run(
          a.name ?? alt.name,
          preisRappen,
          a.gruppe ?? alt.gruppe,
          bit(aktiv),
          bit(a.ausverkauft ?? alt.ausverkauft),
          id
        )
        if (a.reihenfolge !== undefined) return setzeReihenfolge(id, a.reihenfolge)
        return finde(id)
      })
    },
    setzeAusverkauft(id, ausverkauft) {
      const r = db
        .prepare('UPDATE produkt SET ausverkauft = ? WHERE id = ?')
        .run(bit(ausverkauft), id)
      if (r.changes === 0) return null
      return finde(id)
    },
    setzeReihenfolge,
    normalisiereReihenfolge,
    anzahlVerkaufsPositionen(id) {
      return anzahlAus(
        db.prepare('SELECT COUNT(*) AS n FROM position WHERE produkt_id = ?').get(id)
      )
    },
    loesche(id) {
      return inTransaktion(db, () => {
        if (finde(id) === null) return 'nicht_gefunden'
        if (
          anzahlAus(db.prepare('SELECT COUNT(*) AS n FROM position WHERE produkt_id = ?').get(id)) >
          0
        ) {
          return 'hat_verkaeufe'
        }
        db.prepare('DELETE FROM produkt WHERE id = ?').run(id)
        normalisiereReihenfolge()
        return 'geloescht'
      })
    }
  }
}
