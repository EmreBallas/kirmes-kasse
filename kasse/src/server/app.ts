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
import { formatChf, rabattBetrag, RABATT_PROZENT_MAX, RABATT_PROZENT_MIN } from '@core/geld'
import {
  bonModellAbschluss,
  bonModellTest,
  bonModellVerkauf,
  formatDatum,
  HELFER_NAME_MAX,
  VERANSTALTUNG_MAX_LAENGE,
  type NachdruckArt
} from '@core/bon'
import type {
  AbschlussBericht,
  Druckauftrag,
  DruckerInfo,
  DruckStatus,
  Einstellungen,
  FehlerAntwort,
  Helfer,
  HelferSaldo,
  HelferZahlung,
  HelferZahlungAnfrage,
  Kassentag,
  Position,
  Produkt,
  Spende,
  SpendeAnfrage,
  StatusAntwort,
  Verkauf,
  VerkaufAntwort,
  Zahlung,
  ZahlungsWarnung
} from '@core/types'
import { sofortAusgeben } from '@core/warenkorb'
import { berechneZahlung } from '@core/zahlung'
import { schlageDruckerVor } from '@print/winspool'
import { inTransaktion } from './db'
import { erstelleDruckDienst, type DruckDienst } from './druck'
import {
  erstelleRepos,
  istGruppe,
  istSpendeTyp,
  istStornoGrund,
  istWarenkorb,
  istZahlart,
  type Repos,
  type WarenkorbEntwurf
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

/** Rückgabe des nachAbschluss-Callbacks: Pfad der geschriebenen Abschluss-PDF (null bei Fehler). */
export interface AbschlussNachlauf {
  pdfPfad: string | null
}

/**
 * Antwort von POST /api/verkauf: VerkaufAntwort aus @core/types plus Helfer-Felder (Auftrag 17.9.2026).
 * `helferName` = Name am Beleg (null bei gewöhnlichen Verkäufen), `offenRappen` = bei zahlart helfer das
 * geschuldete Total («später zahlen»), sonst null.
 */
export interface VerkaufAntwortServer extends VerkaufAntwort {
  helferName: string | null
  offenRappen: number | null
}

/** Antwort von GET /api/helfer: alle gespeicherten Namen und die Salden über alle Kassentage (auch Saldo 0). */
export interface HelferAntwort {
  helfer: Helfer[]
  salden: HelferSaldo[]
}

/** Antwort von POST /api/helfer/zahlung. */
export interface HelferZahlungAntwort {
  zahlung: HelferZahlung
  /** Saldo des Helfers nach dieser Zahlung (über alle Kassentage; negativ bei Überzahlung) */
  saldoNachher: HelferSaldo
  /** Schubladen-Auftrag bei bar_chf/bar_eur, sonst null */
  druckauftragId: string | null
  bereitsVorhanden: boolean
}

/** Antwort von GET /api/drucker: installierte Warteschlangen, eingestellter Name und Vorschlag. */
export interface DruckerListeAntwort {
  drucker: DruckerInfo[]
  eingestellt: string
  /** Name des einzigen Epson-Kandidaten, wenn `eingestellt` nicht installiert ist; sonst null */
  vorschlag: string | null
}

export type AbschlussNachlaufErgebnis = void | AbschlussNachlauf | Promise<void | AbschlussNachlauf>

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
  druckStatus?: () => Pick<DruckStatus, 'ampel' | 'letzterFehler' | 'transport'> &
    Partial<Pick<DruckStatus, 'vorschlag' | 'meldung'>>
  /** Wird nach jedem neuen Druckauftrag aufgerufen (z. B. worker.verarbeiteOffene()) */
  nachDruckauftrag?: () => void
  /** Installierte Windows-Warteschlangen (listeDrucker aus @print); fehlt er, liefert GET /api/drucker eine leere Liste */
  listeDrucker?: () => Promise<DruckerInfo[]>
  /**
   * Wird aufgerufen, sobald drucker_name geaendert wurde (PUT /api/einstellungen, POST /api/drucker/uebernehmen),
   * damit der laufende Druck-Worker den neuen Namen sofort benutzt (worker.setzeDruckerName). Nicht abgewartet.
   */
  setzeDruckerName?: (name: string) => void | Promise<void>
  /**
   * Nach dem Kassenabschluss (PDF, Backup). Die Abschluss-Route wartet NICHT darauf; liefert der
   * Callback (auch asynchron) `{ pdfPfad }`, wird der Pfad am Kassentag gespeichert (`pdf_pfad`).
   * Fehler werden protokolliert, nicht weitergegeben.
   */
  nachAbschluss?: (bericht: AbschlussBericht) => AbschlussNachlaufErgebnis
  /** Öffnet den Archivordner (Electron: shell.openPath); fehlt er, antwortet POST /api/archiv/oeffnen 501 */
  oeffneArchiv?: () => void | Promise<void>
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

type FehlerStatus = 400 | 403 | 404 | 409 | 500 | 501

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

/** Liest den PDF-Pfad aus dem Callback-Ergebnis (void, Objekt oder Fremdes) heraus. */
function pdfPfadAus(r: unknown): string | null {
  if (typeof r !== 'object' || r === null || !('pdfPfad' in r)) return null
  const pfad = r.pdfPfad
  return typeof pfad === 'string' && pfad !== '' ? pfad : null
}

const ZAHLARTEN = ['bar_chf', 'bar_eur', 'twint', 'helfer'] as const
const NACHDRUCK_ARTEN = ['alles', 'coupons', 'bon'] as const
const STORNO_GRUENDE = ['tippfehler', 'ausverkauft', 'abgesprungen'] as const
const SPENDE_TYPEN = ['bar_chf', 'bar_eur', 'twint'] as const

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

  /**
   * Startet den nachAbschluss-Callback (PDF, Backup), ohne die Antwort der Abschluss-Route zu verzögern.
   * Der Callback beginnt sofort (synchroner Teil), sein Ergebnis wird per .then verarbeitet: liefert er
   * einen PDF-Pfad, wird der am Kassentag gespeichert; der Renderer holt ihn über GET /api/kassentag/:id.
   */
  function nachAbschlussStarten(kassentagId: string, b: AbschlussBericht): void {
    if (deps.nachAbschluss === undefined) return
    let ergebnis: AbschlussNachlaufErgebnis
    try {
      ergebnis = deps.nachAbschluss(b)
    } catch (e) {
      log(`nachAbschluss-Callback fehlgeschlagen: ${fehlerText(e)}`)
      return
    }
    void Promise.resolve(ergebnis)
      .then((r) => {
        const pfad = pdfPfadAus(r)
        if (pfad === null) return
        if (repos.kassentag.setzePdfPfad(kassentagId, pfad) === null) {
          log(`Abschluss-PDF-Pfad konnte nicht gespeichert werden: Kassentag ${kassentagId} fehlt`)
        }
      })
      .catch((e: unknown) => {
        log(`nachAbschluss-Callback fehlgeschlagen: ${fehlerText(e)}`)
      })
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
      druckerName: repos.einstellung.einstellungen().druckerName,
      vorschlag: worker.vorschlag ?? null,
      meldung: worker.meldung ?? null
    }
  }

  /** Meldet dem Druck-Worker den neuen Warteschlangennamen; Fehler landen nur im Protokoll. */
  function druckerNameGeaendert(name: string): void {
    if (deps.setzeDruckerName === undefined) return
    try {
      void Promise.resolve(deps.setzeDruckerName(name)).catch((e: unknown) => {
        log(`setzeDruckerName-Callback fehlgeschlagen: ${fehlerText(e)}`)
      })
    } catch (e) {
      log(`setzeDruckerName-Callback fehlgeschlagen: ${fehlerText(e)}`)
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
      // Separat erfasste Spenden des Tages (nicht stornierte): erhöhen Spende-Zeilen und Soll-Bestand
      spenden: repos.spende.fuerKassentag(kassentag.id),
      // Helfer-Zahlungen des Tages (nicht stornierte): Bar CHF/EUR erhöhen den Soll-Bestand wie Spenden
      helferZahlungen: repos.helfer.zahlungenFuerKassentag(kassentag.id),
      // Offene Helfer-Schulden über ALLE Kassentage zum Stand des Berichts (beim Nachdruck: Abschlusszeit,
      // damit der Nachdruck dieselben Salden zeigt wie der Abschluss); der Core filtert Saldo > 0
      helferSalden: repos.helfer.salden(erstelltAm),
      nachdrucke: repos.druckauftrag.anzahlNachdrucke(kassentag.id),
      // Name des Anlasses (Einstellung veranstaltung, leer = nichts): Kopfzeile des Abschluss-Bons
      // und Fusszeile der Abschluss-PDF (src/main liest ihn aus dem Bericht).
      veranstaltung: repos.einstellung.einstellungen().veranstaltung,
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
  ): VerkaufAntwortServer {
    return {
      verkauf,
      helferName: verkauf.helferName,
      // «später zahlen»: das Total ist die heute entstandene offene Schuld des Helfers
      offenRappen: verkauf.zahlart === 'helfer' ? verkauf.totalRappen : null,
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
    // Zielposition mit Einfüge-Semantik (1 = ganz oben); wird im Repo auf 1..N begrenzt
    const reihenfolge = ganzzahlFeldOptional(o, 'reihenfolge', { min: 1 })
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

  // Löschen nur ohne Verkäufe: sobald eine Position auf das Produkt verweist, bleibt es
  // als Stammdatum erhalten und kann nur deaktiviert werden (Fachregel 15).
  app.delete('/api/produkte/:id', mitPin, (c) => {
    const ergebnis = repos.produkt.loesche(c.req.param('id'))
    if (ergebnis === 'nicht_gefunden')
      return fehler(c, 404, 'produkt_nicht_gefunden', 'Produkt nicht gefunden.')
    if (ergebnis === 'hat_verkaeufe') {
      return fehler(
        c,
        409,
        'produkt_hat_verkaeufe',
        'Produkt wurde bereits verkauft und kann nur deaktiviert werden.'
      )
    }
    return c.json({ ok: true })
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
    nachAbschlussStarten(kassentag.id, b)
    return c.json({ ...b, druckauftragId: ergebnis.auftrag.id })
  })

  // Einzelner Kassentag (der Renderer fragt nach dem Abschluss den PDF-Pfad ab). Nach den
  // /aktuell-Routen registriert, damit "aktuell" nie als :id gelesen wird.
  app.get('/api/kassentag/:id', (c) => {
    const kassentag = repos.kassentag.finde(c.req.param('id'))
    if (kassentag === null)
      return fehler(c, 404, 'kassentag_nicht_gefunden', 'Kassentag nicht gefunden.')
    return c.json(kassentag)
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
    const b = bericht(
      kassentag,
      kassentag.istChfRappen,
      kassentag.istEurCent,
      kassentag.abgeschlossenAm
    )
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
    // Beleg-Rabatt: 0 (Standardfall, auch wenn das Feld fehlt) oder genau der eingestellte Satz.
    const rabattProzent =
      ganzzahlFeldOptional(o, 'rabattProzent', { min: 0, max: RABATT_PROZENT_MAX }) ?? 0
    // Helfername: Pflicht bei «später zahlen» (zahlart helfer), sonst optional («gleich zahlen» mit echter
    // Zahlart trägt den Namen am Beleg); leer = gewöhnlicher Verkauf.
    const helferNameRoh = (textOderNullFeld(o, 'helferName') ?? '').trim()
    if (helferNameRoh.length > HELFER_NAME_MAX) {
      throw new EingabeFehler(`Helfername darf höchstens ${String(HELFER_NAME_MAX)} Zeichen haben`)
    }
    if (zahlart === 'helfer' && helferNameRoh === '') {
      throw new EingabeFehler(
        'Bei der Zahlart Helfer muss ein Helfername erfasst werden.',
        'helfer_name_fehlt'
      )
    }
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

    // Erlaubt ist nur kein Rabatt oder genau der in den Einstellungen hinterlegte Satz
    // (der Kassier drückt einen Knopf, er tippt keinen freien Prozentsatz ein).
    const einstellungen = repos.einstellung.einstellungen()
    if (rabattProzent !== 0 && rabattProzent !== einstellungen.rabattProzent) {
      throw new EingabeFehler(
        `Rabatt ${String(rabattProzent)}% ist nicht erlaubt; eingestellt sind ${String(einstellungen.rabattProzent)}%.`
      )
    }

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
    // Zwischensumme (volle Preise) minus Beleg-Rabatt = kassierter Betrag; die Positionen behalten immer den
    // vollen Preis. Der Rabatt gilt seit dem 17.9.2026 auch bei zahlart helfer: Helfer zahlen echte Beträge,
    // das rabattierte Total ist bei «später zahlen» die offene Schuld (kein Geld in der Lade, Fachregel 8 neu).
    const zwischensummeRappen = totalRappen
    const rabatt = rabattBetrag(zwischensummeRappen, rabattProzent)
    const verkaufTotal = rabatt.total
    const rabattRappen = rabatt.rabatt
    const gespeicherterRabattProzent = rabattRappen === 0 ? 0 : rabattProzent

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

    const erstellt = inTransaktion(deps.db, () => {
      // Helfername als Stammdatum sichern (gespeicherte Schreibweise gilt für Beleg, Salden und Auswahl)
      const helferName = helferNameRoh === '' ? null : repos.helfer.stelleSicher(helferNameRoh).name
      return repos.verkauf.erstelle(
        {
          id,
          kassentagId: kassentag.id,
          zahlart,
          totalRappen: verkaufTotal,
          rabattProzent: gespeicherterRabattProzent,
          rabattRappen,
          helferName,
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
          // Bon 1 und Coupons; die Schublade öffnet nur bei bar_chf/bar_eur (bonModellVerkauf), bei helfer nie
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
    })
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
    // Jede Zeile zusätzlich mit der verknüpften nicht stornierten Spende (Rückgeld als Spende) oder null
    return c.json(
      repos.verkauf.letzte(limit).map((d) => ({
        ...d,
        spende: repos.spende.fuerVerkauf(d.verkauf.id)
      }))
    )
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

  // ---------------------------------------------------------------- Spende (separat, ohne Bon)

  /**
   * Separate Spende: "Rückgeld als Spende" zu einem bereits abgeschlossenen Bar-Beleg (verkaufId,
   * betrag = dessen Rückgeld in CHF) oder freie Spende ohne Kauf. Druckt keinen Bon, die Schublade
   * bleibt zu. Idempotent über id (Fachregel 17, wie beim Verkauf).
   */
  app.post('/api/spende', async (c) => {
    const o = await leseBody(c)
    const id = textFeld(o, 'id', { max: 64 })
    const typ = auswahlFeld(o, 'typ', SPENDE_TYPEN)
    if (!istSpendeTyp(typ)) throw new EingabeFehler('Unbekannter Spendentyp')
    const betrag = ganzzahlFeld(o, 'betrag', { min: 1 })
    const verkaufId = textOderNullFeld(o, 'verkaufId')
    if (verkaufId !== null && verkaufId.trim() === '')
      throw new EingabeFehler('Feld "verkaufId" ist leer')
    const anfrage: SpendeAnfrage = { id, typ, betrag, verkaufId }

    const vorhanden = repos.spende.finde(id)
    if (vorhanden !== null) return c.json({ spende: vorhanden, bereitsVorhanden: true })

    const buchung = buchungsKassentag(c)
    if ('antwort' in buchung) return buchung.antwort
    const { kassentag } = buchung

    if (verkaufId !== null) {
      const detail = repos.verkauf.detail(verkaufId)
      if (detail === null) return fehler(c, 404, 'verkauf_nicht_gefunden', 'Beleg nicht gefunden.')
      const { verkauf, zahlung } = detail
      if (verkauf.storniertAm !== null || detail.storno !== null) {
        return fehler(
          c,
          409,
          'verkauf_storniert',
          `Beleg ${verkauf.belegnr} ist storniert, das Rückgeld kann nicht gespendet werden.`
        )
      }
      if (repos.spende.fuerVerkauf(verkauf.id) !== null) {
        return fehler(
          c,
          409,
          'bereits_gespendet',
          `Das Rückgeld von Beleg ${verkauf.belegnr} wurde bereits gespendet.`
        )
      }
      // Rückgeld gibt es nur bei Bar-Belegen, und es ist immer CHF (auch bei EUR-Zahlung)
      if (zahlung.rueckgeldChfRappen <= 0) {
        return fehler(
          c,
          409,
          'kein_rueckgeld',
          `Beleg ${verkauf.belegnr} hat kein Rückgeld, das gespendet werden könnte.`
        )
      }
      if (typ !== 'bar_chf' || betrag !== zahlung.rueckgeldChfRappen) {
        return fehler(
          c,
          409,
          'betrag_ungleich_rueckgeld',
          `Rückgeld-Spende zu Beleg ${verkauf.belegnr} muss Bar CHF ${formatChf(zahlung.rueckgeldChfRappen)} sein.`
        )
      }
    }

    const erstellt = repos.spende.erstelle(
      anfrage,
      kassentag.id,
      repos.einstellung.einstellungen().eurKursX10000
    )
    return c.json(erstellt, erstellt.bereitsVorhanden ? 200 : 201)
  })

  // Die neuesten Spenden (inkl. stornierte) mit Belegnummer des verknüpften Verkaufs, neueste zuerst
  app.get('/api/spende/letzte', (c) => {
    const roh = Number(c.req.query('limit') ?? '20')
    const limit = Number.isSafeInteger(roh) && roh > 0 ? Math.min(roh, 200) : 20
    return c.json(repos.spende.letzte(limit))
  })

  /**
   * Storno einer Spende (Tippfehler): die zuletzt erfasste ohne PIN, ältere nur mit PIN. Nichts wird
   * gelöscht (storniert_am). Nur solange der Kassentag der Spende offen ist, sonst wäre der Abschluss falsch.
   */
  app.post('/api/spende/:id/storno', (c) => {
    const spende = repos.spende.finde(c.req.param('id'))
    if (spende === null) return fehler(c, 404, 'spende_nicht_gefunden', 'Spende nicht gefunden.')
    if (spende.storniertAm !== null) {
      return fehler(c, 409, 'bereits_storniert', 'Diese Spende ist bereits storniert.')
    }
    const kassentag = repos.kassentag.finde(spende.kassentagId)
    if (kassentag === null || kassentag.abgeschlossenAm !== null) {
      return fehler(
        c,
        409,
        'kassentag_abgeschlossen',
        'Der Kassentag dieser Spende ist abgeschlossen, die Spende kann nicht mehr storniert werden.'
      )
    }
    let mitPinGebucht = false
    if (!repos.spende.istLetzte(spende.id)) {
      if (!repos.einstellung.pruefePin(c.req.header('X-Pin'))) {
        return fehler(c, 403, 'pin_falsch', 'Storno älterer Spenden nur mit PIN.')
      }
      mitPinGebucht = true
    }
    const ergebnis = repos.spende.storno(spende.id, mitPinGebucht)
    if (ergebnis.ergebnis === 'nicht_gefunden')
      return fehler(c, 404, 'spende_nicht_gefunden', 'Spende nicht gefunden.')
    if (ergebnis.ergebnis === 'bereits_storniert')
      return fehler(c, 409, 'bereits_storniert', 'Diese Spende ist bereits storniert.')
    const storniert: Spende = ergebnis.spende
    return c.json({ ...storniert, mitPin: mitPinGebucht })
  })

  // ---------------------------------------------------------------- Helfer (Essen holen, sofort oder später zahlen)

  // Gespeicherte Namen zur Auswahl im Bezahldialog und die Salden über alle Kassentage (auch Saldo 0)
  app.get('/api/helfer', (c) => {
    const antwort: HelferAntwort = { helfer: repos.helfer.alle(), salden: repos.helfer.salden() }
    return c.json(antwort)
  })

  // Namen anlegen (201) oder den bestehenden liefern (200, Vergleich ohne Gross-/Kleinschreibung)
  app.post('/api/helfer', async (c) => {
    const o = await leseBody(c)
    const name = textFeld(o, 'name', { max: HELFER_NAME_MAX }).trim()
    const vorhanden = repos.helfer.finde(name)
    if (vorhanden !== null) return c.json(vorhanden)
    return c.json(repos.helfer.stelleSicher(name), 201)
  })

  /**
   * Zahlung eines Helfers auf seine offene Schuld: Betrag frei (Teilzahlung erlaubt, Vorschlag im Renderer =
   * offener Saldo). bar_chf/bar_eur: Geld in die Lade, Schublade öffnet (Druckauftrag typ schublade), kein Bon;
   * twint: nichts in der Lade. Idempotent über id (Fachregel 17).
   */
  app.post('/api/helfer/zahlung', async (c) => {
    const o = await leseBody(c)
    const id = textFeld(o, 'id', { max: 64 })
    const helferNameRoh = textFeld(o, 'helferName', { max: HELFER_NAME_MAX }).trim()
    const typ = auswahlFeld(o, 'typ', SPENDE_TYPEN)
    if (!istSpendeTyp(typ)) throw new EingabeFehler('Unbekannter Zahlungstyp')
    const betrag = ganzzahlFeld(o, 'betrag', { min: 1 })

    const vorhanden = repos.helfer.zahlungFinde(id)
    if (vorhanden !== null) {
      const antwort: HelferZahlungAntwort = {
        zahlung: vorhanden,
        saldoNachher: repos.helfer.saldo(vorhanden.helferName),
        druckauftragId: null,
        bereitsVorhanden: true
      }
      return c.json(antwort)
    }

    const buchung = buchungsKassentag(c)
    if ('antwort' in buchung) return buchung.antwort
    const { kassentag } = buchung

    const helfer = repos.helfer.finde(helferNameRoh)
    if (helfer === null) {
      throw new EingabeFehler(`Helfer "${helferNameRoh}" ist nicht bekannt.`, 'helfer_unbekannt')
    }
    const anfrage: HelferZahlungAnfrage = { id, helferName: helfer.name, typ, betrag }
    const { erstellt, auftrag } = inTransaktion(deps.db, () => {
      const e = repos.helfer.zahlungErstelle(
        anfrage,
        kassentag.id,
        repos.einstellung.einstellungen().eurKursX10000
      )
      // Bargeld kommt in die Lade: Schublade öffnen, kein Bon (Twint: nichts zu öffnen)
      const a =
        typ === 'bar_chf' || typ === 'bar_eur'
          ? druck.reiheEin({
              typ: 'schublade',
              modell: { schublade: true, dokumente: [] },
              verkaufId: null,
              kassentagId: kassentag.id
            })
          : null
      return { erstellt: e, auftrag: a }
    })
    if (auftrag !== null) druckAnstossen()
    const antwort: HelferZahlungAntwort = {
      zahlung: erstellt.zahlung,
      saldoNachher: repos.helfer.saldo(helfer.name),
      druckauftragId: auftrag?.id ?? null,
      bereitsVorhanden: false
    }
    return c.json(antwort, 201)
  })

  // Die neuesten Helfer-Zahlungen (inkl. stornierte), neueste zuerst
  app.get('/api/helfer/zahlungen/letzte', (c) => {
    const roh = Number(c.req.query('limit') ?? '20')
    const limit = Number.isSafeInteger(roh) && roh > 0 ? Math.min(roh, 200) : 20
    return c.json(repos.helfer.zahlungenLetzte(limit))
  })

  /**
   * Storno einer Helfer-Zahlung (Tippfehler): die zuletzt erfasste ohne PIN, ältere nur mit PIN. Nichts wird
   * gelöscht (storniert_am); die Schuld lebt wieder auf. Nur solange der Kassentag der Zahlung offen ist,
   * sonst wäre dessen Abschluss falsch (wie bei Spenden).
   */
  app.post('/api/helfer/zahlung/:id/storno', (c) => {
    const zahlung = repos.helfer.zahlungFinde(c.req.param('id'))
    if (zahlung === null)
      return fehler(c, 404, 'zahlung_nicht_gefunden', 'Helfer-Zahlung nicht gefunden.')
    if (zahlung.storniertAm !== null) {
      return fehler(c, 409, 'bereits_storniert', 'Diese Helfer-Zahlung ist bereits storniert.')
    }
    const kassentag = repos.kassentag.finde(zahlung.kassentagId)
    if (kassentag === null || kassentag.abgeschlossenAm !== null) {
      return fehler(
        c,
        409,
        'kassentag_abgeschlossen',
        'Der Kassentag dieser Zahlung ist abgeschlossen, die Zahlung kann nicht mehr storniert werden.'
      )
    }
    let mitPinGebucht = false
    if (!repos.helfer.istLetzteZahlung(zahlung.id)) {
      if (!repos.einstellung.pruefePin(c.req.header('X-Pin'))) {
        return fehler(c, 403, 'pin_falsch', 'Storno älterer Helfer-Zahlungen nur mit PIN.')
      }
      mitPinGebucht = true
    }
    const ergebnis = repos.helfer.zahlungStorno(zahlung.id, mitPinGebucht)
    if (ergebnis.ergebnis === 'nicht_gefunden')
      return fehler(c, 404, 'zahlung_nicht_gefunden', 'Helfer-Zahlung nicht gefunden.')
    if (ergebnis.ergebnis === 'bereits_storniert')
      return fehler(c, 409, 'bereits_storniert', 'Diese Helfer-Zahlung ist bereits storniert.')
    return c.json({
      ...ergebnis.zahlung,
      mitPin: mitPinGebucht,
      saldoNachher: repos.helfer.saldo(ergebnis.zahlung.helferName)
    })
  })

  // ---------------------------------------------------------------- Archiv

  // Archivordner (Abschluss-PDFs) im Explorer öffnen; nur in der Kassen-App (Electron) möglich.
  app.post('/api/archiv/oeffnen', async (c) => {
    if (deps.oeffneArchiv === undefined) {
      return fehler(c, 501, 'nicht_verfuegbar', 'Nur in der Kassen-App möglich.')
    }
    try {
      await deps.oeffneArchiv()
    } catch (e) {
      return fehler(
        c,
        500,
        'archiv_oeffnen_fehlgeschlagen',
        `Archivordner konnte nicht geöffnet werden: ${fehlerText(e)}`
      )
    }
    return c.json({ ok: true })
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
    const rabattProzent = ganzzahlFeldOptional(o, 'rabattProzent', {
      min: RABATT_PROZENT_MIN,
      max: RABATT_PROZENT_MAX
    })
    if (rabattProzent !== undefined) aenderung.rabattProzent = rabattProzent
    const veranstaltung = textFeldOptional(o, 'veranstaltung', { max: VERANSTALTUNG_MAX_LAENGE })
    if (veranstaltung !== undefined) aenderung.veranstaltung = veranstaltung.trim()
    const neuePin = textFeldOptional(o, 'neuePin')
    if (neuePin !== undefined && !istGueltigePin(neuePin))
      throw new EingabeFehler('Neue PIN: 4 bis 8 Ziffern')

    const vorher = repos.einstellung.einstellungen().druckerName
    const einstellungen = inTransaktion(deps.db, () => {
      const e = repos.einstellung.aktualisiere(aenderung)
      if (neuePin !== undefined) repos.einstellung.setzePin(neuePin)
      return e
    })
    if (aenderung.druckerName !== undefined && aenderung.druckerName !== vorher) {
      druckerNameGeaendert(aenderung.druckerName)
    }
    return c.json(einstellungen)
  })

  // ---------------------------------------------------------------- Drucker (installierte Warteschlangen)

  app.get('/api/drucker', async (c) => {
    let drucker: DruckerInfo[] = []
    if (deps.listeDrucker !== undefined) {
      try {
        drucker = await deps.listeDrucker()
      } catch (e) {
        log(`Installierte Drucker konnten nicht gelesen werden: ${fehlerText(e)}`)
      }
    }
    const eingestellt = repos.einstellung.einstellungen().druckerName
    const antwort: DruckerListeAntwort = {
      drucker,
      eingestellt,
      vorschlag: schlageDruckerVor(drucker, eingestellt)?.name ?? null
    }
    return c.json(antwort)
  })

  app.post('/api/drucker/uebernehmen', mitPin, async (c) => {
    const o = await leseBody(c)
    const name = textFeld(o, 'name', { max: 120 }).trim()
    const vorher = repos.einstellung.einstellungen().druckerName
    const einstellungen = repos.einstellung.aktualisiere({ druckerName: name })
    if (name !== vorher) druckerNameGeaendert(name)
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
    // Der Rabatt-Knopf gilt für den ganzen Beleg und gehört damit zum Entwurf: ohne ihn stünde er
    // nach einem Neustart wieder auf «kein Rabatt», obwohl der Warenkorb wiederhergestellt wird.
    const w: WarenkorbEntwurf = { zeilen: o.zeilen, rabattAktiv: boolFeld(o, 'rabattAktiv', false) }
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
