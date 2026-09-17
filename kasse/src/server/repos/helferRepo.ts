/**
 * Helfer (Essen holen, sofort oder später zahlen): gespeicherte Helfernamen (Tabelle helfer, Stammdaten,
 * eindeutig ohne Gross-/Kleinschreibung), Zahlungen auf die offene Schuld (Tabelle helfer_zahlung, idempotent
 * über id, Teilzahlungen erlaubt) und die offenen Salden je Name über ALLE Kassentage:
 *   Σ total_rappen der nicht stornierten Verkäufe mit zahlart helfer und diesem Namen
 * − Σ betrag_chf_rappen der nicht stornierten Helfer-Zahlungen dieses Namens.
 * Nichts wird gelöscht: Storno einer Zahlung setzt storniert_am; stornierte Zahlungen zählen nirgends.
 */
import { HELFER_NAME_MAX } from '@core/bon'
import { eurZuChfRappen } from '@core/geld'
import type { Helfer, HelferSaldo, HelferZahlung, HelferZahlungAnfrage } from '@core/types'
import { inTransaktion } from '../db'
import { bit, text, textOderNull, wahr, zahl, zahlOderNull, type Zeile } from '../sql'
import { isoLokal } from '../zeit'
import type { RepoKontext } from './kontext'
import { istSpendeTyp } from './spendeRepo'

/** Zahlung in der Liste «letzte Helfer-Zahlungen»: zusätzlich, ob der Storno eine PIN brauchte. */
export interface HelferZahlungEintrag extends HelferZahlung {
  mitPin: boolean
}

export interface HelferZahlungErstellt {
  zahlung: HelferZahlung
  /** true, wenn dieselbe Zahlung (id) schon existierte; dann wurde nichts neu angelegt. */
  bereitsVorhanden: boolean
}

export type HelferZahlungStornoErgebnis =
  | { ergebnis: 'storniert'; zahlung: HelferZahlung }
  | { ergebnis: 'nicht_gefunden' }
  | { ergebnis: 'bereits_storniert'; zahlung: HelferZahlung }

export interface HelferRepo {
  /**
   * Liefert den gespeicherten Helfer zu diesem Namen (Vergleich getrimmt, ohne Gross-/Kleinschreibung) oder legt
   * ihn an. Wirft bei leerem Namen oder mehr als HELFER_NAME_MAX Zeichen. Die zurückgegebene Schreibweise ist die
   * gespeicherte (erste) Schreibweise; Belege und Zahlungen tragen diesen Namen.
   */
  stelleSicher(name: string): Helfer
  /** Gespeicherter Helfer zu diesem Namen (getrimmt, ohne Gross-/Kleinschreibung) oder null. */
  finde(name: string): Helfer | null
  /** Alle gespeicherten Helfernamen, alphabetisch (ohne Gross-/Kleinschreibung). */
  alle(): Helfer[]
  /**
   * Offene Salden je Helfername über alle Kassentage, auch mit Saldo 0 (jeder gespeicherte Name und jeder Name mit
   * Bewegungen). `stichtag` (ISO lokal): nur Bewegungen bis dahin, Storni danach zählen noch nicht – damit ein
   * Nachdruck des Abschluss-Bons dieselben Salden zeigt wie der Abschluss. Sortiert nach Name.
   */
  salden(stichtag?: string): HelferSaldo[]
  /** Saldo eines Namens (0 ohne Bewegungen). */
  saldo(name: string): HelferSaldo
  /**
   * Legt die Zahlung an (idempotent über anfrage.id). betragChfRappen: bei bar_eur eurZuChfRappen(betrag, kursX10000)
   * (auf 5 Rappen abgerundet, Kurs wird gespeichert), sonst betrag. Der Name wird getrimmt so gespeichert, wie er kommt
   * (die Route übergibt die gespeicherte Schreibweise aus stelleSicher/finde).
   */
  zahlungErstelle(
    anfrage: HelferZahlungAnfrage,
    kassentagId: string,
    kursX10000: number
  ): HelferZahlungErstellt
  zahlungFinde(id: string): HelferZahlung | null
  /** Nicht stornierte Helfer-Zahlungen des Kassentags (für den Abschluss), älteste zuerst. */
  zahlungenFuerKassentag(kassentagId: string): HelferZahlung[]
  /** Die neuesten Helfer-Zahlungen (inkl. stornierte), neueste zuerst. */
  zahlungenLetzte(limit: number): HelferZahlungEintrag[]
  /** Setzt storniert_am; 'bereits_storniert', wenn die Zahlung schon storniert ist. */
  zahlungStorno(id: string, mitPin: boolean): HelferZahlungStornoErgebnis
  /** true, wenn diese Zahlung die zuletzt erfasste nicht stornierte Helfer-Zahlung ist (Storno ohne PIN). */
  istLetzteZahlung(id: string): boolean
}

const H_SPALTEN = 'id, name, erstellt_am'
const Z_SPALTEN =
  'id, kassentag_id, helfer_name, zeit, typ, betrag, kurs_x10000, betrag_chf_rappen, storniert_am, mit_pin'

/** Schlüssel für den Vergleich ohne Gross-/Kleinschreibung (wie COLLATE NOCASE für ASCII, plus Umlaute). */
export function helferSchluessel(name: string): string {
  return name.trim().toLocaleLowerCase('de-CH')
}

/** Getrimmter Name; wirft bei leer oder zu lang. */
export function pruefeHelferName(name: string): string {
  const bereinigt = name.trim()
  if (bereinigt === '') throw new Error('Helfername fehlt')
  if (bereinigt.length > HELFER_NAME_MAX) {
    throw new Error(`Helfername darf höchstens ${String(HELFER_NAME_MAX)} Zeichen haben`)
  }
  return bereinigt
}

export function zuHelfer(z: Zeile): Helfer {
  return { id: text(z, 'id'), name: text(z, 'name'), erstelltAm: text(z, 'erstellt_am') }
}

export function zuHelferZahlung(z: Zeile): HelferZahlung {
  const typ = text(z, 'typ')
  if (!istSpendeTyp(typ)) throw new Error(`Unbekannter Zahlungstyp "${typ}"`)
  return {
    id: text(z, 'id'),
    kassentagId: text(z, 'kassentag_id'),
    helferName: text(z, 'helfer_name'),
    zeit: text(z, 'zeit'),
    typ,
    betrag: zahl(z, 'betrag'),
    kursX10000: zahlOderNull(z, 'kurs_x10000'),
    betragChfRappen: zahl(z, 'betrag_chf_rappen'),
    storniertAm: textOderNull(z, 'storniert_am')
  }
}

function zuEintrag(z: Zeile): HelferZahlungEintrag {
  return { ...zuHelferZahlung(z), mitPin: wahr(z, 'mit_pin') }
}

interface SaldoSammler {
  name: string
  schuldRappen: number
  bezahltRappen: number
  verkaeufeAnzahl: number
  letzteZeit: string | null
}

export function erstelleHelferRepo(k: RepoKontext): HelferRepo {
  const { db } = k

  /**
   * Vergleich ohne Gross-/Kleinschreibung in JS (helferSchluessel): SQLites COLLATE NOCASE faltet nur ASCII,
   * «Müller» und «müller» wären für die Datenbank verschieden. Die Liste ist klein (Helfer eines Vereins).
   */
  function finde(name: string): Helfer | null {
    const schluessel = helferSchluessel(name)
    if (schluessel === '') return null
    return alle().find((h) => helferSchluessel(h.name) === schluessel) ?? null
  }

  function zahlungFinde(id: string): HelferZahlung | null {
    const z = db.prepare(`SELECT ${Z_SPALTEN} FROM helfer_zahlung WHERE id = ?`).get(id)
    return z === undefined ? null : zuHelferZahlung(z)
  }

  /**
   * Bewegungen bis zum Stichtag: ein Verkauf/eine Zahlung zählt, wenn sie bis dahin erfasst und bis dahin nicht
   * storniert war. Ohne Stichtag: alles Nichtstornierte.
   */
  function salden(stichtag?: string): HelferSaldo[] {
    const sammler = new Map<string, SaldoSammler>()
    function hole(name: string): SaldoSammler {
      const schluessel = helferSchluessel(name)
      let s = sammler.get(schluessel)
      if (s === undefined) {
        s = {
          name: name.trim(),
          schuldRappen: 0,
          bezahltRappen: 0,
          verkaeufeAnzahl: 0,
          letzteZeit: null
        }
        sammler.set(schluessel, s)
      }
      return s
    }
    function merkeZeit(s: SaldoSammler, zeit: string): void {
      if (s.letzteZeit === null || zeit > s.letzteZeit) s.letzteZeit = zeit
    }
    // Gespeicherte Namen zuerst: ihre Schreibweise gilt, und sie erscheinen auch ohne Bewegung (Saldo 0)
    for (const h of alle()) hole(h.name)

    const bis = stichtag ?? null
    const verkaeufe = db
      .prepare(
        'SELECT helfer_name, total_rappen, zeit, storniert_am FROM verkauf ' +
          "WHERE zahlart = 'helfer' AND helfer_name IS NOT NULL AND TRIM(helfer_name) <> '' " +
          'AND (? IS NULL OR zeit <= ?) AND (storniert_am IS NULL OR (? IS NOT NULL AND storniert_am > ?)) ' +
          'ORDER BY zeit, rowid'
      )
      .all(bis, bis, bis, bis)
    for (const z of verkaeufe) {
      const s = hole(text(z, 'helfer_name'))
      s.schuldRappen += zahl(z, 'total_rappen')
      s.verkaeufeAnzahl += 1
      merkeZeit(s, text(z, 'zeit'))
    }
    const zahlungen = db
      .prepare(
        'SELECT helfer_name, betrag_chf_rappen, zeit, storniert_am FROM helfer_zahlung ' +
          'WHERE (? IS NULL OR zeit <= ?) AND (storniert_am IS NULL OR (? IS NOT NULL AND storniert_am > ?)) ' +
          'ORDER BY zeit, rowid'
      )
      .all(bis, bis, bis, bis)
    for (const z of zahlungen) {
      const s = hole(text(z, 'helfer_name'))
      s.bezahltRappen += zahl(z, 'betrag_chf_rappen')
      merkeZeit(s, text(z, 'zeit'))
    }
    return [...sammler.values()]
      .map((s): HelferSaldo => ({
        name: s.name,
        offenRappen: s.schuldRappen - s.bezahltRappen,
        verkaeufeAnzahl: s.verkaeufeAnzahl,
        letzteZeit: s.letzteZeit
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de-CH'))
  }

  function alle(): Helfer[] {
    return db
      .prepare(`SELECT ${H_SPALTEN} FROM helfer ORDER BY name COLLATE NOCASE, rowid`)
      .all()
      .map(zuHelfer)
  }

  return {
    stelleSicher(name) {
      const bereinigt = pruefeHelferName(name)
      return inTransaktion(db, (): Helfer => {
        const vorhanden = finde(bereinigt)
        if (vorhanden !== null) return vorhanden
        const id = k.neueId()
        db.prepare(`INSERT INTO helfer (${H_SPALTEN}) VALUES (?, ?, ?)`).run(
          id,
          bereinigt,
          isoLokal(k.uhr())
        )
        const neu = finde(bereinigt)
        if (neu === null) throw new Error('Helfer konnte nach dem Anlegen nicht gelesen werden')
        return neu
      })
    },
    finde,
    alle,
    salden,
    saldo(name) {
      const schluessel = helferSchluessel(name)
      const gefunden = salden().find((s) => helferSchluessel(s.name) === schluessel)
      return gefunden ?? { name: name.trim(), offenRappen: 0, verkaeufeAnzahl: 0, letzteZeit: null }
    },
    zahlungErstelle(anfrage, kassentagId, kursX10000) {
      return inTransaktion(db, (): HelferZahlungErstellt => {
        const vorhanden = zahlungFinde(anfrage.id)
        if (vorhanden !== null) return { zahlung: vorhanden, bereitsVorhanden: true }
        if (!Number.isSafeInteger(anfrage.betrag) || anfrage.betrag <= 0) {
          throw new Error('Zahlungsbetrag muss eine ganze Zahl grösser als 0 sein')
        }
        const helferName = pruefeHelferName(anfrage.helferName)
        const eur = anfrage.typ === 'bar_eur'
        const betragChfRappen = eur ? eurZuChfRappen(anfrage.betrag, kursX10000) : anfrage.betrag
        db.prepare(
          `INSERT INTO helfer_zahlung (${Z_SPALTEN}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)`
        ).run(
          anfrage.id,
          kassentagId,
          helferName,
          isoLokal(k.uhr()),
          anfrage.typ,
          anfrage.betrag,
          eur ? kursX10000 : null,
          betragChfRappen
        )
        const zahlung = zahlungFinde(anfrage.id)
        if (zahlung === null)
          throw new Error('Helfer-Zahlung konnte nach dem Anlegen nicht gelesen werden')
        return { zahlung, bereitsVorhanden: false }
      })
    },
    zahlungFinde,
    zahlungenFuerKassentag(kassentagId) {
      return db
        .prepare(
          `SELECT ${Z_SPALTEN} FROM helfer_zahlung WHERE kassentag_id = ? AND storniert_am IS NULL ORDER BY zeit, rowid`
        )
        .all(kassentagId)
        .map(zuHelferZahlung)
    },
    zahlungenLetzte(limit) {
      return db
        .prepare(`SELECT ${Z_SPALTEN} FROM helfer_zahlung ORDER BY zeit DESC, rowid DESC LIMIT ?`)
        .all(limit)
        .map(zuEintrag)
    },
    zahlungStorno(id, mitPin) {
      return inTransaktion(db, (): HelferZahlungStornoErgebnis => {
        const vorhanden = zahlungFinde(id)
        if (vorhanden === null) return { ergebnis: 'nicht_gefunden' }
        if (vorhanden.storniertAm !== null)
          return { ergebnis: 'bereits_storniert', zahlung: vorhanden }
        db.prepare('UPDATE helfer_zahlung SET storniert_am = ?, mit_pin = ? WHERE id = ?').run(
          isoLokal(k.uhr()),
          bit(mitPin),
          id
        )
        const zahlung = zahlungFinde(id)
        if (zahlung === null)
          throw new Error('Helfer-Zahlung konnte nach dem Storno nicht gelesen werden')
        return { ergebnis: 'storniert', zahlung }
      })
    },
    istLetzteZahlung(id) {
      const z = db
        .prepare(
          'SELECT id FROM helfer_zahlung WHERE storniert_am IS NULL ORDER BY zeit DESC, rowid DESC LIMIT 1'
        )
        .get()
      return z !== undefined && text(z, 'id') === id
    }
  }
}
