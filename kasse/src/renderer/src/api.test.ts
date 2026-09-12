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

  it('Fehlerantwort des Servers wird als ApiFehler geworfen', async () => {
    const api = erstelleApi(fakeFetch(409, { fehler: 'nicht_gedeckt', meldung: 'Betrag nicht gedeckt' }, []), '')
    const versuch = api.verkauf({
      id: 'u1',
      positionen: [],
      zahlart: 'bar_chf',
      gegeben: 0,
      spendeBehalten: false,
      bestaetigtHohesRueckgeld: false
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
      await api.verkauf({ id: 'u1', positionen: [], zahlart: 'bar_chf', gegeben: 0, spendeBehalten: false, bestaetigtHohesRueckgeld: false })
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
    expect(aufrufe.map((a) => a.url)).toEqual([
      '/api/produkte?alle=1',
      '/api/produkte',
      '/api/verkauf/letzte?limit=5',
      '/api/verkauf/v%201/nachdruck',
      '/api/kassentag/k1/abschluss',
      '/api/produkte/p1/ausverkauft',
      '/api/kassentag/k1/abschluss/nachdruck',
      '/api/druck/d%201'
    ])
    expect(aufrufe[5]?.init.body).toBe(JSON.stringify({ ausverkauft: true }))
  })
})
