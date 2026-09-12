/**
 * Separate Spenden (nachträglich, ohne Bon): POST /api/spende, GET /api/spende/letzte,
 * POST /api/spende/:id/storno, Spende in GET /api/verkauf/letzte und im Abschluss.
 * Fachlicher Fall (Auftraggeber, 12.9.2026): Total 98, Kunde gibt 100, Beleg ist gespeichert und
 * gedruckt, Schublade offen, erst dann sagt der Kunde "passt schon" -> Rückgeld als Spende nachtragen.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { erstelleTestUmgebung, TEST_PIN, type TestUmgebung } from './testumgebung'

let u: TestUmgebung

afterEach(() => {
  u.aufraeumen()
})

type Json = Record<string, unknown>

function spendeVon(a: { json: Json }): Json {
  return a.json['spende'] as Json
}

/** Rückgeld-Spende zu einem Beleg. */
function rueckgeldSpende(id: string, verkaufId: string, betrag: number): Json {
  return { id, typ: 'bar_chf', betrag, verkaufId }
}

/** Freie Spende ohne Kauf. */
function freieSpende(id: string, typ: string, betrag: number): Json {
  return { id, typ, betrag, verkaufId: null }
}

async function bericht(): Promise<Json> {
  const b = await u.anfrage('GET', '/api/kassentag/aktuell/bericht')
  expect(b.status).toBe(200)
  return b.json
}

describe('POST /api/spende', () => {
  it('Rückgeld als Spende zu einem Beleg: 201, Abschluss-Vorschau mit Bar-Spende 2.00 und Soll CHF + 2.00', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten(20000)
    // Winti Burger 11.00, Kunde gibt 13.00 -> Rückgeld 2.00, Beleg ist gespeichert und gedruckt
    const v = await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }], { gegeben: 1300 })
    expect(v.status).toBe(201)
    expect((v.json['zahlung'] as Json)['rueckgeldChfRappen']).toBe(200)
    const vorher = await bericht()
    expect(vorher['sollChfRappen']).toBe(21100)
    const druckauftraegeVorher = u.repos.druckauftrag.anzahlOffen()

    const s = await u.anfrage('POST', '/api/spende', rueckgeldSpende('s1', 'v1', 200))
    expect(s.status).toBe(201)
    expect(s.json['bereitsVorhanden']).toBe(false)
    expect(spendeVon(s)).toEqual({
      id: 's1',
      kassentagId: u.repos.kassentag.offener()?.id,
      verkaufId: 'v1',
      zeit: '2026-09-19T14:32:05',
      typ: 'bar_chf',
      betrag: 200,
      kursX10000: null,
      betragChfRappen: 200,
      storniertAm: null
    })
    // Spenden drucken keinen Bon und öffnen keine Schublade
    expect(u.repos.druckauftrag.anzahlOffen()).toBe(druckauftraegeVorher)

    const b = await bericht()
    expect(b['barSpendeChfRappen']).toBe(200)
    expect(b['sollChfRappen']).toBe(21100 + 200)
    expect(b['spendenSeparatAnzahl']).toBe(1)
    expect(b['spendenSeparatChfRappen']).toBe(200)
    expect(b['anzahlBelege']).toBe(1)

    // zweite Spende zum selben Beleg -> 409
    const zweite = await u.anfrage('POST', '/api/spende', rueckgeldSpende('s2', 'v1', 200))
    expect(zweite.status).toBe(409)
    expect(zweite.json['fehler']).toBe('bereits_gespendet')
    expect(u.repos.spende.finde('s2')).toBeNull()

    // GET /api/verkauf/letzte zeigt die verknüpfte Spende
    const l = await u.anfrage('GET', '/api/verkauf/letzte')
    expect(l.liste).toHaveLength(1)
    expect(((l.liste[0] as Json)['spende'] as Json)['id']).toBe('s1')
  })

  it('doppelter POST mit gleicher id = eine Spende, 200 bereitsVorhanden', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten()
    await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }], { gegeben: 1300 })
    const erste = await u.anfrage('POST', '/api/spende', rueckgeldSpende('s1', 'v1', 200))
    expect(erste.status).toBe(201)
    const zweite = await u.anfrage('POST', '/api/spende', rueckgeldSpende('s1', 'v1', 200))
    expect(zweite.status).toBe(200)
    expect(zweite.json['bereitsVorhanden']).toBe(true)
    expect(spendeVon(zweite)).toEqual(spendeVon(erste))
    expect(u.db.prepare('SELECT COUNT(*) AS n FROM spende').get()?.['n']).toBe(1)
    expect((await bericht())['barSpendeChfRappen']).toBe(200)
    // Idempotenz gilt auch ohne offenen Kassentag (Wiederholung nach Zeitüberschreitung)
    const tag = u.repos.kassentag.offener()
    await u.anfrage('POST', `/api/kassentag/${tag?.id ?? ''}/abschluss`, {
      istChfRappen: 21300,
      istEurCent: 0,
      bemerkung: null
    })
    const dritte = await u.anfrage('POST', '/api/spende', rueckgeldSpende('s1', 'v1', 200))
    expect(dritte.status).toBe(200)
    expect(dritte.json['bereitsVorhanden']).toBe(true)
  })

  it('freie Twint-Spende 5.00 -> Twint-Spende 5.00, Soll CHF unverändert', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten(20000)
    const s = await u.anfrage('POST', '/api/spende', freieSpende('s1', 'twint', 500))
    expect(s.status).toBe(201)
    expect(spendeVon(s)).toMatchObject({
      verkaufId: null,
      typ: 'twint',
      betrag: 500,
      betragChfRappen: 500,
      kursX10000: null
    })
    const b = await bericht()
    expect(b['twintSpendeRappen']).toBe(500)
    expect(b['barSpendeChfRappen']).toBe(0)
    expect(b['sollChfRappen']).toBe(20000)
    expect(b['spendenSeparatAnzahl']).toBe(1)
    expect(b['spendenSeparatChfRappen']).toBe(500)
  })

  it('freie EUR-Spende 5.00 EUR bei Kurs 0.90 -> Gegenwert 4.50, Soll EUR + 5.00, Soll CHF unverändert', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten(20000)
    const s = await u.anfrage('POST', '/api/spende', freieSpende('s1', 'bar_eur', 500))
    expect(s.status).toBe(201)
    expect(spendeVon(s)).toMatchObject({
      typ: 'bar_eur',
      betrag: 500,
      kursX10000: 9000,
      betragChfRappen: 450
    })
    const b = await bericht()
    expect(b['barSpendeEurChfRappen']).toBe(450)
    expect(b['barEinnahmenEurCent']).toBe(0)
    expect(b['sollEurCent']).toBe(500)
    expect(b['sollChfRappen']).toBe(20000)
    expect(b['spendenSeparatChfRappen']).toBe(450)

    // 1.23 EUR bei 0.90 -> 110 Rappen (auf 5 Rappen abgerundet)
    const klein = await u.anfrage('POST', '/api/spende', freieSpende('s2', 'bar_eur', 123))
    expect(spendeVon(klein)['betragChfRappen']).toBe(110)
    expect((await bericht())['sollEurCent']).toBe(623)
  })

  it('Fehlerfälle: kein Kassentag, Betrag <= 0, unbekannter/stornierter Beleg, kein Rückgeld, falscher Betrag', async () => {
    u = erstelleTestUmgebung()
    const ohneTag = await u.anfrage('POST', '/api/spende', freieSpende('s0', 'bar_chf', 100))
    expect(ohneTag.status).toBe(409)
    expect(ohneTag.json['fehler']).toBe('kein_kassentag')

    await u.kassentagStarten()
    for (const betrag of [0, -5, 1.5]) {
      const a = await u.anfrage('POST', '/api/spende', freieSpende('s0', 'bar_chf', betrag))
      expect(a.status, String(betrag)).toBe(400)
      expect(a.json['fehler']).toBe('ungueltige_eingabe')
    }
    const typ = await u.anfrage('POST', '/api/spende', freieSpende('s0', 'helfer', 100))
    expect(typ.status).toBe(400)
    const ohneId = await u.anfrage('POST', '/api/spende', {
      typ: 'bar_chf',
      betrag: 100,
      verkaufId: null
    })
    expect(ohneId.status).toBe(400)

    const fehlt = await u.anfrage('POST', '/api/spende', rueckgeldSpende('s0', 'gibtsnicht', 200))
    expect(fehlt.status).toBe(404)
    expect(fehlt.json['fehler']).toBe('verkauf_nicht_gefunden')

    // passend bezahlt: kein Rückgeld
    await u.verkauf('v1', [{ name: 'Kaffee', anzahl: 1 }])
    const passend = await u.anfrage('POST', '/api/spende', rueckgeldSpende('s0', 'v1', 100))
    expect(passend.status).toBe(409)
    expect(passend.json['fehler']).toBe('kein_rueckgeld')

    // Twint-Beleg hat kein Rückgeld
    await u.verkauf('v2', [{ name: 'Kaffee', anzahl: 1 }], { zahlart: 'twint', gegeben: 250 })
    const twint = await u.anfrage('POST', '/api/spende', rueckgeldSpende('s0', 'v2', 100))
    expect(twint.status).toBe(409)
    expect(twint.json['fehler']).toBe('kein_rueckgeld')

    // Betrag muss dem Rückgeld entsprechen und Bar CHF sein
    await u.verkauf('v3', [{ name: 'Winti Burger', anzahl: 1 }], { gegeben: 2000 })
    const falsch = await u.anfrage('POST', '/api/spende', rueckgeldSpende('s0', 'v3', 500))
    expect(falsch.status).toBe(409)
    expect(falsch.json['fehler']).toBe('betrag_ungleich_rueckgeld')
    expect(String(falsch.json['meldung'])).toContain('9.00')
    const falscherTyp = await u.anfrage('POST', '/api/spende', {
      id: 's0',
      typ: 'twint',
      betrag: 900,
      verkaufId: 'v3'
    })
    expect(falscherTyp.status).toBe(409)
    expect(falscherTyp.json['fehler']).toBe('betrag_ungleich_rueckgeld')

    // stornierter Beleg
    await u.anfrage('POST', '/api/verkauf/v3/storno', { grund: 'tippfehler' })
    const storniert = await u.anfrage('POST', '/api/spende', rueckgeldSpende('s0', 'v3', 900))
    expect(storniert.status).toBe(409)
    expect(storniert.json['fehler']).toBe('verkauf_storniert')

    expect(u.db.prepare('SELECT COUNT(*) AS n FROM spende').get()?.['n']).toBe(0)
  })

  it('offener Vortag sperrt neue Spenden mit 409 vortag_offen', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten()
    u.uhr.setze('2026-09-20T09:00:00')
    const a = await u.anfrage('POST', '/api/spende', freieSpende('s1', 'bar_chf', 100))
    expect(a.status).toBe(409)
    expect(a.json['fehler']).toBe('vortag_offen')
  })
})

describe('Storno von Spenden und GET /api/spende/letzte', () => {
  it('letzte Spende ohne PIN, ältere nur mit PIN, zweiter Storno 409, storniert zählt nicht mehr', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten(20000)
    await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }], { gegeben: 1300 })
    await u.anfrage('POST', '/api/spende', rueckgeldSpende('s1', 'v1', 200))
    u.uhr.setze('2026-09-19T14:40:00')
    await u.anfrage('POST', '/api/spende', freieSpende('s2', 'twint', 500))
    u.uhr.setze('2026-09-19T14:45:00')
    await u.anfrage('POST', '/api/spende', freieSpende('s3', 'bar_chf', 300))
    expect((await bericht())['sollChfRappen']).toBe(20000 + 1100 + 200 + 300)

    // s1 ist nicht die letzte -> PIN nötig
    const alt = await u.anfrage('POST', '/api/spende/s1/storno')
    expect(alt.status).toBe(403)
    expect(alt.json['fehler']).toBe('pin_falsch')
    expect(u.repos.spende.finde('s1')?.storniertAm).toBeNull()

    // s3 ist die letzte -> ohne PIN
    u.uhr.setze('2026-09-19T14:50:00')
    const letzte = await u.anfrage('POST', '/api/spende/s3/storno')
    expect(letzte.status).toBe(200)
    expect(letzte.json).toMatchObject({
      id: 's3',
      storniertAm: '2026-09-19T14:50:00',
      mitPin: false
    })
    expect((await bericht())['sollChfRappen']).toBe(20000 + 1100 + 200)

    const nochmal = await u.anfrage('POST', '/api/spende/s3/storno')
    expect(nochmal.status).toBe(409)
    expect(nochmal.json['fehler']).toBe('bereits_storniert')

    // s1 ist weiterhin nicht die letzte nicht stornierte (s2 ist neuer): falsche PIN 403, richtige 200
    const falschePin = await u.anfrage('POST', '/api/spende/s1/storno', undefined, '9999')
    expect(falschePin.status).toBe(403)
    const mitPin = await u.anfrage('POST', '/api/spende/s1/storno', undefined, TEST_PIN)
    expect(mitPin.status).toBe(200)
    expect(mitPin.json).toMatchObject({ id: 's1', mitPin: true })
    expect(mitPin.json['storniertAm']).not.toBeNull()

    // Abschluss-Vorschau: nur s2 (Twint 5.00) zählt noch
    const b = await bericht()
    expect(b['barSpendeChfRappen']).toBe(0)
    expect(b['twintSpendeRappen']).toBe(500)
    expect(b['sollChfRappen']).toBe(20000 + 1100)
    expect(b['spendenSeparatAnzahl']).toBe(1)
    expect(b['spendenSeparatChfRappen']).toBe(500)

    // Nach dem Storno hat der Beleg keine Spende mehr und darf erneut gespendet werden
    const l = await u.anfrage('GET', '/api/verkauf/letzte')
    expect((l.liste[0] as Json)['spende']).toBeNull()
    const erneut = await u.anfrage('POST', '/api/spende', rueckgeldSpende('s4', 'v1', 200))
    expect(erneut.status).toBe(201)

    // Liste: inkl. stornierte, neueste zuerst, mit Belegnummer des verknüpften Verkaufs
    const liste = await u.anfrage('GET', '/api/spende/letzte')
    expect(liste.status).toBe(200)
    expect(liste.liste.map((e) => (e as Json)['id'])).toEqual(['s4', 's3', 's2', 's1'])
    const eintraege = liste.liste as Json[]
    expect(eintraege[0]).toMatchObject({ belegnr: 'K1-0001', storniertAm: null, mitPin: false })
    expect(eintraege[1]).toMatchObject({ belegnr: null, mitPin: false })
    expect(eintraege[1]?.['storniertAm']).toBe('2026-09-19T14:50:00')
    expect(eintraege[2]).toMatchObject({ belegnr: null, typ: 'twint', storniertAm: null })
    expect(eintraege[3]).toMatchObject({ belegnr: 'K1-0001', mitPin: true })
    const begrenzt = await u.anfrage('GET', '/api/spende/letzte?limit=2')
    expect(begrenzt.liste).toHaveLength(2)

    // Nichts wurde gelöscht
    expect(u.db.prepare('SELECT COUNT(*) AS n FROM spende').get()?.['n']).toBe(4)
  })

  it('Storno: unbekannte Spende 404, nach dem Abschluss 409 kassentag_abgeschlossen', async () => {
    u = erstelleTestUmgebung()
    const tag = await u.kassentagStarten(20000)
    await u.anfrage('POST', '/api/spende', freieSpende('s1', 'bar_chf', 300))
    const fehlt = await u.anfrage('POST', '/api/spende/gibtsnicht/storno')
    expect(fehlt.status).toBe(404)
    expect(fehlt.json['fehler']).toBe('spende_nicht_gefunden')

    const abschluss = await u.anfrage('POST', `/api/kassentag/${tag}/abschluss`, {
      istChfRappen: 20300,
      istEurCent: 0,
      bemerkung: null
    })
    expect(abschluss.status).toBe(200)
    expect(abschluss.json['barSpendeChfRappen']).toBe(300)
    expect(abschluss.json['sollChfRappen']).toBe(20300)
    expect(abschluss.json['differenzChfRappen']).toBe(0)

    const zuSpaet = await u.anfrage('POST', '/api/spende/s1/storno', undefined, TEST_PIN)
    expect(zuSpaet.status).toBe(409)
    expect(zuSpaet.json['fehler']).toBe('kassentag_abgeschlossen')
    expect(u.repos.spende.finde('s1')?.storniertAm).toBeNull()

    // Nachdruck des Abschluss-Bons rechnet die Spende weiterhin ein
    u.uhr.setze('2026-09-20T09:00:00')
    const nachdruck = await u.anfrage('POST', `/api/kassentag/${tag}/abschluss/nachdruck`)
    expect(nachdruck.status).toBe(200)
  })

  it('Testdaten löschen leert auch die Spenden', async () => {
    u = erstelleTestUmgebung()
    await u.kassentagStarten()
    await u.verkauf('v1', [{ name: 'Winti Burger', anzahl: 1 }], { gegeben: 1300 })
    await u.anfrage('POST', '/api/spende', rueckgeldSpende('s1', 'v1', 200))
    await u.anfrage('POST', '/api/spende', freieSpende('s2', 'twint', 500))
    expect(u.db.prepare('SELECT COUNT(*) AS n FROM spende').get()?.['n']).toBe(2)
    const l = await u.anfrage('POST', '/api/testdaten-loeschen', undefined, TEST_PIN)
    expect(l.status).toBe(200)
    expect(u.db.prepare('SELECT COUNT(*) AS n FROM spende').get()?.['n']).toBe(0)
    expect(u.db.prepare('SELECT COUNT(*) AS n FROM verkauf').get()?.['n']).toBe(0)
  })
})

describe('spendeRepo', () => {
  it('istLetzte: zuletzt erfasste nicht stornierte Spende; fuerKassentag nur nicht stornierte', async () => {
    u = erstelleTestUmgebung()
    const tag = await u.kassentagStarten()
    const kurs = 9000
    expect(u.repos.spende.istLetzte('s1')).toBe(false)
    u.repos.spende.erstelle({ id: 's1', typ: 'bar_chf', betrag: 100, verkaufId: null }, tag, kurs)
    u.repos.spende.erstelle({ id: 's2', typ: 'bar_eur', betrag: 200, verkaufId: null }, tag, kurs)
    expect(u.repos.spende.istLetzte('s1')).toBe(false)
    expect(u.repos.spende.istLetzte('s2')).toBe(true)
    expect(u.repos.spende.storno('s2', false)).toMatchObject({ ergebnis: 'storniert' })
    expect(u.repos.spende.storno('s2', false)).toMatchObject({ ergebnis: 'bereits_storniert' })
    expect(u.repos.spende.storno('fehlt', false)).toEqual({ ergebnis: 'nicht_gefunden' })
    expect(u.repos.spende.istLetzte('s1')).toBe(true)
    expect(u.repos.spende.fuerKassentag(tag).map((s) => s.id)).toEqual(['s1'])
    expect(u.repos.spende.letzte(10).map((s) => s.id)).toEqual(['s2', 's1'])
    // Kurs wird nur bei bar_eur gespeichert
    expect(u.repos.spende.finde('s1')?.kursX10000).toBeNull()
    expect(u.repos.spende.finde('s2')).toMatchObject({ kursX10000: 9000, betragChfRappen: 180 })
    // Repo lehnt ungültige Beträge ab (Schutz hinter der Routen-Validierung)
    expect(() =>
      u.repos.spende.erstelle({ id: 's3', typ: 'twint', betrag: 0, verkaufId: null }, tag, kurs)
    ).toThrow()
  })
})
