import { describe, expect, it } from 'vitest'
import type { HelferSaldo, Warenkorb } from '@core/types'
import {
  HELFER_NAME_MAX,
  HELFER_ZAHLUNG_TYPEN,
  baueHelferSpaeterAnfrage,
  baueHelferZahlung,
  bereinigeHelferName,
  findeBekanntenNamen,
  gesamtOffen,
  helferNameVon,
  helferNamenZurAuswahl,
  helferOffenBannerText,
  helferSaldoZusatz,
  helferSchluessel,
  helferZahlungMeldung,
  istGueltigerHelferName,
  istSpaeterZahlen,
  neueHelferZahlungId,
  saldenMitSchuld,
  saldoAusAntwort,
  saldoNachZahlung,
  sortiereHelferNamen,
  spaeterZahlenFrage,
  ueberSaldo,
  verkaufZahlartText,
  zahlungChfGegenwert,
  zahlungVorschlag
} from './helfer'

const warenkorb: Warenkorb = {
  zeilen: [
    { produktId: 'p1', name: 'Bratwurst', preisRappen: 1000, gruppe: 'coupon', anzahl: 2 },
    { produktId: 'p2', name: 'Kaffee', preisRappen: 700, gruppe: 'kasse', anzahl: 1 }
  ]
}

describe('Helfername', () => {
  it('bereinigt Leerzeichen und kuerzt auf die Bon-Breite', () => {
    expect(HELFER_NAME_MAX).toBe(24)
    expect(bereinigeHelferName('  Anna   Müller ')).toBe('Anna Müller')
    expect(bereinigeHelferName('')).toBe('')
    expect(bereinigeHelferName('   ')).toBe('')
    expect(bereinigeHelferName('A'.repeat(30))).toBe('A'.repeat(24))
    // Kuerzung laesst kein Leerzeichen am Ende stehen
    expect(bereinigeHelferName(`${'B'.repeat(23)} C`)).toBe('B'.repeat(23))
  })

  it('istGueltigerHelferName verlangt mindestens ein Zeichen', () => {
    expect(istGueltigerHelferName('Anna')).toBe(true)
    expect(istGueltigerHelferName('  ')).toBe(false)
  })

  it('Schluessel ignoriert Gross-/Kleinschreibung und Rand-Leerzeichen', () => {
    expect(helferSchluessel(' ANNA ')).toBe('anna')
    expect(helferSchluessel('Müller')).toBe(helferSchluessel('müller'))
  })

  it('sortiert alphabetisch nach de-CH ohne Beachtung der Grossschreibung', () => {
    expect(sortiereHelferNamen(['reto', 'Anna', 'Ötzi', 'beat'])).toEqual(['Anna', 'beat', 'Ötzi', 'reto'])
  })

  it('Auswahl vereint gespeicherte Helfer und Salden-Namen ohne Doppelte', () => {
    const helfer = [{ name: 'Reto' }, { name: 'Anna' }]
    const salden = [{ name: 'anna' }, { name: 'Beat' }, { name: '  ' }]
    expect(helferNamenZurAuswahl(helfer, salden)).toEqual(['Anna', 'Beat', 'Reto'])
    expect(helferNamenZurAuswahl([], [])).toEqual([])
  })

  it('findet den gespeicherten Namen zur Eingabe (gleiche Schreibweise wie gespeichert)', () => {
    const namen = ['Anna', 'Reto']
    expect(findeBekanntenNamen(namen, 'anna ')).toBe('Anna')
    expect(findeBekanntenNamen(namen, 'Beat')).toBeNull()
    expect(findeBekanntenNamen(namen, '')).toBeNull()
  })

  it('helferNameVon ist tolerant gegen alte Server (Feld fehlt) und leere Namen', () => {
    expect(helferNameVon({ helferName: 'Anna' })).toBe('Anna')
    expect(helferNameVon({ helferName: ' ' })).toBeNull()
    expect(helferNameVon({ helferName: null })).toBeNull()
    expect(helferNameVon({} as { helferName: string | null })).toBeNull()
  })
})

describe('Verkauf «Spaeter zahlen»', () => {
  it('baut die Anfrage mit zahlart helfer, gegeben 0, Rabatt und bereinigtem Namen', () => {
    expect(baueHelferSpaeterAnfrage('u1', warenkorb, 50, '  Anna ')).toEqual({
      id: 'u1',
      positionen: [
        { produktId: 'p1', anzahl: 2 },
        { produktId: 'p2', anzahl: 1 }
      ],
      zahlart: 'helfer',
      gegeben: 0,
      rabattProzent: 50,
      helferName: 'Anna',
      spendeBehalten: false,
      bestaetigtHohesRueckgeld: false
    })
  })

  it('Texte: Rueckfrage, Banner, Saldo-Zusatz, Zahlart in Listen', () => {
    expect(spaeterZahlenFrage('Anna', 1250)).toBe('CHF 12.50 als offene Schuld für Anna speichern?')
    expect(helferOffenBannerText('Anna', 1250)).toBe('Helfer Anna: CHF 12.50 offen (zahlt später)')
    expect(helferOffenBannerText(null, 500)).toBe('Helfer (ohne Name): CHF 5.00 offen (zahlt später)')
    expect(helferSaldoZusatz({ offenRappen: 2500 }, 1250)).toBe('Saldo gesamt CHF 25.00')
    expect(helferSaldoZusatz({ offenRappen: 1250 }, 1250)).toBeNull()
    expect(helferSaldoZusatz({}, 1250)).toBeNull()
    expect(verkaufZahlartText({ zahlart: 'helfer' })).toBe('offen')
    expect(verkaufZahlartText({ zahlart: 'bar_chf' })).toBe('Bar CHF')
    expect(verkaufZahlartText({ zahlart: 'twint' })).toBe('Twint')
    expect(istSpaeterZahlen('helfer')).toBe(true)
    expect(istSpaeterZahlen('bar_eur')).toBe(false)
  })
})

describe('Helfer-Zahlung', () => {
  it('Umschalter-Reihenfolge und Anfrage', () => {
    expect(HELFER_ZAHLUNG_TYPEN).toEqual(['bar_chf', 'twint', 'bar_eur'])
    expect(baueHelferZahlung('z1', 'Anna', 'bar_eur', 1000)).toEqual({ id: 'z1', helferName: 'Anna', typ: 'bar_eur', betrag: 1000 })
  })

  it('CHF-Gegenwert: EUR ueber den Kurs abgerundet auf 5 Rappen, sonst der Betrag', () => {
    expect(zahlungChfGegenwert('bar_chf', 1250, 9000)).toBe(1250)
    expect(zahlungChfGegenwert('twint', 1250, 0)).toBe(1250)
    expect(zahlungChfGegenwert('bar_eur', 1000, 9000)).toBe(900)
    expect(zahlungChfGegenwert('bar_eur', 1000, 0)).toBe(0)
  })

  it('Vorschlag = offener Saldo, bei EUR auf 10 Cent aufgerundet; ohne Schuld oder Kurs 0', () => {
    expect(zahlungVorschlag('bar_chf', 1250, 9000)).toBe(1250)
    expect(zahlungVorschlag('twint', 1250, 9000)).toBe(1250)
    // 12.50 CHF / 0.90 = 13.888.. EUR -> 13.90
    expect(zahlungVorschlag('bar_eur', 1250, 9000)).toBe(1390)
    expect(zahlungVorschlag('bar_eur', 1250, 0)).toBe(0)
    expect(zahlungVorschlag('bar_chf', 0, 9000)).toBe(0)
    expect(zahlungVorschlag('bar_chf', -500, 9000)).toBe(0)
  })

  it('Teilzahlung und Ueberzahlung', () => {
    expect(ueberSaldo(1000, 1250)).toBe(false)
    expect(ueberSaldo(1250, 1250)).toBe(false)
    expect(ueberSaldo(1300, 1250)).toBe(true)
    expect(saldoNachZahlung(1250, 1000)).toBe(250)
    expect(saldoNachZahlung(1250, 1300)).toBe(-50)
  })

  it('Saldo aus der Serverantwort (saldoNachher.offenRappen), sonst geschaetzt', () => {
    expect(saldoAusAntwort({ saldoNachher: { offenRappen: 250 } }, 1250, 1000)).toBe(250)
    expect(saldoAusAntwort({ saldoNachher: { offenRappen: -50 } }, 1250, 1300)).toBe(-50)
    expect(saldoAusAntwort({}, 1250, 1000)).toBe(250)
    expect(saldoAusAntwort({ saldoNachher: null }, 1250, 1000)).toBe(250)
    expect(saldoAusAntwort({ saldoNachher: { offenRappen: Number.NaN } }, 1250, 1000)).toBe(250)
  })

  it('Meldung nach der Zahlung', () => {
    expect(helferZahlungMeldung('Anna', 1000, 250)).toBe('Anna hat CHF 10.00 bezahlt, offen: CHF 2.50')
  })

  it('neueHelferZahlungId liefert eine UUID', () => {
    expect(neueHelferZahlungId()).toMatch(/^[0-9a-f-]{36}$/)
    expect(neueHelferZahlungId()).not.toBe(neueHelferZahlungId())
  })
})

describe('Salden', () => {
  const salden: HelferSaldo[] = [
    { name: 'Reto', offenRappen: 500, verkaeufeAnzahl: 1, letzteZeit: '2026-09-19T14:00:00' },
    { name: 'anna', offenRappen: 1250, verkaeufeAnzahl: 2, letzteZeit: '2026-09-19T15:00:00' },
    { name: 'Beat', offenRappen: 0, verkaeufeAnzahl: 1, letzteZeit: '2026-09-19T13:00:00' },
    { name: 'Carla', offenRappen: -200, verkaeufeAnzahl: 0, letzteZeit: null }
  ]

  it('nur Schulden > 0, nach Name sortiert', () => {
    expect(saldenMitSchuld(salden).map((s) => s.name)).toEqual(['anna', 'Reto'])
  })

  it('Gesamtsumme zaehlt nur Schulden, kein Guthaben', () => {
    expect(gesamtOffen(salden)).toBe(1750)
    expect(gesamtOffen([])).toBe(0)
  })
})
