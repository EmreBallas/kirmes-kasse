/**
 * Letzte Verkaeufe: Liste mit Nachdruck (alles / Coupons / Bon 1) und Storno mit Grund.
 * Letzter Beleg ohne PIN, aeltere mit PIN-Dialog; stornierte Belege ohne Nachdruck.
 */
import { useCallback, useEffect, useState, type JSX } from 'react'
import type { NachdruckAnfrage, Storno, StornoGrund } from '@core/types'
import { formatChf } from '@core/geld'
import { formatUhrzeit } from '@core/bon'
import { ApiFehler, api, fehlerMeldung, type LetzterVerkauf } from '../api'
import { STORNO_GRUND_NAME, ZAHLART_NAME } from '../bezahlen'
import { PinDialog } from './PinDialog'
import { Popup } from './Popup'

interface Props {
  onZurueck: () => void
  /** meldet einen erfolgreichen Storno (damit der Banner im Verkauf den stornierten Beleg anzeigt) */
  onStorniert?: (storno: Storno) => void
}

type Dialog = { art: 'grund'; eintrag: LetzterVerkauf; mitPin: boolean } | { art: 'pin'; eintrag: LetzterVerkauf; grund: StornoGrund } | null

const GRUENDE: StornoGrund[] = ['tippfehler', 'ausverkauft', 'abgesprungen']

export function LetzteVerkaeufe({ onZurueck, onStorniert }: Props): JSX.Element {
  const [liste, setListe] = useState<LetzterVerkauf[]>([])
  const [meldung, setMeldung] = useState<{ text: string; art: 'ok' | 'fehler' } | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [beschaeftigt, setBeschaeftigt] = useState(false)

  const laden = useCallback(async (): Promise<void> => {
    try {
      setListe(await api.letzteVerkaeufe(20))
    } catch (e) {
      setMeldung({ text: fehlerMeldung(e), art: 'fehler' })
    }
  }, [])

  useEffect(() => {
    void laden()
  }, [laden])

  const nachdruck = async (eintrag: LetzterVerkauf, was: NachdruckAnfrage['was']): Promise<void> => {
    if (beschaeftigt) return
    setBeschaeftigt(true)
    try {
      await api.nachdruck(eintrag.verkauf.id, was)
      setMeldung({ text: `Nachdruck ${eintrag.verkauf.belegnr} (${was === 'alles' ? 'alles' : was === 'coupons' ? 'nur Coupons' : 'nur Bon 1'}) gestartet.`, art: 'ok' })
    } catch (e) {
      setMeldung({ text: fehlerMeldung(e), art: 'fehler' })
    } finally {
      setBeschaeftigt(false)
    }
  }

  const stornieren = async (eintrag: LetzterVerkauf, grund: StornoGrund, pin?: string): Promise<void> => {
    if (beschaeftigt) return
    setBeschaeftigt(true)
    setDialog(null)
    try {
      const storno = await api.storno(eintrag.verkauf.id, grund, pin)
      setMeldung({
        text: `Beleg ${eintrag.verkauf.belegnr} storniert (${STORNO_GRUND_NAME[grund]}). Auszahlung CHF ${formatChf(storno.auszahlungChfRappen)}${storno.auszahlungChfRappen > 0 ? ' – Schublade öffnet' : ''}.`,
        art: 'ok'
      })
      onStorniert?.(storno)
      await laden()
    } catch (e) {
      if (e instanceof ApiFehler && e.fehler === 'pin_falsch') {
        setMeldung({ text: 'PIN falsch – Storno abgelehnt.', art: 'fehler' })
      } else if (e instanceof ApiFehler && e.fehler === 'pin_noetig') {
        // Server verlangt PIN (nicht der letzte Beleg): PIN-Dialog nachschieben
        setDialog({ art: 'pin', eintrag, grund })
      } else {
        setMeldung({ text: fehlerMeldung(e), art: 'fehler' })
      }
      await laden()
    } finally {
      setBeschaeftigt(false)
    }
  }

  return (
    <main className="seite seite-liste">
      <div className="seite-kopf">
        <button type="button" className="knopf knopf-neutral knopf-gross" onClick={onZurueck}>
          ← Zurück zum Verkauf
        </button>
        <h1>Letzte Verkäufe</h1>
        <button type="button" className="knopf knopf-neutral" onClick={() => void laden()} disabled={beschaeftigt}>
          Aktualisieren
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

      <div className="tabelle-rahmen">
        <table className="tabelle">
          <thead>
            <tr>
              <th>Beleg</th>
              <th>Zeit</th>
              <th>Zahlart</th>
              <th className="rechts">Total CHF</th>
              <th>Positionen</th>
              <th>Status</th>
              <th>Nachdruck</th>
              <th>Storno</th>
            </tr>
          </thead>
          <tbody>
            {liste.map((e, i) => {
              const storniert = e.storno !== null || e.verkauf.storniertAm !== null
              const istLetzter = i === 0
              return (
                <tr key={e.verkauf.id} className={storniert ? 'zeile-storniert' : ''}>
                  <td className="zahl">{e.verkauf.belegnr}</td>
                  <td className="zahl">{formatUhrzeit(e.verkauf.zeit)}</td>
                  <td>{ZAHLART_NAME[e.verkauf.zahlart]}</td>
                  <td className="rechts zahl">{formatChf(e.verkauf.totalRappen)}</td>
                  <td className="positionen">{e.positionen.map((p) => `${String(p.anzahl)}x ${p.nameSnapshot}`).join(', ')}</td>
                  <td>
                    {storniert ? (
                      <span className="marke marke-storno">STORNIERT{e.storno !== null ? ` (${STORNO_GRUND_NAME[e.storno.grund]})` : ''}</span>
                    ) : (
                      <span className="marke marke-ok">ok</span>
                    )}
                  </td>
                  <td>
                    <div className="knopfgruppe">
                      <button type="button" className="knopf knopf-neutral knopf-klein" disabled={storniert || beschaeftigt} onClick={() => void nachdruck(e, 'alles')} title={storniert ? 'Beleg storniert' : undefined}>
                        alles
                      </button>
                      <button type="button" className="knopf knopf-neutral knopf-klein" disabled={storniert || beschaeftigt} onClick={() => void nachdruck(e, 'coupons')} title={storniert ? 'Beleg storniert' : undefined}>
                        Coupons
                      </button>
                      <button type="button" className="knopf knopf-neutral knopf-klein" disabled={storniert || beschaeftigt} onClick={() => void nachdruck(e, 'bon')} title={storniert ? 'Beleg storniert' : undefined}>
                        Bon 1
                      </button>
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="knopf knopf-gefahr knopf-klein"
                      disabled={storniert || beschaeftigt}
                      onClick={() => setDialog({ art: 'grund', eintrag: e, mitPin: !istLetzter })}
                    >
                      Stornieren{istLetzter ? '' : ' (PIN)'}
                    </button>
                  </td>
                </tr>
              )
            })}
            {liste.length === 0 ? (
              <tr>
                <td colSpan={8} className="tabelle-leer">
                  Noch keine Verkäufe.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {dialog?.art === 'grund' ? (
        <Popup
          titel={`Beleg ${dialog.eintrag.verkauf.belegnr} stornieren – Grund?`}
          art="frage"
          knoepfe={[{ text: 'Abbrechen', art: 'neutral', onClick: () => setDialog(null) }]}
        >
          <p>
            Ganzer Beleg, Auszahlung bar CHF <span className="zahl">{formatChf(dialog.eintrag.verkauf.zahlart === 'helfer' ? 0 : dialog.eintrag.verkauf.totalRappen)}</span> (Spende wird nicht erstattet).
          </p>
          <div className="knopfgruppe knopfgruppe-senkrecht">
            {GRUENDE.map((g) => (
              <button
                key={g}
                type="button"
                className="knopf knopf-gefahr knopf-gross"
                onClick={() => {
                  if (dialog.mitPin) setDialog({ art: 'pin', eintrag: dialog.eintrag, grund: g })
                  else void stornieren(dialog.eintrag, g)
                }}
              >
                {STORNO_GRUND_NAME[g]}
              </button>
            ))}
          </div>
        </Popup>
      ) : null}

      {dialog?.art === 'pin' ? (
        <PinDialog
          titel={`PIN für Storno ${dialog.eintrag.verkauf.belegnr}`}
          onAbbrechen={() => setDialog(null)}
          onOk={(pin) => void stornieren(dialog.eintrag, dialog.grund, pin)}
        />
      ) : null}
    </main>
  )
}
