/**
 * HTTP-Client des Renderers. Spricht ausschliesslich JSON gegen den lokalen Hono-Server.
 * Fehlerantworten des Servers (FehlerAntwort) werden als ApiFehler geworfen,
 * Verbindungsprobleme und Zeitueberschreitungen als NetzFehler (fuer "Nochmals senden" mit derselben
 * Verkaufs-UUID, Fachregel 17). Keine Anfrage bleibt unbegrenzt offen: jeder Aufruf hat ein Zeitlimit,
 * damit der Bezahldialog und die Status-Ampel nie einfrieren.
 */
import type {
  AbschlussBericht,
  Druckauftrag,
  Einstellungen,
  FehlerAntwort,
  Kassentag,
  KassentagAbschlussAnfrage,
  KassentagStartAnfrage,
  NachdruckAnfrage,
  Position,
  Produkt,
  Spende,
  SpendeAnfrage,
  StatusAntwort,
  Storno,
  StornoAnfrage,
  StornoGrund,
  Verkauf,
  VerkaufAnfrage,
  VerkaufAntwort,
  Zahlung
} from '@core/types'
import type { WarenkorbEntwurf } from './rabatt'

/** Port des Vite-Dev-Servers (npm run dev); nur dort liegt der Kassen-Server auf einer anderen Adresse. */
export const VITE_DEV_PORT = '5173'
/** Standardadresse des Kassen-Servers, wenn der Renderer nicht von ihm ausgeliefert wird. */
export const STANDARD_SERVER = 'http://127.0.0.1:47100'

/**
 * Basis der API. Im Kiosk und im Plan B (Browser) wird der Renderer vom Kassen-Server selbst
 * ausgeliefert, auf dem Port aus den Einstellungen bzw. KASSE_PORT. Dann werden die Aufrufe relativ
 * gestellt und folgen automatisch dem ausliefernden Port. Nur im Vite-Dev-Server (Port 5173) oder
 * ohne http-Adresse wird der Standard-Server absolut angesprochen.
 */
export function bestimmeApiBase(ort: { protocol: string; port: string } | undefined): string {
  if (ort === undefined) return STANDARD_SERVER
  if (!ort.protocol.startsWith('http')) return STANDARD_SERVER
  return ort.port === VITE_DEV_PORT ? STANDARD_SERVER : ''
}

export const API_BASE: string = bestimmeApiBase(typeof location === 'undefined' ? undefined : location)

export const PIN_HEADER = 'X-Pin'

/** Zeitlimits je Aufrufart in Millisekunden. */
export interface Zeitlimits {
  /** Verkauf, Storno, Nachdruck, Listen, Einstellungen */
  standard: number
  /** Status-Polling (alle 2 s) */
  status: number
  /** Abschluss (PDF + Backup) und Testdaten loeschen (Backup) */
  lang: number
}

export const ZEITLIMITS: Zeitlimits = { standard: 10_000, status: 4_000, lang: 60_000 }

/** Fehlerantwort des Servers (HTTP-Status ausserhalb 2xx). */
export class ApiFehler extends Error {
  readonly status: number
  readonly fehler: string
  readonly meldung: string

  constructor(status: number, fehler: string, meldung: string) {
    super(meldung)
    this.name = 'ApiFehler'
    this.status = status
    this.fehler = fehler
    this.meldung = meldung
  }
}

/** Keine Antwort vom Server (Netz, Server nicht gestartet, Zeitueberschreitung). */
export class NetzFehler extends Error {
  /** true, wenn das Zeitlimit die Anfrage abgebrochen hat */
  readonly zeitueberschreitung: boolean

  constructor(meldung = 'Keine Verbindung zum Kassen-Server', zeitueberschreitung = false) {
    super(meldung)
    this.name = 'NetzFehler'
    this.zeitueberschreitung = zeitueberschreitung
  }
}

/** Liefert eine deutsche Meldung fuer beliebige Fehlerobjekte (fuer den Bildschirm). */
export function fehlerMeldung(e: unknown): string {
  if (e instanceof ApiFehler) return e.meldung
  if (e instanceof NetzFehler) return e.message
  if (e instanceof Error) return e.message
  return 'Unbekannter Fehler'
}

export type Methode = 'GET' | 'POST' | 'PUT' | 'DELETE'

export interface KassentagAktuellAntwort {
  kassentag: Kassentag | null
  vortagOffen: Kassentag | null
  vorschlagStartgeldChfRappen: number
  /** zuletzt abgeschlossener Kassentag (Nachdruck des Abschluss-Bons); fehlt bei alten Servern */
  letzterAbgeschlossener?: Kassentag | null
}

export interface LetzterVerkauf {
  verkauf: Verkauf
  zahlung: Zahlung
  positionen: Position[]
  storno: Storno | null
  /** separat erfasste "Rueckgeld als Spende" zu diesem Beleg; fehlt bei alten Servern */
  spende?: Spende | null
}

/** Antwort von POST /api/spende: die gespeicherte Spende; bereitsVorhanden = gleiche UUID schon gespeichert. */
export interface SpendeAntwort {
  spende: Spende
  bereitsVorhanden: boolean
}

/** Zeile von GET /api/spende/letzte: Spende mit Belegnummer des verknuepften Verkaufs (null bei freier Spende). */
export type LetzteSpende = Spende & { belegnr: string | null }

export interface EinstellungenAenderung extends Partial<Einstellungen> {
  neuePin?: string
}

export type FetchFunktion = (eingabe: string, init: RequestInit) => Promise<Response>

function istFehlerAntwort(daten: unknown): daten is FehlerAntwort {
  return (
    typeof daten === 'object' &&
    daten !== null &&
    typeof (daten as { fehler?: unknown }).fehler === 'string' &&
    typeof (daten as { meldung?: unknown }).meldung === 'string'
  )
}

/**
 * Baut den API-Client. `fetchFn`, `base` und `zeitlimits` sind nur fuer Tests austauschbar.
 */
export function erstelleApi(
  fetchFn: FetchFunktion,
  base: string = API_BASE,
  zeitlimits: Zeitlimits = ZEITLIMITS
): KasseApi {
  async function anfrage<T>(
    methode: Methode,
    pfad: string,
    body?: unknown,
    pin?: string,
    zeitlimitMs: number = zeitlimits.standard
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (pin !== undefined) headers[PIN_HEADER] = pin

    // Zeitlimit: blockiert der Main-Prozess (USB-Backup, PDF) oder haengt der Server, wird die Anfrage
    // abgebrochen und als NetzFehler gemeldet. "Nochmals senden" ist dank Verkaufs-UUID gefahrlos.
    const abbruch = new AbortController()
    const timer = setTimeout(() => abbruch.abort(), zeitlimitMs)
    let antwort: Response
    let text: string
    try {
      antwort = await fetchFn(base + pfad, {
        method: methode,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: abbruch.signal
      })
      text = await antwort.text()
    } catch {
      if (abbruch.signal.aborted) {
        throw new NetzFehler(
          `Der Kassen-Server hat innert ${String(Math.round(zeitlimitMs / 1000))} s nicht geantwortet`,
          true
        )
      }
      throw new NetzFehler()
    } finally {
      clearTimeout(timer)
    }

    let daten: unknown = null
    if (text !== '') {
      try {
        daten = JSON.parse(text)
      } catch {
        daten = null
      }
    }

    if (!antwort.ok) {
      if (istFehlerAntwort(daten)) {
        throw new ApiFehler(antwort.status, daten.fehler, daten.meldung)
      }
      throw new ApiFehler(antwort.status, `http_${String(antwort.status)}`, `Server-Fehler ${String(antwort.status)}`)
    }
    return daten as T
  }

  return {
    status: () => anfrage<StatusAntwort>('GET', '/api/status', undefined, undefined, zeitlimits.status),

    produkte: (alle = false) => anfrage<Produkt[]>('GET', alle ? '/api/produkte?alle=1' : '/api/produkte'),
    produktAnlegen: (daten, pin) => anfrage<Produkt>('POST', '/api/produkte', daten, pin),
    produktAendern: (id, daten, pin) =>
      anfrage<Produkt>('PUT', `/api/produkte/${encodeURIComponent(id)}`, daten, pin),
    produktLoeschen: (id, pin) =>
      anfrage<{ ok: boolean }>('DELETE', `/api/produkte/${encodeURIComponent(id)}`, undefined, pin),
    ausverkauftSetzen: (id, ausverkauft) =>
      anfrage<Produkt>('POST', `/api/produkte/${encodeURIComponent(id)}/ausverkauft`, { ausverkauft }),

    kassentagAktuell: () => anfrage<KassentagAktuellAntwort>('GET', '/api/kassentag/aktuell'),
    kassentag: (id) =>
      anfrage<Kassentag>('GET', `/api/kassentag/${encodeURIComponent(id)}`, undefined, undefined, zeitlimits.status),
    kassentagStart: (daten) => anfrage<Kassentag>('POST', '/api/kassentag/start', daten),
    bericht: () => anfrage<AbschlussBericht>('GET', '/api/kassentag/aktuell/bericht'),
    abschluss: (kassentagId, daten) =>
      anfrage<AbschlussBericht>(
        'POST',
        `/api/kassentag/${encodeURIComponent(kassentagId)}/abschluss`,
        daten,
        undefined,
        zeitlimits.lang
      ),
    abschlussNachdruck: (kassentagId) =>
      anfrage<{ druckauftragId: string }>(
        'POST',
        `/api/kassentag/${encodeURIComponent(kassentagId)}/abschluss/nachdruck`,
        {}
      ),

    verkauf: (daten) => anfrage<VerkaufAntwort>('POST', '/api/verkauf', daten),
    letzteVerkaeufe: (limit = 20) =>
      anfrage<LetzterVerkauf[]>('GET', `/api/verkauf/letzte?limit=${String(limit)}`),
    storno: (verkaufId, grund, pin) => {
      const body: StornoAnfrage = { grund }
      return anfrage<Storno>('POST', `/api/verkauf/${encodeURIComponent(verkaufId)}/storno`, body, pin)
    },
    nachdruck: (verkaufId, was) => {
      const body: NachdruckAnfrage = { was }
      return anfrage<{ druckauftragId: string }>(
        'POST',
        `/api/verkauf/${encodeURIComponent(verkaufId)}/nachdruck`,
        body
      )
    },

    spendeErfassen: (daten) => anfrage<SpendeAntwort>('POST', '/api/spende', daten),
    spendenLetzte: (limit = 20) => anfrage<LetzteSpende[]>('GET', `/api/spende/letzte?limit=${String(limit)}`),
    spendeStorno: (id, pin) => anfrage<Spende>('POST', `/api/spende/${encodeURIComponent(id)}/storno`, {}, pin),

    druckauftrag: (id) =>
      anfrage<Druckauftrag>('GET', `/api/druck/${encodeURIComponent(id)}`, undefined, undefined, zeitlimits.status),
    testdruck: () => anfrage<{ druckauftragId: string }>('POST', '/api/druck/test', {}),
    archivOeffnen: () => anfrage<{ ok: boolean }>('POST', '/api/archiv/oeffnen', {}),

    einstellungen: () => anfrage<Einstellungen>('GET', '/api/einstellungen'),
    einstellungenSpeichern: (daten, pin) => anfrage<Einstellungen>('PUT', '/api/einstellungen', daten, pin),
    pinPruefen: (pin) => anfrage<{ ok: boolean }>('POST', '/api/pin/pruefen', { pin }),
    testdatenLoeschen: (pin) =>
      anfrage<{ ok: boolean; backupPfad: string }>('POST', '/api/testdaten-loeschen', {}, pin, zeitlimits.lang),

    warenkorbEntwurf: () => anfrage<WarenkorbEntwurf>('GET', '/api/warenkorb-entwurf'),
    warenkorbEntwurfSpeichern: (w) => anfrage<WarenkorbEntwurf>('PUT', '/api/warenkorb-entwurf', w)
  }
}

export interface KasseApi {
  status(): Promise<StatusAntwort>
  produkte(alle?: boolean): Promise<Produkt[]>
  produktAnlegen(daten: Partial<Produkt>, pin: string): Promise<Produkt>
  produktAendern(id: string, daten: Partial<Produkt>, pin: string): Promise<Produkt>
  /**
   * Loescht ein nie verkauftes Produkt endgueltig (DELETE, PIN). Wurde es schon verkauft, antwortet der
   * Server 409 `produkt_hat_verkaeufe`; dann bleibt nur Deaktivieren.
   */
  produktLoeschen(id: string, pin: string): Promise<{ ok: boolean }>
  ausverkauftSetzen(id: string, ausverkauft: boolean): Promise<Produkt>
  kassentagAktuell(): Promise<KassentagAktuellAntwort>
  /** Einzelner Kassentag (nach dem Abschluss: Abfrage des PDF-Pfads, alle 1 s); 404 kassentag_nicht_gefunden */
  kassentag(id: string): Promise<Kassentag>
  kassentagStart(daten: KassentagStartAnfrage): Promise<Kassentag>
  bericht(): Promise<AbschlussBericht>
  abschluss(kassentagId: string, daten: KassentagAbschlussAnfrage): Promise<AbschlussBericht>
  /** Nachdruck des Abschluss-Bons eines abgeschlossenen Kassentags (Testfall 32) */
  abschlussNachdruck(kassentagId: string): Promise<{ druckauftragId: string }>
  verkauf(daten: VerkaufAnfrage): Promise<VerkaufAntwort>
  letzteVerkaeufe(limit?: number): Promise<LetzterVerkauf[]>
  storno(verkaufId: string, grund: StornoGrund, pin?: string): Promise<Storno>
  nachdruck(verkaufId: string, was: NachdruckAnfrage['was']): Promise<{ druckauftragId: string }>
  /**
   * Separate Spende erfassen (Rueckgeld als Spende zu einem Beleg oder freie Spende, ohne Bon).
   * 409 kein_kassentag / bereits_gespendet / verkauf_storniert, 400 ungueltige_eingabe.
   */
  spendeErfassen(daten: SpendeAnfrage): Promise<SpendeAntwort>
  /** Letzte Spenden, neueste zuerst, inkl. stornierte */
  spendenLetzte(limit?: number): Promise<LetzteSpende[]>
  /** Spende stornieren: ohne PIN nur die zuletzt erfasste, sonst 403 pin_falsch (dann mit PIN wiederholen); 409 wenn schon storniert */
  spendeStorno(id: string, pin?: string): Promise<Spende>
  /** Zustand eines Druckauftrags (Banner verfolgt den eigenen Beleg) */
  druckauftrag(id: string): Promise<Druckauftrag>
  testdruck(): Promise<{ druckauftragId: string }>
  /** Archivordner (Abschluss-PDFs) im Explorer oeffnen; ausserhalb der Kassen-App 501 nicht_verfuegbar */
  archivOeffnen(): Promise<{ ok: boolean }>
  einstellungen(): Promise<Einstellungen>
  einstellungenSpeichern(daten: EinstellungenAenderung, pin: string): Promise<Einstellungen>
  pinPruefen(pin: string): Promise<{ ok: boolean }>
  testdatenLoeschen(pin: string): Promise<{ ok: boolean; backupPfad: string }>
  /** Gesicherter Warenkorb-Entwurf inkl. Rabatt-Zustand (`rabattAktiv` fehlt bei alten Entwürfen) */
  warenkorbEntwurf(): Promise<WarenkorbEntwurf>
  warenkorbEntwurfSpeichern(w: WarenkorbEntwurf): Promise<WarenkorbEntwurf>
}

/** Standard-Client der App (globales fetch, API_BASE, Standard-Zeitlimits). */
export const api: KasseApi = erstelleApi((eingabe, init) => fetch(eingabe, init))
