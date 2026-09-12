/**
 * Hono-App der Kasse: alle Routen aus KONTRAKT.md (Abschnitt src/server).
 * Fehler kommen immer als JSON FehlerAntwort { fehler, meldung } mit passendem HTTP-Status.
 * Geschützte Routen erwarten den Header X-Pin.
 */
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { createMiddleware } from 'hono/factory'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { berechneAbschluss } from '@core/abschluss'
import {
  bonModellAbschluss,
  bonModellTest,
  bonModellVerkauf,
  formatDatum,
  type NachdruckArt
} from '@core/bon'
import type {
  AbschlussBericht,
  Druckauftrag,
  DruckStatus,
  Einstellungen,
  FehlerAntwort,
  Kassentag,
  Position,
  Produkt,
  StatusAntwort,
  Verkauf,
  VerkaufAntwort,
  Warenkorb,
  Zahlung,
  ZahlungsWarnung
} from '@core/types'
import { sofortAusgeben } from '@core/warenkorb'
import { berechneZahlung } from '@core/zahlung'
import { inTransaktion } from './db'
import { erstelleDruckDienst, type DruckDienst } from './druck'
import {
  erstelleRepos,
  istGruppe,
  istStornoGrund,
  istWarenkorb,
  istZahlart,
  type Repos
} from './repos/index'
import type { PositionNeu } from './repos/verkaufRepo'
import {
  auswahlFeld,
  boolFeld,
  boolFeldOptional,
  EingabeFehler,
  ganzzahlFeld,
  ganzzahlFeldOptional,
  ganzzahlOderNullFeld,
  istGueltigePin,
  listeFeld,
  objekt,
  textFeld,
  textFeldOptional,
  textOderNullFeld,
  type Objekt
} from './validierung'
import { datumLokal, isoLokal, systemUhr, type Uhr } from './zeit'

export interface AppDeps {
  db: DatabaseSync
  /** Ordner für <druckauftragId>.bin */
  bytesOrdner: string
  version: string
  /** true: CORS für http://localhost:5173 (Vite-Dev-Server des Renderers) */
  dev?: boolean
  /** Renderer-Build (out/renderer); wird statisch mit index.html-Fallback ausgeliefert */
  rendererOrdner?: string
  /** Status des Druck-Workers (worker.status()); fehlt er, meldet die Ampel "pruefen" */
  druckStatus?: () => Pick<DruckStatus, 'ampel' | 'letzterFehler' | 'transport'>
  /** Wird nach jedem neuen Druckauftrag aufgerufen (z. B. worker.verarbeiteOffene()) */
  nachDruckauftrag?: () => void
  /** Nach dem Kassenabschluss (PDF, Backup); Fehler werden protokolliert, nicht weitergegeben */
  nachAbschluss?: (bericht: AbschlussBericht) => void | Promise<void>
  /** Backup vor "Testdaten löschen"; liefert den Pfad der Sicherung */
  backup?: () => string | null | Promise<string | null>
  uhr?: Uhr
  neueId?: () => string
  log?: (meldung: string) => void
}

/** Für Tests und main: Zugriff auf Repos und Druckdienst der App. */
export interface KassenApp {
  app: Hono
  repos: Repos
  druck: DruckDienst
}

type FehlerStatus = 400 | 403 | 404 | 409 | 500

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
}

function fehlerText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function fehler(
  c: Context,
  status: FehlerStatus,
  code: string,
  meldung: string,
  extra: Record<string, unknown> = {}
): Response {
  const body: FehlerAntwort & Record<string, unknown> = { fehler: code, meldung, ...extra }
  return c.json(body, status as ContentfulStatusCode)
}

async function leseBody(c: Context): Promise<Objekt> {
  let roh: unknown
  try {
    roh = await c.req.json()
  } catch {
    throw new EingabeFehler('Body ist kein gültiges JSON')
  }
  return objekt(roh)
}

const ZAHLARTEN = ['bar_chf', 'bar_eur', 'twint', 'helfer'] as const
const NACHDRUCK_ARTEN = ['alles', 'coupons', 'bon'] as const
const STORNO_GRUENDE = ['tippfehler', 'ausverkauft', 'abgesprungen'] as const

export function erstelleApp(deps: AppDeps): Hono {
  return erstelleKassenApp(deps).app
}

export function erstelleKassenApp(deps: AppDeps): KassenApp {
  const uhr = deps.uhr ?? systemUhr
  const log = deps.log ?? ((m: string): void => console.log(`[server] ${m}`))
  const repos = erstelleRepos(deps.db, uhr, deps.neueId)
  const druck = erstelleDruckDienst(repos.druckauftrag, deps.bytesOrdner, repos.kontext.neueId)
  const app = new Hono()

  function druckAnstossen(): void {
    try {
      deps.nachDruckauftrag?.()
    } catch (e) {
      log(`nachDruckauftrag-Callback fehlgeschlagen: ${fehlerText(e)}`)
    }
  }

  // ---------------------------------------------------------------- Middleware

  if (deps.dev === true) {
    app.use(
      '/api/*',
      cors({ origin: 'http://localhost:5173', allowHeaders: ['Content-Type', 'X-Pin'] })
    )
  }

  const mitPin = createMiddleware(async (c, next) => {
    if (!repos.einstellung.pruefePin(c.req.header('X-Pin'))) {
      return fehler(c, 403, 'pin_falsch', 'PIN falsch.')
    }
    await next()
    return undefined
  })

  app.onError((e, c) => {
    if (e instanceof EingabeFehler) return fehler(c, 400, e.code, e.message)
    log(`Unbehandelter Fehler ${c.req.method} ${c.req.path}: ${fehlerText(e)}`)
    return fehler(c, 500, 'interner_fehler', `Interner Fehler: ${fehlerText(e)}`)
  })

  app.notFound((c) =>
    fehler(c, 404, 'nicht_gefunden', `Route ${c.req.method} ${c.req.path} gibt es nicht.`)
  )

  // ---------------------------------------------------------------- Helfer

  function vortagOffen(): Kassentag | null {
    const offen = repos.kassentag.offener()
    if (offen === null) return null
    return offen.datum < datumLokal(uhr()) ? offen : null
  }

  /**
   * Offener Kassentag für Buchungen (Verkauf, Storno). Ein offener Vortag (MUSS 10, Testfall 24)
   * sperrt Buchungen: der Abschluss muss zuerst nachgeholt werden, sonst landen Verkäufe auf dem
   * falschen Datum und im falschen Abschluss.
   */
  function buchungsKassentag(c: Context): { kassentag: Kassentag } | { antwort: Response } {
    const kassentag = repos.kassentag.offener()
    if (kassentag === null) {
      return {
        antwort: fehler(
          c,
          409,
          'kein_kassentag',
          'Kein Kassentag geöffnet. Bitte zuerst den Kassentag starten.'
        )
      }
    }
    if (kassentag.datum < datumLokal(uhr())) {
      return {
        antwort: fehler(
          c,
          409,
          'vortag_offen',
          `Der Kassentag ${formatDatum(kassentag.datum)} (${kassentag.kassier}) ist noch nicht abgeschlossen. Bitte zuerst den Abschluss nachholen.`
        )
      }
    }
    return { kassentag }
  }

  function druckStatus(): DruckStatus {
    const worker = deps.druckStatus?.() ?? {
      ampel: 'pruefen' as const,
      letzterFehler: 'Druck-Worker nicht gestartet',
      transport: 'simulator' as const
    }
    return {
      ampel: worker.ampel,
      letzterFehler: worker.letzterFehler,
      transport: worker.transport,
      offeneAuftraege: repos.druckauftrag.anzahlOffen(),
      druckerName: repos.einstellung.einstellungen().druckerName
    }
  }

  function bericht(
    kassentag: Kassentag,
    istChfRappen: number | null,
    istEurCent: number | null,
    erstelltAm: string = isoLokal(uhr())
  ): AbschlussBericht {
    const { verkaeufe, positionen, zahlungen } = repos.verkauf.desKassentags(kassentag.id)
    return berechneAbschluss({
      kassentag,
      verkaeufe,
      positionen,
      zahlungen,
      storni: repos.storno.desKassentags(kassentag.id),
      nachdrucke: repos.druckauftrag.anzahlNachdrucke(kassentag.id),
      istChfRappen,
      istEurCent,
      erstelltAm
    })
  }

  function verkaufAntwort(
    verkauf: Verkauf,
    zahlung: Zahlung,
    positionen: Position[],
    druckauftrag: Druckauftrag | null,
    bereitsVorhanden: boolean
  ): VerkaufAntwort {
    return {
      verkauf,
      zahlung,
      positionen,
      sofortAusgeben: sofortAusgeben(
        positionen.map((p) => ({
          name: p.nameSnapshot,
          anzahl: p.anzahl,
          gruppe: p.gruppeSnapshot
        }))
      ),
      druckauftragId: druckauftrag?.id ?? null,
      bereitsVorhanden
    }
  }

  function produktAusBody(o: Objekt, teilweise: boolean): Partial<Produkt> {
    const p: Partial<Produkt> = {}
    const name = teilweise
      ? textFeldOptional(o, 'name', { max: 24 })
      : textFeld(o, 'name', { max: 24 })
    if (name !== undefined) {
      if (name.trim() === '') throw new EingabeFehler('Feld "name" ist leer')
      p.name = name.trim()
    }
    if (!teilweise || o['preisRappen'] !== undefined) {
      const preis = ganzzahlOderNullFeld(o, 'preisRappen', { min: 0 })
      if (preis !== null && preis % 5 !== 0)
        throw new EingabeFehler('Preis muss auf 5 Rappen enden (Fachregel 5)')
      p.preisRappen = preis
    }
    if (!teilweise || o['gruppe'] !== undefined) {
      const gruppe = o['gruppe']
      if (!istGruppe(gruppe)) throw new EingabeFehler('Feld "gruppe" muss coupon oder kasse sein')
      p.gruppe = gruppe
    }
    const aktiv = boolFeldOptional(o, 'aktiv')
    if (aktiv !== undefined) p.aktiv = aktiv
    const ausverkauft = boolFeldOptional(o, 'ausverkauft')
    if (ausverkauft !== undefined) p.ausverkauft = ausverkauft
    const reihenfolge = ganzzahlFeldOptional(o, 'reihenfolge')
    if (reihenfolge !== undefined) p.reihenfolge = reihenfolge
    return p
  }

  // ---------------------------------------------------------------- Health / Status

  app.get('/api/health', (c) => c.json({ ok: true, version: deps.version }))

  app.get('/api/status', (c) => {
    const antwort: StatusAntwort = {
      kassentag: repos.kassentag.offener(),
      vortagOffen: vortagOffen(),
      druck: druckStatus(),
      version: deps.version
    }
    return c.json(antwort)
  })

  // ---------------------------------------------------------------- Produkte

  app.get('/api/produkte', (c) => {
    const alle = c.req.query('alle')
    return c.json(repos.produkt.alle(!(alle === '1' || alle === 'true')))
  })

  app.post('/api/produkte', mitPin, async (c) => {
    const o = await leseBody(c)
    const p = produktAusBody(o, false)
    if (p.name === undefined || p.preisRappen === undefined || p.gruppe === undefined) {
      throw new EingabeFehler('name, preisRappen und gruppe sind Pflichtfelder')
    }
    const produkt = repos.produkt.erstelle({
      name: p.name,
      preisRappen: p.preisRappen,
      gruppe: p.gruppe,
      aktiv: p.aktiv,
      ausverkauft: p.ausverkauft,
      reihenfolge: p.reihenfolge
    })
    return c.json(produkt, 201)
  })

  app.put('/api/produkte/:id', mitPin, async (c) => {
    const o = await leseBody(c)
    const p = produktAusBody(o, true)
    const produkt = repos.produkt.aktualisiere(c.req.param('id'), p)
    if (produkt === null) return fehler(c, 404, 'produkt_nicht_gefunden', 'Produkt nicht gefunden.')
    return c.json(produkt)
  })

  app.post('/api/produkte/:id/ausverkauft', async (c) => {
    const o = await leseBody(c)
    const ausverkauft = boolFeld(o, 'ausverkauft')
    const produkt = repos.produkt.setzeAusverkauft(c.req.param('id'), ausverkauft)
    if (produkt === null) return fehler(c, 404, 'produkt_nicht_gefunden', 'Produkt nicht gefunden.')
    return c.json(produkt)
  })

  // ---------------------------------------------------------------- Kassentag

  app.get('/api/kassentag/aktuell', (c) => {
    const letzter = repos.kassentag.letzterAbgeschlossener()
    return c.json({
      kassentag: repos.kassentag.offener(),
      vortagOffen: vortagOffen(),
      vorschlagStartgeldChfRappen: letzter?.istChfRappen ?? 0,
      /** für den Nachdruck des Abschluss-Bons im Kassenstart (Testfall 32) */
      letzterAbgeschlossener: letzter
    })
  })

  app.post('/api/kassentag/start', async (c) => {
    const o = await leseBody(c)
    const startgeldChfRappen = ganzzahlFeld(o, 'startgeldChfRappen', { min: 0 })
    const startgeldEurCent =
      o['startgeldEurCent'] === undefined ? 0 : ganzzahlFeld(o, 'startgeldEurCent', { min: 0 })
    const kassier = textFeld(o, 'kassier', { max: 40 }).trim()
    if (repos.kassentag.offener() !== null) {
      return fehler(c, 409, 'kassentag_offen', 'Es ist bereits ein Kassentag offen.')
    }
    const kassentag = repos.kassentag.starte({
      datum: datumLokal(uhr()),
      kassePraefix: repos.einstellung.einstellungen().kassenPraefix,
      kassier,
      startgeldChfRappen,
      startgeldEurCent
    })
    return c.json(kassentag, 201)
  })

  app.get('/api/kassentag/aktuell/bericht', (c) => {
    const offen = repos.kassentag.offener()
    if (offen === null) return fehler(c, 409, 'kein_kassentag', 'Kein Kassentag geöffnet.')
    return c.json(bericht(offen, null, null))
  })

  app.post('/api/kassentag/:id/abschluss', async (c) => {
    const o = await leseBody(c)
    const istChfRappen = ganzzahlFeld(o, 'istChfRappen', { min: 0 })
    const istEurCent = o['istEurCent'] === undefined ? 0 : ganzzahlFeld(o, 'istEurCent', { min: 0 })
    const bemerkung = textOderNullFeld(o, 'bemerkung')
    const kassentag = repos.kassentag.finde(c.req.param('id'))
    if (kassentag === null)
      return fehler(c, 404, 'kassentag_nicht_gefunden', 'Kassentag nicht gefunden.')
    if (kassentag.abgeschlossenAm !== null) {
      return fehler(c, 409, 'bereits_abgeschlossen', 'Dieser Kassentag ist bereits abgeschlossen.')
    }

    const b = bericht(kassentag, istChfRappen, istEurCent)
    const ergebnis = inTransaktion(deps.db, () => {
      const abgeschlossen = repos.kassentag.schliesseAb(kassentag.id, {
        istChfRappen,
        istEurCent,
        differenzChfRappen: b.differenzChfRappen ?? istChfRappen - b.sollChfRappen,
        differenzEurCent: b.differenzEurCent ?? istEurCent - b.sollEurCent,
        bemerkung
      })
      if (abgeschlossen === null) throw new Error('Kassentag konnte nicht abgeschlossen werden')
      const auftrag = druck.reiheEin({
        typ: 'abschluss',
        modell: bonModellAbschluss(b),
        verkaufId: null,
        kassentagId: kassentag.id
      })
      return { abgeschlossen, auftrag }
    })
    druckAnstossen()
    if (deps.nachAbschluss !== undefined) {
      try {
        await deps.nachAbschluss(b)
      } catch (e) {
        log(`nachAbschluss-Callback fehlgeschlagen: ${fehlerText(e)}`)
      }
    }
    return c.json({ ...b, druckauftragId: ergebnis.auftrag.id })
  })

  // Nachdruck des Abschluss-Bons (Testfall 32: Abschluss bei Druckerausfall, Nachdruck nach Anstecken).
  // Der Bericht wird aus den gespeicherten Ist-Werten neu berechnet; Zeitstempel = Abschlusszeit.
  app.post('/api/kassentag/:id/abschluss/nachdruck', (c) => {
    const kassentag = repos.kassentag.finde(c.req.param('id'))
    if (kassentag === null)
      return fehler(c, 404, 'kassentag_nicht_gefunden', 'Kassentag nicht gefunden.')
    if (
      kassentag.abgeschlossenAm === null ||
      kassentag.istChfRappen === null ||
      kassentag.istEurCent === null
    ) {
      return fehler(
        c,
        409,
        'nicht_abgeschlossen',
        'Dieser Kassentag ist noch nicht abgeschlossen, es gibt keinen Abschluss-Bon.'
      )
    }
    const b = bericht(kassentag, kassentag.istChfRappen, kassentag.istEurCent, kassentag.abgeschlossenAm)
    const auftrag = druck.reiheEin({
      typ: 'abschluss',
      modell: bonModellAbschluss(b, { nachdruck: true }),
      verkaufId: null,
      kassentagId: kassentag.id
    })
    druckAnstossen()
    return c.json({ druckauftragId: auftrag.id })
  })

  // ---------------------------------------------------------------- Verkauf

  app.post('/api/verkauf', async (c) => {
    const o = await leseBody(c)
    const id = textFeld(o, 'id', { max: 64 })
    const zahlart = auswahlFeld(o, 'zahlart', ZAHLARTEN)
    if (!istZahlart(zahlart)) throw new EingabeFehler('Unbekannte Zahlart')
    const gegeben = zahlart === 'helfer' ? 0 : ganzzahlFeld(o, 'gegeben', { min: 0 })
    const spendeBehalten = boolFeld(o, 'spendeBehalten', false)
    const bestaetigtHohesRueckgeld = boolFeld(o, 'bestaetigtHohesRueckgeld', false)
    const rohPositionen = listeFeld(o, 'positionen')
    if (rohPositionen.length === 0) throw new EingabeFehler('Der Warenkorb ist leer.')

    // Mengen je Produkt zusammenfassen (doppelte produktId im Body -> eine Zeile)
    const mengen = new Map<string, number>()
    for (const roh of rohPositionen) {
      const p = objekt(roh, 'Position')
      const produktId = textFeld(p, 'produktId')
      const anzahl = ganzzahlFeld(p, 'anzahl', { min: 1 })
      mengen.set(produktId, (mengen.get(produktId) ?? 0) + anzahl)
    }

    // Idempotenz: derselbe Verkauf wird nicht ein zweites Mal angelegt (Fachregel 17)
    const vorhanden = repos.verkauf.detail(id)
    if (vorhanden !== null) {
      return c.json(
        verkaufAntwort(
          vorhanden.verkauf,
          vorhanden.zahlung,
          vorhanden.positionen,
          repos.druckauftrag.belegAuftrag(id),
          true
        )
      )
    }

    const buchung = buchungsKassentag(c)
    if ('antwort' in buchung) return buchung.antwort
    const { kassentag } = buchung

    const positionen: PositionNeu[] = []
    let totalRappen = 0
    for (const [produktId, anzahl] of mengen) {
      const produkt = repos.produkt.finde(produktId)
      if (produkt === null) {
        return fehler(c, 409, 'produkt_nicht_verfuegbar', `Produkt ${produktId} gibt es nicht.`)
      }
      if (!produkt.aktiv || produkt.preisRappen === null) {
        return fehler(
          c,
          409,
          'produkt_nicht_verfuegbar',
          `Produkt "${produkt.name}" ist nicht aktiv.`
        )
      }
      if (produkt.ausverkauft) {
        return fehler(
          c,
          409,
          'produkt_nicht_verfuegbar',
          `Produkt "${produkt.name}" ist ausverkauft.`
        )
      }
      positionen.push({
        produktId,
        nameSnapshot: produkt.name,
        preisSnapshotRappen: produkt.preisRappen,
        anzahl,
        gruppeSnapshot: produkt.gruppe
      })
      totalRappen += produkt.preisRappen * anzahl
    }
    // Helfer/Gratis: Total 0, Positionen behalten den Preis-Snapshot (Helferessen im Abschluss, Fachregel 8)
    const verkaufTotal = zahlart === 'helfer' ? 0 : totalRappen

    const einstellungen = repos.einstellung.einstellungen()
    let ergebnis
    try {
      ergebnis = berechneZahlung({
        zahlart,
        totalRappen: verkaufTotal,
        gegeben,
        kursX10000: einstellungen.eurKursX10000,
        spendeBehalten
      })
    } catch (e) {
      return fehler(c, 400, 'ungueltige_zahlung', fehlerText(e))
    }
    if (!ergebnis.gedeckt) {
      return fehler(c, 409, 'nicht_gedeckt', 'Betrag nicht gedeckt.', {
        warnungen: ergebnis.warnungen
      })
    }
    const warnungen: ZahlungsWarnung[] = ergebnis.warnungen
    if (warnungen.length > 0 && !bestaetigtHohesRueckgeld) {
      return fehler(
        c,
        409,
        'bestaetigung_noetig',
        'Rückgeld oder Spende über 200 CHF, bitte bestätigen.',
        { warnungen }
      )
    }

    const erstellt = repos.verkauf.erstelle(
      {
        id,
        kassentagId: kassentag.id,
        zahlart,
        totalRappen: verkaufTotal,
        positionen,
        zahlung: {
          waehrung: ergebnis.waehrung,
          kursX10000: ergebnis.kursX10000,
          gegeben: ergebnis.gegeben,
          gegebenChfRappen: ergebnis.gegebenChfRappen,
          rueckgeldChfRappen: ergebnis.rueckgeldChfRappen,
          spendeChfRappen: ergebnis.spendeChfRappen,
          spendeTyp: ergebnis.spendeTyp
        }
      },
      (verkauf, pos, zahlung) => {
        const auftrag = druck.reiheEin({
          typ: 'beleg',
          modell: bonModellVerkauf(verkauf, pos, zahlung, { nachdruck: null }),
          verkaufId: verkauf.id,
          kassentagId: verkauf.kassentagId
        })
        repos.warenkorb.leeren()
        return auftrag
      }
    )
    if (!erstellt.bereitsVorhanden) druckAnstossen()
    return c.json(
      verkaufAntwort(
        erstellt.verkauf,
        erstellt.zahlung,
        erstellt.positionen,
        erstellt.druckauftrag,
        erstellt.bereitsVorhanden
      ),
      erstellt.bereitsVorhanden ? 200 : 201
    )
  })

  app.get('/api/verkauf/letzte', (c) => {
    const roh = Number(c.req.query('limit') ?? '20')
    const limit = Number.isSafeInteger(roh) && roh > 0 ? Math.min(roh, 200) : 20
    return c.json(repos.verkauf.letzte(limit))
  })

  app.post('/api/verkauf/:id/storno', async (c) => {
    const o = await leseBody(c)
    const grund = auswahlFeld(o, 'grund', STORNO_GRUENDE)
    if (!istStornoGrund(grund)) throw new EingabeFehler('Unbekannter Stornogrund')
    const verkauf = repos.verkauf.finde(c.req.param('id'))
    if (verkauf === null) return fehler(c, 404, 'verkauf_nicht_gefunden', 'Beleg nicht gefunden.')
    if (verkauf.storniertAm !== null || repos.storno.fuerVerkauf(verkauf.id) !== null) {
      return fehler(c, 409, 'bereits_storniert', `Beleg ${verkauf.belegnr} ist bereits storniert.`)
    }
    const buchung = buchungsKassentag(c)
    if ('antwort' in buchung) return buchung.antwort
    const { kassentag } = buchung
    // Letzter Beleg des offenen Kassentags ohne PIN, alle anderen nur mit PIN (Fachregel 9)
    const letzter = repos.verkauf.letzter()
    const istLetzter =
      letzter !== null && letzter.id === verkauf.id && letzter.kassentagId === kassentag.id
    let mitPinGebucht = false
    if (!istLetzter) {
      if (!repos.einstellung.pruefePin(c.req.header('X-Pin'))) {
        return fehler(c, 403, 'pin_falsch', 'Storno älterer Belege nur mit PIN.')
      }
      mitPinGebucht = true
    }
    const auszahlungChfRappen = verkauf.zahlart === 'helfer' ? 0 : verkauf.totalRappen

    const { storno, auftrag } = inTransaktion(deps.db, () => {
      const s = repos.storno.erstelle({
        verkaufId: verkauf.id,
        kassentagId: kassentag.id,
        grund,
        auszahlungChfRappen,
        mitPin: mitPinGebucht
      })
      repos.verkauf.markiereStorniert(verkauf.id, s.id)
      // Schublade nur bei Auszahlung > 0 (Fachregel 10)
      const a =
        auszahlungChfRappen > 0
          ? druck.reiheEin({
              typ: 'schublade',
              modell: { schublade: true, dokumente: [] },
              verkaufId: verkauf.id,
              kassentagId: kassentag.id
            })
          : null
      return { storno: s, auftrag: a }
    })
    if (auftrag !== null) druckAnstossen()
    return c.json({ ...storno, druckauftragId: auftrag?.id ?? null })
  })

  app.post('/api/verkauf/:id/nachdruck', async (c) => {
    const o = await leseBody(c)
    const was = auswahlFeld(o, 'was', NACHDRUCK_ARTEN)
    const detail = repos.verkauf.detail(c.req.param('id'))
    if (detail === null) return fehler(c, 404, 'verkauf_nicht_gefunden', 'Beleg nicht gefunden.')
    if (detail.verkauf.storniertAm !== null || detail.storno !== null) {
      return fehler(
        c,
        409,
        'beleg_storniert',
        `Beleg ${detail.verkauf.belegnr} ist storniert und wird nicht nachgedruckt.`
      )
    }
    const nachdruck: NachdruckArt = was
    const auftrag = druck.reiheEin({
      typ: `nachdruck_${was}`,
      modell: bonModellVerkauf(detail.verkauf, detail.positionen, detail.zahlung, { nachdruck }),
      verkaufId: detail.verkauf.id,
      kassentagId: detail.verkauf.kassentagId
    })
    druckAnstossen()
    return c.json({ druckauftragId: auftrag.id })
  })

  // ---------------------------------------------------------------- Druck

  // Zustand eines einzelnen Druckauftrags (Banner verfolgt den eigenen Beleg-Auftrag)
  app.get('/api/druck/:id', (c) => {
    const auftrag = repos.druckauftrag.finde(c.req.param('id'))
    if (auftrag === null)
      return fehler(c, 404, 'druckauftrag_nicht_gefunden', 'Druckauftrag nicht gefunden.')
    return c.json(auftrag)
  })

  app.post('/api/druck/test', (c) => {
    const auftrag = druck.reiheEin({
      typ: 'test',
      modell: bonModellTest(),
      verkaufId: null,
      kassentagId: null
    })
    druckAnstossen()
    return c.json({ druckauftragId: auftrag.id })
  })

  // ---------------------------------------------------------------- Einstellungen / PIN

  app.get('/api/einstellungen', (c) => c.json(repos.einstellung.einstellungen()))

  app.put('/api/einstellungen', mitPin, async (c) => {
    const o = await leseBody(c)
    const aenderung: Partial<Omit<Einstellungen, 'belegzaehler'>> = {}
    const kurs = ganzzahlFeldOptional(o, 'eurKursX10000', { min: 1 })
    if (kurs !== undefined) aenderung.eurKursX10000 = kurs
    const drucker = textFeldOptional(o, 'druckerName', { max: 120 })
    if (drucker !== undefined) aenderung.druckerName = drucker.trim()
    const praefix = textFeldOptional(o, 'kassenPraefix', { max: 8 })
    if (praefix !== undefined) {
      if (!/^[A-Za-z0-9]{1,8}$/.test(praefix))
        throw new EingabeFehler('Kassen-Präfix: nur Buchstaben und Ziffern, max. 8')
      aenderung.kassenPraefix = praefix
    }
    if (o['backupPfadUsb'] !== undefined)
      aenderung.backupPfadUsb = textOderNullFeld(o, 'backupPfadUsb')
    const port = ganzzahlFeldOptional(o, 'port', { min: 1, max: 65535 })
    if (port !== undefined) aenderung.port = port
    const neuePin = textFeldOptional(o, 'neuePin')
    if (neuePin !== undefined && !istGueltigePin(neuePin))
      throw new EingabeFehler('Neue PIN: 4 bis 8 Ziffern')

    const einstellungen = inTransaktion(deps.db, () => {
      const e = repos.einstellung.aktualisiere(aenderung)
      if (neuePin !== undefined) repos.einstellung.setzePin(neuePin)
      return e
    })
    return c.json(einstellungen)
  })

  app.post('/api/pin/pruefen', async (c) => {
    const o = await leseBody(c)
    const pin = o['pin']
    return c.json({ ok: typeof pin === 'string' && repos.einstellung.pruefePin(pin) })
  })

  app.post('/api/testdaten-loeschen', mitPin, async (c) => {
    let backupPfad: string | null = null
    if (deps.backup !== undefined) {
      try {
        backupPfad = await deps.backup()
      } catch (e) {
        return fehler(
          c,
          500,
          'backup_fehlgeschlagen',
          `Backup vor dem Löschen fehlgeschlagen: ${fehlerText(e)}`
        )
      }
    }
    repos.loescheTestdaten()
    return c.json({ ok: true, backupPfad })
  })

  // ---------------------------------------------------------------- Warenkorb-Entwurf

  app.get('/api/warenkorb-entwurf', (c) => c.json(repos.warenkorb.lies()))

  app.put('/api/warenkorb-entwurf', async (c) => {
    const o = await leseBody(c)
    if (!istWarenkorb(o)) throw new EingabeFehler('Warenkorb: Feld "zeilen" (Liste) fehlt')
    const w: Warenkorb = { zeilen: o.zeilen }
    repos.warenkorb.speichere(w)
    return c.json(w)
  })

  // ---------------------------------------------------------------- Statisches Renderer-Build

  app.get('/*', async (c) => {
    if (c.req.path.startsWith('/api/')) {
      return fehler(c, 404, 'nicht_gefunden', `Route GET ${c.req.path} gibt es nicht.`)
    }
    const ordner = deps.rendererOrdner
    if (ordner === undefined || !existsSync(ordner)) {
      return fehler(c, 404, 'kein_renderer', 'Kein Renderer-Build vorhanden.')
    }
    const wurzel = resolve(ordner)
    let pfad: string
    try {
      pfad = decodeURIComponent(c.req.path)
    } catch {
      pfad = '/'
    }
    let datei = resolve(wurzel, `.${pfad}`)
    if (datei !== wurzel && !datei.startsWith(wurzel + sep)) datei = resolve(wurzel, 'index.html')
    if (!existsSync(datei) || !statSync(datei).isFile()) datei = resolve(wurzel, 'index.html')
    if (!existsSync(datei))
      return fehler(c, 404, 'kein_renderer', 'index.html des Renderers fehlt.')
    const inhalt = await readFile(datei)
    const typ = MIME[extname(datei).toLowerCase()] ?? 'application/octet-stream'
    c.header('Content-Type', typ)
    c.header('Cache-Control', datei.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600')
    return c.body(new Uint8Array(inhalt.buffer, inhalt.byteOffset, inhalt.byteLength))
  })

  return { app, repos, druck }
}
