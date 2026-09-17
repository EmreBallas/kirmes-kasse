/**
 * Druck-Worker: arbeitet Druckauftraege mit Status 'queued' sequenziell ab.
 * Ein Auftrag nach dem anderen, nie zwei gleichzeitig. Kein automatischer Nachdruck (Regel 18).
 *
 * Beim Start: alle offenen Auftraege (queued/sent) auf failed setzen (Grund app_neustart) und,
 * beim winspool-Transport, alte Spooler-Auftraege verwerfen sowie pruefen, ob die Warteschlange
 * existiert (Roadmap Punkt 14: "Druck OK" nur mit vorhandener Warteschlange). Die Pruefung wird im
 * Leerlauf alle pruefIntervallMs wiederholt, damit die Ampel nach einer Korrektur des Druckernamens
 * wieder gruen wird; ein fehlgeschlagener Auftrag bleibt bis zum naechsten Erfolg "pruefen".
 *
 * Fehlt die Warteschlange, listet der Worker die installierten Drucker (Get-Printer) und legt den
 * einzigen Epson-Kandidaten als `vorschlag` in den Status (samt lesbarer `meldung`). Er aendert die
 * Einstellungen NICHT selbst; das tun Main (nur beim unveraenderten Standardnamen) oder die Route
 * POST /api/drucker/uebernehmen, die anschliessend `setzeDruckerName` aufrufen.
 */
import { isAbsolute, resolve } from 'node:path'
import type { Druckauftrag, DruckauftragStatus, DruckerInfo, DruckStatus } from '@core/types'
import type { DruckTransport, TransportName } from './transport'
import {
  druckerVorhanden as druckerVorhandenStandard,
  listeDrucker as listeDruckerStandard,
  schlageDruckerVor,
  verwerfeSpoolerAuftraege as verwerfeSpoolerAuftraegeStandard
} from './winspool'

export const GRUND_APP_NEUSTART = 'app_neustart'
export const PRUEF_INTERVALL_MS = 60_000

/** Fehlertext der Ampel, wenn die Warteschlange fehlt (falscher Name, Drucker nicht eingerichtet). */
export function fehlerWarteschlangeFehlt(druckerName: string): string {
  return `Warteschlange "${druckerName}" fehlt`
}

/**
 * Lesbarer Hinweis fuer den Bildschirm, wenn die Warteschlange fehlt: nennt den Vorschlag oder,
 * ohne eindeutigen Kandidaten, die installierten Warteschlangen.
 */
export function meldungWarteschlangeFehlt(
  druckerName: string,
  vorschlag: string | null,
  liste: DruckerInfo[]
): string {
  const kopf = `${fehlerWarteschlangeFehlt(druckerName)}.`
  if (vorschlag !== null) {
    return `${kopf} Gefunden: "${vorschlag}" – in den Einstellungen auswählen.`
  }
  if (liste.length === 0) {
    return `${kopf} Keine installierten Drucker gefunden – Epson-Treiber installieren und Drucker anschliessen.`
  }
  const namen = liste.map((d) => `"${d.name}"`).join(', ')
  return `${kopf} Installiert: ${namen} – den richtigen in den Einstellungen auswählen.`
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
  /** nur fuer Tests: ersetzt listeDrucker aus winspool.ts (wird nur bei fehlender Warteschlange gerufen) */
  listeDrucker?: () => Promise<DruckerInfo[]>
  /** Abstand der wiederholten Warteschlangen-Pruefung im Leerlauf (winspool), Standard 60 s */
  pruefIntervallMs?: number
  /** Protokollausgabe, Standard console */
  log?: (meldung: string) => void
}

export interface DruckWorkerStatus extends Pick<
  DruckStatus,
  'ampel' | 'letzterFehler' | 'vorschlag' | 'meldung'
> {
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
  /** Warteschlange, mit der der Worker gerade arbeitet (nach setzeDruckerName der neue Name) */
  druckerName: string | null
}

export interface DruckWorker {
  /** erfuellt, sobald die Start-Aufraeumarbeiten erledigt sind und die Schleife laeuft */
  bereit: Promise<void>
  /** arbeitet sofort alle queued-Auftraege ab (wartet, falls gerade einer laeuft) */
  verarbeiteOffene(): Promise<void>
  status(): DruckWorkerStatus
  /** prueft sofort, ob die Warteschlange existiert (winspool; sonst ohne Wirkung) */
  pruefeWarteschlange(): Promise<void>
  /**
   * Wechselt die Warteschlange zur Laufzeit (Einstellung drucker_name geaendert): Transport und
   * Pruefung verwenden sofort den neuen Namen; die Warteschlange wird gleich neu geprueft.
   */
  setzeDruckerName(name: string): Promise<void>
  stop(): void
}

export function bezeichnungFuer(auftrag: Druckauftrag): string {
  return `Kasse ${auftrag.typ} ${auftrag.id.slice(0, 8)}`
}

function fehlerText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function bereinigterName(name: string | undefined): string | null {
  if (name === undefined) return null
  const getrimmt = name.trim()
  return getrimmt === '' ? null : getrimmt
}

export function startDruckWorker(optionen: DruckWorkerOptionen): DruckWorker {
  const { quelle, transport, bytesOrdner } = optionen
  const intervallMs = optionen.intervallMs ?? 500
  const log = optionen.log ?? ((m: string): void => console.log(`[druck] ${m}`))
  const verwerfeSpooler = optionen.verwerfeSpoolerAuftraege ?? verwerfeSpoolerAuftraegeStandard
  const pruefeVorhanden = optionen.druckerVorhanden ?? druckerVorhandenStandard
  const listeInstallierte =
    optionen.listeDrucker ?? ((): Promise<DruckerInfo[]> => listeDruckerStandard())
  const pruefIntervallMs = optionen.pruefIntervallMs ?? PRUEF_INTERVALL_MS
  let druckerName = bereinigterName(optionen.druckerName)
  const mitSpooler = (): boolean => transport.name === 'winspool' && druckerName !== null

  let gestoppt = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let kette: Promise<void> = Promise.resolve()
  let letztePruefung = 0

  const zustand: DruckWorkerStatus = {
    ampel: 'ok',
    letzterFehler: null,
    vorschlag: null,
    meldung: null,
    transport: transport.name,
    inArbeit: false,
    erledigt: 0,
    fehlgeschlagen: 0,
    beimStartVerworfen: { auftraege: 0, spooler: 0 },
    warteschlangeVorhanden: null,
    druckerName
  }

  /** Installierte Drucker holen; ein Fehler ergibt eine leere Liste (der Hinweis bleibt trotzdem). */
  async function installierteDrucker(): Promise<DruckerInfo[]> {
    try {
      return await listeInstallierte()
    } catch (e) {
      log(`Installierte Drucker konnten nicht gelesen werden: ${fehlerText(e)}`)
      return []
    }
  }

  /**
   * Prueft, ob die Warteschlange existiert. Fehlt sie: Ampel "pruefen" mit Hinweis und Vorschlag aus
   * den installierten Druckern. Ist sie wieder da und der letzte Fehler war genau dieser Hinweis,
   * wird die Ampel wieder gruen (kein Auftrag ging verloren).
   */
  async function pruefeWarteschlange(): Promise<void> {
    if (!mitSpooler() || druckerName === null) return
    const name = druckerName
    letztePruefung = Date.now()
    let vorhanden: boolean
    try {
      vorhanden = await pruefeVorhanden(name)
    } catch (e) {
      log(`Warteschlange konnte nicht geprueft werden: ${fehlerText(e)}`)
      return
    }
    if (name !== druckerName) return // Name wurde waehrenddessen gewechselt; naechste Pruefung zaehlt
    const hinweis = fehlerWarteschlangeFehlt(name)
    const vorher = zustand.warteschlangeVorhanden
    zustand.warteschlangeVorhanden = vorhanden
    if (!vorhanden) {
      const liste = await installierteDrucker()
      if (name !== druckerName) return
      const vorschlag = schlageDruckerVor(liste, name)?.name ?? null
      zustand.ampel = 'pruefen'
      zustand.letzterFehler = hinweis
      zustand.vorschlag = vorschlag
      zustand.meldung = meldungWarteschlangeFehlt(name, vorschlag, liste)
      if (vorher !== false) log(zustand.meldung)
      return
    }
    zustand.vorschlag = null
    zustand.meldung = null
    if (zustand.letzterFehler === hinweis) {
      zustand.ampel = 'ok'
      zustand.letzterFehler = null
      log(`Warteschlange "${name}" wieder vorhanden`)
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
          if (!gestoppt && mitSpooler() && Date.now() - letztePruefung >= pruefIntervallMs) {
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

  /** Neuer Warteschlangenname aus den Einstellungen: Transport umstellen, Zustand zuruecksetzen, pruefen. */
  async function setzeDruckerName(name: string): Promise<void> {
    const neu = bereinigterName(name)
    if (neu === null) {
      log('Leerer Druckername wird ignoriert')
      return
    }
    if (neu === druckerName) return
    const alterHinweis = druckerName !== null ? fehlerWarteschlangeFehlt(druckerName) : null
    druckerName = neu
    zustand.druckerName = neu
    transport.setzeDruckerName?.(neu)
    zustand.warteschlangeVorhanden = null
    zustand.vorschlag = null
    zustand.meldung = null
    if (alterHinweis !== null && zustand.letzterFehler === alterHinweis) {
      // Der alte "fehlt"-Hinweis gilt nicht mehr; die Pruefung unten setzt den neuen Zustand.
      zustand.letzterFehler = null
      zustand.ampel = 'ok'
    }
    log(`Warteschlange gewechselt auf "${neu}"`)
    await pruefeWarteschlange()
  }

  const bereit = aufraeumenBeimStart().then(() => planeNaechstenDurchlauf())

  return {
    bereit,
    verarbeiteOffene: () => bereit.then(() => verarbeiteOffene()),
    status: () => ({ ...zustand, beimStartVerworfen: { ...zustand.beimStartVerworfen } }),
    pruefeWarteschlange: () => bereit.then(() => pruefeWarteschlange()),
    setzeDruckerName: (name) => bereit.then(() => setzeDruckerName(name)),
    stop: () => {
      gestoppt = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }
  }
}
