/**
 * Produktverwaltung (hinter PIN): Liste aller Produkte inkl. inaktiver, Anlegen/Aendern, Deaktivieren.
 */
import { useCallback, useEffect, useState, type JSX } from 'react'
import type { Gruppe, Produkt } from '@core/types'
import { formatChf, parseBetrag } from '@core/geld'
import { NAME_MAX } from '@core/bon'
import { ApiFehler, api, fehlerMeldung } from '../api'

interface Props {
  pin: string
  onZurueck: () => void
  onPinUngueltig: () => void
}

interface Formular {
  id: string | null
  name: string
  preis: string
  gruppe: Gruppe
  aktiv: boolean
  reihenfolge: string
}

const LEER: Formular = { id: null, name: '', preis: '', gruppe: 'coupon', aktiv: true, reihenfolge: '' }

function formularAus(p: Produkt): Formular {
  return {
    id: p.id,
    name: p.name,
    preis: p.preisRappen === null ? '' : formatChf(p.preisRappen),
    gruppe: p.gruppe,
    aktiv: p.aktiv,
    reihenfolge: String(p.reihenfolge)
  }
}

export function Verwaltung({ pin, onZurueck, onPinUngueltig }: Props): JSX.Element {
  const [produkte, setProdukte] = useState<Produkt[]>([])
  const [formular, setFormular] = useState<Formular | null>(null)
  const [meldung, setMeldung] = useState<{ text: string; art: 'ok' | 'fehler' } | null>(null)
  const [sendet, setSendet] = useState(false)

  const laden = useCallback(async (): Promise<void> => {
    try {
      const alle = await api.produkte(true)
      setProdukte([...alle].sort((a, b) => a.reihenfolge - b.reihenfolge || a.name.localeCompare(b.name, 'de-CH')))
    } catch (e) {
      setMeldung({ text: fehlerMeldung(e), art: 'fehler' })
    }
  }, [])

  useEffect(() => {
    void laden()
  }, [laden])

  const fehlerBehandeln = (e: unknown): void => {
    if (e instanceof ApiFehler && e.fehler === 'pin_falsch') {
      onPinUngueltig()
      return
    }
    setMeldung({ text: fehlerMeldung(e), art: 'fehler' })
  }

  const speichern = async (): Promise<void> => {
    if (formular === null || sendet) return
    const name = formular.name.trim()
    if (name === '' || name.length > NAME_MAX) {
      setMeldung({ text: `Name muss 1 bis ${String(NAME_MAX)} Zeichen lang sein.`, art: 'fehler' })
      return
    }
    const preisRappen = formular.preis.trim() === '' ? null : parseBetrag(formular.preis)
    if (formular.preis.trim() !== '' && preisRappen === null) {
      setMeldung({ text: 'Preis ungültig (z. B. 12.50).', art: 'fehler' })
      return
    }
    const reihenfolge = formular.reihenfolge.trim() === '' ? undefined : Number(formular.reihenfolge)
    if (reihenfolge !== undefined && !Number.isSafeInteger(reihenfolge)) {
      setMeldung({ text: 'Reihenfolge muss eine ganze Zahl sein.', art: 'fehler' })
      return
    }
    const daten: Partial<Produkt> = { name, preisRappen, gruppe: formular.gruppe, aktiv: formular.aktiv }
    if (reihenfolge !== undefined) daten.reihenfolge = reihenfolge

    setSendet(true)
    try {
      if (formular.id === null) {
        const neu = await api.produktAnlegen(daten, pin)
        setMeldung({ text: `Produkt «${neu.name}» angelegt.`, art: 'ok' })
      } else {
        const neu = await api.produktAendern(formular.id, daten, pin)
        setMeldung({ text: `Produkt «${neu.name}» gespeichert.`, art: 'ok' })
      }
      setFormular(null)
      await laden()
    } catch (e) {
      fehlerBehandeln(e)
    } finally {
      setSendet(false)
    }
  }

  const aktivSetzen = async (p: Produkt, aktiv: boolean): Promise<void> => {
    if (sendet) return
    setSendet(true)
    try {
      await api.produktAendern(p.id, { aktiv }, pin)
      setMeldung({ text: `Produkt «${p.name}» ${aktiv ? 'aktiviert' : 'deaktiviert'}.`, art: 'ok' })
      await laden()
    } catch (e) {
      fehlerBehandeln(e)
    } finally {
      setSendet(false)
    }
  }

  return (
    <main className="seite seite-liste">
      <div className="seite-kopf">
        <button type="button" className="knopf knopf-neutral knopf-gross" onClick={onZurueck}>
          ← Zurück zum Verkauf
        </button>
        <h1>Produktverwaltung</h1>
        <button type="button" className="knopf knopf-primaer" onClick={() => setFormular(LEER)} disabled={formular !== null}>
          Neues Produkt
        </button>
      </div>

      {meldung !== null ? (
        <div className={`meldung-leiste ${meldung.art === 'ok' ? 'meldung-ok' : 'meldung-fehler'}`} role="status">
          {meldung.text}
          <button type="button" className="knopf knopf-neutral knopf-klein" onClick={() => setMeldung(null)}>
            OK
          </button>
        </div>
      ) : null}

      <div className="verwaltung-inhalt">
        <div className="tabelle-rahmen">
          <table className="tabelle">
            <thead>
              <tr>
                <th className="rechts">Nr.</th>
                <th>Name</th>
                <th className="rechts">Preis CHF</th>
                <th>Gruppe</th>
                <th>Status</th>
                <th>Aktion</th>
              </tr>
            </thead>
            <tbody>
              {produkte.map((p) => (
                <tr key={p.id} className={p.aktiv ? '' : 'zeile-inaktiv'}>
                  <td className="rechts zahl">{p.reihenfolge}</td>
                  <td>{p.name}</td>
                  <td className="rechts zahl">{p.preisRappen === null ? 'offen' : formatChf(p.preisRappen)}</td>
                  <td>
                    <span className={`marke marke-${p.gruppe}`}>{p.gruppe}</span>
                  </td>
                  <td>
                    {p.aktiv ? 'aktiv' : 'inaktiv'}
                    {p.ausverkauft ? ' · ausverkauft' : ''}
                  </td>
                  <td>
                    <div className="knopfgruppe">
                      <button type="button" className="knopf knopf-neutral knopf-klein" onClick={() => setFormular(formularAus(p))} disabled={sendet}>
                        Ändern
                      </button>
                      {p.aktiv ? (
                        <button type="button" className="knopf knopf-gefahr knopf-klein" onClick={() => void aktivSetzen(p, false)} disabled={sendet}>
                          Deaktivieren
                        </button>
                      ) : (
                        <button type="button" className="knopf knopf-primaer knopf-klein" onClick={() => void aktivSetzen(p, true)} disabled={sendet || p.preisRappen === null} title={p.preisRappen === null ? 'Zuerst Preis setzen' : undefined}>
                          Aktivieren
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {formular !== null ? (
          <form
            className="karte formular"
            onSubmit={(ev) => {
              ev.preventDefault()
              void speichern()
            }}
          >
            <h2>{formular.id === null ? 'Neues Produkt' : 'Produkt ändern'}</h2>
            <label className="feld">
              <span>
                Name <span className={`zaehler zahl${formular.name.length > NAME_MAX ? ' zaehler-zuviel' : ''}`}>{formular.name.length}/{NAME_MAX}</span>
              </span>
              <input type="text" className={`eingabe${formular.name.length > NAME_MAX ? ' eingabe-fehler' : ''}`} value={formular.name} onChange={(ev) => setFormular({ ...formular, name: ev.target.value })} autoFocus autoComplete="off" />
            </label>
            <label className="feld">
              <span>Preis CHF (leer = offen, Produkt bleibt inaktiv)</span>
              <input type="text" inputMode="decimal" className="eingabe zahl" value={formular.preis} onChange={(ev) => setFormular({ ...formular, preis: ev.target.value })} />
            </label>
            <div className="feld">
              <span>Gruppe</span>
              <div className="knopfgruppe">
                {(['coupon', 'kasse'] as Gruppe[]).map((g) => (
                  <button key={g} type="button" className={`knopf knopf-wahl gruppe-wahl-${g}${formular.gruppe === g ? ' knopf-wahl-aktiv' : ''}`} onClick={() => setFormular({ ...formular, gruppe: g })}>
                    {g === 'coupon' ? 'Coupon (Abholung)' : 'Kasse (sofort)'}
                  </button>
                ))}
              </div>
            </div>
            <label className="feld feld-zeile">
              <input type="checkbox" checked={formular.aktiv} onChange={(ev) => setFormular({ ...formular, aktiv: ev.target.checked })} />
              <span>aktiv (Kachel im Verkauf)</span>
            </label>
            <label className="feld">
              <span>Reihenfolge</span>
              <input type="text" inputMode="numeric" className="eingabe zahl" value={formular.reihenfolge} onChange={(ev) => setFormular({ ...formular, reihenfolge: ev.target.value })} />
            </label>
            <div className="knopfgruppe">
              <button type="button" className="knopf knopf-neutral knopf-gross" onClick={() => setFormular(null)} disabled={sendet}>
                Abbrechen
              </button>
              <button type="submit" className="knopf knopf-primaer knopf-gross" disabled={sendet}>
                Speichern
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </main>
  )
}
