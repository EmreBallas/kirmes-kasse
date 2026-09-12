/**
 * Gemeinsame Testumgebung (nur für *.test.ts): In-Memory-DB mit Migration, Produkt-Seed aus
 * resources/produkte-seed.json, feste Einstellungen inkl. PIN, feste Uhr, temporärer Bytes-Ordner.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'
import type { AbschlussBericht } from '@core/types'
import { erstelleKassenApp, type AppDeps } from './app'
import { migriere, oeffneDb, type DatabaseSync } from './db'
import type { DruckDienst } from './druck'
import type { Repos } from './repos/index'
import { leseProdukteSeed, seedEinstellungen, seedProdukte } from './seed'
import { festeUhr } from './zeit'

export const MIGRATIONEN_ORDNER = fileURLToPath(new URL('./migrations', import.meta.url))
export const PRODUKTE_SEED = fileURLToPath(
  new URL('../../resources/produkte-seed.json', import.meta.url)
)

export const TEST_PIN = '1234'
export const START_ZEIT = '2026-09-19T14:32:05'

export interface Antwort {
  status: number
  json: Record<string, unknown>
  liste: unknown[]
}

export interface TestUmgebung {
  db: DatabaseSync
  app: Hono
  repos: Repos
  druck: DruckDienst
  uhr: ReturnType<typeof festeUhr>
  bytesOrdner: string
  abschluesse: AbschlussBericht[]
  backups: number
  druckAnstoesse: number
  /** Produkt-ID über den Namen aus dem Seed. */
  produktId(name: string): string
  anfrage(methode: string, pfad: string, body?: unknown, pin?: string): Promise<Antwort>
  /** Startet einen Kassentag mit Standardwerten und liefert dessen ID. */
  kassentagStarten(startgeldChfRappen?: number): Promise<string>
  /** Verkauf Bar-CHF mit passendem Betrag; liefert die Antwort. */
  verkauf(
    id: string,
    produkte: { name: string; anzahl: number }[],
    extra?: Record<string, unknown>
  ): Promise<Antwort>
  aufraeumen(): void
}

let zaehler = 0

export function erstelleTestUmgebung(
  opts: { deps?: Partial<AppDeps>; ohneSeed?: boolean } = {}
): TestUmgebung {
  const db = oeffneDb(':memory:')
  const uhr = festeUhr(START_ZEIT)
  migriere(db, MIGRATIONEN_ORDNER, uhr)
  const bytesOrdner = mkdtempSync(join(tmpdir(), 'kasse-test-'))
  const abschluesse: AbschlussBericht[] = []
  const zustand = { backups: 0, druckAnstoesse: 0 }
  zaehler += 1
  let idZaehler = 0
  const praefix = `t${String(zaehler)}`

  const { app, repos, druck } = erstelleKassenApp({
    db,
    bytesOrdner,
    version: 'test',
    uhr,
    neueId: () => {
      idZaehler += 1
      return `${praefix}-${String(idZaehler).padStart(4, '0')}`
    },
    log: () => undefined,
    druckStatus: () => ({ ampel: 'ok', letzterFehler: null, transport: 'simulator' }),
    nachDruckauftrag: () => {
      zustand.druckAnstoesse += 1
    },
    nachAbschluss: (b) => {
      abschluesse.push(b)
    },
    backup: () => {
      zustand.backups += 1
      return 'C:/Kasse/backup/test.sqlite'
    },
    ...opts.deps
  })

  if (opts.ohneSeed !== true) {
    seedProdukte(repos, leseProdukteSeed(PRODUKTE_SEED))
    seedEinstellungen(repos, {
      pin: TEST_PIN,
      eurKursX10000: 9000,
      kassenPraefix: 'K1',
      druckerName: 'TM-T20II',
      port: 47100
    })
  }

  async function anfrage(
    methode: string,
    pfad: string,
    body?: unknown,
    pin?: string
  ): Promise<Antwort> {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (pin !== undefined) headers['X-Pin'] = pin
    const res = await app.request(pfad, {
      method: methode,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const text = await res.text()
    let json: unknown = null
    try {
      json = text === '' ? null : JSON.parse(text)
    } catch {
      json = { roh: text }
    }
    return {
      status: res.status,
      json:
        typeof json === 'object' && json !== null && !Array.isArray(json)
          ? (json as Record<string, unknown>)
          : {},
      liste: Array.isArray(json) ? json : []
    }
  }

  function produktId(name: string): string {
    const p = repos.produkt.alle(false).find((x) => x.name === name)
    if (p === undefined) throw new Error(`Testprodukt "${name}" fehlt im Seed`)
    return p.id
  }

  return {
    db,
    app,
    repos,
    druck,
    uhr,
    bytesOrdner,
    abschluesse,
    get backups() {
      return zustand.backups
    },
    get druckAnstoesse() {
      return zustand.druckAnstoesse
    },
    produktId,
    anfrage,
    async kassentagStarten(startgeldChfRappen = 20000) {
      const a = await anfrage('POST', '/api/kassentag/start', {
        startgeldChfRappen,
        startgeldEurCent: 0,
        kassier: 'EB'
      })
      if (a.status !== 201)
        throw new Error(`Kassentag-Start fehlgeschlagen: ${JSON.stringify(a.json)}`)
      return String(a.json['id'])
    },
    async verkauf(id, produkte, extra = {}) {
      const positionen = produkte.map((p) => ({ produktId: produktId(p.name), anzahl: p.anzahl }))
      let total = 0
      for (const p of produkte) {
        const produkt = repos.produkt.finde(produktId(p.name))
        total += (produkt?.preisRappen ?? 0) * p.anzahl
      }
      return anfrage('POST', '/api/verkauf', {
        id,
        positionen,
        zahlart: 'bar_chf',
        gegeben: total,
        spendeBehalten: false,
        bestaetigtHohesRueckgeld: false,
        ...extra
      })
    },
    aufraeumen() {
      db.close()
      rmSync(bytesOrdner, { recursive: true, force: true })
    }
  }
}
