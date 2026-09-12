/**
 * Druck-Worker: arbeitet Druckauftraege mit Status 'queued' sequenziell ab.
 * Ein Auftrag nach dem anderen, nie zwei gleichzeitig. Kein automatischer Nachdruck (Regel 18).
 *
 * Beim Start: alle offenen Auftraege (queued/sent) auf failed setzen (Grund app_neustart) und,
 * beim winspool-Transport, alte Spooler-Auftraege verwerfen sowie pruefen, ob die Warteschlange
 * existiert (Roadmap Punkt 14: "Druck OK" nur mit vorhandener Warteschlange). Die Pruefung wird im
 * Leerlauf alle pruefIntervallMs wiederholt, damit die Ampel nach einer Korrektur des Druckernamens
 * wieder gruen wird; ein fehlgeschlagener Auftrag bleibt bis zum naechsten Erfolg "pruefen".
 */
import { isAbsolute, resolve } from 'node:path'
import type { Druckauftrag, DruckauftragStatus, DruckStatus } from '@core/types'
import type { DruckTransport, TransportName } from './transport'
import {
  druckerVorhanden as druckerVorhandenStandard,
  verwerfeSpoolerAuftraege as verwerfeSpoolerAuftraegeStandard
} from './winspool'

export const GRUND_APP_NEUSTART = 'app_neustart'
export const PRUEF_INTERVALL_MS = 60_000

/** Fehlertext der Ampel, wenn die Warteschlange fehlt (falscher Name, Drucker nicht eingerichtet). */
export function fehlerWarteschlangeFehlt(druckerName: string): string {
  return `Warteschlange "${druckerName}" fehlt`
}

export interface MarkiereFelder {
  fehler?: string | null
  spoolerJobId?: number | null
}

/** Datenquelle des Workers, in src/server ueber das druckauftragRepo umgesetzt. */
export interface DruckQuelle {
  /** aeltester Auftrag mit Status queued, oder null */
  naechsterQueued(): Druckauftrag | null
  /** liest die Bytes aus auftrag.bytesPfad */
  ladeBytes(auftrag: Druckauftrag): Promise<Uint8Array>
  /** setzt Status und Felder; bei done/failed auch erledigt_am */
  markiere(id: string, status: DruckauftragStatus, felder: MarkiereFelder): void
  /** setzt alle queued/sent auf failed mit diesem Grund; liefert die Anzahl */
  markiereAlleOffenenAlsFailed(grund: string): number
}

export interface DruckWorkerOptionen {
  quelle: DruckQuelle
  transport: DruckTransport
  /** Basisordner fuer relative bytesPfad-Angaben */
  bytesOrdner: string
  /** Abstand zwischen zwei Durchlaeufen, wenn nichts ansteht */
  intervallMs?: number
  /** Warteschlangenname; noetig, um beim Start Spooler-Auftraege zu verwerfen (winspool) */
  druckerName?: string
  /** nur fuer Tests: ersetzt verwerfeSpoolerAuftraege aus winspool.ts */
  verwerfeSpoolerAuftraege?: (druckerName: string) => Promise<number>
  /** nur fuer Tests: ersetzt druckerVorhanden aus winspool.ts */
  druckerVorhanden?: (druckerName: string) => Promise<boolean>
  /** Abstand der wiederholten Warteschlangen-Pruefung im Leerlauf (winspool), Standard 60 s */
  pruefIntervallMs?: number
  /** Protokollausgabe, Standard console */
  log?: (meldung: string) => void
}

export interface DruckWorkerStatus extends Pick<DruckStatus, 'ampel' | 'letzterFehler'> {
  transport: TransportName
  /** true, waehrend ein Auftrag beim Transport ist */
  inArbeit: boolean
  /** Auftraege seit dem Start: erfolgreich / fehlgeschlagen */
  erledigt: number
  fehlgeschlagen: number
  /** beim Start auf failed gesetzte Auftraege und verworfene Spooler-Auftraege */
  beimStartVerworfen: { auftraege: number; spooler: number }
  /** Ergebnis der letzten Warteschlangen-Pruefung (winspool); null = noch nicht geprueft / Simulator */
  warteschlangeVorhanden: boolean | null
}

export interface DruckWorker {
  /** erfuellt, sobald die Start-Aufraeumarbeiten erledigt sind und die Schleife laeuft */
  bereit: Promise<void>
  /** arbeitet sofort alle queued-Auftraege ab (wartet, falls gerade einer laeuft) */
  verarbeiteOffene(): Promise<void>
  status(): DruckWorkerStatus
  /** prueft sofort, ob die Warteschlange existiert (winspool; sonst ohne Wirkung) */
  pruefeWarteschlange(): Promise<void>
  stop(): void
}

export function bezeichnungFuer(auftrag: Druckauftrag): string {
  return `Kasse ${auftrag.typ} ${auftrag.id.slice(0, 8)}`
}

function fehlerText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function startDruckWorker(optionen: DruckWorkerOptionen): DruckWorker {
  const { quelle, transport, bytesOrdner } = optionen
  const intervallMs = optionen.intervallMs ?? 500
  const log = optionen.log ?? ((m: string): void => console.log(`[druck] ${m}`))
  const verwerfeSpooler = optionen.verwerfeSpoolerAuftraege ?? verwerfeSpoolerAuftraegeStandard
  const pruefeVorhanden = optionen.druckerVorhanden ?? druckerVorhandenStandard
  const pruefIntervallMs = optionen.pruefIntervallMs ?? PRUEF_INTERVALL_MS
  const druckerName =
    optionen.druckerName !== undefined && optionen.druckerName !== '' ? optionen.druckerName : null
  const mitSpooler = transport.name === 'winspool' && druckerName !== null

  let gestoppt = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let kette: Promise<void> = Promise.resolve()
  let letztePruefung = 0

  const zustand: DruckWorkerStatus = {
    ampel: 'ok',
    letzterFehler: null,
    transport: transport.name,
    inArbeit: false,
    erledigt: 0,
    fehlgeschlagen: 0,
    beimStartVerworfen: { auftraege: 0, spooler: 0 },
    warteschlangeVorhanden: null
  }

  /**
   * Prueft, ob die Warteschlange existiert. Fehlt sie: Ampel "pruefen" mit Hinweis. Ist sie wieder da
   * und der letzte Fehler war genau dieser Hinweis, wird die Ampel wieder gruen (kein Auftrag ging verloren).
   */
  async function pruefeWarteschlange(): Promise<void> {
    if (!mitSpooler || druckerName === null) return
    letztePruefung = Date.now()
    let vorhanden: boolean
    try {
      vorhanden = await pruefeVorhanden(druckerName)
    } catch (e) {
      log(`Warteschlange konnte nicht geprueft werden: ${fehlerText(e)}`)
      return
    }
    const hinweis = fehlerWarteschlangeFehlt(druckerName)
    const vorher = zustand.warteschlangeVorhanden
    zustand.warteschlangeVorhanden = vorhanden
    if (!vorhanden) {
      zustand.ampel = 'pruefen'
      zustand.letzterFehler = hinweis
      if (vorher !== false) log(hinweis)
    } else if (zustand.letzterFehler === hinweis) {
      zustand.ampel = 'ok'
      zustand.letzterFehler = null
      log(`Warteschlange "${druckerName}" wieder vorhanden`)
    }
  }

  function setzeFehlgeschlagen(
    auftrag: Druckauftrag,
    fehler: string,
    spoolerJobId: number | null = null
  ): void {
    quelle.markiere(auftrag.id, 'failed', { fehler, spoolerJobId })
    zustand.ampel = 'pruefen'
    zustand.letzterFehler = fehler
    zustand.fehlgeschlagen += 1
    log(`Auftrag ${auftrag.id} (${auftrag.typ}) fehlgeschlagen: ${fehler}`)
  }

  async function verarbeiteEinen(auftrag: Druckauftrag): Promise<void> {
    quelle.markiere(auftrag.id, 'sent', {})

    if (auftrag.bytesPfad === null || auftrag.bytesPfad === '') {
      setzeFehlgeschlagen(auftrag, 'keine_bytes: Auftrag hat keinen bytes_pfad')
      return
    }
    const pfad = isAbsolute(auftrag.bytesPfad)
      ? auftrag.bytesPfad
      : resolve(bytesOrdner, auftrag.bytesPfad)

    let bytes: Uint8Array
    try {
      bytes = await quelle.ladeBytes({ ...auftrag, bytesPfad: pfad })
    } catch (e) {
      setzeFehlgeschlagen(auftrag, `Bytes konnten nicht gelesen werden: ${fehlerText(e)}`)
      return
    }

    try {
      const ergebnis = await transport.senden(bytes, bezeichnungFuer(auftrag))
      if (ergebnis.ok) {
        quelle.markiere(auftrag.id, 'done', { fehler: null, spoolerJobId: ergebnis.jobId })
        zustand.ampel = 'ok'
        zustand.letzterFehler = null
        zustand.erledigt += 1
      } else {
        setzeFehlgeschlagen(auftrag, ergebnis.fehler ?? `Druck ${ergebnis.status}`, ergebnis.jobId)
      }
    } catch (e) {
      setzeFehlgeschlagen(auftrag, `Transport-Fehler: ${fehlerText(e)}`)
    }
  }

  async function verarbeiteAlle(): Promise<void> {
    zustand.inArbeit = true
    try {
      for (;;) {
        if (gestoppt) return
        const auftrag = quelle.naechsterQueued()
        if (auftrag === null) return
        await verarbeiteEinen(auftrag)
      }
    } finally {
      zustand.inArbeit = false
    }
  }

  /** Serialisiert: jeder Aufruf haengt sich an die Kette, es laeuft immer hoechstens eine Verarbeitung. */
  function verarbeiteOffene(): Promise<void> {
    const naechster = kette.then(() => verarbeiteAlle())
    kette = naechster.catch(() => undefined)
    return naechster
  }

  function planeNaechstenDurchlauf(): void {
    if (gestoppt) return
    timer = setTimeout(() => {
      timer = null
      verarbeiteOffene()
        .then(() => {
          // Im Leerlauf periodisch die Warteschlange pruefen (nur winspool)
          if (!gestoppt && mitSpooler && Date.now() - letztePruefung >= pruefIntervallMs) {
            return pruefeWarteschlange()
          }
          return undefined
        })
        .catch((e: unknown) => log(`Unerwarteter Fehler im Druck-Worker: ${fehlerText(e)}`))
        .finally(() => planeNaechstenDurchlauf())
    }, intervallMs)
  }

  async function aufraeumenBeimStart(): Promise<void> {
    try {
      zustand.beimStartVerworfen.auftraege = quelle.markiereAlleOffenenAlsFailed(GRUND_APP_NEUSTART)
    } catch (e) {
      log(`Offene Auftraege konnten nicht auf failed gesetzt werden: ${fehlerText(e)}`)
    }
    if (transport.name === 'winspool') {
      if (druckerName === null) {
        log('Kein Druckername angegeben, Spooler-Auftraege werden nicht verworfen')
        zustand.ampel = 'pruefen'
        zustand.letzterFehler = 'Kein Druckername in den Einstellungen'
      } else {
        try {
          zustand.beimStartVerworfen.spooler = await verwerfeSpooler(druckerName)
        } catch (e) {
          log(`Spooler-Auftraege konnten nicht verworfen werden: ${fehlerText(e)}`)
        }
        await pruefeWarteschlange()
      }
    }
    if (zustand.beimStartVerworfen.auftraege > 0 || zustand.beimStartVerworfen.spooler > 0) {
      log(
        `Beim Start verworfen: ${zustand.beimStartVerworfen.auftraege} Auftraege, ` +
          `${zustand.beimStartVerworfen.spooler} Spooler-Auftraege`
      )
    }
  }

  const bereit = aufraeumenBeimStart().then(() => planeNaechstenDurchlauf())

  return {
    bereit,
    verarbeiteOffene: () => bereit.then(() => verarbeiteOffene()),
    status: () => ({ ...zustand, beimStartVerworfen: { ...zustand.beimStartVerworfen } }),
    pruefeWarteschlange: () => bereit.then(() => pruefeWarteschlange()),
    stop: () => {
      gestoppt = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }
  }
}
