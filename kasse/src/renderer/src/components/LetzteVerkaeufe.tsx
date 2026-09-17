/**
 * Letzte Verkaeufe: Liste mit Nachdruck (alles / Coupons / Bon 1) und Storno mit Grund.
 * Letzter Beleg ohne PIN, aeltere mit PIN-Dialog; stornierte Belege ohne Nachdruck.
 *
 * Spenden: Pro Bar-Zeile mit Rueckgeld > 0 (nicht storniert, noch ohne Spende) der Knopf "Rueckgeld als
 * Spende" (gleiche Rueckfrage wie im Banner). Darunter der Abschnitt "Letzte Spenden" (Zeit, Typ, Betrag,
 * Beleg, storniert) mit Storno: die zuletzt erfasste ohne PIN, aeltere mit PIN (403 pin_falsch -> PIN-Dialog).
 * Nichts wird geloescht (storniertAm).
 *
 * Helfer: Belege mit Helfername zeigen «Helfer: <Name>» unter der Zahlart; bei zahlart helfer («spaeter
 * zahlen») steht «offen» statt einer Zahlart. Storno eines solchen Belegs zahlt nichts aus, die Schuld sinkt.
 */
import { useCallback, useEffect, useState, type JSX } from 'react'
import type { NachdruckAnfrage, Spende, Storno, StornoGrund } from '@core/types'
import { formatChf } from '@core/geld'
import { formatUhrzeit } from '@core/bon'
import { ApiFehler, api, fehlerMeldung, type LetzteSpende, type LetzterVerkauf } from '../api'
import { STORNO_GRUND_NAME } from '../bezahlen'
import { helferNameVon, verkaufZahlartText } from '../helfer'
import { SPENDE_TYP_NAME, indexOhnePin, rueckgeldSpendeMoeglich, spendeBetragText } from '../spende'
import { PinDialog } from './PinDialog'
import { Popup } from './Popup'
import { RueckgeldSpendeFrage } from './RueckgeldSpende'

interface Props {
  onZurueck: () => void
  /** meldet einen erfolgreichen Storno (damit der Banner im Verkauf den stornierten Beleg anzeigt) */
  onStorniert?: (storno: Storno) => void
  /** meldet eine erfasste oder stornierte Spende (damit der Banner im Verkauf nachzieht) */
  onSpendeGeaendert?: (spende: Spende) => void
}

type Dialog =
  | { art: 'grund'; eintrag: LetzterVerkauf; mitPin: boolean }
  | { art: 'pin'; eintrag: LetzterVerkauf; grund: StornoGrund }
  | { art: 'spende_frage'; eintrag: LetzterVerkauf }
  | { art: 'spende_storno'; spende: LetzteSpende }
  | { art: 'spende_pin'; spende: LetzteSpende }
  | null

const GRUENDE: StornoGrund[] = ['tippfehler', 'ausverkauft', 'abgesprungen']

export function LetzteVerkaeufe({ onZurueck, onStorniert, onSpendeGeaendert }: Props): JSX.Element {
  const [liste, setListe] = useState<LetzterVerkauf[]>([])
  const [spenden, setSpenden] = useState<LetzteSpende[]>([])
  const [meldung, setMeldung] = useState<{ text: string; art: 'ok' | 'fehler' } | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [beschaeftigt, setBeschaeftigt] = useState(false)

  const laden = useCallback(async (): Promise<void> => {
    try {
      setListe(await api.letzteVerkaeufe(20))
    } catch (e) {
      setMeldung({ text: fehlerMeldung(e), art: 'fehler' })
    }
    try {
      setSpenden(await api.spendenLetzte(20))
    } catch {
      /* alter Server ohne Spenden-Route: Abschnitt bleibt leer */
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
      const helferName = helferNameVon(eintrag.verkauf)
      const schuldText =
        eintrag.verkauf.zahlart === 'helfer' && helferName !== null
          ? ` Keine Auszahlung, die offene Schuld von ${helferName} sinkt um CHF ${formatChf(eintrag.verkauf.totalRappen)}.`
          : ''
      setMeldung({
        text: `Beleg ${eintrag.verkauf.belegnr} storniert (${STORNO_GRUND_NAME[grund]}). Auszahlung CHF ${formatChf(storno.auszahlungChfRappen)}${storno.auszahlungChfRappen > 0 ? ' – Schublade öffnet' : ''}.${schuldText}`,
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

  /** Spende stornieren: zuerst ohne PIN; verlangt der Server eine PIN (403 pin_falsch), PIN-Dialog nachschieben. */
  const spendeStornieren = async (spende: LetzteSpende, pin?: string): Promise<void> => {
    if (beschaeftigt) return
    setBeschaeftigt(true)
    setDialog(null)
    try {
      const storniert = await api.spendeStorno(spende.id, pin)
      setMeldung({ text: `Spende ${spendeBetragText(spende)} storniert. Das Geld bleibt physisch in der Kasse, der Soll-Bestand sinkt.`, art: 'ok' })
      onSpendeGeaendert?.(storniert)
      await laden()
    } catch (e) {
      if (e instanceof ApiFehler && (e.fehler === 'pin_falsch' || e.fehler === 'pin_noetig')) {
        if (pin === undefined) setDialog({ art: 'spende_pin', spende })
        else setMeldung({ text: 'PIN falsch – Storno abgelehnt.', art: 'fehler' })
      } else {
        setMeldung({ text: fehlerMeldung(e), art: 'fehler' })
        await laden()
      }
    } finally {
      setBeschaeftigt(false)
    }
  }

  const spendeOhnePin = indexOhnePin(spenden)

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
              <th>Spende</th>
              <th>Nachdruck</th>
              <th>Storno</th>
            </tr>
          </thead>
          <tbody>
            {liste.map((e, i) => {
              const storniert = e.storno !== null || e.verkauf.storniertAm !== null
              const istLetzter = i === 0
              const spende = e.spende ?? null
              const spendeErfasst = spende !== null && spende.storniertAm === null
              const helferName = helferNameVon(e.verkauf)
              return (
                <tr key={e.verkauf.id} className={storniert ? 'zeile-storniert' : ''}>
                  <td className="zahl">{e.verkauf.belegnr}</td>
                  <td className="zahl">{formatUhrzeit(e.verkauf.zeit)}</td>
                  <td>
                    {e.verkauf.zahlart === 'helfer' ? <span className="marke marke-offen">{verkaufZahlartText(e.verkauf)}</span> : verkaufZahlartText(e.verkauf)}
                    {helferName !== null || e.verkauf.zahlart === 'helfer' ? <div className="helfer-marke">Helfer: {helferName ?? '(ohne Name)'}</div> : null}
                  </td>
                  <td className="rechts zahl">{formatChf(e.verkauf.totalRappen)}</td>
                  <td className="positionen">{e.positionen.map((p) => `${String(p.anzahl)}x ${p.nameSnapshot}`).join(', ')}</td>
                  <td>
                    {storniert ? (
                      <span className="marke marke-storno">STORNIERT{e.storno !== null ? ` (${STORNO_GRUND_NAME[e.storno.grund]})` : ''}</span>
                    ) : (
                      <span className="marke marke-ok">ok</span>
                    )}
                  </td>
                  <td className="spalte-spende">
                    {spendeErfasst && spende !== null ? (
                      <span className="marke marke-spende zahl">Spende CHF {formatChf(spende.betragChfRappen)}</span>
                    ) : rueckgeldSpendeMoeglich(e.verkauf, e.zahlung, storniert, spende) ? (
                      <button type="button" className="knopf knopf-neutral knopf-klein" disabled={beschaeftigt} onClick={() => setDialog({ art: 'spende_frage', eintrag: e })}>
                        Rückgeld als Spende
                      </button>
                    ) : null}
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
                <td colSpan={9} className="tabelle-leer">
                  Noch keine Verkäufe.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <h2 className="spenden-titel">Letzte Spenden</h2>
        <table className="tabelle tabelle-spenden">
          <thead>
            <tr>
              <th>Zeit</th>
              <th>Typ</th>
              <th className="rechts">Betrag</th>
              <th>Beleg</th>
              <th>Status</th>
              <th>Storno</th>
            </tr>
          </thead>
          <tbody>
            {spenden.map((s, i) => {
              const storniert = s.storniertAm !== null
              const ohnePin = i === spendeOhnePin
              return (
                <tr key={s.id} className={storniert ? 'zeile-storniert' : ''}>
                  <td className="zahl">{formatUhrzeit(s.zeit)}</td>
                  <td>{SPENDE_TYP_NAME[s.typ]}</td>
                  <td className="rechts zahl">{spendeBetragText(s)}</td>
                  <td className="zahl">{s.belegnr ?? '– (ohne Kauf)'}</td>
                  <td>{storniert ? <span className="marke marke-storno">STORNIERT</span> : <span className="marke marke-ok">ok</span>}</td>
                  <td>
                    <button
                      type="button"
                      className="knopf knopf-gefahr knopf-klein"
                      disabled={storniert || beschaeftigt}
                      onClick={() => setDialog({ art: 'spende_storno', spende: s })}
                    >
                      Stornieren{ohnePin || storniert ? '' : ' (PIN)'}
                    </button>
                  </td>
                </tr>
              )
            })}
            {spenden.length === 0 ? (
              <tr>
                <td colSpan={6} className="tabelle-leer">
                  Noch keine separaten Spenden.
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
          {dialog.eintrag.verkauf.zahlart === 'helfer' ? (
            <p>
              Ganzer Beleg, keine Auszahlung (offener Helfer-Beleg). Die Schuld von {helferNameVon(dialog.eintrag.verkauf) ?? 'diesem Helfer'} sinkt um CHF{' '}
              <span className="zahl">{formatChf(dialog.eintrag.verkauf.totalRappen)}</span>.
            </p>
          ) : (
            <p>
              Ganzer Beleg, Auszahlung bar CHF <span className="zahl">{formatChf(dialog.eintrag.verkauf.totalRappen)}</span> (Spende wird nicht erstattet).
            </p>
          )}
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

      {dialog?.art === 'spende_frage' ? (
        <RueckgeldSpendeFrage
          verkauf={dialog.eintrag.verkauf}
          zahlung={dialog.eintrag.zahlung}
          onAbbrechen={() => setDialog(null)}
          onErfasst={(spende) => {
            setDialog(null)
            setMeldung({ text: `Spende CHF ${formatChf(spende.betragChfRappen)} zu Beleg ${dialog.eintrag.verkauf.belegnr} erfasst.`, art: 'ok' })
            onSpendeGeaendert?.(spende)
            void laden()
          }}
        />
      ) : null}

      {dialog?.art === 'spende_storno' ? (
        <Popup
          titel="Spende stornieren?"
          art="frage"
          knoepfe={[
            { text: 'Abbrechen', art: 'neutral', onClick: () => setDialog(null) },
            { text: 'Ja, stornieren', art: 'gefahr', onClick: () => void spendeStornieren(dialog.spende) }
          ]}
        >
          <p>
            Spende {spendeBetragText(dialog.spende)} ({SPENDE_TYP_NAME[dialog.spende.typ]}
            {dialog.spende.belegnr !== null ? `, Beleg ${dialog.spende.belegnr}` : ', ohne Kauf'}) von {formatUhrzeit(dialog.spende.zeit)} wird storniert (Tippfehler). Sie zählt dann nicht mehr im Abschluss.
          </p>
        </Popup>
      ) : null}

      {dialog?.art === 'spende_pin' ? (
        <PinDialog
          titel="PIN für Storno der Spende"
          onAbbrechen={() => setDialog(null)}
          onOk={(pin) => void spendeStornieren(dialog.spende, pin)}
        />
      ) : null}
    </main>
  )
}
