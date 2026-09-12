import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bonModellTest } from '@core/bon'
import { erstelleDruckDienst, erstelleDruckQuelle } from './druck'
import { erstelleTestUmgebung, type TestUmgebung } from './testumgebung'

let u: TestUmgebung

afterEach(() => {
  u.aufraeumen()
})

describe('DruckDienst.reiheEin', () => {
  it('schreibt <id>.bin (beginnt mit ESC @) und legt den Auftrag queued an', () => {
    u = erstelleTestUmgebung()
    const a = u.druck.reiheEin({
      typ: 'test',
      modell: bonModellTest(),
      verkaufId: null,
      kassentagId: null
    })
    expect(a.status).toBe('queued')
    expect(a.bytesPfad).toBe(`${a.id}.bin`)
    const datei = join(u.bytesOrdner, `${a.id}.bin`)
    expect(existsSync(datei)).toBe(true)
    const bytes = readFileSync(datei)
    expect([bytes[0], bytes[1]]).toEqual([0x1b, 0x40])
  })

  it('legt den Auftrag als failed an, wenn der Bytes-Ordner nicht beschreibbar ist', () => {
    u = erstelleTestUmgebung()
    // Datei statt Ordner: mkdir/writeFile scheitern
    const kaputt = erstelleDruckDienst(
      u.repos.druckauftrag,
      join(u.bytesOrdner, 'datei-statt-ordner', 'x'),
      () => 'k1'
    )
    writeFileSync(join(u.bytesOrdner, 'datei-statt-ordner'), 'x')
    const a = kaputt.reiheEin({
      typ: 'test',
      modell: bonModellTest(),
      verkaufId: null,
      kassentagId: null
    })
    expect(a.status).toBe('failed')
    expect(a.bytesPfad).toBeNull()
    expect(a.fehler).toMatch(/nicht geschrieben/)
  })
})

describe('erstelleDruckQuelle', () => {
  it('liefert Aufträge in Reihenfolge, lädt Bytes und markiert Status mit erledigt_am', async () => {
    u = erstelleTestUmgebung()
    const quelle = erstelleDruckQuelle(u.db, u.bytesOrdner, u.uhr)
    const a1 = u.druck.reiheEin({
      typ: 'test',
      modell: bonModellTest(),
      verkaufId: null,
      kassentagId: null
    })
    u.uhr.setze('2026-09-19T14:33:00')
    const a2 = u.druck.reiheEin({
      typ: 'test',
      modell: bonModellTest(),
      verkaufId: null,
      kassentagId: null
    })

    expect(quelle.naechsterQueued()?.id).toBe(a1.id)
    const bytes = await quelle.ladeBytes({
      ...a1,
      bytesPfad: join(u.bytesOrdner, a1.bytesPfad ?? '')
    })
    expect(bytes.length).toBeGreaterThan(10)
    const relativ = await quelle.ladeBytes(a1)
    expect(relativ.length).toBe(bytes.length)

    quelle.markiere(a1.id, 'sent', {})
    expect(quelle.naechsterQueued()?.id).toBe(a2.id)
    quelle.markiere(a1.id, 'done', { fehler: null, spoolerJobId: 17 })
    const fertig = u.repos.druckauftrag.finde(a1.id)
    expect(fertig?.status).toBe('done')
    expect(fertig?.spoolerJobId).toBe(17)
    expect(fertig?.erledigtAm).toBe('2026-09-19T14:33:00')

    expect(quelle.markiereAlleOffenenAlsFailed('app_neustart')).toBe(1)
    expect(u.repos.druckauftrag.finde(a2.id)?.fehler).toBe('app_neustart')
    expect(quelle.naechsterQueued()).toBeNull()
    await expect(quelle.ladeBytes({ ...a1, bytesPfad: null })).rejects.toThrow(/bytes_pfad/)
  })
})
