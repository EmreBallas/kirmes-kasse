import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { erstelleTestUmgebung, TEST_PIN, type TestUmgebung } from './testumgebung'

let u: TestUmgebung
const temp: string[] = []

afterEach(() => {
  u.aufraeumen()
  for (const t of temp.splice(0)) rmSync(t, { recursive: true, force: true })
})

function verkaufVon(a: { json: Record<string, unknown> }): Record<string, unknown> {
  return a.json['verkauf'] as Record<string, unknown>
}

function zahlungVon(a: { json: Record<string, unknown> }): Record<string, unknown> {
  return a.json['zahlung'] as Record<string, unknown>
}

describe('Health und Status', () => {
  it('GET /api/health und /api/status', async () => {
    u = erstelleTestUmgebung()
    const h = await u.anfrage('GET', '/api/health')
    expect(h.status).toBe(200)
    expect(h.json).toEqual({ ok: true, version: 'test' })

    const s = await u.anfrage('GET', '/api/status')
    expect(s.status).toBe(200)
    expect(s.json['kassentag']).toBeNull()
    expect(s.json['vortagOffen']).toBeNull()
    expect(s.json['druck']).toEqual({
      ampel: 'ok',
      letzterFehler: null,
      transport: 'simulator',
      offeneAuftraege: 0,
      druckerName: 'TM-T20II'
    })
  })

  it('meldet einen offenen Vortag', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten()
    u.uhr.setze('2026-09-20T09:00:00')
    const s = await u.anfrage('GET', '/api/status')
    expect((s.json['vortagOffen'] as Record<string, unknown>)['datum']).toBe('2026-09-19')
    const a = await u.anfrage('GET', '/api/kassentag/aktuell')
    expect((a.json['vortagOffen'] as Record<string, unknown>)['datum']).toBe('2026-09-19')
  })

  it('offener Vortag sperrt Verkauf und Storno mit 409 vortag_offen, bis der Abschluss nachgeholt ist', async () => {
    u = erstelleTestUmgebung()
    const id = await u.kassentagStarten()
    const gestern = await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }])
    expect(gestern.status).toBe(201)

    u.uhr.setze('2026-09-20T09:00:00')
    const heute = await u.verkauf('v2', [{ name: 'Winti Burger', anzahl: 1 }])
    expect(heute.status).toBe(409)
    expect(heute.json['fehler']).toBe('vortag_offen')
    expect(String(heute.json['meldung'])).toContain('19.09.2026')
    expect(u.repos.verkauf.finde('v2')).toBeNull()

    const storno = await u.anfrage('POST', '/api/verkauf/v1/storno', { grund: 'tippfehler' })
    expect(storno.status).toBe(409)
    expect(storno.json['fehler']).toBe('vortag_offen')
    expect(u.repos.verkauf.finde('v1')?.storniertAm).toBeNull()

    // Kassentag-Start bleibt gesperrt, solange der Vortag offen ist
    const start = await u.anfrage('POST', '/api/kassentag/start', {
      startgeldChfRappen: 100,
      startgeldEurCent: 0,
      kassier: 'X'
    })
    expect(start.status).toBe(409)

    // Abschluss nachholen, dann neuer Tag -> Verkauf wieder möglich
    const abschluss = await u.anfrage('POST', `/api/kassentag/${id}/abschluss`, {
      istChfRappen: 21100,
      istEurCent: 0,
      bemerkung: null
    })
    expect(abschluss.status).toBe(200)
    const ohneTag = await u.verkauf('v2', [{ name: 'Winti Burger', anzahl: 1 }])
    expect(ohneTag.json['fehler']).toBe('kein_kassentag')
    await u.kassentagStarten()
    const neu = await u.verkauf('v2', [{ name: 'Winti Burger', anzahl: 1 }])
    expect(neu.status).toBe(201)
    expect(verkaufVon(neu)['belegnr']).toBe('K1-0002')
  })

  it('unbekannte API-Routen liefern JSON 404', async () => {
    u = erstelleTestUmgebung()
    const a = await u.anfrage('GET', '/api/gibtsnicht')
    expect(a.status).toBe(404)
    expect(a.json['fehler']).toBe('nicht_gefunden')
    // DELETE /api/produkte/:id gibt es inzwischen (PIN-geschützt); eine andere Methode/Route prüfen
    const b = await u.anfrage('DELETE', '/api/verkauf/x')
    expect(b.status).toBe(404)
    expect(b.json['fehler']).toBe('nicht_gefunden')
  })
})

describe('POST /api/verkauf', () => {
  it('ohne Kassentag -> 409 kein_kassentag', async () => {
    u = erstelleTestUmgebung()
    const a = await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }])
    expect(a.status).toBe(409)
    expect(a.json['fehler']).toBe('kein_kassentag')
  })

  it('vergibt K1-0001 und K1-0002, speichert Snapshots, druckt und leert den Entwurf', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten()
    await u.anfrage('PUT', '/api/warenkorb-entwurf', {
      zeilen: [{ produktId: 'x', name: 'x', preisRappen: 1, gruppe: 'kasse', anzahl: 1 }]
    })

    const a = await u.verkauf(
      'v1',
      [
        { name: 'Winti Burger', anzahl: 2 },
        { name: 'Getränk Dose', anzahl: 1 }
      ],
      { gegeben: 5000 }
    )
    expect(a.status).toBe(201)
    expect(verkaufVon(a)['belegnr']).toBe('K1-0001')
    expect(verkaufVon(a)['totalRappen']).toBe(2450)
    expect(verkaufVon(a)['zeit']).toBe('2026-09-19T14:32:05')
    expect(zahlungVon(a)['rueckgeldChfRappen']).toBe(2550)
    expect(a.json['sofortAusgeben']).toEqual([{ name: 'Getränk Dose', anzahl: 1 }])
    expect(a.json['bereitsVorhanden']).toBe(false)
    const positionen = a.json['positionen'] as Record<string, unknown>[]
    expect(positionen).toHaveLength(2)
    expect(positionen[0]).toMatchObject({
      nameSnapshot: 'Winti Burger',
      preisSnapshotRappen: 1100,
      anzahl: 2,
      gruppeSnapshot: 'coupon'
    })

    const druckId = String(a.json['druckauftragId'])
    const auftrag = u.repos.druckauftrag.finde(druckId)
    expect(auftrag?.typ).toBe('beleg')
    expect(auftrag?.status).toBe('queued')
    expect(existsSync(join(u.bytesOrdner, `${druckId}.bin`))).toBe(true)
    expect(u.druckAnstoesse).toBe(1)

    const entwurf = await u.anfrage('GET', '/api/warenkorb-entwurf')
    expect(entwurf.json).toEqual({ zeilen: [] })

    const b = await u.verkauf('v2', [{ name: 'Kaffee', anzahl: 1 }])
    expect(verkaufVon(b)['belegnr']).toBe('K1-0002')
    expect(zahlungVon(b)['rueckgeldChfRappen']).toBe(0)
  })

  it('doppelter POST mit gleicher id = ein Verkauf, gleiche Belegnummer, bereitsVorhanden', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten()
    const a = await u.verkauf('v1', [{ name: 'Lahmacun', anzahl: 1 }])
    const b = await u.verkauf('v1', [{ name: 'Lahmacun', anzahl: 1 }])
    expect(a.status).toBe(201)
    expect(b.status).toBe(200)
    expect(b.json['bereitsVorhanden']).toBe(true)
    expect(verkaufVon(b)['belegnr']).toBe('K1-0001')
    expect(b.json['druckauftragId']).toBe(a.json['druckauftragId'])
    expect(u.db.prepare('SELECT COUNT(*) AS n FROM verkauf').get()?.['n']).toBe(1)
    expect(u.db.prepare('SELECT COUNT(*) AS n FROM druckauftrag').get()?.['n']).toBe(1)
    expect(u.druckAnstoesse).toBe(1)
    const c = await u.verkauf('v2', [{ name: 'Lahmacun', anzahl: 1 }])
    expect(verkaufVon(c)['belegnr']).toBe('K1-0002')
  })

  it('nicht gedeckt -> 409 nicht_gedeckt', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten()
    const a = await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }], { gegeben: 1000 })
    expect(a.status).toBe(409)
    expect(a.json['fehler']).toBe('nicht_gedeckt')
    expect(u.repos.verkauf.finde('v1')).toBeNull()
    const t = await u.verkauf('v2', [{ name: 'Winti Burger', anzahl: 1 }], {
      zahlart: 'twint',
      gegeben: 1095
    })
    expect(t.status).toBe(409)
  })

  it('Rückgeld über 200: ohne Bestätigung 409, mit Bestätigung 201', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten()
    const a = await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }], { gegeben: 50000 })
    expect(a.status).toBe(409)
    expect(a.json['fehler']).toBe('bestaetigung_noetig')
    expect(a.json['warnungen']).toEqual(['rueckgeld_ueber_200'])
    const b = await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }], {
      gegeben: 50000,
      bestaetigtHohesRueckgeld: true
    })
    expect(b.status).toBe(201)
    expect(zahlungVon(b)['rueckgeldChfRappen']).toBe(48900)
    const t = await u.verkauf('v2', [{ name: 'Winti Burger', anzahl: 1 }], {
      zahlart: 'twint',
      gegeben: 50000
    })
    expect(t.json['warnungen']).toEqual(['spende_ueber_200'])
  })

  it('Bar-EUR: 20 EUR bei 0.90 für 12.00 -> Gegenwert 18.00, Rückgeld 6.00', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten()
    const a = await u.verkauf('v1', [{ name: 'Döner Kebap', anzahl: 1 }], {
      zahlart: 'bar_eur',
      gegeben: 2000
    })
    expect(a.status).toBe(201)
    expect(zahlungVon(a)).toMatchObject({
      waehrung: 'EUR',
      kursX10000: 9000,
      gegeben: 2000,
      gegebenChfRappen: 1800,
      rueckgeldChfRappen: 600,
      spendeChfRappen: 0
    })
  })

  it('Twint-Überzahlung wird Spende, "stimmt so" bar wird Bar-Spende', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten()
    const t = await u.verkauf('v1', [{ name: 'Kaffee', anzahl: 1 }], {
      zahlart: 'twint',
      gegeben: 300
    })
    expect(zahlungVon(t)).toMatchObject({
      rueckgeldChfRappen: 0,
      spendeChfRappen: 50,
      spendeTyp: 'twint'
    })
    const b = await u.verkauf('v2', [{ name: 'Kaffee', anzahl: 1 }], {
      gegeben: 300,
      spendeBehalten: true
    })
    expect(zahlungVon(b)).toMatchObject({
      rueckgeldChfRappen: 0,
      spendeChfRappen: 50,
      spendeTyp: 'bar_chf'
    })
  })

  it('Helfer: Total 0, Positionen behalten den Preis-Snapshot', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten()
    const a = await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 2 }], { zahlart: 'helfer' })
    expect(a.status).toBe(201)
    expect(verkaufVon(a)['totalRappen']).toBe(0)
    expect(zahlungVon(a)['gegeben']).toBe(0)
    expect((a.json['positionen'] as Record<string, unknown>[])[0]?.['preisSnapshotRappen']).toBe(
      1100
    )
  })

  it('ausverkaufte oder inaktive Produkte -> 409 produkt_nicht_verfuegbar', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten()
    const id = u.produktId('Ayran')
    const t = await u.anfrage('POST', `/api/produkte/${id}/ausverkauft`, { ausverkauft: true })
    expect(t.status).toBe(200)
    expect(t.json['ausverkauft']).toBe(true)
    const a = await u.verkauf('v1', [{ name: 'Ayran', anzahl: 1 }])
    expect(a.status).toBe(409)
    expect(a.json['fehler']).toBe('produkt_nicht_verfuegbar')
    const f = await u.anfrage('POST', '/api/verkauf', {
      id: 'v2',
      positionen: [{ produktId: 'gibtsnicht', anzahl: 1 }],
      zahlart: 'bar_chf',
      gegeben: 100
    })
    expect(f.status).toBe(409)
  })

  it('ungültiger Body -> 400', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten()
    const a = await u.anfrage('POST', '/api/verkauf', {
      id: 'v1',
      positionen: [],
      zahlart: 'bar_chf',
      gegeben: 100
    })
    expect(a.status).toBe(400)
    const b = await u.anfrage('POST', '/api/verkauf', {
      id: 'v1',
      positionen: [{ produktId: 'x', anzahl: 1 }],
      zahlart: 'karte',
      gegeben: 100
    })
    expect(b.status).toBe(400)
    const c = await u.anfrage('POST', '/api/verkauf', {
      id: 'v1',
      positionen: [{ produktId: 'x', anzahl: 1 }],
      zahlart: 'bar_chf',
      gegeben: 12.5
    })
    expect(c.status).toBe(400)
    expect(c.json['fehler']).toBe('ungueltige_eingabe')
  })
})

describe('Storno und Nachdruck', () => {
  it('letzter Beleg ohne PIN, älterer nur mit PIN, zweiter Storno 409', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten()
    await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }])
    await u.verkauf('v2', [{ name: 'Kaffee', anzahl: 1 }])

    const alt = await u.anfrage('POST', '/api/verkauf/v1/storno', { grund: 'tippfehler' })
    expect(alt.status).toBe(403)
    expect(alt.json['fehler']).toBe('pin_falsch')
    const altFalsch = await u.anfrage(
      'POST',
      '/api/verkauf/v1/storno',
      { grund: 'tippfehler' },
      '9999'
    )
    expect(altFalsch.status).toBe(403)

    const letzter = await u.anfrage('POST', '/api/verkauf/v2/storno', { grund: 'abgesprungen' })
    expect(letzter.status).toBe(200)
    expect(letzter.json).toMatchObject({
      verkaufId: 'v2',
      grund: 'abgesprungen',
      auszahlungChfRappen: 250,
      mitPin: false
    })
    const schublade = u.repos.druckauftrag.finde(String(letzter.json['druckauftragId']))
    expect(schublade?.typ).toBe('schublade')
    expect(u.repos.verkauf.finde('v2')?.storniertAm).toBe('2026-09-19T14:32:05')
    expect(u.repos.verkauf.finde('v2')?.stornoId).toBe(letzter.json['id'])

    const zweiter = await u.anfrage('POST', '/api/verkauf/v2/storno', { grund: 'tippfehler' })
    expect(zweiter.status).toBe(409)
    expect(zweiter.json['fehler']).toBe('bereits_storniert')

    const mitPin = await u.anfrage(
      'POST',
      '/api/verkauf/v1/storno',
      { grund: 'ausverkauft' },
      TEST_PIN
    )
    expect(mitPin.status).toBe(200)
    expect(mitPin.json).toMatchObject({ auszahlungChfRappen: 1100, mitPin: true })

    const ohneGrund = await u.anfrage('POST', '/api/verkauf/v1/storno', {})
    expect(ohneGrund.status).toBe(400)
    const fehlt = await u.anfrage('POST', '/api/verkauf/gibtsnicht/storno', { grund: 'tippfehler' })
    expect(fehlt.status).toBe(404)
  })

  it('Helfer-Storno: Auszahlung 0, keine Schublade', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten()
    await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }], { zahlart: 'helfer' })
    const anzahlVorher = u.repos.druckauftrag.anzahlOffen()
    const s = await u.anfrage('POST', '/api/verkauf/v1/storno', { grund: 'tippfehler' })
    expect(s.status).toBe(200)
    expect(s.json['auszahlungChfRappen']).toBe(0)
    expect(s.json['druckauftragId']).toBeNull()
    expect(u.repos.druckauftrag.anzahlOffen()).toBe(anzahlVorher)
  })

  it('Storno wird dem Kassentag des Stornos zugeordnet', async () => {
    u = erstelleTestUmgebung()
    const tag1 = await u.kassentagStarten()
    await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }])
    await u.anfrage('POST', `/api/kassentag/${tag1}/abschluss`, {
      istChfRappen: 21100,
      istEurCent: 0,
      bemerkung: null
    })
    u.uhr.setze('2026-09-20T10:00:00')
    const tag2 = await u.kassentagStarten()
    // Der Samstag-Beleg ist nicht der letzte Beleg des offenen (Sonntag-)Kassentags -> PIN nötig
    const ohnePin = await u.anfrage('POST', '/api/verkauf/v1/storno', { grund: 'tippfehler' })
    expect(ohnePin.status).toBe(403)
    const s = await u.anfrage('POST', '/api/verkauf/v1/storno', { grund: 'tippfehler' }, TEST_PIN)
    expect(s.status).toBe(200)
    expect(s.json['kassentagId']).toBe(tag2)
    expect(s.json['mitPin']).toBe(true)
    const bericht = await u.anfrage('GET', '/api/kassentag/aktuell/bericht')
    expect(bericht.json['storniAnzahl']).toBe(1)
    expect(bericht.json['storniAuszahlungRappen']).toBe(1100)
    expect(bericht.json['sollChfRappen']).toBe(20000 - 1100)
  })

  it('Nachdruck erzeugt nachdruck_* Auftrag, stornierter Beleg -> 409', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten()
    await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }])
    const n = await u.anfrage('POST', '/api/verkauf/v1/nachdruck', { was: 'coupons' })
    expect(n.status).toBe(200)
    const auftrag = u.repos.druckauftrag.finde(String(n.json['druckauftragId']))
    expect(auftrag?.typ).toBe('nachdruck_coupons')
    expect(auftrag?.verkaufId).toBe('v1')
    const bericht = await u.anfrage('GET', '/api/kassentag/aktuell/bericht')
    expect(bericht.json['nachdrucke']).toBe(1)

    await u.anfrage('POST', '/api/verkauf/v1/storno', { grund: 'tippfehler' })
    const s = await u.anfrage('POST', '/api/verkauf/v1/nachdruck', { was: 'alles' })
    expect(s.status).toBe(409)
    expect(s.json['fehler']).toBe('beleg_storniert')
    const falsch = await u.anfrage('POST', '/api/verkauf/v1/nachdruck', { was: 'bon2' })
    expect(falsch.status).toBe(400)
  })

  it('GET /api/verkauf/letzte liefert neueste zuerst mit Storno', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten()
    await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }])
    u.uhr.setze('2026-09-19T14:40:00')
    await u.verkauf('v2', [{ name: 'Kaffee', anzahl: 1 }])
    await u.anfrage('POST', '/api/verkauf/v2/storno', { grund: 'tippfehler' })
    const l = await u.anfrage('GET', '/api/verkauf/letzte?limit=1')
    expect(l.liste).toHaveLength(1)
    const eintrag = l.liste[0] as Record<string, unknown>
    expect((eintrag['verkauf'] as Record<string, unknown>)['id']).toBe('v2')
    expect((eintrag['storno'] as Record<string, unknown>)['grund']).toBe('tippfehler')
    expect(eintrag['zahlung']).toBeDefined()
    expect(eintrag['positionen']).toHaveLength(1)
    const alle = await u.anfrage('GET', '/api/verkauf/letzte')
    expect(
      alle.liste.map(
        (e) => ((e as Record<string, unknown>)['verkauf'] as Record<string, unknown>)['id']
      )
    ).toEqual(['v2', 'v1'])
  })
})

describe('Kassentag', () => {
  it('start, 409 bei offenem Tag, Vorschlag aus dem letzten Abschluss, Abschluss mit Differenz', async () => {
    u = erstelleTestUmgebung()
    const vor = await u.anfrage('GET', '/api/kassentag/aktuell')
    expect(vor.json).toEqual({
      kassentag: null,
      vortagOffen: null,
      vorschlagStartgeldChfRappen: 0,
      letzterAbgeschlossener: null
    })

    const id = await u.kassentagStarten(20000)
    const doppelt = await u.anfrage('POST', '/api/kassentag/start', {
      startgeldChfRappen: 100,
      startgeldEurCent: 0,
      kassier: 'X'
    })
    expect(doppelt.status).toBe(409)
    expect(doppelt.json['fehler']).toBe('kassentag_offen')

    await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }], { gegeben: 2000 })
    await u.verkauf('v2', [{ name: 'Kaffee', anzahl: 2 }], { zahlart: 'twint', gegeben: 500 })
    await u.verkauf('v3', [{ name: 'Lahmacun', anzahl: 1 }], { zahlart: 'helfer' })

    const vorschau = await u.anfrage('GET', '/api/kassentag/aktuell/bericht')
    expect(vorschau.status).toBe(200)
    expect(vorschau.json).toMatchObject({
      kassentagId: id,
      barEinnahmenChfRappen: 1100,
      twintUmsatzRappen: 500,
      helferessenStueck: 1,
      helferessenEntgangenRappen: 500,
      sollChfRappen: 21100,
      istChfRappen: null,
      differenzChfRappen: null,
      anzahlBelege: 3,
      erstelltAm: '2026-09-19T14:32:05'
    })

    const abschluss = await u.anfrage('POST', `/api/kassentag/${id}/abschluss`, {
      istChfRappen: 21000,
      istEurCent: 0,
      bemerkung: 'ein Franken fehlt'
    })
    expect(abschluss.status).toBe(200)
    expect(abschluss.json).toMatchObject({
      sollChfRappen: 21100,
      istChfRappen: 21000,
      differenzChfRappen: -100,
      differenzEurCent: 0
    })
    const auftrag = u.repos.druckauftrag.finde(String(abschluss.json['druckauftragId']))
    expect(auftrag?.typ).toBe('abschluss')
    expect(auftrag?.kassentagId).toBe(id)
    expect(u.abschluesse).toHaveLength(1)
    expect(u.abschluesse[0]?.differenzChfRappen).toBe(-100)

    const tag = u.repos.kassentag.finde(id)
    expect(tag?.abgeschlossenAm).toBe('2026-09-19T14:32:05')
    expect(tag?.differenzChfRappen).toBe(-100)
    expect(tag?.bemerkung).toBe('ein Franken fehlt')

    const nochmal = await u.anfrage('POST', `/api/kassentag/${id}/abschluss`, {
      istChfRappen: 21000,
      istEurCent: 0,
      bemerkung: null
    })
    expect(nochmal.status).toBe(409)
    expect(nochmal.json['fehler']).toBe('bereits_abgeschlossen')

    const nachher = await u.anfrage('GET', '/api/kassentag/aktuell')
    expect(nachher.json).toMatchObject({
      kassentag: null,
      vortagOffen: null,
      vorschlagStartgeldChfRappen: 21000
    })
    expect((nachher.json['letzterAbgeschlossener'] as Record<string, unknown>)['id']).toBe(id)
    const keinTag = await u.anfrage('GET', '/api/kassentag/aktuell/bericht')
    expect(keinTag.status).toBe(409)
    const fehlt = await u.anfrage('POST', '/api/kassentag/gibtsnicht/abschluss', {
      istChfRappen: 0,
      istEurCent: 0,
      bemerkung: null
    })
    expect(fehlt.status).toBe(404)
  })

  it('GET /api/kassentag/:id liefert den Kassentag (pdfPfad null), 404 bei unbekannter ID', async () => {
    u = erstelleTestUmgebung()
    const id = await u.kassentagStarten(20000)
    const a = await u.anfrage('GET', `/api/kassentag/${id}`)
    expect(a.status).toBe(200)
    expect(a.json).toMatchObject({ id, kassier: 'EB', abgeschlossenAm: null, pdfPfad: null })
    const fehlt = await u.anfrage('GET', '/api/kassentag/gibtsnicht')
    expect(fehlt.status).toBe(404)
    expect(fehlt.json['fehler']).toBe('kassentag_nicht_gefunden')
    // "aktuell" bleibt die Sammelroute, nicht eine ID
    const aktuell = await u.anfrage('GET', '/api/kassentag/aktuell')
    expect(aktuell.status).toBe(200)
    expect((aktuell.json['kassentag'] as Record<string, unknown>)['id']).toBe(id)
  })

  it('Abschluss speichert den pdfPfad aus dem (asynchronen) nachAbschluss-Callback, ohne darauf zu warten', async () => {
    const halter: { freigeben: (() => void) | null } = { freigeben: null }
    u = erstelleTestUmgebung({
      deps: {
        nachAbschluss: () =>
          new Promise<{ pdfPfad: string }>((erfuellt) => {
            halter.freigeben = (): void => erfuellt({ pdfPfad: 'C:/x/a.pdf' })
          })
      }
    })
    const id = await u.kassentagStarten(20000)
    const abschluss = await u.anfrage('POST', `/api/kassentag/${id}/abschluss`, {
      istChfRappen: 20000,
      istEurCent: 0,
      bemerkung: null
    })
    // Antwort kommt, obwohl der Callback noch laeuft
    expect(abschluss.status).toBe(200)
    expect(u.repos.kassentag.finde(id)?.pdfPfad).toBeNull()
    expect(halter.freigeben).not.toBeNull()
    halter.freigeben?.()
    await new Promise((r) => setTimeout(r, 20))
    expect(u.repos.kassentag.finde(id)?.pdfPfad).toBe('C:/x/a.pdf')
    const einzeln = await u.anfrage('GET', `/api/kassentag/${id}`)
    expect(einzeln.json['pdfPfad']).toBe('C:/x/a.pdf')
    const aktuell = await u.anfrage('GET', '/api/kassentag/aktuell')
    expect((aktuell.json['letzterAbgeschlossener'] as Record<string, unknown>)['pdfPfad']).toBe('C:/x/a.pdf')
  })

  it('Abschluss: Callback mit Fehler laesst pdfPfad null, loggt und die Antwort bleibt 200', async () => {
    const meldungen: string[] = []
    u = erstelleTestUmgebung({
      deps: {
        nachAbschluss: () => Promise.reject(new Error('PDF kaputt')),
        log: (m) => {
          meldungen.push(m)
        }
      }
    })
    const id = await u.kassentagStarten(20000)
    const abschluss = await u.anfrage('POST', `/api/kassentag/${id}/abschluss`, {
      istChfRappen: 20000,
      istEurCent: 0,
      bemerkung: null
    })
    expect(abschluss.status).toBe(200)
    await new Promise((r) => setTimeout(r, 20))
    expect(u.repos.kassentag.finde(id)?.pdfPfad).toBeNull()
    expect(meldungen.some((m) => m.includes('PDF kaputt'))).toBe(true)
  })

  it('POST /api/archiv/oeffnen: 200 mit Callback, 501 nicht_verfuegbar ohne, 500 bei Fehler', async () => {
    let aufrufe = 0
    u = erstelleTestUmgebung({
      deps: {
        oeffneArchiv: () => {
          aufrufe += 1
        }
      }
    })
    const ok = await u.anfrage('POST', '/api/archiv/oeffnen', {})
    expect(ok.status).toBe(200)
    expect(ok.json).toEqual({ ok: true })
    expect(aufrufe).toBe(1)
    u.aufraeumen()

    u = erstelleTestUmgebung()
    const ohne = await u.anfrage('POST', '/api/archiv/oeffnen', {})
    expect(ohne.status).toBe(501)
    expect(ohne.json).toEqual({ fehler: 'nicht_verfuegbar', meldung: 'Nur in der Kassen-App möglich.' })
    u.aufraeumen()

    u = erstelleTestUmgebung({
      deps: { oeffneArchiv: () => Promise.reject(new Error('Explorer fehlt')) }
    })
    const kaputt = await u.anfrage('POST', '/api/archiv/oeffnen', {})
    expect(kaputt.status).toBe(500)
    expect(kaputt.json['fehler']).toBe('archiv_oeffnen_fehlgeschlagen')
    expect(String(kaputt.json['meldung'])).toContain('Explorer fehlt')
  })

  it('Abschluss-Bon nachdrucken: 409 vor dem Abschluss, danach Auftrag typ abschluss mit NACHDRUCK', async () => {
    u = erstelleTestUmgebung()
    const id = await u.kassentagStarten(20000)
    await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }])

    const zuFrueh = await u.anfrage('POST', `/api/kassentag/${id}/abschluss/nachdruck`, {})
    expect(zuFrueh.status).toBe(409)
    expect(zuFrueh.json['fehler']).toBe('nicht_abgeschlossen')

    await u.anfrage('POST', `/api/kassentag/${id}/abschluss`, {
      istChfRappen: 21100,
      istEurCent: 0,
      bemerkung: null
    })
    u.uhr.setze('2026-09-20T09:00:00')
    const anstoesseVorher = u.druckAnstoesse
    const nachdruck = await u.anfrage('POST', `/api/kassentag/${id}/abschluss/nachdruck`, {})
    expect(nachdruck.status).toBe(200)
    const auftrag = u.repos.druckauftrag.finde(String(nachdruck.json['druckauftragId']))
    expect(auftrag?.typ).toBe('abschluss')
    expect(auftrag?.kassentagId).toBe(id)
    expect(auftrag?.status).toBe('queued')
    expect(u.druckAnstoesse).toBe(anstoesseVorher + 1)
    const bytes = readFileSync(join(u.bytesOrdner, String(auftrag?.bytesPfad))).toString('latin1')
    expect(bytes).toContain('NACHDRUCK')
    expect(bytes).toContain('KASSENABSCHLUSS')
    // Zeitstempel des Bons = Abschlusszeit, nicht Nachdruckzeit
    expect(bytes).toContain('Erstellt: Sa 19.09.2026  14:32')
    // Ein Nachdruck des Abschlusses erzeugt keinen zweiten PDF-/Backup-Lauf
    expect(u.abschluesse).toHaveLength(1)

    const fehlt = await u.anfrage('POST', '/api/kassentag/gibtsnicht/abschluss/nachdruck', {})
    expect(fehlt.status).toBe(404)
  })

  it('GET /api/druck/:id liefert den Auftrag, unbekannt 404', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten()
    const v = await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }])
    const auftragId = String(v.json['druckauftragId'])
    const a = await u.anfrage('GET', `/api/druck/${auftragId}`)
    expect(a.status).toBe(200)
    expect(a.json).toMatchObject({ id: auftragId, typ: 'beleg', status: 'queued', verkaufId: 'v1' })
    u.repos.druckauftrag.markiere(auftragId, 'failed', { fehler: 'USB gezogen' })
    const b = await u.anfrage('GET', `/api/druck/${auftragId}`)
    expect(b.json).toMatchObject({ status: 'failed', fehler: 'USB gezogen' })
    const fehlt = await u.anfrage('GET', '/api/druck/gibtsnicht')
    expect(fehlt.status).toBe(404)
    expect(fehlt.json['fehler']).toBe('druckauftrag_nicht_gefunden')
  })

  it('Kontrollfall Bar-EUR storniert: Soll CHF = Startgeld − 6.00 − 12.00, Soll EUR = +20', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten(10000)
    await u.verkauf('v1', [{ name: 'Döner Kebap', anzahl: 1 }], {
      zahlart: 'bar_eur',
      gegeben: 2000
    })
    await u.anfrage('POST', '/api/verkauf/v1/storno', { grund: 'tippfehler' })
    const b = await u.anfrage('GET', '/api/kassentag/aktuell/bericht')
    expect(b.json['sollChfRappen']).toBe(10000 - 600 - 1200)
    expect(b.json['sollEurCent']).toBe(2000)
    expect(b.json['anzahlBelege']).toBe(0)
  })
})

describe('PIN, Produkte, Einstellungen', () => {
  it('PIN-geschützte Routen: fehlend/falsch 403, richtig ok; /api/pin/pruefen', async () => {
    u = erstelleTestUmgebung()
    const body = { name: 'Testprodukt', preisRappen: 450, gruppe: 'kasse' }
    expect((await u.anfrage('POST', '/api/produkte', body)).status).toBe(403)
    const falsch = await u.anfrage('POST', '/api/produkte', body, '0000')
    expect(falsch.status).toBe(403)
    expect(falsch.json).toEqual({ fehler: 'pin_falsch', meldung: 'PIN falsch.' })
    const ok = await u.anfrage('POST', '/api/produkte', body, TEST_PIN)
    expect(ok.status).toBe(201)
    expect(ok.json).toMatchObject({
      name: 'Testprodukt',
      preisRappen: 450,
      gruppe: 'kasse',
      aktiv: true,
      ausverkauft: false,
      reihenfolge: 16
    })

    expect((await u.anfrage('POST', '/api/pin/pruefen', { pin: TEST_PIN })).json).toEqual({
      ok: true
    })
    expect((await u.anfrage('POST', '/api/pin/pruefen', { pin: '0000' })).json).toEqual({
      ok: false
    })
    expect((await u.anfrage('POST', '/api/pin/pruefen', {})).json).toEqual({ ok: false })
  })

  it('Produkte: aktive Liste, alle=1, PUT, Preis offen -> inaktiv, Preisregel 5 Rappen', async () => {
    u = erstelleTestUmgebung()
    const aktive = await u.anfrage('GET', '/api/produkte')
    expect(aktive.liste).toHaveLength(15)
    const id = u.produktId('Mocktail')
    const p = await u.anfrage('PUT', `/api/produkte/${id}`, { aktiv: false }, TEST_PIN)
    expect(p.status).toBe(200)
    expect(p.json['aktiv']).toBe(false)
    expect((await u.anfrage('GET', '/api/produkte')).liste).toHaveLength(14)
    expect((await u.anfrage('GET', '/api/produkte?alle=1')).liste).toHaveLength(15)

    const offen = await u.anfrage(
      'PUT',
      `/api/produkte/${id}`,
      { preisRappen: null, aktiv: true },
      TEST_PIN
    )
    expect(offen.json['preisRappen']).toBeNull()
    expect(offen.json['aktiv']).toBe(false)

    const krumm = await u.anfrage('PUT', `/api/produkte/${id}`, { preisRappen: 501 }, TEST_PIN)
    expect(krumm.status).toBe(400)
    const lang = await u.anfrage(
      'POST',
      '/api/produkte',
      { name: 'x'.repeat(25), preisRappen: 100, gruppe: 'kasse' },
      TEST_PIN
    )
    expect(lang.status).toBe(400)
    const fehlt = await u.anfrage('PUT', '/api/produkte/gibtsnicht', { name: 'x' }, TEST_PIN)
    expect(fehlt.status).toBe(404)
  })

  describe('Reihenfolge mit Einfüge-Semantik', () => {
    /** Namen aller Produkte in Reihenfolge-Sortierung und Prüfung, dass 1..N ohne Lücken/Doppel. */
    function reihenfolge(): { namen: string[]; nummern: number[] } {
      const alle = u.repos.produkt.alle(false)
      return { namen: alle.map((p) => p.name), nummern: alle.map((p) => p.reihenfolge) }
    }
    function eins_bis(n: number): number[] {
      return Array.from({ length: n }, (_, i) => i + 1)
    }

    it('neues Produkt auf 1: Winti Burger wird 2, alle anderen rutschen um eins', async () => {
      u = erstelleTestUmgebung()
      const vorher = reihenfolge()
      expect(vorher.namen[0]).toBe('Winti Burger')
      expect(vorher.nummern).toEqual(eins_bis(15))

      const a = await u.anfrage(
        'POST',
        '/api/produkte',
        { name: 'Neu ganz oben', preisRappen: 300, gruppe: 'kasse', reihenfolge: 1 },
        TEST_PIN
      )
      expect(a.status).toBe(201)
      expect(a.json['reihenfolge']).toBe(1)

      const nachher = reihenfolge()
      expect(nachher.namen).toEqual(['Neu ganz oben', ...vorher.namen])
      expect(nachher.nummern).toEqual(eins_bis(16))
      expect(u.repos.produkt.finde(u.produktId('Winti Burger'))?.reihenfolge).toBe(2)
    })

    it('Ändern von 5 auf 2: die bisherigen 2..4 werden 3..5, keine Lücken', async () => {
      u = erstelleTestUmgebung()
      const vorher = reihenfolge()
      const fuenftes = vorher.namen[4]
      expect(fuenftes).toBe('Döner Kebap')

      const a = await u.anfrage(
        'PUT',
        `/api/produkte/${u.produktId('Döner Kebap')}`,
        { reihenfolge: 2 },
        TEST_PIN
      )
      expect(a.status).toBe(200)
      expect(a.json['reihenfolge']).toBe(2)

      const nachher = reihenfolge()
      expect(nachher.namen).toEqual([
        vorher.namen[0],
        'Döner Kebap',
        vorher.namen[1],
        vorher.namen[2],
        vorher.namen[3],
        ...vorher.namen.slice(5)
      ])
      expect(nachher.nummern).toEqual(eins_bis(15))
    })

    it('Ändern nach unten (2 auf 5) landet genau auf 5; ohne reihenfolge im Body bleibt die Position', async () => {
      u = erstelleTestUmgebung()
      const vorher = reihenfolge()
      const zweites = vorher.namen[1]
      const a = await u.anfrage(
        'PUT',
        `/api/produkte/${u.produktId(zweites ?? '')}`,
        { reihenfolge: 5 },
        TEST_PIN
      )
      expect(a.json['reihenfolge']).toBe(5)
      const nachher = reihenfolge()
      expect(nachher.namen[4]).toBe(zweites)
      expect(nachher.namen.slice(1, 4)).toEqual(vorher.namen.slice(2, 5))
      expect(nachher.nummern).toEqual(eins_bis(15))

      const b = await u.anfrage(
        'PUT',
        `/api/produkte/${u.produktId(zweites ?? '')}`,
        { name: 'Umbenannt' },
        TEST_PIN
      )
      expect(b.json['reihenfolge']).toBe(5)
      expect(reihenfolge().nummern).toEqual(eins_bis(15))
    })

    it('ohne reihenfolge beim Anlegen: ans Ende (max + 1); zu grosse Werte werden auf N begrenzt, 0 ist ungültig', async () => {
      u = erstelleTestUmgebung()
      const ende = await u.anfrage(
        'POST',
        '/api/produkte',
        { name: 'Am Ende', preisRappen: 100, gruppe: 'kasse' },
        TEST_PIN
      )
      expect(ende.json['reihenfolge']).toBe(16)
      const weit = await u.anfrage(
        'POST',
        '/api/produkte',
        { name: 'Weit hinten', preisRappen: 100, gruppe: 'kasse', reihenfolge: 999 },
        TEST_PIN
      )
      expect(weit.json['reihenfolge']).toBe(17)
      expect(reihenfolge().nummern).toEqual(eins_bis(17))
      const null_ = await u.anfrage(
        'POST',
        '/api/produkte',
        { name: 'Null', preisRappen: 100, gruppe: 'kasse', reihenfolge: 0 },
        TEST_PIN
      )
      expect(null_.status).toBe(400)
    })

    it('Repo: normalisiereReihenfolge räumt Doppel und Lücken aus Altdaten auf (reihenfolge, dann erstellt_am)', () => {
      u = erstelleTestUmgebung({ ohneSeed: true })
      u.db.exec(
        'INSERT INTO produkt (id, name, preis_rappen, gruppe, aktiv, ausverkauft, reihenfolge, erstellt_am) VALUES ' +
          "('b', 'B', 100, 'kasse', 1, 0, 3, '2026-09-01T10:00:00'), " +
          "('a', 'A', 100, 'kasse', 0, 0, 3, '2026-09-01T09:00:00'), " +
          "('c', 'C', 100, 'kasse', 1, 0, 9, '2026-09-01T11:00:00')"
      )
      u.repos.produkt.normalisiereReihenfolge()
      const alle = u.repos.produkt.alle(false)
      expect(alle.map((p) => [p.name, p.reihenfolge])).toEqual([
        ['A', 1],
        ['B', 2],
        ['C', 3]
      ])
      expect(u.repos.produkt.setzeReihenfolge('gibtsnicht', 1)).toBeNull()
    })
  })

  describe('DELETE /api/produkte/:id', () => {
    it('ohne Verkäufe: 200 und weg, Reihenfolge wieder 1..N', async () => {
      u = erstelleTestUmgebung()
      const id = u.produktId('Lahmacun')
      expect(u.repos.produkt.finde(id)?.reihenfolge).toBe(3)
      const a = await u.anfrage('DELETE', `/api/produkte/${id}`, undefined, TEST_PIN)
      expect(a.status).toBe(200)
      expect(a.json).toEqual({ ok: true })
      expect(u.repos.produkt.finde(id)).toBeNull()
      expect((await u.anfrage('GET', '/api/produkte?alle=1')).liste).toHaveLength(14)
      const alle = u.repos.produkt.alle(false)
      expect(alle.map((p) => p.reihenfolge)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1))
      expect(alle[2]?.name).toBe('Gözleme')
    })

    it('mit Verkauf: 409 produkt_hat_verkaeufe und das Produkt bleibt', async () => {
      u = erstelleTestUmgebung()
      await u.kassentagStarten()
      expect((await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }])).status).toBe(201)
      const id = u.produktId('Winti Burger')
      const a = await u.anfrage('DELETE', `/api/produkte/${id}`, undefined, TEST_PIN)
      expect(a.status).toBe(409)
      expect(a.json).toEqual({
        fehler: 'produkt_hat_verkaeufe',
        meldung: 'Produkt wurde bereits verkauft und kann nur deaktiviert werden.'
      })
      expect(u.repos.produkt.finde(id)).not.toBeNull()
      expect(u.repos.produkt.anzahlVerkaufsPositionen(id)).toBe(1)
    })

    it('ohne PIN 403, unbekannte id 404', async () => {
      u = erstelleTestUmgebung()
      const id = u.produktId('Lahmacun')
      const ohne = await u.anfrage('DELETE', `/api/produkte/${id}`)
      expect(ohne.status).toBe(403)
      expect(ohne.json).toEqual({ fehler: 'pin_falsch', meldung: 'PIN falsch.' })
      expect(u.repos.produkt.finde(id)).not.toBeNull()
      const fehlt = await u.anfrage('DELETE', '/api/produkte/gibtsnicht', undefined, TEST_PIN)
      expect(fehlt.status).toBe(404)
      expect(fehlt.json['fehler']).toBe('produkt_nicht_gefunden')
    })
  })

  it('Einstellungen: GET ohne PIN-Felder, PUT mit PIN und neuer PIN', async () => {
    u = erstelleTestUmgebung()
    const g = await u.anfrage('GET', '/api/einstellungen')
    expect(g.json).toEqual({
      eurKursX10000: 9000,
      druckerName: 'TM-T20II',
      kassenPraefix: 'K1',
      belegzaehler: 0,
      backupPfadUsb: null,
      port: 47100
    })
    expect(Object.keys(g.json).some((k) => k.toLowerCase().includes('pin'))).toBe(false)

    expect((await u.anfrage('PUT', '/api/einstellungen', { eurKursX10000: 9300 })).status).toBe(403)
    const p = await u.anfrage(
      'PUT',
      '/api/einstellungen',
      { eurKursX10000: 9300, neuePin: '5678', belegzaehler: 99, backupPfadUsb: 'E:\\kasse' },
      TEST_PIN
    )
    expect(p.status).toBe(200)
    expect(p.json).toMatchObject({
      eurKursX10000: 9300,
      belegzaehler: 0,
      backupPfadUsb: 'E:\\kasse'
    })
    expect((await u.anfrage('POST', '/api/pin/pruefen', { pin: TEST_PIN })).json).toEqual({
      ok: false
    })
    expect((await u.anfrage('POST', '/api/pin/pruefen', { pin: '5678' })).json).toEqual({
      ok: true
    })
    const kurz = await u.anfrage('PUT', '/api/einstellungen', { neuePin: '12' }, '5678')
    expect(kurz.status).toBe(400)
    const praefix = await u.anfrage('PUT', '/api/einstellungen', { kassenPraefix: 'K-2' }, '5678')
    expect(praefix.status).toBe(400)
  })

  it('Testdaten löschen: Backup zuerst, Bewegungsdaten weg, Produkte und Einstellungen bleiben', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten()
    await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }])
    await u.anfrage('POST', '/api/verkauf/v1/storno', { grund: 'tippfehler' })
    await u.anfrage('PUT', '/api/warenkorb-entwurf', {
      zeilen: [{ produktId: 'x', name: 'x', preisRappen: 1, gruppe: 'kasse', anzahl: 1 }]
    })
    await u.anfrage('PUT', '/api/einstellungen', { eurKursX10000: 9300 }, TEST_PIN)

    expect((await u.anfrage('POST', '/api/testdaten-loeschen')).status).toBe(403)
    const l = await u.anfrage('POST', '/api/testdaten-loeschen', undefined, TEST_PIN)
    expect(l.status).toBe(200)
    expect(l.json).toEqual({ ok: true, backupPfad: 'C:/Kasse/backup/test.sqlite' })
    expect(u.backups).toBe(1)

    for (const t of [
      'verkauf',
      'position',
      'zahlung',
      'storno',
      'druckauftrag',
      'kassentag',
      'warenkorb_entwurf'
    ]) {
      expect(u.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()?.['n'], t).toBe(0)
    }
    expect(u.repos.produkt.anzahl()).toBe(15)
    const e = await u.anfrage('GET', '/api/einstellungen')
    expect(e.json).toMatchObject({ eurKursX10000: 9300, belegzaehler: 0 })
    expect((await u.anfrage('POST', '/api/pin/pruefen', { pin: TEST_PIN })).json).toEqual({
      ok: true
    })

    await u.kassentagStarten()
    const neu = await u.verkauf('v9', [{ name: 'Kaffee', anzahl: 1 }])
    expect(verkaufVon(neu)['belegnr']).toBe('K1-0001')
  })

  it('Testdruck legt einen Auftrag typ test an', async () => {
    u = erstelleTestUmgebung()
    const t = await u.anfrage('POST', '/api/druck/test')
    expect(t.status).toBe(200)
    expect(u.repos.druckauftrag.finde(String(t.json['druckauftragId']))?.typ).toBe('test')
    const s = await u.anfrage('GET', '/api/status')
    expect((s.json['druck'] as Record<string, unknown>)['offeneAuftraege']).toBe(1)
  })

  it('Warenkorb-Entwurf: PUT/GET, ungültig 400', async () => {
    u = erstelleTestUmgebung()
    const w = {
      zeilen: [{ produktId: 'p', name: 'Kaffee', preisRappen: 250, gruppe: 'kasse', anzahl: 2 }]
    }
    expect((await u.anfrage('PUT', '/api/warenkorb-entwurf', w)).json).toEqual(w)
    expect((await u.anfrage('GET', '/api/warenkorb-entwurf')).json).toEqual(w)
    expect((await u.anfrage('PUT', '/api/warenkorb-entwurf', { zeilen: 'x' })).status).toBe(400)
  })
})

describe('Statisches Renderer-Build', () => {
  it('ohne Renderer-Ordner 404, mit Ordner index.html-Fallback und Dateien', async () => {
    u = erstelleTestUmgebung()
    const ohne = await u.anfrage('GET', '/')
    expect(ohne.status).toBe(404)
    expect(ohne.json['fehler']).toBe('kein_renderer')
    u.aufraeumen()

    const ordner = mkdtempSync(join(tmpdir(), 'kasse-renderer-'))
    temp.push(ordner)
    writeFileSync(join(ordner, 'index.html'), '<!doctype html><title>Kasse</title>')
    writeFileSync(join(ordner, 'app.js'), 'console.log(1)')
    u = erstelleTestUmgebung({ deps: { rendererOrdner: ordner } })

    const wurzel = await u.app.request('/')
    expect(wurzel.status).toBe(200)
    expect(wurzel.headers.get('content-type')).toContain('text/html')
    expect(await wurzel.text()).toContain('<title>Kasse</title>')

    const js = await u.app.request('/app.js')
    expect(js.headers.get('content-type')).toContain('javascript')
    expect(await js.text()).toBe('console.log(1)')

    const fallback = await u.app.request('/verkauf/irgendwas')
    expect(fallback.status).toBe(200)
    expect(await fallback.text()).toContain('<title>Kasse</title>')

    const ausbruch = await u.app.request('/..%2F..%2Fpackage.json')
    expect(ausbruch.status).toBe(200)
    expect(await ausbruch.text()).toContain('<title>Kasse</title>')

    const api = await u.anfrage('GET', '/api/nix')
    expect(api.status).toBe(404)
  })
})
