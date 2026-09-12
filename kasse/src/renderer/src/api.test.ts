import { describe, expect, it } from 'vitest'
import {
  ApiFehler,
  NetzFehler,
  PIN_HEADER,
  STANDARD_SERVER,
  bestimmeApiBase,
  erstelleApi,
  fehlerMeldung,
  type FetchFunktion
} from './api'

interface Aufruf {
  url: string
  init: RequestInit
}

function fakeFetch(status: number, body: unknown, aufrufe: Aufruf[]): FetchFunktion {
  return (url, init) => {
    aufrufe.push({ url, init })
    const text = body === undefined ? '' : JSON.stringify(body)
    return Promise.resolve(new Response(text, { status, headers: { 'Content-Type': 'application/json' } }))
  }
}

describe('api-Client', () => {
  it('GET /api/status liefert die JSON-Antwort', async () => {
    const aufrufe: Aufruf[] = []
    const api = erstelleApi(fakeFetch(200, { version: '0.1.0', kassentag: null }, aufrufe), 'http://test')
    const status = await api.status()
    expect(status.version).toBe('0.1.0')
    expect(aufrufe[0]?.url).toBe('http://test/api/status')
    expect(aufrufe[0]?.init.method).toBe('GET')
    expect(aufrufe[0]?.init.body).toBeUndefined()
  })

  it('POST sendet JSON-Body und den X-Pin-Header, wo noetig', async () => {
    const aufrufe: Aufruf[] = []
    const api = erstelleApi(fakeFetch(200, { id: 'p1' }, aufrufe), '')
    await api.produktAnlegen({ name: 'Test', preisRappen: 500, gruppe: 'coupon' }, '1234')
    const init = aufrufe[0]?.init
    expect(aufrufe[0]?.url).toBe('/api/produkte')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ name: 'Test', preisRappen: 500, gruppe: 'coupon' }))
    const headers = init?.headers as Record<string, string>
    expect(headers[PIN_HEADER]).toBe('1234')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('Storno ohne PIN sendet keinen X-Pin-Header', async () => {
    const aufrufe: Aufruf[] = []
    const api = erstelleApi(fakeFetch(200, { id: 's1' }, aufrufe), '')
    await api.storno('v1', 'tippfehler')
    const headers = aufrufe[0]?.init.headers as Record<string, string>
    expect(headers[PIN_HEADER]).toBeUndefined()
    expect(aufrufe[0]?.url).toBe('/api/verkauf/v1/storno')
    expect(aufrufe[0]?.init.body).toBe(JSON.stringify({ grund: 'tippfehler' }))
  })

  it('DELETE /api/produkte/:id sendet den X-Pin-Header ohne Body', async () => {
    const aufrufe: Aufruf[] = []
    const api = erstelleApi(fakeFetch(200, { ok: true }, aufrufe), '')
    const antwort = await api.produktLoeschen('p 1', '1234')
    expect(antwort.ok).toBe(true)
    expect(aufrufe[0]?.url).toBe('/api/produkte/p%201')
    expect(aufrufe[0]?.init.method).toBe('DELETE')
    expect(aufrufe[0]?.init.body).toBeUndefined()
    const headers = aufrufe[0]?.init.headers as Record<string, string>
    expect(headers[PIN_HEADER]).toBe('1234')
    expect(headers['Content-Type']).toBeUndefined()
  })

  it('DELETE mit 409 produkt_hat_verkaeufe wird als ApiFehler mit diesem Code geworfen', async () => {
    const api = erstelleApi(fakeFetch(409, { fehler: 'produkt_hat_verkaeufe', meldung: 'Produkt wurde bereits verkauft' }, []), '')
    try {
      await api.produktLoeschen('p1', '1234')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ApiFehler)
      expect((e as ApiFehler).status).toBe(409)
      expect((e as ApiFehler).fehler).toBe('produkt_hat_verkaeufe')
    }
  })

  it('Fehlerantwort des Servers wird als ApiFehler geworfen', async () => {
    const api = erstelleApi(fakeFetch(409, { fehler: 'nicht_gedeckt', meldung: 'Betrag nicht gedeckt' }, []), '')
    const versuch = api.verkauf({
      id: 'u1',
      positionen: [],
      zahlart: 'bar_chf',
      gegeben: 0,
      spendeBehalten: false,
      bestaetigtHohesRueckgeld: false,
      rabattProzent: 0
    })
    await expect(versuch).rejects.toBeInstanceOf(ApiFehler)
    try {
      await versuch
    } catch (e) {
      const f = e as ApiFehler
      expect(f.status).toBe(409)
      expect(f.fehler).toBe('nicht_gedeckt')
      expect(fehlerMeldung(f)).toBe('Betrag nicht gedeckt')
    }
  })

  it('Fehler ohne JSON-Body wird zu http_<status>', async () => {
    const api = erstelleApi(fakeFetch(500, undefined, []), '')
    try {
      await api.status()
      expect.unreachable()
    } catch (e) {
      const f = e as ApiFehler
      expect(f.fehler).toBe('http_500')
      expect(f.meldung).toBe('Server-Fehler 500')
    }
  })

  it('Netzfehler (fetch wirft) wird zu NetzFehler', async () => {
    const api = erstelleApi(() => Promise.reject(new TypeError('Failed to fetch')), '')
    await expect(api.status()).rejects.toBeInstanceOf(NetzFehler)
    try {
      await api.status()
    } catch (e) {
      expect(fehlerMeldung(e)).toBe('Keine Verbindung zum Kassen-Server')
    }
  })

  it('Zeitlimit: haengende Anfrage wird abgebrochen und als NetzFehler (Zeitueberschreitung) gemeldet', async () => {
    const haengend: FetchFunktion = (_url, init) =>
      new Promise((_erfuellt, ablehnen) => {
        init.signal?.addEventListener('abort', () => ablehnen(new DOMException('abgebrochen', 'AbortError')))
      })
    const api = erstelleApi(haengend, '', { standard: 20, status: 10, lang: 30 })
    const start = Date.now()
    try {
      await api.verkauf({ id: 'u1', positionen: [], zahlart: 'bar_chf', gegeben: 0, spendeBehalten: false, bestaetigtHohesRueckgeld: false, rabattProzent: 0 })
      expect.unreachable('haette abbrechen muessen')
    } catch (e) {
      expect(e).toBeInstanceOf(NetzFehler)
      expect((e as NetzFehler).zeitueberschreitung).toBe(true)
      expect(fehlerMeldung(e)).toContain('nicht geantwortet')
    }
    expect(Date.now() - start).toBeLessThan(1000)
    await expect(api.status()).rejects.toBeInstanceOf(NetzFehler)
  })

  it('API_BASE: relativ, wenn der Server den Renderer ausliefert; absolut im Vite-Dev-Server', () => {
    expect(bestimmeApiBase({ protocol: 'http:', port: '47100' })).toBe('')
    expect(bestimmeApiBase({ protocol: 'http:', port: '47200' })).toBe('')
    expect(bestimmeApiBase({ protocol: 'http:', port: '5173' })).toBe(STANDARD_SERVER)
    expect(bestimmeApiBase({ protocol: 'file:', port: '' })).toBe(STANDARD_SERVER)
    expect(bestimmeApiBase(undefined)).toBe(STANDARD_SERVER)
  })

  it('Pfade mit Parametern werden korrekt gebaut', async () => {
    const aufrufe: Aufruf[] = []
    const api = erstelleApi(fakeFetch(200, {}, aufrufe), '')
    await api.produkte(true)
    await api.produkte()
    await api.letzteVerkaeufe(5)
    await api.nachdruck('v 1', 'coupons')
    await api.abschluss('k1', { istChfRappen: 100, istEurCent: 0, bemerkung: null })
    await api.ausverkauftSetzen('p1', true)
    await api.abschlussNachdruck('k1')
    await api.druckauftrag('d 1')
    await api.kassentag('k 1')
    expect(aufrufe.map((a) => a.url)).toEqual([
      '/api/produkte?alle=1',
      '/api/produkte',
      '/api/verkauf/letzte?limit=5',
      '/api/verkauf/v%201/nachdruck',
      '/api/kassentag/k1/abschluss',
      '/api/produkte/p1/ausverkauft',
      '/api/kassentag/k1/abschluss/nachdruck',
      '/api/druck/d%201',
      '/api/kassentag/k%201'
    ])
    expect(aufrufe[5]?.init.body).toBe(JSON.stringify({ ausverkauft: true }))
  })

  it('kassentag(id): GET /api/kassentag/:id liefert den Kassentag mit pdfPfad; 404 als ApiFehler', async () => {
    const aufrufe: Aufruf[] = []
    const api = erstelleApi(fakeFetch(200, { id: 'k1', pdfPfad: 'C:/Kasse/data/archiv/Kassenabschluss_2026-09-19_K1.pdf' }, aufrufe), '')
    const k = await api.kassentag('k1')
    expect(k.pdfPfad).toBe('C:/Kasse/data/archiv/Kassenabschluss_2026-09-19_K1.pdf')
    expect(aufrufe[0]?.url).toBe('/api/kassentag/k1')
    expect(aufrufe[0]?.init.method).toBe('GET')
    expect(aufrufe[0]?.init.body).toBeUndefined()

    const fehlt = erstelleApi(fakeFetch(404, { fehler: 'kassentag_nicht_gefunden', meldung: 'Kassentag nicht gefunden.' }, []), '')
    try {
      await fehlt.kassentag('x')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ApiFehler)
      expect((e as ApiFehler).status).toBe(404)
      expect((e as ApiFehler).fehler).toBe('kassentag_nicht_gefunden')
    }
  })

  it('archivOeffnen(): POST /api/archiv/oeffnen; 501 nicht_verfuegbar als ApiFehler mit Meldung', async () => {
    const aufrufe: Aufruf[] = []
    const api = erstelleApi(fakeFetch(200, { ok: true }, aufrufe), '')
    const antwort = await api.archivOeffnen()
    expect(antwort.ok).toBe(true)
    expect(aufrufe[0]?.url).toBe('/api/archiv/oeffnen')
    expect(aufrufe[0]?.init.method).toBe('POST')

    const browser = erstelleApi(fakeFetch(501, { fehler: 'nicht_verfuegbar', meldung: 'Nur in der Kassen-App möglich.' }, []), '')
    try {
      await browser.archivOeffnen()
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ApiFehler)
      expect((e as ApiFehler).status).toBe(501)
      expect(fehlerMeldung(e)).toBe('Nur in der Kassen-App möglich.')
    }
  })

  it('spendeErfassen(): POST /api/spende mit SpendeAnfrage als JSON-Body, ohne PIN', async () => {
    const aufrufe: Aufruf[] = []
    const spende = { id: 'sp1', kassentagId: 'k1', verkaufId: 'v1', zeit: '2026-09-19T14:32:05', typ: 'bar_chf', betrag: 200, kursX10000: null, betragChfRappen: 200, storniertAm: null }
    const api = erstelleApi(fakeFetch(201, { spende, bereitsVorhanden: false }, aufrufe), '')
    const antwort = await api.spendeErfassen({ id: 'sp1', typ: 'bar_chf', betrag: 200, verkaufId: 'v1' })
    expect(antwort.spende.betragChfRappen).toBe(200)
    expect(antwort.bereitsVorhanden).toBe(false)
    expect(aufrufe[0]?.url).toBe('/api/spende')
    expect(aufrufe[0]?.init.method).toBe('POST')
    expect(aufrufe[0]?.init.body).toBe(JSON.stringify({ id: 'sp1', typ: 'bar_chf', betrag: 200, verkaufId: 'v1' }))
    const headers = aufrufe[0]?.init.headers as Record<string, string>
    expect(headers[PIN_HEADER]).toBeUndefined()
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('spendeErfassen(): 409 bereits_gespendet wird als ApiFehler mit diesem Code geworfen', async () => {
    const api = erstelleApi(fakeFetch(409, { fehler: 'bereits_gespendet', meldung: 'Für diesen Beleg wurde bereits eine Spende erfasst.' }, []), '')
    try {
      await api.spendeErfassen({ id: 'sp1', typ: 'bar_chf', betrag: 200, verkaufId: 'v1' })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ApiFehler)
      expect((e as ApiFehler).status).toBe(409)
      expect((e as ApiFehler).fehler).toBe('bereits_gespendet')
    }
  })

  it('spendenLetzte(): GET /api/spende/letzte?limit=n liefert Spenden mit belegnr', async () => {
    const aufrufe: Aufruf[] = []
    const api = erstelleApi(fakeFetch(200, [{ id: 'sp1', belegnr: 'K1-0004', typ: 'bar_chf', betrag: 200, storniertAm: null }], aufrufe), '')
    const liste = await api.spendenLetzte(5)
    expect(liste[0]?.belegnr).toBe('K1-0004')
    expect(aufrufe[0]?.url).toBe('/api/spende/letzte?limit=5')
    expect(aufrufe[0]?.init.method).toBe('GET')
    await api.spendenLetzte()
    expect(aufrufe[1]?.url).toBe('/api/spende/letzte?limit=20')
  })

  it('spendeStorno(): ohne PIN kein X-Pin-Header, mit PIN Header gesetzt; 403 pin_falsch als ApiFehler', async () => {
    const aufrufe: Aufruf[] = []
    const api = erstelleApi(fakeFetch(200, { id: 'sp 1', storniertAm: '2026-09-19T14:40:00' }, aufrufe), '')
    const ohne = await api.spendeStorno('sp 1')
    expect(ohne.storniertAm).toBe('2026-09-19T14:40:00')
    expect(aufrufe[0]?.url).toBe('/api/spende/sp%201/storno')
    expect(aufrufe[0]?.init.method).toBe('POST')
    expect((aufrufe[0]?.init.headers as Record<string, string>)[PIN_HEADER]).toBeUndefined()

    await api.spendeStorno('sp1', '1234')
    expect((aufrufe[1]?.init.headers as Record<string, string>)[PIN_HEADER]).toBe('1234')

    const verweigert = erstelleApi(fakeFetch(403, { fehler: 'pin_falsch', meldung: 'PIN falsch' }, []), '')
    try {
      await verweigert.spendeStorno('sp2')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ApiFehler)
      expect((e as ApiFehler).status).toBe(403)
      expect((e as ApiFehler).fehler).toBe('pin_falsch')
    }
  })
})
