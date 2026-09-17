/**
 * Verkäufe: legt Verkauf + Positionen + Zahlung (+ Druckauftrag über Callback) in EINER Transaktion an,
 * vergibt die Belegnummer aus dem Belegzähler und ist idempotent über verkauf.id (Fachregel 17).
 */
import type { Druckauftrag, Position, Storno, Verkauf, Zahlart, Zahlung } from '@core/types'
import { inTransaktion } from '../db'
import { text, textOderNull, zahl, zahlOderNull, type Zeile } from '../sql'
import { isoLokal } from '../zeit'
import { erstelleDruckauftragRepo, type DruckauftragRepo } from './druckauftragRepo'
import { erstelleEinstellungRepo, type EinstellungRepo } from './einstellungRepo'
import type { RepoKontext } from './kontext'
import { zuStorno } from './stornoRepo'

export type PositionNeu = Omit<Position, 'id' | 'verkaufId'>
export type ZahlungNeu = Omit<Zahlung, 'verkaufId'>

export interface VerkaufNeu {
  id: string
  kassentagId: string
  zahlart: Zahlart
  /** Bereits rabattierter Betrag: das, was kassiert wird. */
  totalRappen: number
  /** Gewährter Beleg-Rabatt in Prozent; fehlt oder 0 = kein Rabatt (gilt auch bei zahlart helfer). */
  rabattProzent?: number
  /** Abzug in Rappen = Zwischensumme (volle Preise) − totalRappen; fehlt oder 0 = kein Rabatt. */
  rabattRappen?: number
  /**
   * Helfername (Migration 005): Pflicht bei zahlart helfer («später zahlen», totalRappen = Schuld), gesetzt bei
   * «gleich zahlen» mit echter Zahlart; fehlt oder null = gewöhnlicher Verkauf.
   */
  helferName?: string | null
  positionen: PositionNeu[]
  zahlung: ZahlungNeu
}

export interface VerkaufDetail {
  verkauf: Verkauf
  zahlung: Zahlung
  positionen: Position[]
  storno: Storno | null
}

export interface VerkaufErstellt extends VerkaufDetail {
  druckauftrag: Druckauftrag | null
  /** true, wenn derselbe Verkauf (id) schon existierte; dann wurde nichts neu angelegt. */
  bereitsVorhanden: boolean
}

/** Wird innerhalb der Transaktion nach dem Anlegen aufgerufen, um den Druckauftrag (typ beleg) zu erzeugen. */
export type DruckauftragErzeuger = (
  verkauf: Verkauf,
  positionen: Position[],
  zahlung: Zahlung
) => Druckauftrag | null

export interface VerkaufRepo {
  erstelle(neu: VerkaufNeu, druck?: DruckauftragErzeuger): VerkaufErstellt
  finde(id: string): Verkauf | null
  detail(id: string): VerkaufDetail | null
  /** Neuester Verkauf über alle Kassentage (nach zeit, rowid). */
  letzter(): Verkauf | null
  /** Die neuesten Verkäufe mit Details, neueste zuerst. */
  letzte(limit: number): VerkaufDetail[]
  positionen(verkaufId: string): Position[]
  zahlung(verkaufId: string): Zahlung | null
  /** Alle Verkäufe eines Kassentags mit Positionen und Zahlungen (für den Abschluss). */
  desKassentags(kassentagId: string): {
    verkaeufe: Verkauf[]
    positionen: Position[]
    zahlungen: Zahlung[]
  }
  markiereStorniert(id: string, stornoId: string): void
}

const V_SPALTEN =
  'id, kassentag_id, belegnr, zeit, zahlart, total_rappen, rabatt_prozent, rabatt_rappen, helfer_name, storniert_am, storno_id'
const P_SPALTEN =
  'id, verkauf_id, produkt_id, name_snapshot, preis_snapshot_rappen, anzahl, gruppe_snapshot'
const Z_SPALTEN =
  'verkauf_id, waehrung, kurs_x10000, gegeben, gegeben_chf_rappen, rueckgeld_chf_rappen, spende_chf_rappen, spende_typ'
const S_SPALTEN = 'id, verkauf_id, kassentag_id, zeit, grund, auszahlung_chf_rappen, mit_pin'

const ZAHLARTEN: readonly string[] = ['bar_chf', 'bar_eur', 'twint', 'helfer']

export function istZahlart(z: unknown): z is Zahlart {
  return typeof z === 'string' && ZAHLARTEN.includes(z)
}

/** Getrimmter Helfername oder null (leer/fehlend = gewöhnlicher Verkauf). */
function helferNameNormalisiert(name: string | null | undefined): string | null {
  if (name === undefined || name === null) return null
  const bereinigt = name.trim()
  return bereinigt === '' ? null : bereinigt
}

export function zuVerkauf(z: Zeile): Verkauf {
  const zahlart = text(z, 'zahlart')
  if (!istZahlart(zahlart)) throw new Error(`Unbekannte Zahlart "${zahlart}"`)
  return {
    id: text(z, 'id'),
    kassentagId: text(z, 'kassentag_id'),
    belegnr: text(z, 'belegnr'),
    zeit: text(z, 'zeit'),
    zahlart,
    totalRappen: zahl(z, 'total_rappen'),
    rabattProzent: zahl(z, 'rabatt_prozent'),
    rabattRappen: zahl(z, 'rabatt_rappen'),
    helferName: textOderNull(z, 'helfer_name'),
    storniertAm: textOderNull(z, 'storniert_am'),
    stornoId: textOderNull(z, 'storno_id')
  }
}

export function zuPosition(z: Zeile): Position {
  const gruppe = text(z, 'gruppe_snapshot')
  if (gruppe !== 'coupon' && gruppe !== 'kasse') throw new Error(`Unbekannte Gruppe "${gruppe}"`)
  return {
    id: text(z, 'id'),
    verkaufId: text(z, 'verkauf_id'),
    produktId: text(z, 'produkt_id'),
    nameSnapshot: text(z, 'name_snapshot'),
    preisSnapshotRappen: zahl(z, 'preis_snapshot_rappen'),
    anzahl: zahl(z, 'anzahl'),
    gruppeSnapshot: gruppe
  }
}

export function zuZahlung(z: Zeile): Zahlung {
  const waehrung = text(z, 'waehrung')
  if (waehrung !== 'CHF' && waehrung !== 'EUR') throw new Error(`Unbekannte Währung "${waehrung}"`)
  const spendeTyp = textOderNull(z, 'spende_typ')
  if (
    spendeTyp !== null &&
    spendeTyp !== 'bar_chf' &&
    spendeTyp !== 'bar_eur' &&
    spendeTyp !== 'twint'
  ) {
    throw new Error(`Unbekannter Spendentyp "${spendeTyp}"`)
  }
  return {
    verkaufId: text(z, 'verkauf_id'),
    waehrung,
    kursX10000: zahlOderNull(z, 'kurs_x10000'),
    gegeben: zahl(z, 'gegeben'),
    gegebenChfRappen: zahl(z, 'gegeben_chf_rappen'),
    rueckgeldChfRappen: zahl(z, 'rueckgeld_chf_rappen'),
    spendeChfRappen: zahl(z, 'spende_chf_rappen'),
    spendeTyp
  }
}

export function erstelleVerkaufRepo(
  k: RepoKontext,
  einstellungRepo: EinstellungRepo = erstelleEinstellungRepo(k),
  druckauftragRepo: DruckauftragRepo = erstelleDruckauftragRepo(k)
): VerkaufRepo {
  const { db } = k

  function finde(id: string): Verkauf | null {
    const z = db.prepare(`SELECT ${V_SPALTEN} FROM verkauf WHERE id = ?`).get(id)
    return z === undefined ? null : zuVerkauf(z)
  }

  function positionen(verkaufId: string): Position[] {
    return db
      .prepare(`SELECT ${P_SPALTEN} FROM position WHERE verkauf_id = ? ORDER BY rowid`)
      .all(verkaufId)
      .map(zuPosition)
  }

  function zahlung(verkaufId: string): Zahlung | null {
    const z = db.prepare(`SELECT ${Z_SPALTEN} FROM zahlung WHERE verkauf_id = ?`).get(verkaufId)
    return z === undefined ? null : zuZahlung(z)
  }

  function storno(verkaufId: string): Storno | null {
    const z = db.prepare(`SELECT ${S_SPALTEN} FROM storno WHERE verkauf_id = ?`).get(verkaufId)
    return z === undefined ? null : zuStorno(z)
  }

  function detailVon(verkauf: Verkauf): VerkaufDetail {
    const z = zahlung(verkauf.id)
    if (z === null) throw new Error(`Verkauf ${verkauf.belegnr} hat keine Zahlung`)
    return { verkauf, zahlung: z, positionen: positionen(verkauf.id), storno: storno(verkauf.id) }
  }

  function detail(id: string): VerkaufDetail | null {
    const v = finde(id)
    return v === null ? null : detailVon(v)
  }

  return {
    erstelle(neu, druck) {
      return inTransaktion(db, (): VerkaufErstellt => {
        const vorhanden = detail(neu.id)
        if (vorhanden !== null) {
          return {
            ...vorhanden,
            druckauftrag: druckauftragRepo.belegAuftrag(neu.id),
            bereitsVorhanden: true
          }
        }
        if (neu.positionen.length === 0)
          throw new Error('Ein Verkauf braucht mindestens eine Position')

        const belegnr = einstellungRepo.naechsteBelegnummer()
        const zeit = isoLokal(k.uhr())
        db.prepare(
          'INSERT INTO verkauf (id, kassentag_id, belegnr, zeit, zahlart, total_rappen, rabatt_prozent, rabatt_rappen, helfer_name, storniert_am, storno_id) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)'
        ).run(
          neu.id,
          neu.kassentagId,
          belegnr,
          zeit,
          neu.zahlart,
          neu.totalRappen,
          neu.rabattProzent ?? 0,
          neu.rabattRappen ?? 0,
          helferNameNormalisiert(neu.helferName)
        )

        const einfuegen = db.prepare(
          `INSERT INTO position (${P_SPALTEN}) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        for (const p of neu.positionen) {
          einfuegen.run(
            k.neueId(),
            neu.id,
            p.produktId,
            p.nameSnapshot,
            p.preisSnapshotRappen,
            p.anzahl,
            p.gruppeSnapshot
          )
        }

        const zn = neu.zahlung
        db.prepare(`INSERT INTO zahlung (${Z_SPALTEN}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          neu.id,
          zn.waehrung,
          zn.kursX10000,
          zn.gegeben,
          zn.gegebenChfRappen,
          zn.rueckgeldChfRappen,
          zn.spendeChfRappen,
          zn.spendeTyp
        )

        const angelegt = detail(neu.id)
        if (angelegt === null)
          throw new Error('Verkauf konnte nach dem Anlegen nicht gelesen werden')
        const druckauftrag =
          druck === undefined
            ? null
            : druck(angelegt.verkauf, angelegt.positionen, angelegt.zahlung)
        return { ...angelegt, druckauftrag, bereitsVorhanden: false }
      })
    },
    finde,
    detail,
    letzter() {
      const z = db
        .prepare(`SELECT ${V_SPALTEN} FROM verkauf ORDER BY zeit DESC, rowid DESC LIMIT 1`)
        .get()
      return z === undefined ? null : zuVerkauf(z)
    },
    letzte(limit) {
      return db
        .prepare(`SELECT ${V_SPALTEN} FROM verkauf ORDER BY zeit DESC, rowid DESC LIMIT ?`)
        .all(limit)
        .map(zuVerkauf)
        .map(detailVon)
    },
    positionen,
    zahlung,
    desKassentags(kassentagId) {
      const verkaeufe = db
        .prepare(`SELECT ${V_SPALTEN} FROM verkauf WHERE kassentag_id = ? ORDER BY zeit, rowid`)
        .all(kassentagId)
        .map(zuVerkauf)
      const pos = db
        .prepare(
          `SELECT ${P_SPALTEN.split(', ')
            .map((s) => `p.${s}`)
            .join(
              ', '
            )} FROM position p JOIN verkauf v ON v.id = p.verkauf_id WHERE v.kassentag_id = ? ORDER BY p.rowid`
        )
        .all(kassentagId)
        .map(zuPosition)
      const zahlungen = db
        .prepare(
          `SELECT ${Z_SPALTEN.split(', ')
            .map((s) => `z.${s}`)
            .join(
              ', '
            )} FROM zahlung z JOIN verkauf v ON v.id = z.verkauf_id WHERE v.kassentag_id = ?`
        )
        .all(kassentagId)
        .map(zuZahlung)
      return { verkaeufe, positionen: pos, zahlungen }
    },
    markiereStorniert(id, stornoId) {
      db.prepare('UPDATE verkauf SET storniert_am = ?, storno_id = ? WHERE id = ?').run(
        isoLokal(k.uhr()),
        stornoId,
        id
      )
    }
  }
}
