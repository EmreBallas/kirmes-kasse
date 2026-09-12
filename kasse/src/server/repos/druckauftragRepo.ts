/**
 * Druckaufträge: Warteschlange für den Druck-Worker (queued -> sent -> done/failed).
 * Aufträge werden nie gelöscht und nie automatisch nachgedruckt (Fachregel 18).
 */
import type { Druckauftrag, DruckauftragStatus, DruckauftragTyp } from '@core/types'
import { anzahlAus, text, textOderNull, zahlOderNull, type Zeile } from '../sql'
import { isoLokal } from '../zeit'
import type { RepoKontext } from './kontext'

export interface DruckauftragNeu {
  id?: string
  typ: DruckauftragTyp
  verkaufId: string | null
  kassentagId: string | null
  bytesPfad: string | null
  status?: DruckauftragStatus
  fehler?: string | null
}

export interface DruckauftragMarkierung {
  fehler?: string | null
  spoolerJobId?: number | null
}

export interface DruckauftragRepo {
  erstelle(neu: DruckauftragNeu): Druckauftrag
  finde(id: string): Druckauftrag | null
  /** Ältester Auftrag mit Status queued (ORDER BY erstellt_am, rowid). */
  naechsterQueued(): Druckauftrag | null
  markiere(id: string, status: DruckauftragStatus, felder: DruckauftragMarkierung): void
  /** Setzt alle queued/sent auf failed mit Grund; liefert die Anzahl. */
  markiereAlleOffenenAlsFailed(grund: string): number
  /** Anzahl queued + sent. */
  anzahlOffen(): number
  /** Nachdrucke (typ LIKE 'nachdruck_%') für Verkäufe des Kassentags (verkauf.kassentag_id). */
  anzahlNachdrucke(kassentagId: string): number
  /** Der Erstdruck-Auftrag (typ beleg) eines Verkaufs. */
  belegAuftrag(verkaufId: string): Druckauftrag | null
  alleFuerVerkauf(verkaufId: string): Druckauftrag[]
}

const SPALTEN =
  'id, verkauf_id, kassentag_id, typ, bytes_pfad, status, spooler_job_id, fehler, erstellt_am, erledigt_am'

const TYPEN: readonly string[] = [
  'beleg',
  'nachdruck_alles',
  'nachdruck_coupons',
  'nachdruck_bon',
  'abschluss',
  'test',
  'schublade'
]
const STATI: readonly string[] = ['queued', 'sent', 'done', 'failed']

function istTyp(t: string): t is DruckauftragTyp {
  return TYPEN.includes(t)
}

function istStatus(s: string): s is DruckauftragStatus {
  return STATI.includes(s)
}

export function zuDruckauftrag(z: Zeile): Druckauftrag {
  const typ = text(z, 'typ')
  const status = text(z, 'status')
  if (!istTyp(typ)) throw new Error(`Unbekannter Druckauftragstyp "${typ}"`)
  if (!istStatus(status)) throw new Error(`Unbekannter Druckauftragsstatus "${status}"`)
  return {
    id: text(z, 'id'),
    verkaufId: textOderNull(z, 'verkauf_id'),
    kassentagId: textOderNull(z, 'kassentag_id'),
    typ,
    bytesPfad: textOderNull(z, 'bytes_pfad'),
    status,
    spoolerJobId: zahlOderNull(z, 'spooler_job_id'),
    fehler: textOderNull(z, 'fehler'),
    erstelltAm: text(z, 'erstellt_am'),
    erledigtAm: textOderNull(z, 'erledigt_am')
  }
}

export function erstelleDruckauftragRepo(k: RepoKontext): DruckauftragRepo {
  const { db } = k

  function finde(id: string): Druckauftrag | null {
    const z = db.prepare(`SELECT ${SPALTEN} FROM druckauftrag WHERE id = ?`).get(id)
    return z === undefined ? null : zuDruckauftrag(z)
  }

  return {
    erstelle(neu) {
      const id = neu.id ?? k.neueId()
      const status = neu.status ?? 'queued'
      const jetzt = isoLokal(k.uhr())
      const erledigtAm = status === 'done' || status === 'failed' ? jetzt : null
      db.prepare(
        `INSERT INTO druckauftrag (${SPALTEN}) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
      ).run(
        id,
        neu.verkaufId,
        neu.kassentagId,
        neu.typ,
        neu.bytesPfad,
        status,
        neu.fehler ?? null,
        jetzt,
        erledigtAm
      )
      const a = finde(id)
      if (a === null) throw new Error('Druckauftrag konnte nach dem Anlegen nicht gelesen werden')
      return a
    },
    finde,
    naechsterQueued() {
      const z = db
        .prepare(
          `SELECT ${SPALTEN} FROM druckauftrag WHERE status = 'queued' ORDER BY erstellt_am, rowid LIMIT 1`
        )
        .get()
      return z === undefined ? null : zuDruckauftrag(z)
    },
    markiere(id, status, felder) {
      const erledigt = status === 'done' || status === 'failed'
      const teile: string[] = ['status = ?']
      const werte: (string | number | null)[] = [status]
      if (felder.fehler !== undefined) {
        teile.push('fehler = ?')
        werte.push(felder.fehler)
      }
      if (felder.spoolerJobId !== undefined) {
        teile.push('spooler_job_id = ?')
        werte.push(felder.spoolerJobId)
      }
      if (erledigt) {
        teile.push('erledigt_am = ?')
        werte.push(isoLokal(k.uhr()))
      }
      werte.push(id)
      db.prepare(`UPDATE druckauftrag SET ${teile.join(', ')} WHERE id = ?`).run(...werte)
    },
    markiereAlleOffenenAlsFailed(grund) {
      const r = db
        .prepare(
          "UPDATE druckauftrag SET status = 'failed', fehler = ?, erledigt_am = ? WHERE status IN ('queued', 'sent')"
        )
        .run(grund, isoLokal(k.uhr()))
      return Number(r.changes)
    },
    anzahlOffen() {
      return anzahlAus(
        db
          .prepare("SELECT COUNT(*) AS n FROM druckauftrag WHERE status IN ('queued', 'sent')")
          .get()
      )
    },
    anzahlNachdrucke(kassentagId) {
      return anzahlAus(
        db
          .prepare(
            'SELECT COUNT(*) AS n FROM druckauftrag d JOIN verkauf v ON v.id = d.verkauf_id ' +
              "WHERE d.typ LIKE 'nachdruck_%' AND v.kassentag_id = ?"
          )
          .get(kassentagId)
      )
    },
    belegAuftrag(verkaufId) {
      const z = db
        .prepare(
          `SELECT ${SPALTEN} FROM druckauftrag WHERE verkauf_id = ? AND typ = 'beleg' ORDER BY erstellt_am, rowid LIMIT 1`
        )
        .get(verkaufId)
      return z === undefined ? null : zuDruckauftrag(z)
    },
    alleFuerVerkauf(verkaufId) {
      return db
        .prepare(
          `SELECT ${SPALTEN} FROM druckauftrag WHERE verkauf_id = ? ORDER BY erstellt_am, rowid`
        )
        .all(verkaufId)
        .map(zuDruckauftrag)
    }
  }
}
