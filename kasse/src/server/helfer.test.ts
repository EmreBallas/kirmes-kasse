/**
 * Helfer zahlen ihr Essen (Auftraggeber, 17.9.2026): Name Pflicht bei «später zahlen» (zahlart helfer, Total =
 * offene Schuld, Coupons ohne Schublade), «gleich zahlen» = echte Zahlart mit Name am Beleg, Helfer-Zahlungen
 * (Teilzahlung, idempotent, Storno letzte ohne PIN / ältere mit PIN), Salden über alle Kassentage und Abschluss.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { erstelleTestUmgebung, TEST_PIN, type TestUmgebung } from './testumgebung'

let u: TestUmgebung

afterEach(() => {
  u.aufraeumen()
})

type Json = Record<string, unknown>

/** ESC p 0 25 250: Schubladenimpuls am Anfang eines Druckauftrags. */
const SCHUBLADE_IMPULS = [0x1b, 0x70, 0x00, 0x19, 0xfa]

function bytesVon(druckauftragId: string): Uint8Array {
  return new Uint8Array(readFileSync(join(u.bytesOrdner, `${druckauftragId}.bin`)))
}

function enthaelt(bytes: Uint8Array, folge: readonly number[]): boolean {
  aussen: for (let i = 0; i + folge.length <= bytes.length; i += 1) {
    for (let j = 0; j < folge.length; j += 1) {
      if (bytes[i + j] !== folge[j]) continue aussen
    }
    return true
  }
  return false
}

function enthaeltText(bytes: Uint8Array, text: string): boolean {
  return enthaelt(
    bytes,
    [...text].map((z) => z.charCodeAt(0))
  )
}

async function bericht(): Promise<Json> {
  const b = await u.anfrage('GET', '/api/kassentag/aktuell/bericht')
  expect(b.status).toBe(200)
  return b.json
}

function zahlungAnfrage(id: string, helferName: string, typ: string, betrag: number): Json {
  return { id, helferName, typ, betrag }
}

async function abschliessen(tagId: string, istChfRappen: number, istEurCent = 0): Promise<Json> {
  const a = await u.anfrage('POST', `/api/kassentag/${tagId}/abschluss`, {
    istChfRappen,
    istEurCent,
    bemerkung: null
  })
  expect(a.status).toBe(200)
  return a.json
}

describe('POST /api/verkauf mit Helfer', () => {
  it('«später zahlen»: Name Pflicht, offen = Total, Coupons gedruckt, keine Schublade, Name gespeichert', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten(20000)
    for (const body of [
      { zahlart: 'helfer' },
      { zahlart: 'helfer', helferName: '  ' },
      { zahlart: 'helfer', helferName: null }
    ]) {
      const a = await u.verkauf('v0', [{ name: 'Winti Burger', anzahl: 1 }], body)
      expect(a.status, JSON.stringify(body)).toBe(400)
      expect(a.json['fehler']).toBe('helfer_name_fehlt')
    }
    const zuLang = await u.verkauf('v0', [{ name: 'Winti Burger', anzahl: 1 }], {
      zahlart: 'helfer',
      helferName: 'x'.repeat(25)
    })
    expect(zuLang.status).toBe(400)
    expect(u.repos.verkauf.finde('v0')).toBeNull()
    expect(u.repos.helfer.alle()).toEqual([])

    const a = await u.verkauf(
      'v1',
      [
        { name: 'Winti Burger', anzahl: 1 },
        { name: 'Kaffee', anzahl: 1 }
      ],
      {
        zahlart: 'helfer',
        helferName: 'Ali'
      }
    )
    expect(a.status).toBe(201)
    expect(a.json['helferName']).toBe('Ali')
    expect(a.json['offenRappen']).toBe(1350)
    expect(a.json['verkauf']).toMatchObject({
      zahlart: 'helfer',
      totalRappen: 1350,
      helferName: 'Ali'
    })
    expect(a.json['zahlung']).toMatchObject({
      gegeben: 0,
      gegebenChfRappen: 0,
      rueckgeldChfRappen: 0
    })
    // Beleg-Auftrag mit Coupon und Bon 1 (HELFER-Zeile, OFFEN), aber ohne Schubladenimpuls
    const auftragId = String(a.json['druckauftragId'])
    const auftrag = u.repos.druckauftrag.finde(auftragId)
    expect(auftrag?.typ).toBe('beleg')
    const bytes = bytesVon(auftragId)
    expect(enthaeltText(bytes, 'Coupon 1/1')).toBe(true)
    expect(enthaeltText(bytes, 'HELFER: Ali')).toBe(true)
    expect(enthaeltText(bytes, 'OFFEN - zahlt sp')).toBe(true)
    expect(enthaelt(bytes, SCHUBLADE_IMPULS)).toBe(false)
    // Kein zweiter Auftrag (keine separate Schublade)
    expect(u.repos.druckauftrag.anzahlOffen()).toBe(1)

    // Name gespeichert, Saldo offen, kein Geld in der Lade
    expect(u.repos.helfer.alle().map((h) => h.name)).toEqual(['Ali'])
    const h = await u.anfrage('GET', '/api/helfer')
    expect(h.status).toBe(200)
    expect((h.json['helfer'] as Json[]).map((x) => x['name'])).toEqual(['Ali'])
    expect(h.json['salden']).toEqual([
      { name: 'Ali', offenRappen: 1350, verkaeufeAnzahl: 1, letzteZeit: '2026-09-19T14:32:05' }
    ])
    const b = await bericht()
    expect(b).toMatchObject({
      helferessenStueck: 2,
      helferessenBetragRappen: 1350,
      helferSofortRappen: 0,
      helferSpaeterRappen: 1350,
      helferOffenGesamtRappen: 1350,
      barEinnahmenChfRappen: 0,
      sollChfRappen: 20000,
      anzahlBelege: 1
    })
    expect(b['helferOffen']).toEqual([
      { name: 'Ali', offenRappen: 1350, verkaeufeAnzahl: 1, letzteZeit: '2026-09-19T14:32:05' }
    ])

    // GET /api/verkauf/letzte liefert den Namen mit
    const l = await u.anfrage('GET', '/api/verkauf/letzte')
    expect(((l.liste[0] as Json)['verkauf'] as Json)['helferName']).toBe('Ali')
  })

  it('«gleich zahlen» Bar CHF mit Name: normaler Verkauf, Beleg trägt den Namen, Saldo 0, Schublade öffnet', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten(20000)
    const a = await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }], {
      gegeben: 2000,
      helferName: 'Beyza'
    })
    expect(a.status).toBe(201)
    expect(a.json['helferName']).toBe('Beyza')
    expect(a.json['offenRappen']).toBeNull()
    expect(a.json['verkauf']).toMatchObject({
      zahlart: 'bar_chf',
      totalRappen: 1100,
      helferName: 'Beyza'
    })
    expect(a.json['zahlung']).toMatchObject({ gegeben: 2000, rueckgeldChfRappen: 900 })
    const bytes = bytesVon(String(a.json['druckauftragId']))
    expect(enthaelt(bytes, SCHUBLADE_IMPULS)).toBe(true)
    expect(enthaeltText(bytes, 'Helfer: Beyza')).toBe(true)
    expect(enthaeltText(bytes, 'OFFEN')).toBe(false)

    expect(u.repos.helfer.saldo('Beyza')).toMatchObject({ offenRappen: 0, verkaeufeAnzahl: 0 })
    const b = await bericht()
    expect(b).toMatchObject({
      helferessenStueck: 1,
      helferessenBetragRappen: 1100,
      helferSofortRappen: 1100,
      helferSpaeterRappen: 0,
      helferOffenGesamtRappen: 0,
      helferOffen: [],
      barEinnahmenChfRappen: 1100,
      sollChfRappen: 21100
    })
    const burger = (b['produkte'] as Json[]).find((p) => p['name'] === 'Winti Burger')
    expect(burger).toMatchObject({ verkauft: 0, helfer: 1, umsatzRappen: 1100 })

    // Storno wie ein normaler Storno: Auszahlung des kassierten Betrags, Schublade
    const s = await u.anfrage('POST', '/api/verkauf/v1/storno', { grund: 'tippfehler' })
    expect(s.status).toBe(200)
    expect(s.json['auszahlungChfRappen']).toBe(1100)
    expect(s.json['druckauftragId']).not.toBeNull()
  })

  it('Namen sind ohne Gross-/Kleinschreibung eindeutig: erste Schreibweise gilt für Beleg und Salden', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten()
    const neu = await u.anfrage('POST', '/api/helfer', { name: ' Ali ' })
    expect(neu.status).toBe(201)
    expect(neu.json).toMatchObject({ name: 'Ali', erstelltAm: '2026-09-19T14:32:05' })
    const nochmal = await u.anfrage('POST', '/api/helfer', { name: 'ALI' })
    expect(nochmal.status).toBe(200)
    expect(nochmal.json['id']).toBe(neu.json['id'])
    expect((await u.anfrage('POST', '/api/helfer', { name: '   ' })).status).toBe(400)
    expect((await u.anfrage('POST', '/api/helfer', { name: 'x'.repeat(25) })).status).toBe(400)

    const a = await u.verkauf('v1', [{ name: 'Kaffee', anzahl: 1 }], {
      zahlart: 'helfer',
      helferName: 'ali'
    })
    expect(a.json['helferName']).toBe('Ali')
    const b = await u.verkauf('v2', [{ name: 'Kaffee', anzahl: 1 }], {
      zahlart: 'helfer',
      helferName: 'ALI'
    })
    expect(b.json['helferName']).toBe('Ali')
    expect(u.repos.helfer.alle()).toHaveLength(1)
    const h = await u.anfrage('GET', '/api/helfer')
    expect(h.json['salden']).toEqual([
      { name: 'Ali', offenRappen: 500, verkaeufeAnzahl: 2, letzteZeit: '2026-09-19T14:32:05' }
    ])
    expect(u.repos.helfer.saldo('aLi').offenRappen).toBe(500)
  })
})

describe('POST /api/helfer/zahlung', () => {
  it('Teilzahlungen Bar CHF, Twint und Bar EUR: Saldo sinkt, Schublade nur bei Bargeld, Abschluss-Zeilen und Soll', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten(20000)
    await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 2 }], {
      zahlart: 'helfer',
      helferName: 'Ali'
    })
    expect(u.repos.helfer.saldo('Ali').offenRappen).toBe(2200)
    const auftraegeVorher = u.repos.druckauftrag.anzahlOffen()

    u.uhr.setze('2026-09-19T15:00:00')
    const bar = await u.anfrage(
      'POST',
      '/api/helfer/zahlung',
      zahlungAnfrage('z1', 'Ali', 'bar_chf', 1000)
    )
    expect(bar.status).toBe(201)
    expect(bar.json['bereitsVorhanden']).toBe(false)
    expect(bar.json['zahlung']).toEqual({
      id: 'z1',
      kassentagId: u.repos.kassentag.offener()?.id,
      helferName: 'Ali',
      zeit: '2026-09-19T15:00:00',
      typ: 'bar_chf',
      betrag: 1000,
      kursX10000: null,
      betragChfRappen: 1000,
      storniertAm: null
    })
    expect(bar.json['saldoNachher']).toMatchObject({ name: 'Ali', offenRappen: 1200 })
    // Schublade öffnet (eigener Auftrag typ schublade, leeres Dokument), kein Bon
    const schublade = u.repos.druckauftrag.finde(String(bar.json['druckauftragId']))
    expect(schublade?.typ).toBe('schublade')
    expect(schublade?.verkaufId).toBeNull()
    expect(enthaelt(bytesVon(schublade?.id ?? ''), SCHUBLADE_IMPULS)).toBe(true)
    expect(u.repos.druckauftrag.anzahlOffen()).toBe(auftraegeVorher + 1)

    u.uhr.setze('2026-09-19T15:05:00')
    const twint = await u.anfrage(
      'POST',
      '/api/helfer/zahlung',
      zahlungAnfrage('z2', 'Ali', 'twint', 500)
    )
    expect(twint.status).toBe(201)
    expect(twint.json['druckauftragId']).toBeNull()
    expect((twint.json['saldoNachher'] as Json)['offenRappen']).toBe(700)
    expect(u.repos.druckauftrag.anzahlOffen()).toBe(auftraegeVorher + 1)

    u.uhr.setze('2026-09-19T15:10:00')
    const eur = await u.anfrage(
      'POST',
      '/api/helfer/zahlung',
      zahlungAnfrage('z3', 'Ali', 'bar_eur', 500)
    )
    expect(eur.status).toBe(201)
    expect(eur.json['zahlung']).toMatchObject({
      typ: 'bar_eur',
      betrag: 500,
      kursX10000: 9000,
      betragChfRappen: 450
    })
    expect((eur.json['saldoNachher'] as Json)['offenRappen']).toBe(250)
    expect(eur.json['druckauftragId']).not.toBeNull()
    expect(u.repos.druckauftrag.anzahlOffen()).toBe(auftraegeVorher + 2)

    const b = await bericht()
    expect(b).toMatchObject({
      helferSpaeterRappen: 2200,
      helferZahlungenBarChfRappen: 1000,
      helferZahlungenEurCent: 500,
      helferZahlungenEurChfRappen: 450,
      helferZahlungenTwintRappen: 500,
      helferOffenGesamtRappen: 250,
      barEinnahmenChfRappen: 0,
      sollChfRappen: 20000 + 1000,
      sollEurCent: 500
    })
    expect(b['helferOffen']).toEqual([
      { name: 'Ali', offenRappen: 250, verkaeufeAnzahl: 1, letzteZeit: '2026-09-19T15:10:00' }
    ])

    // Liste der letzten Zahlungen, neueste zuerst
    const liste = await u.anfrage('GET', '/api/helfer/zahlungen/letzte')
    expect(liste.liste.map((z) => (z as Json)['id'])).toEqual(['z3', 'z2', 'z1'])
    expect(liste.liste[0]).toMatchObject({ helferName: 'Ali', mitPin: false, storniertAm: null })
    expect((await u.anfrage('GET', '/api/helfer/zahlungen/letzte?limit=2')).liste).toHaveLength(2)

    // Überzahlung ist erlaubt (Betrag frei), Saldo wird negativ
    const zuviel = await u.anfrage(
      'POST',
      '/api/helfer/zahlung',
      zahlungAnfrage('z4', 'Ali', 'twint', 300)
    )
    expect(zuviel.status).toBe(201)
    expect((zuviel.json['saldoNachher'] as Json)['offenRappen']).toBe(-50)
    expect((await bericht())['helferOffen']).toEqual([])
  })

  it('doppelter POST mit gleicher id = eine Zahlung, 200 bereitsVorhanden, keine zweite Schublade', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten()
    await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }], {
      zahlart: 'helfer',
      helferName: 'Ali'
    })
    const erste = await u.anfrage(
      'POST',
      '/api/helfer/zahlung',
      zahlungAnfrage('z1', 'Ali', 'bar_chf', 1100)
    )
    expect(erste.status).toBe(201)
    const auftraege = u.repos.druckauftrag.anzahlOffen()
    const zweite = await u.anfrage(
      'POST',
      '/api/helfer/zahlung',
      zahlungAnfrage('z1', 'Ali', 'bar_chf', 1100)
    )
    expect(zweite.status).toBe(200)
    expect(zweite.json['bereitsVorhanden']).toBe(true)
    expect(zweite.json['zahlung']).toEqual(erste.json['zahlung'])
    expect(zweite.json['druckauftragId']).toBeNull()
    expect(u.repos.druckauftrag.anzahlOffen()).toBe(auftraege)
    expect(u.db.prepare('SELECT COUNT(*) AS n FROM helfer_zahlung').get()?.['n']).toBe(1)
    expect(u.repos.helfer.saldo('Ali').offenRappen).toBe(0)
    // Idempotenz gilt auch nach dem Abschluss (Wiederholung nach Zeitüberschreitung)
    const tag = u.repos.kassentag.offener()
    await abschliessen(tag?.id ?? '', 20000 + 1100)
    const dritte = await u.anfrage(
      'POST',
      '/api/helfer/zahlung',
      zahlungAnfrage('z1', 'Ali', 'bar_chf', 1100)
    )
    expect(dritte.status).toBe(200)
    expect(dritte.json['bereitsVorhanden']).toBe(true)
  })

  it('Fehlerfälle: kein Kassentag, Betrag <= 0, unbekannter Name, unbekannter Typ, offener Vortag', async () => {
    u = erstelleTestUmgebung()
    const ohneTag = await u.anfrage(
      'POST',
      '/api/helfer/zahlung',
      zahlungAnfrage('z0', 'Ali', 'bar_chf', 100)
    )
    expect(ohneTag.status).toBe(409)
    expect(ohneTag.json['fehler']).toBe('kein_kassentag')

    await u.kassentagStarten()
    await u.verkauf('v1', [{ name: 'Kaffee', anzahl: 1 }], { zahlart: 'helfer', helferName: 'Ali' })
    for (const betrag of [0, -5, 1.5]) {
      const a = await u.anfrage(
        'POST',
        '/api/helfer/zahlung',
        zahlungAnfrage('z0', 'Ali', 'bar_chf', betrag)
      )
      expect(a.status, String(betrag)).toBe(400)
      expect(a.json['fehler']).toBe('ungueltige_eingabe')
    }
    const unbekannt = await u.anfrage(
      'POST',
      '/api/helfer/zahlung',
      zahlungAnfrage('z0', 'Niemand', 'bar_chf', 100)
    )
    expect(unbekannt.status).toBe(400)
    expect(unbekannt.json['fehler']).toBe('helfer_unbekannt')
    expect(
      (await u.anfrage('POST', '/api/helfer/zahlung', zahlungAnfrage('z0', 'Ali', 'helfer', 100)))
        .status
    ).toBe(400)
    expect(
      (
        await u.anfrage('POST', '/api/helfer/zahlung', {
          helferName: 'Ali',
          typ: 'bar_chf',
          betrag: 100
        })
      ).status
    ).toBe(400)
    expect(u.db.prepare('SELECT COUNT(*) AS n FROM helfer_zahlung').get()?.['n']).toBe(0)

    u.uhr.setze('2026-09-20T09:00:00')
    const vortag = await u.anfrage(
      'POST',
      '/api/helfer/zahlung',
      zahlungAnfrage('z0', 'Ali', 'bar_chf', 100)
    )
    expect(vortag.status).toBe(409)
    expect(vortag.json['fehler']).toBe('vortag_offen')
  })
})

describe('Salden über zwei Kassentage', () => {
  it('Samstag Schuld, Sonntag Zahlung -> Saldo 0; Abschluss-Bon des Samstags zeigt die Salden von damals', async () => {
    u = erstelleTestUmgebung()
    const samstag = await u.kassentagStarten(20000)
    await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }], {
      zahlart: 'helfer',
      helferName: 'Ali'
    })
    u.uhr.setze('2026-09-19T15:00:00')
    await u.verkauf('v2', [{ name: 'Kaffee', anzahl: 2 }], {
      zahlart: 'helfer',
      helferName: 'Beyza'
    })
    await u.verkauf('v3', [{ name: 'Kaffee', anzahl: 1 }], {
      zahlart: 'helfer',
      helferName: 'Beyza'
    })
    // Sofort bezahlter Helfer-Beleg erzeugt keine Schuld
    await u.verkauf('v4', [{ name: 'Kaffee', anzahl: 1 }], {
      zahlart: 'twint',
      gegeben: 250,
      helferName: 'Cem'
    })

    u.uhr.setze('2026-09-19T22:00:00')
    const sa = await abschliessen(samstag, 20000)
    expect(sa).toMatchObject({
      helferessenStueck: 5,
      helferSpaeterRappen: 1850,
      helferSofortRappen: 250,
      twintUmsatzRappen: 250,
      helferOffenGesamtRappen: 1850,
      sollChfRappen: 20000,
      differenzChfRappen: 0
    })
    expect(sa['helferOffen']).toEqual([
      { name: 'Ali', offenRappen: 1100, verkaeufeAnzahl: 1, letzteZeit: '2026-09-19T14:32:05' },
      { name: 'Beyza', offenRappen: 750, verkaeufeAnzahl: 2, letzteZeit: '2026-09-19T15:00:00' }
    ])

    // Sonntag: Ali zahlt bar, Beyza die Hälfte per Twint
    u.uhr.setze('2026-09-20T11:00:00')
    await u.kassentagStarten(15000)
    const ali = await u.anfrage(
      'POST',
      '/api/helfer/zahlung',
      zahlungAnfrage('z1', 'Ali', 'bar_chf', 1100)
    )
    expect(ali.status).toBe(201)
    expect((ali.json['saldoNachher'] as Json)['offenRappen']).toBe(0)
    await u.anfrage('POST', '/api/helfer/zahlung', zahlungAnfrage('z2', 'Beyza', 'twint', 400))
    // Neue Sonntags-Schuld von Beyza
    u.uhr.setze('2026-09-20T12:00:00')
    await u.verkauf('v5', [{ name: 'Kaffee', anzahl: 1 }], {
      zahlart: 'helfer',
      helferName: 'Beyza'
    })

    const h = await u.anfrage('GET', '/api/helfer')
    expect(h.json['salden']).toEqual([
      { name: 'Ali', offenRappen: 0, verkaeufeAnzahl: 1, letzteZeit: '2026-09-20T11:00:00' },
      {
        name: 'Beyza',
        offenRappen: 750 - 400 + 250,
        verkaeufeAnzahl: 3,
        letzteZeit: '2026-09-20T12:00:00'
      },
      { name: 'Cem', offenRappen: 0, verkaeufeAnzahl: 0, letzteZeit: null }
    ])

    const so = await bericht()
    expect(so).toMatchObject({
      helferessenStueck: 1,
      helferSpaeterRappen: 250,
      helferZahlungenBarChfRappen: 1100,
      helferZahlungenTwintRappen: 400,
      helferOffenGesamtRappen: 600,
      sollChfRappen: 15000 + 1100
    })
    expect(so['helferOffen']).toEqual([
      { name: 'Beyza', offenRappen: 600, verkaeufeAnzahl: 3, letzteZeit: '2026-09-20T12:00:00' }
    ])

    // Nachdruck des Samstag-Abschlusses: Salden zum Stand der Abschlusszeit (Ali und Beyza offen)
    expect(u.repos.helfer.salden('2026-09-19T22:00:00').filter((s) => s.offenRappen > 0)).toEqual([
      { name: 'Ali', offenRappen: 1100, verkaeufeAnzahl: 1, letzteZeit: '2026-09-19T14:32:05' },
      { name: 'Beyza', offenRappen: 750, verkaeufeAnzahl: 2, letzteZeit: '2026-09-19T15:00:00' }
    ])
    const nachdruck = await u.anfrage('POST', `/api/kassentag/${samstag}/abschluss/nachdruck`)
    expect(nachdruck.status).toBe(200)
    const bytes = bytesVon(String(nachdruck.json['druckauftragId']))
    expect(enthaeltText(bytes, 'Ali')).toBe(true)
    expect(enthaeltText(bytes, '18.50')).toBe(true)

    // Storno des Samstag-Belegs am Sonntag (mit PIN): Schuld sinkt, keine Auszahlung
    const storno = await u.anfrage(
      'POST',
      '/api/verkauf/v2/storno',
      { grund: 'tippfehler' },
      TEST_PIN
    )
    expect(storno.status).toBe(200)
    expect(storno.json['auszahlungChfRappen']).toBe(0)
    expect(u.repos.helfer.saldo('Beyza').offenRappen).toBe(600 - 500)
    // Der Samstag-Stand bleibt davon unberührt (Storno ist nach dem Stichtag)
    expect(
      u.repos.helfer.salden('2026-09-19T22:00:00').find((s) => s.name === 'Beyza')?.offenRappen
    ).toBe(750)
  })
})

describe('Storno von Helfer-Zahlungen', () => {
  it('letzte ohne PIN, ältere nur mit PIN, zweiter Storno 409, Schuld lebt wieder auf', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten(20000)
    await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 2 }], {
      zahlart: 'helfer',
      helferName: 'Ali'
    })
    u.uhr.setze('2026-09-19T15:00:00')
    await u.anfrage('POST', '/api/helfer/zahlung', zahlungAnfrage('z1', 'Ali', 'bar_chf', 1000))
    u.uhr.setze('2026-09-19T15:05:00')
    await u.anfrage('POST', '/api/helfer/zahlung', zahlungAnfrage('z2', 'Ali', 'twint', 500))
    u.uhr.setze('2026-09-19T15:10:00')
    await u.anfrage('POST', '/api/helfer/zahlung', zahlungAnfrage('z3', 'Ali', 'bar_chf', 700))
    expect(u.repos.helfer.saldo('Ali').offenRappen).toBe(0)
    expect((await bericht())['sollChfRappen']).toBe(20000 + 1000 + 700)

    // z1 ist nicht die letzte -> PIN nötig
    const alt = await u.anfrage('POST', '/api/helfer/zahlung/z1/storno')
    expect(alt.status).toBe(403)
    expect(alt.json['fehler']).toBe('pin_falsch')
    expect(u.repos.helfer.zahlungFinde('z1')?.storniertAm).toBeNull()

    // z3 ist die letzte -> ohne PIN
    u.uhr.setze('2026-09-19T15:20:00')
    const letzte = await u.anfrage('POST', '/api/helfer/zahlung/z3/storno')
    expect(letzte.status).toBe(200)
    expect(letzte.json).toMatchObject({
      id: 'z3',
      storniertAm: '2026-09-19T15:20:00',
      mitPin: false
    })
    expect((letzte.json['saldoNachher'] as Json)['offenRappen']).toBe(700)
    expect((await bericht())['sollChfRappen']).toBe(20000 + 1000)

    const nochmal = await u.anfrage('POST', '/api/helfer/zahlung/z3/storno')
    expect(nochmal.status).toBe(409)
    expect(nochmal.json['fehler']).toBe('bereits_storniert')

    // z1 ist weiterhin nicht die letzte nicht stornierte (z2 ist neuer): falsche PIN 403, richtige 200
    expect(
      (await u.anfrage('POST', '/api/helfer/zahlung/z1/storno', undefined, '9999')).status
    ).toBe(403)
    const mitPin = await u.anfrage('POST', '/api/helfer/zahlung/z1/storno', undefined, TEST_PIN)
    expect(mitPin.status).toBe(200)
    expect(mitPin.json).toMatchObject({ id: 'z1', mitPin: true })
    expect((mitPin.json['saldoNachher'] as Json)['offenRappen']).toBe(1700)

    const b = await bericht()
    expect(b).toMatchObject({
      helferZahlungenBarChfRappen: 0,
      helferZahlungenTwintRappen: 500,
      helferOffenGesamtRappen: 1700,
      sollChfRappen: 20000
    })
    const liste = await u.anfrage('GET', '/api/helfer/zahlungen/letzte')
    expect(liste.liste.map((z) => (z as Json)['id'])).toEqual(['z3', 'z2', 'z1'])
    expect(liste.liste[0]).toMatchObject({ mitPin: false, storniertAm: '2026-09-19T15:20:00' })
    expect(liste.liste[2]).toMatchObject({ mitPin: true })
    // Nichts wurde gelöscht
    expect(u.db.prepare('SELECT COUNT(*) AS n FROM helfer_zahlung').get()?.['n']).toBe(3)

    const fehlt = await u.anfrage('POST', '/api/helfer/zahlung/gibtsnicht/storno')
    expect(fehlt.status).toBe(404)
    expect(fehlt.json['fehler']).toBe('zahlung_nicht_gefunden')
  })

  it('nach dem Abschluss 409 kassentag_abgeschlossen; Testdaten löschen leert Zahlungen, Namen bleiben', async () => {
    u = erstelleTestUmgebung()
    const tag = await u.kassentagStarten(20000)
    await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }], {
      zahlart: 'helfer',
      helferName: 'Ali'
    })
    await u.anfrage('POST', '/api/helfer/zahlung', zahlungAnfrage('z1', 'Ali', 'bar_chf', 1100))
    const abschluss = await abschliessen(tag, 21100)
    expect(abschluss['helferZahlungenBarChfRappen']).toBe(1100)
    expect(abschluss['differenzChfRappen']).toBe(0)
    const zuSpaet = await u.anfrage('POST', '/api/helfer/zahlung/z1/storno', undefined, TEST_PIN)
    expect(zuSpaet.status).toBe(409)
    expect(zuSpaet.json['fehler']).toBe('kassentag_abgeschlossen')
    expect(u.repos.helfer.zahlungFinde('z1')?.storniertAm).toBeNull()

    const l = await u.anfrage('POST', '/api/testdaten-loeschen', undefined, TEST_PIN)
    expect(l.status).toBe(200)
    expect(u.db.prepare('SELECT COUNT(*) AS n FROM helfer_zahlung').get()?.['n']).toBe(0)
    expect(u.db.prepare('SELECT COUNT(*) AS n FROM verkauf').get()?.['n']).toBe(0)
    expect(u.repos.helfer.alle().map((h) => h.name)).toEqual(['Ali'])
    expect(u.repos.helfer.salden()).toEqual([
      { name: 'Ali', offenRappen: 0, verkaeufeAnzahl: 0, letzteZeit: null }
    ])
  })
})

describe('helferRepo', () => {
  it('stelleSicher trimmt, prüft Länge und ist ohne Gross-/Kleinschreibung eindeutig; istLetzteZahlung', () => {
    u = erstelleTestUmgebung()
    const tag = u.repos.kassentag.starte({
      datum: '2026-09-19',
      kassePraefix: 'K1',
      kassier: 'EB',
      startgeldChfRappen: 0,
      startgeldEurCent: 0
    })
    expect(() => u.repos.helfer.stelleSicher('   ')).toThrow()
    expect(() => u.repos.helfer.stelleSicher('x'.repeat(25))).toThrow()
    const a = u.repos.helfer.stelleSicher('  Müller Ali ')
    expect(a.name).toBe('Müller Ali')
    const b = u.repos.helfer.stelleSicher('müller ali')
    expect(b.id).toBe(a.id)
    expect(u.repos.helfer.finde('MÜLLER ALI')?.id).toBe(a.id)
    expect(u.repos.helfer.finde('Niemand')).toBeNull()
    u.repos.helfer.stelleSicher('Beyza')
    expect(u.repos.helfer.alle().map((h) => h.name)).toEqual(['Beyza', 'Müller Ali'])

    expect(u.repos.helfer.istLetzteZahlung('z1')).toBe(false)
    u.repos.helfer.zahlungErstelle(
      { id: 'z1', helferName: 'Beyza', typ: 'bar_chf', betrag: 100 },
      tag.id,
      9000
    )
    u.repos.helfer.zahlungErstelle(
      { id: 'z2', helferName: 'Beyza', typ: 'bar_eur', betrag: 200 },
      tag.id,
      9000
    )
    expect(u.repos.helfer.istLetzteZahlung('z1')).toBe(false)
    expect(u.repos.helfer.istLetzteZahlung('z2')).toBe(true)
    expect(u.repos.helfer.zahlungFinde('z2')).toMatchObject({
      kursX10000: 9000,
      betragChfRappen: 180
    })
    expect(u.repos.helfer.zahlungFinde('z1')?.kursX10000).toBeNull()
    expect(u.repos.helfer.zahlungStorno('z2', false)).toMatchObject({ ergebnis: 'storniert' })
    expect(u.repos.helfer.zahlungStorno('z2', false)).toMatchObject({
      ergebnis: 'bereits_storniert'
    })
    expect(u.repos.helfer.zahlungStorno('fehlt', false)).toEqual({ ergebnis: 'nicht_gefunden' })
    expect(u.repos.helfer.istLetzteZahlung('z1')).toBe(true)
    expect(u.repos.helfer.zahlungenFuerKassentag(tag.id).map((z) => z.id)).toEqual(['z1'])
    expect(u.repos.helfer.zahlungenLetzte(10).map((z) => z.id)).toEqual(['z2', 'z1'])
    // Repo lehnt ungültige Beträge ab (Schutz hinter der Routen-Validierung)
    expect(() =>
      u.repos.helfer.zahlungErstelle(
        { id: 'z3', helferName: 'Beyza', typ: 'twint', betrag: 0 },
        tag.id,
        9000
      )
    ).toThrow()
    // Überzahlung ohne Schuld: Saldo negativ, taucht im Bericht nicht als offen auf
    expect(u.repos.helfer.saldo('Beyza').offenRappen).toBe(-100)
  })
})
