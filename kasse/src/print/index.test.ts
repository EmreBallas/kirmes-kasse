import { describe, expect, it } from 'vitest'
import {
  SimulatorTransport,
  WinspoolTransport,
  erstelleTransport,
  istSimulatorGewuenscht
} from './index'

const basis = {
  druckerName: 'TM-T20II',
  skriptPfad: 'C:\\Kasse\\tools\\print-raw.ps1',
  archivOrdner: 'C:\\Kasse\\data\\archiv'
}

describe('erstelleTransport', () => {
  it('KASSE_PRINT=sim -> Simulator unter <archiv>/simulator', () => {
    const t = erstelleTransport({ ...basis, KASSE_PRINT: 'sim' })
    expect(t.name).toBe('simulator')
    expect(t).toBeInstanceOf(SimulatorTransport)
    expect((t as SimulatorTransport).ordner.toLowerCase()).toBe(
      'c:\\kasse\\data\\archiv\\simulator'
    )
  })

  it('ohne KASSE_PRINT -> winspool mit Druckername und Skript', () => {
    const t = erstelleTransport({ ...basis, tempOrdner: 'C:\\Temp\\kasse' })
    expect(t.name).toBe('winspool')
    expect(t).toBeInstanceOf(WinspoolTransport)
    const w = t as WinspoolTransport
    expect(w.druckerName).toBe('TM-T20II')
    expect(w.skriptPfad).toBe('C:\\Kasse\\tools\\print-raw.ps1')
    expect(w.tempOrdner).toBe('C:\\Temp\\kasse')
  })

  it('Dev-Modus -> Simulator, ausser KASSE_PRINT=winspool', () => {
    expect(istSimulatorGewuenscht({ devModus: true })).toBe(true)
    expect(istSimulatorGewuenscht({ devModus: true, KASSE_PRINT: 'winspool' })).toBe(false)
    expect(istSimulatorGewuenscht({ devModus: false })).toBe(false)
    expect(istSimulatorGewuenscht({ KASSE_PRINT: 'irgendwas' })).toBe(false)
    expect(erstelleTransport({ ...basis, devModus: true }).name).toBe('simulator')
  })
})
