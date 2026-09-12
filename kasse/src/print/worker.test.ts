import { describe, expect, it } from 'vitest'
import type { Druckauftrag, DruckauftragStatus } from '@core/types'
import type { DruckErgebnis, DruckTransport } from './transport'
import {
  GRUND_APP_NEUSTART,
  bezeichnungFuer,
  fehlerWarteschlangeFehlt,
  startDruckWorker,
  type DruckQuelle,
  type MarkiereFelder
} from './worker'

interface Markierung {
  id: string
  status: DruckauftragStatus
  felder: MarkiereFelder
}

class FakeQuelle implements DruckQuelle {
  auftraege: Druckauftrag[] = []
  markierungen: Markierung[] = []
  bytesJe = new Map<string, Uint8Array>()
  ladeFehlerFuer = new Set<string>()
  neustartGrund: string | null = null

  einreihen(
    id: string,
    typ: Druckauftrag['typ'] = 'beleg',
    bytesPfad: string | null = `${id}.bin`,
    status: DruckauftragStatus = 'queued'
  ): Druckauftrag {
    const a: Druckauftrag = {
      id,
      verkaufId: null,
      kassentagId: null,
      typ,
      bytesPfad,
      status,
      spoolerJobId: null,
      fehler: null,
      erstelltAm: '2026-09-19T14:32:05',
      erledigtAm: null
    }
    this.auftraege.push(a)
    this.bytesJe.set(id, Uint8Array.from([id.charCodeAt(0)]))
    return a
  }

  naechsterQueued(): Druckauftrag | null {
    return this.auftraege.find((a) => a.status === 'queued') ?? null
  }

  async ladeBytes(auftrag: Druckauftrag): Promise<Uint8Array> {
    if (this.ladeFehlerFuer.has(auftrag.id)) throw new Error(`ENOENT ${auftrag.bytesPfad}`)
    return this.bytesJe.get(auftrag.id) ?? Uint8Array.from([])
  }

  markiere(id: string, status: DruckauftragStatus, felder: MarkiereFelder): void {
    this.markierungen.push({ id, status, felder })
    const a = this.auftraege.find((x) => x.id === id)
    if (a === undefined) throw new Error(`unbekannt ${id}`)
    a.status = status
    if (felder.fehler !== undefined) a.fehler = felder.fehler
    if (felder.spoolerJobId !== undefined) a.spoolerJobId = felder.spoolerJobId
  }

  markiereAlleOffenenAlsFailed(grund: string): number {
    this.neustartGrund = grund
    let n = 0
    for (const a of this.auftraege) {
      if (a.status === 'queued' || a.status === 'sent') {
        a.status = 'failed'
        a.fehler = grund
        n++
      }
    }
    return n
  }
}

interface Sendung {
  bytes: Uint8Array
  bezeichnung: string
}

class FakeTransport implements DruckTransport {
  name: 'winspool' | 'simulator'
  sendungen: Sendung[] = []
  gleichzeitig = 0
  maxGleichzeitig = 0
  antwort: (s: Sendung) => DruckErgebnis = () => ({
    ok: true,
    status: 'accepted',
    jobId: 11,
    fehler: null
  })
  verzoegerungMs = 5

  constructor(name: 'winspool' | 'simulator' = 'simulator') {
    this.name = name
  }

  async senden(bytes: Uint8Array, bezeichnung: string): Promise<DruckErgebnis> {
    this.gleichzeitig++
    this.maxGleichzeitig = Math.max(this.maxGleichzeitig, this.gleichzeitig)
    await new Promise((r) => setTimeout(r, this.verzoegerungMs))
    const s = { bytes, bezeichnung }
    this.sendungen.push(s)
    this.gleichzeitig--
    return this.antwort(s)
  }
}

const warte = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const still = (): void => undefined

describe('startDruckWorker', () => {
  it('Erfolg: queued -> sent -> done mit spoolerJobId, Ampel ok', async () => {
    const quelle = new FakeQuelle()
    const transport = new FakeTransport()
    const worker = startDruckWorker({
      quelle,
      transport,
      bytesOrdner: 'C:\\Kasse\\data\\bytes',
      intervallMs: 10,
      log: still
    })
    await worker.bereit
    quelle.einreihen('a1')
    await worker.verarbeiteOffene()
    worker.stop()

    expect(quelle.markierungen.map((m) => [m.id, m.status])).toEqual([
      ['a1', 'sent'],
      ['a1', 'done']
    ])
    expect(quelle.markierungen[1].felder).toEqual({ fehler: null, spoolerJobId: 11 })
    expect(transport.sendungen).toHaveLength(1)
    expect(transport.sendungen[0].bezeichnung).toBe('Kasse beleg a1')
    expect(Array.from(transport.sendungen[0].bytes)).toEqual(['a'.charCodeAt(0)])
    const s = worker.status()
    expect(s.ampel).toBe('ok')
    expect(s.letzterFehler).toBeNull()
    expect(s.erledigt).toBe(1)
    expect(s.transport).toBe('simulator')
  })

  it('Fehler des Transports: sent -> failed mit Fehlertext, Ampel pruefen; naechster Erfolg setzt ok', async () => {
    const quelle = new FakeQuelle()
    const transport = new FakeTransport()
    transport.antwort = (s) =>
      s.bezeichnung.endsWith('b1')
        ? {
            ok: false,
            status: 'removed',
            jobId: 9,
            fehler: 'Auftrag nach 10 s noch im Spooler, entfernt'
          }
        : { ok: true, status: 'accepted', jobId: 12, fehler: null }
    const worker = startDruckWorker({
      quelle,
      transport,
      bytesOrdner: '.',
      intervallMs: 10,
      log: still
    })
    await worker.bereit
    quelle.einreihen('b1')
    await worker.verarbeiteOffene()

    expect(quelle.auftraege[0].status).toBe('failed')
    expect(quelle.auftraege[0].fehler).toBe('Auftrag nach 10 s noch im Spooler, entfernt')
    expect(quelle.auftraege[0].spoolerJobId).toBe(9)
    expect(worker.status().ampel).toBe('pruefen')
    expect(worker.status().letzterFehler).toContain('Spooler')

    quelle.einreihen('b2')
    await worker.verarbeiteOffene()
    worker.stop()
    expect(quelle.auftraege[1].status).toBe('done')
    expect(worker.status().ampel).toBe('ok')
    expect(worker.status().letzterFehler).toBeNull()
    expect(worker.status().fehlgeschlagen).toBe(1)
    expect(worker.status().erledigt).toBe(1)
  })

  it('Transport wirft -> failed, Worker laeuft weiter', async () => {
    const quelle = new FakeQuelle()
    const transport = new FakeTransport()
    transport.senden = async () => {
      throw new Error('Kabel raus')
    }
    const worker = startDruckWorker({
      quelle,
      transport,
      bytesOrdner: '.',
      intervallMs: 10,
      log: still
    })
    await worker.bereit
    quelle.einreihen('c1')
    await worker.verarbeiteOffene()
    worker.stop()
    expect(quelle.auftraege[0].status).toBe('failed')
    expect(quelle.auftraege[0].fehler).toContain('Kabel raus')
    expect(worker.status().ampel).toBe('pruefen')
  })

  it('Bytes nicht lesbar oder kein bytesPfad -> failed ohne Transportaufruf', async () => {
    const quelle = new FakeQuelle()
    const transport = new FakeTransport()
    const worker = startDruckWorker({
      quelle,
      transport,
      bytesOrdner: '.',
      intervallMs: 10,
      log: still
    })
    await worker.bereit
    quelle.einreihen('d1')
    quelle.ladeFehlerFuer.add('d1')
    quelle.einreihen('d2', 'test', null)
    await worker.verarbeiteOffene()
    worker.stop()
    expect(transport.sendungen).toHaveLength(0)
    expect(quelle.auftraege[0].status).toBe('failed')
    expect(quelle.auftraege[0].fehler).toContain('ENOENT')
    expect(quelle.auftraege[1].status).toBe('failed')
    expect(quelle.auftraege[1].fehler).toContain('keine_bytes')
  })

  it('loest relative bytesPfad gegen bytesOrdner auf', async () => {
    const quelle = new FakeQuelle()
    const pfade: (string | null)[] = []
    quelle.ladeBytes = async (a) => {
      pfade.push(a.bytesPfad)
      return Uint8Array.from([1])
    }
    const worker = startDruckWorker({
      quelle,
      transport: new FakeTransport(),
      bytesOrdner: 'C:\\Kasse\\bytes',
      intervallMs: 10,
      log: still
    })
    await worker.bereit
    quelle.einreihen('e1', 'beleg', 'e1.bin')
    quelle.einreihen('e2', 'beleg', 'C:\\anderswo\\e2.bin')
    await worker.verarbeiteOffene()
    worker.stop()
    expect(pfade[0]?.toLowerCase()).toBe('c:\\kasse\\bytes\\e1.bin')
    expect(pfade[1]).toBe('C:\\anderswo\\e2.bin')
  })

  it('Reihenfolge: sequenziell, nie zwei gleichzeitig, auch bei parallelen Aufrufen', async () => {
    const quelle = new FakeQuelle()
    const transport = new FakeTransport()
    const worker = startDruckWorker({
      quelle,
      transport,
      bytesOrdner: '.',
      intervallMs: 5,
      log: still
    })
    await worker.bereit
    for (const id of ['f1', 'f2', 'f3', 'f4']) quelle.einreihen(id)
    await Promise.all([
      worker.verarbeiteOffene(),
      worker.verarbeiteOffene(),
      warte(2).then(() => worker.verarbeiteOffene())
    ])
    worker.stop()
    expect(transport.maxGleichzeitig).toBe(1)
    expect(transport.sendungen.map((s) => s.bezeichnung)).toEqual([
      'Kasse beleg f1',
      'Kasse beleg f2',
      'Kasse beleg f3',
      'Kasse beleg f4'
    ])
    expect(quelle.auftraege.every((a) => a.status === 'done')).toBe(true)
    // je Auftrag genau sent + done
    expect(quelle.markierungen).toHaveLength(8)
  })

  it('Schleife: nimmt spaeter eingereihte Auftraege ohne expliziten Aufruf', async () => {
    const quelle = new FakeQuelle()
    const transport = new FakeTransport()
    const worker = startDruckWorker({
      quelle,
      transport,
      bytesOrdner: '.',
      intervallMs: 5,
      log: still
    })
    await worker.bereit
    quelle.einreihen('g1')
    for (let i = 0; i < 40 && transport.sendungen.length === 0; i++) await warte(5)
    worker.stop()
    expect(transport.sendungen).toHaveLength(1)
    expect(quelle.auftraege[0].status).toBe('done')
  })

  it('Neustart: setzt queued/sent auf failed (app_neustart) und verwirft Spooler-Auftraege bei winspool', async () => {
    const quelle = new FakeQuelle()
    quelle.einreihen('h1', 'beleg', 'h1.bin', 'sent')
    quelle.einreihen('h2', 'beleg', 'h2.bin', 'queued')
    quelle.einreihen('h3', 'beleg', 'h3.bin', 'done')
    const transport = new FakeTransport('winspool')
    const verworfenFuer: string[] = []
    const worker = startDruckWorker({
      quelle,
      transport,
      bytesOrdner: '.',
      intervallMs: 10,
      druckerName: 'TM-T20II',
      druckerVorhanden: async () => true,
      verwerfeSpoolerAuftraege: async (name) => {
        verworfenFuer.push(name)
        return 3
      },
      log: still
    })
    await worker.bereit
    await worker.verarbeiteOffene()
    worker.stop()

    expect(quelle.neustartGrund).toBe(GRUND_APP_NEUSTART)
    expect(quelle.auftraege.map((a) => a.status)).toEqual(['failed', 'failed', 'done'])
    expect(quelle.auftraege[0].fehler).toBe('app_neustart')
    expect(verworfenFuer).toEqual(['TM-T20II'])
    expect(transport.sendungen).toHaveLength(0) // nichts wird automatisch nachgedruckt
    expect(worker.status().beimStartVerworfen).toEqual({ auftraege: 2, spooler: 3 })
  })

  it('Neustart mit Simulator: Spooler wird nicht angefasst', async () => {
    const quelle = new FakeQuelle()
    let aufgerufen = false
    const worker = startDruckWorker({
      quelle,
      transport: new FakeTransport('simulator'),
      bytesOrdner: '.',
      intervallMs: 10,
      druckerName: 'TM-T20II',
      druckerVorhanden: async () => true,
      verwerfeSpoolerAuftraege: async () => {
        aufgerufen = true
        return 0
      },
      log: still
    })
    await worker.bereit
    worker.stop()
    expect(aufgerufen).toBe(false)
  })

  it('Neustart: Fehler beim Verwerfen blockiert den Start nicht', async () => {
    const quelle = new FakeQuelle()
    const transport = new FakeTransport('winspool')
    const meldungen: string[] = []
    const worker = startDruckWorker({
      quelle,
      transport,
      bytesOrdner: '.',
      intervallMs: 10,
      druckerName: 'TM-T20II',
      druckerVorhanden: async () => true,
      verwerfeSpoolerAuftraege: async () => {
        throw new Error('PowerShell fehlt')
      },
      log: (m) => meldungen.push(m)
    })
    await worker.bereit
    worker.stop()
    expect(meldungen.some((m) => m.includes('PowerShell fehlt'))).toBe(true)
    expect(worker.status().beimStartVerworfen.spooler).toBe(0)
  })

  it('stop() beendet die Schleife', async () => {
    const quelle = new FakeQuelle()
    const transport = new FakeTransport()
    const worker = startDruckWorker({
      quelle,
      transport,
      bytesOrdner: '.',
      intervallMs: 5,
      log: still
    })
    await worker.bereit
    worker.stop()
    quelle.einreihen('j1')
    await warte(30)
    expect(transport.sendungen).toHaveLength(0)
    expect(quelle.auftraege[0].status).toBe('queued')
  })

  it('Start: fehlende Warteschlange -> Ampel pruefen mit Hinweis, Auftraege werden trotzdem versucht', async () => {
    const quelle = new FakeQuelle()
    const transport = new FakeTransport('winspool')
    const worker = startDruckWorker({
      quelle,
      transport,
      bytesOrdner: '.',
      intervallMs: 10,
      druckerName: 'Falscher Name',
      verwerfeSpoolerAuftraege: async () => 0,
      druckerVorhanden: async () => false,
      log: still
    })
    await worker.bereit
    expect(worker.status().ampel).toBe('pruefen')
    expect(worker.status().letzterFehler).toBe(fehlerWarteschlangeFehlt('Falscher Name'))
    expect(worker.status().warteschlangeVorhanden).toBe(false)
    // Ein spaeterer erfolgreicher Auftrag setzt die Ampel wie bisher auf ok
    quelle.einreihen('a1')
    await worker.verarbeiteOffene()
    worker.stop()
    expect(worker.status().ampel).toBe('ok')
  })

  it('Warteschlange wieder vorhanden -> Ampel nach der Leerlauf-Pruefung wieder ok', async () => {
    const quelle = new FakeQuelle()
    const transport = new FakeTransport('winspool')
    let vorhanden = false
    let pruefungen = 0
    const worker = startDruckWorker({
      quelle,
      transport,
      bytesOrdner: '.',
      intervallMs: 5,
      pruefIntervallMs: 20,
      druckerName: 'TM-T20II',
      verwerfeSpoolerAuftraege: async () => 0,
      druckerVorhanden: async () => {
        pruefungen++
        return vorhanden
      },
      log: still
    })
    await worker.bereit
    expect(worker.status().ampel).toBe('pruefen')
    await warte(60)
    expect(pruefungen).toBeGreaterThanOrEqual(2)
    expect(worker.status().ampel).toBe('pruefen')
    vorhanden = true
    await warte(60)
    worker.stop()
    expect(worker.status().ampel).toBe('ok')
    expect(worker.status().letzterFehler).toBeNull()
    expect(worker.status().warteschlangeVorhanden).toBe(true)
  })

  it('Warteschlange da, aber letzter Auftrag failed -> Ampel bleibt pruefen (kein automatisches Gruen)', async () => {
    const quelle = new FakeQuelle()
    const transport = new FakeTransport('winspool')
    transport.antwort = () => ({ ok: false, status: 'error', jobId: null, fehler: 'USB gezogen' })
    const worker = startDruckWorker({
      quelle,
      transport,
      bytesOrdner: '.',
      intervallMs: 5,
      pruefIntervallMs: 10,
      druckerName: 'TM-T20II',
      verwerfeSpoolerAuftraege: async () => 0,
      druckerVorhanden: async () => true,
      log: still
    })
    await worker.bereit
    expect(worker.status().ampel).toBe('ok')
    quelle.einreihen('f1')
    await worker.verarbeiteOffene()
    expect(worker.status().ampel).toBe('pruefen')
    await warte(40)
    worker.stop()
    expect(worker.status().ampel).toBe('pruefen')
    expect(worker.status().letzterFehler).toBe('USB gezogen')
  })

  it('Simulator: keine Warteschlangen-Pruefung', async () => {
    const quelle = new FakeQuelle()
    let geprueft = false
    const worker = startDruckWorker({
      quelle,
      transport: new FakeTransport('simulator'),
      bytesOrdner: '.',
      intervallMs: 5,
      pruefIntervallMs: 5,
      druckerName: 'TM-T20II',
      druckerVorhanden: async () => {
        geprueft = true
        return false
      },
      log: still
    })
    await worker.bereit
    await worker.pruefeWarteschlange()
    await warte(30)
    worker.stop()
    expect(geprueft).toBe(false)
    expect(worker.status().ampel).toBe('ok')
    expect(worker.status().warteschlangeVorhanden).toBeNull()
  })

  it('bezeichnungFuer', () => {
    const quelle = new FakeQuelle()
    const a = quelle.einreihen('0123456789abcdef', 'nachdruck_bon')
    expect(bezeichnungFuer(a)).toBe('Kasse nachdruck_bon 01234567')
  })
})
