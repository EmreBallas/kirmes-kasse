import { describe, expect, it } from 'vitest'
import { berechneZahlung } from '@core/zahlung'
import type { Position, Spende, Storno, VerkaufAntwort, Warenkorb } from '@core/types'
import {
  DRUCK_WARTEZEIT_MS,
  bannerAusAntwort,
  bannerDruckProblem,
  bannerNachSpende,
  bannerNachStorno,
  baueVerkaufAnfrage,
  bestaetigungsWarnung,
  druckVerlauf,
  gegebenAusText,
  handschreibListe,
  listeAlsText,
  neueVerkaufsId,
  pruefeVorSenden,
  stornoBannerText
} from './bezahlen'

const warenkorb: Warenkorb = {
  zeilen: [
    { produktId: 'p1', name: 'Winti Burger mit Pommes', preisRappen: 1500, gruppe: 'coupon', anzahl: 2 },
    { produktId: 'p2', name: 'Getränk Dose', preisRappen: 250, gruppe: 'kasse', anzahl: 2 }
  ]
}

describe('gegebenAusText', () => {
  it('Helfer ist immer 0, sonst der geparste Betrag', () => {
    expect(gegebenAusText('helfer', '50')).toBe(0)
    expect(gegebenAusText('bar_chf', '50')).toBe(5000)
    expect(gegebenAusText('bar_eur', '13')).toBe(1300)
    expect(gegebenAusText('twint', '')).toBe(0)
  })
})

describe('pruefeVorSenden', () => {
  it('nicht gedeckt blockiert (Testplan 4)', () => {
    const e = berechneZahlung({ zahlart: 'bar_chf', totalRappen: 7500, gegeben: 6000, kursX10000: 9000, spendeBehalten: false })
    expect(pruefeVorSenden(e, false)).toBe('nicht_gedeckt')
    expect(pruefeVorSenden(e, true)).toBe('nicht_gedeckt')
  })

  it('Rueckgeld ueber 200 verlangt Bestaetigung (Testplan 5)', () => {
    const e = berechneZahlung({ zahlart: 'bar_chf', totalRappen: 1200, gegeben: 100000, kursX10000: 9000, spendeBehalten: false })
    expect(bestaetigungsWarnung(e.warnungen)).toBe('rueckgeld_ueber_200')
    expect(pruefeVorSenden(e, false)).toBe('bestaetigung_noetig')
    expect(pruefeVorSenden(e, true)).toBe('ok')
  })

  it('Twint-Ueberzahlung ueber 200 verlangt Bestaetigung', () => {
    const e = berechneZahlung({ zahlart: 'twint', totalRappen: 1200, gegeben: 30000, kursX10000: 9000, spendeBehalten: false })
    expect(bestaetigungsWarnung(e.warnungen)).toBe('spende_ueber_200')
    expect(pruefeVorSenden(e, false)).toBe('bestaetigung_noetig')
  })

  it('normaler Fall geht direkt zum Senden', () => {
    const e = berechneZahlung({ zahlart: 'bar_chf', totalRappen: 3500, gegeben: 5000, kursX10000: 9000, spendeBehalten: false })
    expect(pruefeVorSenden(e, false)).toBe('ok')
    expect(e.rueckgeldChfRappen).toBe(1500)
  })
})

describe('baueVerkaufAnfrage', () => {
  it('uebernimmt Positionen und Flags', () => {
    const a = baueVerkaufAnfrage('uuid-1', warenkorb, 'bar_chf', 5000, false, true, 0, null)
    expect(a).toEqual({
      id: 'uuid-1',
      positionen: [
        { produktId: 'p1', anzahl: 2 },
        { produktId: 'p2', anzahl: 2 }
      ],
      zahlart: 'bar_chf',
      gegeben: 5000,
      spendeBehalten: false,
      bestaetigtHohesRueckgeld: true,
      rabattProzent: 0,
      helferName: null
    })
  })

  it('sendet den gewaehrten Rabattsatz mit; die Positionen bleiben zu vollen Mengen', () => {
    const a = baueVerkaufAnfrage('uuid-2', warenkorb, 'twint', 1350, false, false, 50, null)
    expect(a.rabattProzent).toBe(50)
    expect(a.positionen).toEqual([
      { produktId: 'p1', anzahl: 2 },
      { produktId: 'p2', anzahl: 2 }
    ])
  })

  it('Helfer «gleich zahlen»: echte Zahlart mit Helfername, der Rabatt bleibt wirksam', () => {
    const a = baueVerkaufAnfrage('uuid-3', warenkorb, 'bar_chf', 2000, false, false, 50, 'Anna')
    expect(a.zahlart).toBe('bar_chf')
    expect(a.helferName).toBe('Anna')
    expect(a.rabattProzent).toBe(50)
  })

  it('Rabatt gilt jetzt auch bei Zahlart Helfer (spaeter zahlen: Total = Schuld)', () => {
    const a = baueVerkaufAnfrage('uuid-4', warenkorb, 'helfer', 0, false, false, 50, 'Anna')
    expect(a.rabattProzent).toBe(50)
    expect(a.helferName).toBe('Anna')
  })
})

describe('handschreibListe / listeAlsText', () => {
  const positionen: Position[] = [
    { id: 'a', verkaufId: 'v', produktId: 'p1', nameSnapshot: 'Winti Burger', preisSnapshotRappen: 1100, anzahl: 2, gruppeSnapshot: 'coupon' },
    { id: 'b', verkaufId: 'v', produktId: 'p2', nameSnapshot: 'Getränk Dose', preisSnapshotRappen: 250, anzahl: 1, gruppeSnapshot: 'kasse' }
  ]

  it('nur Coupons, als Text', () => {
    const liste = handschreibListe(positionen)
    expect(liste).toEqual([{ name: 'Winti Burger', anzahl: 2 }])
    expect(listeAlsText(liste)).toBe('2x Winti Burger')
    expect(listeAlsText([{ name: 'Getränk Dose', anzahl: 2 }, { name: 'Kaffee', anzahl: 1 }])).toBe('2x Getränk Dose, 1x Kaffee')
  })
})

describe('druckVerlauf / bannerDruckProblem', () => {
  it('verfolgt den eigenen Auftrag: laeuft, lange, done, failed', () => {
    expect(druckVerlauf(null, false, 0)).toBe('unbekannt')
    expect(druckVerlauf(null, true, 0)).toBe('laeuft')
    expect(druckVerlauf({ status: 'queued' }, true, DRUCK_WARTEZEIT_MS - 1)).toBe('laeuft')
    expect(druckVerlauf({ status: 'sent' }, true, DRUCK_WARTEZEIT_MS)).toBe('lange')
    expect(druckVerlauf({ status: 'done' }, true, 99_000)).toBe('done')
    expect(druckVerlauf({ status: 'failed' }, true, 0)).toBe('failed')
  })

  it('Handschreib-Liste bei failed oder lange offen; ohne Auftrag entscheidet die Ampel; done nie', () => {
    expect(bannerDruckProblem('failed', 'ok')).toBe(true)
    expect(bannerDruckProblem('lange', 'ok')).toBe(true)
    expect(bannerDruckProblem('laeuft', 'pruefen')).toBe(false)
    expect(bannerDruckProblem('done', 'pruefen')).toBe(false)
    expect(bannerDruckProblem('unbekannt', 'pruefen')).toBe(true)
    expect(bannerDruckProblem('unbekannt', 'ok')).toBe(false)
    expect(bannerDruckProblem('unbekannt', null)).toBe(false)
  })
})

describe('Banner nach Storno', () => {
  const antwort: VerkaufAntwort = {
    verkauf: { id: 'v4', kassentagId: 'k1', belegnr: 'K1-0004', zeit: '2026-09-19T14:32:00.000Z', zahlart: 'bar_chf', totalRappen: 250, rabattProzent: 0, rabattRappen: 0, helferName: null, storniertAm: null, stornoId: null },
    zahlung: { verkaufId: 'v4', waehrung: 'CHF', kursX10000: null, gegeben: 500, gegebenChfRappen: 500, rueckgeldChfRappen: 250, spendeChfRappen: 0, spendeTyp: null },
    positionen: [],
    sofortAusgeben: [],
    druckauftragId: 'd4',
    bereitsVorhanden: false
  }
  const storno: Storno = { id: 's1', verkaufId: 'v4', kassentagId: 'k1', zeit: '2026-09-19T14:40:00.000Z', grund: 'tippfehler', auszahlungChfRappen: 250, mitPin: false }

  it('bannerAusAntwort: frische Antwort ohne Storno, null bleibt null', () => {
    expect(bannerAusAntwort(null)).toBeNull()
    expect(bannerAusAntwort(antwort)).toEqual({ antwort, storno: null, spende: null })
  })

  it('Storno des Banner-Belegs wird gemerkt', () => {
    const banner = bannerAusAntwort(antwort)
    expect(bannerNachStorno(banner, storno)).toEqual({ antwort, storno, spende: null })
  })

  it('Rueckgeld als Spende zum Banner-Beleg wird gemerkt, zu einem anderen Beleg nicht; Storno der Spende ueberschreibt', () => {
    const spende: Spende = { id: 'sp1', kassentagId: 'k1', verkaufId: 'v4', zeit: '2026-09-19T14:35:00', typ: 'bar_chf', betrag: 250, kursX10000: null, betragChfRappen: 250, storniertAm: null }
    const banner = bannerAusAntwort(antwort)
    expect(bannerNachSpende(banner, spende)).toEqual({ antwort, storno: null, spende })
    expect(bannerNachSpende(banner, { ...spende, verkaufId: 'v3' })).toBe(banner)
    expect(bannerNachSpende(banner, { ...spende, verkaufId: null })).toBe(banner)
    expect(bannerNachSpende(null, spende)).toBeNull()
    const storniert = { ...spende, storniertAm: '2026-09-19T14:36:00' }
    expect(bannerNachSpende(bannerNachSpende(banner, spende), storniert)).toEqual({ antwort, storno: null, spende: storniert })
  })

  it('Storno eines anderen Belegs laesst das Banner unveraendert; ohne Banner bleibt es null', () => {
    const banner = bannerAusAntwort(antwort)
    const anderer: Storno = { ...storno, id: 's2', verkaufId: 'v3' }
    expect(bannerNachStorno(banner, anderer)).toBe(banner)
    expect(bannerNachStorno(null, storno)).toBeNull()
  })

  it('Storno-Zeile mit und ohne Auszahlung (Helfer / 0)', () => {
    expect(stornoBannerText('K1-0004', storno)).toBe('Beleg K1-0004 storniert · Auszahlung CHF 2.50')
    expect(stornoBannerText('K1-0005', { auszahlungChfRappen: 0 })).toBe('Beleg K1-0005 storniert')
  })
})

describe('neueVerkaufsId', () => {
  it('liefert eine UUID v4', () => {
    expect(neueVerkaufsId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(neueVerkaufsId()).not.toBe(neueVerkaufsId())
  })
})
