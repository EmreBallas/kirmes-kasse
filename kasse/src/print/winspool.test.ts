import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  WinspoolTransport,
  baueBefehlArgumente,
  baueSkriptArgumente,
  baueVerwerfenBefehl,
  baueVorhandenBefehl,
  druckerVorhanden,
  parseAnzahl,
  parseSkriptAusgabe,
  parseSkriptJson,
  parseVorhanden,
  psString,
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
        return { stdout: '', stderr: '', exitCode: null, prozessFehler: 'ENOENT', abgebrochen: false }
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

  it('Standard-Temp-Ordner liegt unter %TEMP%\\kasse', () => {
    const transport = new WinspoolTransport({ druckerName: 'X', skriptPfad: 'x.ps1' })
    expect(transport.tempOrdner).toBe(join(tmpdir(), 'kasse'))
    expect(transport.name).toBe('winspool')
  })
})
