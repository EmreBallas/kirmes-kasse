import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DruckerInfo } from '@core/types'
import {
  WinspoolTransport,
  baueBefehlArgumente,
  baueListeBefehl,
  baueSkriptArgumente,
  baueVerwerfenBefehl,
  baueVorhandenBefehl,
  druckerVorhanden,
  istBondruckerKandidat,
  listeDrucker,
  parseAnzahl,
  parseDruckerListe,
  parseSkriptAusgabe,
  parseSkriptJson,
  parseVorhanden,
  psString,
  schlageDruckerVor,
  sollAutomatischUebernehmen,
  verwerfeSpoolerAuftraege,
  type ProzessErgebnis
} from './winspool'

const ok = (stdout: string, exitCode: number | null = 0, stderr = ''): ProzessErgebnis => ({
  stdout,
  stderr,
  exitCode,
  prozessFehler: null
})

describe('baueSkriptArgumente', () => {
  it('entspricht dem Aufruf aus dem KONTRAKT', () => {
    expect(
      baueSkriptArgumente(
        'C:\\Kasse\\tools\\print-raw.ps1',
        'TM-T20II',
        'C:\\Temp\\job-1.bin',
        'Kasse beleg'
      )
    ).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'C:\\Kasse\\tools\\print-raw.ps1',
      '-Printer',
      'TM-T20II',
      '-File',
      'C:\\Temp\\job-1.bin',
      '-DocName',
      'Kasse beleg'
    ])
  })
})

describe('parseSkriptJson', () => {
  it('liest das JSON des Skripts', () => {
    expect(
      parseSkriptJson('{"jobId":123,"bytes":220,"status":"accepted","fehler":null}\r\n')
    ).toEqual({
      jobId: 123,
      bytes: 220,
      status: 'accepted',
      fehler: null
    })
  })

  it('nimmt die letzte JSON-Zeile und ignoriert Muell davor', () => {
    const stdout =
      'WARNUNG: irgendwas\n{"jobId":1,"bytes":5,"status":"x","fehler":""}\n{"jobId":7,"bytes":9,"status":"removed","fehler":"hing"}\n'
    expect(parseSkriptJson(stdout)).toEqual({
      jobId: 7,
      bytes: 9,
      status: 'removed',
      fehler: 'hing'
    })
  })

  it('leeres fehler wird null', () => {
    expect(parseSkriptJson('{"jobId":0,"bytes":0,"status":"error","fehler":""}')?.fehler).toBeNull()
  })

  it('null bei fehlendem oder kaputtem JSON', () => {
    expect(parseSkriptJson('')).toBeNull()
    expect(parseSkriptJson('{"jobId":')).toBeNull()
    expect(parseSkriptJson('[1,2]')).toBeNull()
  })

  it('kommt mit BOM zurecht', () => {
    expect(
      parseSkriptJson('\uFEFF{"jobId":3,"bytes":1,"status":"accepted","fehler":null}')?.jobId
    ).toBe(3)
  })
})

describe('parseSkriptAusgabe', () => {
  it('Exit 0 -> accepted mit jobId', () => {
    expect(
      parseSkriptAusgabe('{"jobId":42,"bytes":220,"status":"accepted","fehler":null}', 0)
    ).toEqual({
      ok: true,
      status: 'accepted',
      jobId: 42,
      fehler: null
    })
  })

  it('Exit 2 -> removed mit Grund aus JSON', () => {
    const e = parseSkriptAusgabe(
      '{"jobId":42,"bytes":220,"status":"removed","fehler":"Auftrag nach 10 s noch im Spooler, entfernt"}',
      2,
      'Auftrag nach 10 s noch im Spooler, entfernt\n'
    )
    expect(e).toEqual({
      ok: false,
      status: 'removed',
      jobId: 42,
      fehler: 'Auftrag nach 10 s noch im Spooler, entfernt'
    })
  })

  it('Exit 2 ohne JSON -> Grund aus stderr', () => {
    expect(parseSkriptAusgabe('', 2, "Auftrag im Zustand 'Error', entfernt").fehler).toBe(
      "Auftrag im Zustand 'Error', entfernt"
    )
  })

  it('Exit 1 -> error mit Exception-Text', () => {
    const e = parseSkriptAusgabe(
      '{"jobId":0,"bytes":0,"status":"error","fehler":"OpenPrinter fehlgeschlagen, Win32-Fehler 1801"}',
      1,
      'OpenPrinter fehlgeschlagen, Win32-Fehler 1801\n'
    )
    expect(e).toEqual({
      ok: false,
      status: 'error',
      jobId: null,
      fehler: 'OpenPrinter fehlgeschlagen, Win32-Fehler 1801'
    })
  })

  it('Exit 1 ohne JSON -> stderr, ohne stderr -> generische Meldung', () => {
    expect(parseSkriptAusgabe('', 1, 'Datei nicht gefunden').fehler).toBe('Datei nicht gefunden')
    expect(parseSkriptAusgabe('', 1).fehler).toBe('Druckskript mit Exit-Code 1 beendet')
    expect(parseSkriptAusgabe('', 3).status).toBe('error')
  })

  it('Exit null (Timeout) -> error mit Prozessfehler', () => {
    const e = parseSkriptAusgabe('', null, '', 'PowerShell nach 20 s abgebrochen (Timeout)')
    expect(e.ok).toBe(false)
    expect(e.status).toBe('error')
    expect(e.fehler).toBe('PowerShell nach 20 s abgebrochen (Timeout)')
    expect(parseSkriptAusgabe('', null).fehler).toBe('Druckskript ohne Exit-Code beendet')
  })

  it('jobId 0 wird null', () => {
    expect(
      parseSkriptAusgabe('{"jobId":0,"bytes":0,"status":"accepted","fehler":null}', 0).jobId
    ).toBeNull()
  })
})

describe('PowerShell-Befehle fuer Spooler', () => {
  it('quotiert Druckernamen sicher', () => {
    expect(psString('TM-T20II')).toBe("'TM-T20II'")
    expect(psString("Bob's Printer")).toBe("'Bob''s Printer'")
  })

  it('baut den Verwerfen-Befehl mit Get-PrintJob | Remove-PrintJob', () => {
    const b = baueVerwerfenBefehl('TM-T20II')
    expect(b).toContain("Get-PrintJob -PrinterName 'TM-T20II' -ErrorAction SilentlyContinue")
    expect(b).toContain('Remove-PrintJob')
    expect(baueBefehlArgumente(b).slice(0, 5)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command'
    ])
  })

  it('baut den Vorhanden-Befehl mit Get-Printer -Name', () => {
    expect(baueVorhandenBefehl('TM-T20II')).toContain("Get-Printer -Name 'TM-T20II'")
  })

  it('parst Anzahl und Vorhanden-Ausgabe', () => {
    expect(parseAnzahl('3\r\n')).toBe(3)
    expect(parseAnzahl('')).toBe(0)
    expect(parseAnzahl('Warnung\n0\n')).toBe(0)
    expect(parseVorhanden('ja\r\n')).toBe(true)
    expect(parseVorhanden('nein\r\n')).toBe(false)
    expect(parseVorhanden('')).toBe(false)
  })

  it('verwerfeSpoolerAuftraege liefert die Anzahl (Fake-Ausfuehrer)', async () => {
    const aufrufe: string[][] = []
    const n = await verwerfeSpoolerAuftraege('TM-T20II', async (a) => {
      aufrufe.push(a)
      return ok('2\r\n')
    })
    expect(n).toBe(2)
    expect(aufrufe[0][5]).toContain("Get-PrintJob -PrinterName 'TM-T20II'")
  })

  it('verwerfeSpoolerAuftraege wirft bei Prozessfehler', async () => {
    await expect(
      verwerfeSpoolerAuftraege('X', async () => ({
        stdout: '',
        stderr: '',
        exitCode: null,
        prozessFehler: 'ENOENT'
      }))
    ).rejects.toThrow('ENOENT')
  })

  it('druckerVorhanden', async () => {
    expect(await druckerVorhanden('TM-T20II', async () => ok('ja\n'))).toBe(true)
    expect(await druckerVorhanden('Nix', async () => ok('nein\n'))).toBe(false)
    expect(
      await druckerVorhanden('Nix', async () => ({
        stdout: '',
        stderr: '',
        exitCode: null,
        prozessFehler: 'kaputt'
      }))
    ).toBe(false)
  })
})

// ---------------------------------------------------------------- Installierte Drucker

const EPSON: DruckerInfo = {
  name: 'EPSON TM-T20 Receipt',
  port: 'ESDPRT001',
  treiber: 'EPSON TM-T20 Receipt',
  status: 'Normal'
}
const PDF: DruckerInfo = {
  name: 'Microsoft Print to PDF',
  port: 'PORTPROMPT:',
  treiber: 'Microsoft Print To PDF',
  status: 'Normal'
}
const GENERIC_USB: DruckerInfo = {
  name: 'TM-T20II',
  port: 'USB001',
  treiber: 'Generic / Text Only',
  status: 'Normal'
}

describe('Installierte Drucker (Get-Printer)', () => {
  it('baueListeBefehl: Get-Printer mit Name, Port, Treiber, Status als JSON', () => {
    const b = baueListeBefehl()
    expect(b).toContain('Get-Printer')
    expect(b).toContain('Select-Object Name,PortName,DriverName')
    expect(b).toContain('PrinterStatus')
    expect(b).toContain('ConvertTo-Json -Compress')
  })

  it('parseDruckerListe: Array', () => {
    const stdout =
      '[{"Name":"EPSON TM-T20 Receipt","PortName":"ESDPRT001","DriverName":"EPSON TM-T20 Receipt","PrinterStatus":"Normal"},' +
      '{"Name":"Microsoft Print to PDF","PortName":"PORTPROMPT:","DriverName":"Microsoft Print To PDF","PrinterStatus":"Normal"}]\r\n'
    expect(parseDruckerListe(stdout)).toEqual([EPSON, PDF])
  })

  it('parseDruckerListe: Einzelobjekt (genau ein Drucker installiert)', () => {
    const stdout =
      '{"Name":"EPSON TM-T20 Receipt","PortName":"ESDPRT001","DriverName":"EPSON TM-T20 Receipt","PrinterStatus":"Normal"}'
    expect(parseDruckerListe(stdout)).toEqual([EPSON])
  })

  it('parseDruckerListe: BOM, Muell davor, Zahl-Status, fehlende Felder, Eintraege ohne Namen', () => {
    const stdout =
      '\uFEFFWARNUNG: irgendwas\n[{"Name":"A","PortName":null,"DriverName":"X","PrinterStatus":0},{"Name":"","PortName":"USB001"},{"Name":"B"}]'
    expect(parseDruckerListe(stdout)).toEqual([
      { name: 'A', port: '', treiber: 'X', status: '0' },
      { name: 'B', port: '', treiber: '', status: '' }
    ])
  })

  it('parseDruckerListe: leer, null oder kaputt -> leere Liste', () => {
    expect(parseDruckerListe('')).toEqual([])
    expect(parseDruckerListe('null')).toEqual([])
    expect(parseDruckerListe('{"Name":')).toEqual([])
    expect(parseDruckerListe('nur Text')).toEqual([])
    expect(parseDruckerListe('"ein String"')).toEqual([])
  })

  it('listeDrucker: Fake-Ausfuehrer bekommt den Befehl, Ergebnis wird geparst', async () => {
    const aufrufe: string[][] = []
    const liste = await listeDrucker(async (a) => {
      aufrufe.push(a)
      return ok(
        '{"Name":"EPSON TM-T20 Receipt","PortName":"ESDPRT001","DriverName":"EPSON TM-T20 Receipt","PrinterStatus":"Normal"}\n'
      )
    })
    expect(liste).toEqual([EPSON])
    expect(aufrufe[0].slice(0, 5)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command'
    ])
    expect(aufrufe[0][5]).toContain('Get-Printer')
  })

  it('listeDrucker: Prozessfehler oder Ausnahme -> leere Liste, nichts fliegt', async () => {
    expect(
      await listeDrucker(async () => ({
        stdout: '',
        stderr: '',
        exitCode: null,
        prozessFehler: 'ENOENT'
      }))
    ).toEqual([])
    expect(
      await listeDrucker(async () => {
        throw new Error('kaputt')
      })
    ).toEqual([])
    expect(await listeDrucker(async () => ok('', 1, 'Fehler'))).toEqual([])
  })

  it('istBondruckerKandidat: Name, Treiber oder Port', () => {
    expect(istBondruckerKandidat(EPSON)).toBe(true)
    expect(istBondruckerKandidat(PDF)).toBe(false)
    expect(istBondruckerKandidat(GENERIC_USB)).toBe(true) // Name TM-T20II und Port USB001
    expect(
      istBondruckerKandidat({
        name: 'Bon',
        port: 'usb002',
        treiber: 'Generic / Text Only',
        status: ''
      })
    ).toBe(true)
    expect(
      istBondruckerKandidat({ name: 'Bon', port: 'LPT1:', treiber: 'EPSON TM-m30', status: '' })
    ).toBe(true)
    expect(
      istBondruckerKandidat({ name: 'Kueche', port: 'LPT1:', treiber: 'Epson tm-u220', status: '' })
    ).toBe(true)
    expect(
      istBondruckerKandidat({
        name: 'Buero',
        port: 'WSD-1234',
        treiber: 'HP Universal',
        status: ''
      })
    ).toBe(false)
  })

  it('schlageDruckerVor: Beispiel aus dem Problem -> EPSON TM-T20 Receipt', () => {
    expect(schlageDruckerVor([EPSON, PDF], 'TM-T20II')).toEqual(EPSON)
    expect(schlageDruckerVor([PDF, EPSON], 'TM-T20II')?.name).toBe('EPSON TM-T20 Receipt')
  })

  it('schlageDruckerVor: gewuenschter Name vorhanden -> null (alles gut), auch bei anderer Schreibweise', () => {
    expect(schlageDruckerVor([GENERIC_USB, PDF], 'TM-T20II')).toBeNull()
    expect(schlageDruckerVor([GENERIC_USB, PDF], 'tm-t20ii')).toBeNull()
    expect(schlageDruckerVor([GENERIC_USB, PDF], ' TM-T20II ')).toBeNull()
  })

  it('schlageDruckerVor: kein oder mehrere Kandidaten -> null', () => {
    expect(schlageDruckerVor([], 'TM-T20II')).toBeNull()
    expect(schlageDruckerVor([PDF], 'TM-T20II')).toBeNull()
    expect(schlageDruckerVor([EPSON, GENERIC_USB, PDF], 'Bondrucker')).toBeNull()
  })

  it('sollAutomatischUebernehmen: nur bei Standardname und Vorschlag', () => {
    expect(sollAutomatischUebernehmen('TM-T20II', 'TM-T20II', 'EPSON TM-T20 Receipt')).toBe(true)
    expect(sollAutomatischUebernehmen('tm-t20ii', 'TM-T20II', 'EPSON TM-T20 Receipt')).toBe(true)
    expect(sollAutomatischUebernehmen('Bondrucker', 'TM-T20II', 'EPSON TM-T20 Receipt')).toBe(false)
    expect(sollAutomatischUebernehmen('TM-T20II', 'TM-T20II', null)).toBe(false)
    expect(sollAutomatischUebernehmen('TM-T20II', 'TM-T20II', '')).toBe(false)
    expect(sollAutomatischUebernehmen('TM-T20II', 'TM-T20II', 'TM-T20II')).toBe(false)
    expect(sollAutomatischUebernehmen('', '', 'EPSON TM-T20 Receipt')).toBe(false)
  })
})

describe('WinspoolTransport.senden (ohne echten Druck)', () => {
  let ordner: string
  beforeEach(async () => {
    ordner = await mkdtemp(join(tmpdir(), 'kasse-winspool-test-'))
  })
  afterEach(async () => {
    await rm(ordner, { recursive: true, force: true })
  })

  it('schreibt die Job-Datei, uebergibt die Argumente und loescht die Datei danach', async () => {
    let argumente: string[] = []
    let dateiInhalt: Buffer | null = null
    const transport = new WinspoolTransport({
      druckerName: 'TM-T20II',
      skriptPfad: 'C:\\Kasse\\tools\\print-raw.ps1',
      tempOrdner: ordner,
      ausfuehren: async (a) => {
        argumente = a
        dateiInhalt = await readFile(a[9])
        return ok('{"jobId":77,"bytes":3,"status":"accepted","fehler":null}\r\n')
      }
    })
    const ergebnis = await transport.senden(Uint8Array.from([1, 2, 3]), 'Kasse beleg')
    expect(ergebnis).toEqual({ ok: true, status: 'accepted', jobId: 77, fehler: null })
    expect(argumente.slice(0, 8)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'C:\\Kasse\\tools\\print-raw.ps1',
      '-Printer',
      'TM-T20II'
    ])
    expect(argumente[8]).toBe('-File')
    expect(argumente[9]).toMatch(/[\\/]job-[0-9a-f-]{36}\.bin$/)
    expect(argumente[9].startsWith(ordner)).toBe(true)
    expect(argumente.slice(10)).toEqual(['-DocName', 'Kasse beleg'])
    expect(dateiInhalt !== null && Buffer.from(dateiInhalt).equals(Buffer.from([1, 2, 3]))).toBe(
      true
    )
    expect(await readdir(ordner)).toEqual([])
  })

  it('Exit 2 -> removed, Datei ebenfalls geloescht', async () => {
    const transport = new WinspoolTransport({
      druckerName: 'TM-T20II',
      skriptPfad: 'x.ps1',
      tempOrdner: ordner,
      ausfuehren: async () =>
        ok('{"jobId":5,"bytes":3,"status":"removed","fehler":"hing"}', 2, 'hing')
    })
    const e = await transport.senden(Uint8Array.from([1]), 'test')
    expect(e).toEqual({ ok: false, status: 'removed', jobId: 5, fehler: 'hing' })
    expect(await readdir(ordner)).toEqual([])
  })

  it('Timeout (abgebrochen) -> error und Spooler-Auftraege werden sofort verworfen (Regel 18)', async () => {
    const aufrufe: string[][] = []
    const transport = new WinspoolTransport({
      druckerName: 'TM-T20II',
      skriptPfad: 'x.ps1',
      tempOrdner: ordner,
      ausfuehren: async (a) => {
        aufrufe.push(a)
        if (a.includes('-File')) {
          return {
            stdout: '',
            stderr: '',
            exitCode: null,
            prozessFehler: 'PowerShell nach 20 s abgebrochen (Timeout)',
            abgebrochen: true
          }
        }
        return ok('2\r\n')
      }
    })
    const e = await transport.senden(Uint8Array.from([1]), 'test')
    expect(e.ok).toBe(false)
    expect(e.status).toBe('error')
    expect(e.fehler).toContain('Timeout')
    expect(e.fehler).toContain('2 Spooler-Auftraege verworfen')
    expect(aufrufe).toHaveLength(2)
    expect(aufrufe[1]?.join(' ')).toContain('Remove-PrintJob')
    expect(aufrufe[1]?.join(' ')).toContain("'TM-T20II'")
    expect(await readdir(ordner)).toEqual([])
  })

  it('Timeout: scheitert das Verwerfen, steht der Hinweis im Fehlertext', async () => {
    const transport = new WinspoolTransport({
      druckerName: 'TM-T20II',
      skriptPfad: 'x.ps1',
      tempOrdner: ordner,
      ausfuehren: async (a) => ({
        stdout: '',
        stderr: '',
        exitCode: null,
        prozessFehler: a.includes('-File') ? 'Timeout' : 'PowerShell haengt',
        abgebrochen: true
      })
    })
    const e = await transport.senden(Uint8Array.from([1]), 'test')
    expect(e.status).toBe('error')
    expect(e.fehler).toContain('von Hand leeren')
  })

  it('Prozess nicht gestartet (ENOENT) -> error ohne Verwerfen', async () => {
    const aufrufe: string[][] = []
    const transport = new WinspoolTransport({
      druckerName: 'TM-T20II',
      skriptPfad: 'x.ps1',
      tempOrdner: ordner,
      ausfuehren: async (a) => {
        aufrufe.push(a)
        return {
          stdout: '',
          stderr: '',
          exitCode: null,
          prozessFehler: 'ENOENT',
          abgebrochen: false
        }
      }
    })
    const e = await transport.senden(Uint8Array.from([1]), 'test')
    expect(e.status).toBe('error')
    expect(e.fehler).toBe('ENOENT')
    expect(aufrufe).toHaveLength(1)
  })

  it('Ausfuehrer wirft -> error, Datei geloescht, nichts fliegt nach aussen', async () => {
    const transport = new WinspoolTransport({
      druckerName: 'TM-T20II',
      skriptPfad: 'x.ps1',
      tempOrdner: ordner,
      ausfuehren: async () => {
        throw new Error('Boom')
      }
    })
    const e = await transport.senden(Uint8Array.from([1]), 'test')
    expect(e.ok).toBe(false)
    expect(e.status).toBe('error')
    expect(e.fehler).toContain('Boom')
    expect(await readdir(ordner)).toEqual([])
  })

  it('setzeDruckerName: folgende Auftraege gehen an die neue Warteschlange', async () => {
    const aufrufe: string[][] = []
    const t = new WinspoolTransport({
      druckerName: 'TM-T20II',
      skriptPfad: 'C:\\tools\\print-raw.ps1',
      tempOrdner: ordner,
      ausfuehren: async (a) => {
        aufrufe.push(a)
        return ok('{"jobId":1,"bytes":3,"status":"accepted"}', 0)
      }
    })
    expect(t.druckerName).toBe('TM-T20II')
    await t.senden(Uint8Array.from([1, 2, 3]), 'a')
    t.setzeDruckerName('EPSON TM-T20 Receipt')
    expect(t.druckerName).toBe('EPSON TM-T20 Receipt')
    await t.senden(Uint8Array.from([1, 2, 3]), 'b')
    const drucker = (a: string[]): string => a[a.indexOf('-Printer') + 1]
    expect(drucker(aufrufe[0])).toBe('TM-T20II')
    expect(drucker(aufrufe[1])).toBe('EPSON TM-T20 Receipt')
  })

  it('Standard-Temp-Ordner liegt unter %TEMP%\\kasse', () => {
    const transport = new WinspoolTransport({ druckerName: 'X', skriptPfad: 'x.ps1' })
    expect(transport.tempOrdner).toBe(join(tmpdir(), 'kasse'))
    expect(transport.name).toBe('winspool')
  })
})
