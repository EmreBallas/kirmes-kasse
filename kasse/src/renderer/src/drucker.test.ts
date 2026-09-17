import { describe, expect, it } from 'vitest'
import type { DruckStatus } from '@core/types'
import {
  ANDERER_NAME,
  TESTDRUCK_MAX_WARTEZEIT_MS,
  ampelMeldung,
  auswahlFuer,
  druckerAnzeige,
  druckerInListe,
  gleicherDruckerName,
  testdruckAnzeige,
  vorschlagHinweis,
  wirksamerDruckerName,
  type DruckerEintrag
} from './drucker'

const epson: DruckerEintrag = {
  name: 'EPSON TM-T20 Receipt',
  port: 'ESDPRT001',
  treiber: 'EPSON TM-T20 Receipt5',
  status: 'Normal'
}
const pdf: DruckerEintrag = {
  name: 'Microsoft Print to PDF',
  port: 'PORTPROMPT:',
  treiber: 'Microsoft Print To PDF',
  status: 'Normal'
}
const liste = [epson, pdf]

const druckOk: DruckStatus = {
  ampel: 'ok',
  letzterFehler: null,
  offeneAuftraege: 0,
  druckerName: 'TM-T20II',
  transport: 'winspool',
  vorschlag: null,
  meldung: null
}

describe('Druckerauswahl', () => {
  it('druckerAnzeige: "Name – Port – Treiber", leere Teile werden weggelassen', () => {
    expect(druckerAnzeige(epson)).toBe('EPSON TM-T20 Receipt – ESDPRT001 – EPSON TM-T20 Receipt5')
    expect(druckerAnzeige({ name: 'TM-T20II', port: '', treiber: 'Generic / Text Only' })).toBe(
      'TM-T20II – Generic / Text Only'
    )
    expect(druckerAnzeige({ name: 'X', port: '  ', treiber: '' })).toBe('X')
  })

  it('gleicherDruckerName ignoriert Gross-/Kleinschreibung und Randleerzeichen (wie Windows)', () => {
    expect(gleicherDruckerName('TM-T20II', 'tm-t20ii')).toBe(true)
    expect(gleicherDruckerName(' TM-T20II ', 'TM-T20II')).toBe(true)
    expect(gleicherDruckerName('TM-T20II', 'EPSON TM-T20 Receipt')).toBe(false)
  })

  it('druckerInListe / auswahlFuer: eingestellter Name in der Liste -> vorausgewaehlt, sonst "Anderer Name"', () => {
    expect(druckerInListe(liste, 'EPSON TM-T20 Receipt')).toBe(true)
    expect(druckerInListe(liste, 'epson tm-t20 receipt')).toBe(true)
    expect(druckerInListe(liste, 'TM-T20II')).toBe(false)
    expect(auswahlFuer(liste, 'epson tm-t20 receipt')).toBe('EPSON TM-T20 Receipt')
    expect(auswahlFuer(liste, 'TM-T20II')).toBe(ANDERER_NAME)
    expect(auswahlFuer([], 'TM-T20II')).toBe(ANDERER_NAME)
  })

  it('wirksamerDruckerName: Auswahl aus der Liste oder getrimmter Freitext', () => {
    expect(wirksamerDruckerName('EPSON TM-T20 Receipt', 'egal')).toBe('EPSON TM-T20 Receipt')
    expect(wirksamerDruckerName(ANDERER_NAME, '  TM-T20II ')).toBe('TM-T20II')
    expect(wirksamerDruckerName(ANDERER_NAME, '   ')).toBe('')
  })

  it('vorschlagHinweis: Text nur bei abweichendem Vorschlag', () => {
    expect(vorschlagHinweis('TM-T20II', 'EPSON TM-T20 Receipt')).toBe(
      'Eingestellt ist "TM-T20II", gefunden wurde "EPSON TM-T20 Receipt".'
    )
    expect(vorschlagHinweis('EPSON TM-T20 Receipt', 'EPSON TM-T20 Receipt')).toBeNull()
    expect(vorschlagHinweis('EPSON TM-T20 Receipt', 'epson tm-t20 receipt')).toBeNull()
    expect(vorschlagHinweis('TM-T20II', null)).toBeNull()
    expect(vorschlagHinweis('TM-T20II', undefined)).toBeNull()
    expect(vorschlagHinweis('TM-T20II', '  ')).toBeNull()
  })

  it('ampelMeldung: gruen -> Drucker und Transport; rot -> Meldung des Servers, sonst Fehler mit Vorschlag', () => {
    expect(ampelMeldung(druckOk)).toBe('TM-T20II (winspool)')
    expect(
      ampelMeldung({
        ...druckOk,
        ampel: 'pruefen',
        letzterFehler: 'Warteschlange "TM-T20II" fehlt',
        meldung: 'Warteschlange fehlt, Vorschlag: EPSON TM-T20 Receipt',
        vorschlag: 'EPSON TM-T20 Receipt'
      })
    ).toBe('Warteschlange fehlt, Vorschlag: EPSON TM-T20 Receipt')
    // aelterer Server ohne meldung: letzter Fehler plus Vorschlag, falls vorhanden
    expect(
      ampelMeldung({
        ...druckOk,
        ampel: 'pruefen',
        letzterFehler: 'Warteschlange "TM-T20II" fehlt',
        vorschlag: 'EPSON TM-T20 Receipt'
      })
    ).toBe('Warteschlange "TM-T20II" fehlt, Vorschlag: EPSON TM-T20 Receipt')
    expect(ampelMeldung({ ...druckOk, ampel: 'pruefen', letzterFehler: 'Papier fehlt' })).toBe(
      'Papier fehlt (TM-T20II)'
    )
    expect(
      ampelMeldung({
        ...druckOk,
        ampel: 'pruefen',
        letzterFehler: null,
        meldung: null,
        vorschlag: null
      })
    ).toBe('Druck fehlgeschlagen (TM-T20II)')
  })

  it('testdruckAnzeige: done gruen, failed rot mit Fehlertext, sonst laeuft / nach Wartezeit rot', () => {
    expect(
      testdruckAnzeige({ status: 'done', fehler: null }, 'EPSON TM-T20 Receipt', 1200)
    ).toEqual({
      text: 'Testdruck an "EPSON TM-T20 Receipt" übergeben.',
      art: 'ok'
    })
    expect(
      testdruckAnzeige(
        { status: 'failed', fehler: 'Warteschlange "TM-T20II" fehlt' },
        'TM-T20II',
        3000
      )
    ).toEqual({
      text: 'Testdruck fehlgeschlagen: Warteschlange "TM-T20II" fehlt',
      art: 'fehler'
    })
    expect(testdruckAnzeige({ status: 'failed', fehler: null }, 'TM-T20II', 3000).text).toBe(
      'Testdruck fehlgeschlagen: unbekannter Fehler'
    )
    expect(testdruckAnzeige({ status: 'queued', fehler: null }, 'TM-T20II', 0)).toEqual({
      text: 'Testdruck läuft … (Drucker "TM-T20II")',
      art: 'laeuft'
    })
    expect(testdruckAnzeige(null, 'TM-T20II', 500).art).toBe('laeuft')
    const zuLange = testdruckAnzeige(
      { status: 'sent', fehler: null },
      'TM-T20II',
      TESTDRUCK_MAX_WARTEZEIT_MS
    )
    expect(zuLange.art).toBe('fehler')
    expect(zuLange.text).toContain('noch nicht abgeschlossen')
  })
})
