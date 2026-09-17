/**
 * Bildschirm «Helfer»: offene Helfer-Schulden ueber alle Kassentage (GET /api/helfer), Gesamtsumme gross
 * oben, Tabelle Name | Offen CHF | Anzahl Belege | letzte Zeit mit Knopf «Bezahlen» je Zeile mit Saldo > 0
 * (Dialog HelferZahlungDialog -> POST /api/helfer/zahlung). Darunter «Letzte Helfer-Zahlungen» mit Storno:
 * die zuletzt erfasste ohne PIN, aeltere mit PIN (403 pin_falsch -> PIN-Dialog). Nichts wird geloescht.
 */
import { useCallback, useEffect, useState, type JSX } from 'react'
import type { HelferSaldo } from '@core/types'
import { formatChf } from '@core/geld'
import { formatDatumUhrzeit, formatUhrzeit } from '@core/bon'
import { ApiFehler, api, fehlerMeldung } from '../api'
import { gesamtOffen, helferZahlungMeldung, saldenMitSchuld, type LetzteHelferZahlung } from '../helfer'
import { SPENDE_TYP_NAME, indexOhnePin, spendeBetragText } from '../spende'
import { HelferZahlungDialog } from './HelferZahlungDialog'
import { PinDialog } from './PinDialog'
import { Popup } from './Popup'

interface Props {
  /** EUR-Kurs (x10000) fuer Bar-EUR-Zahlungen; 0 = kein Kurs */
  kursX10000: number
  onZurueck: () => void
}

type Dialog =
  | { art: 'zahlung'; saldo: HelferSaldo }
  | { art: 'storno'; zahlung: LetzteHelferZahlung }
  | { art: 'storno_pin'; zahlung: LetzteHelferZahlung }
  | null

/** Salden sortiert: zuerst Schulden (nach Name), dann die ohne Schuld (nach Name). */
function sortiereSalden(salden: readonly HelferSaldo[]): HelferSaldo[] {
  const mitSchuld = saldenMitSchuld(salden)
  const ohne = salden
    .filter((s) => s.offenRappen <= 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'de-CH', { sensitivity: 'base' }))
  return [...mitSchuld, ...ohne]
}

export function Helfer({ kursX10000, onZurueck }: Props): JSX.Element {
  const [salden, setSalden] = useState<HelferSaldo[]>([])
  const [zahlungen, setZahlungen] = useState<LetzteHelferZahlung[]>([])
  const [meldung, setMeldung] = useState<{ text: string; art: 'ok' | 'fehler' } | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [beschaeftigt, setBeschaeftigt] = useState(false)
  const [geladen, setGeladen] = useState(false)

  const laden = useCallback(async (): Promise<void> => {
    try {
      const h = await api.helfer()
      setSalden(sortiereSalden(h.salden))
    } catch (e) {
      setMeldung({ text: fehlerMeldung(e), art: 'fehler' })
    }
    try {
      setZahlungen(await api.helferZahlungenLetzte(20))
    } catch {
      /* alter Server ohne Zahlungs-Route: Abschnitt bleibt leer */
    }
    setGeladen(true)
  }, [])

  useEffect(() => {
    void laden()
  }, [laden])

  /** Zahlung stornieren: zuerst ohne PIN; verlangt der Server eine PIN (403 pin_falsch), PIN-Dialog nachschieben. */
  const stornieren = async (zahlung: LetzteHelferZahlung, pin?: string): Promise<void> => {
    if (beschaeftigt) return
    setBeschaeftigt(true)
    setDialog(null)
    try {
      await api.helferZahlungStorno(zahlung.id, pin)
      setMeldung({
        text: `Zahlung ${spendeBetragText(zahlung)} von ${zahlung.helferName} storniert. Die Schuld steigt wieder; das Geld bleibt physisch in der Kasse, der Soll-Bestand sinkt.`,
        art: 'ok'
      })
      await laden()
    } catch (e) {
      if (e instanceof ApiFehler && (e.fehler === 'pin_falsch' || e.fehler === 'pin_noetig')) {
        if (pin === undefined) setDialog({ art: 'storno_pin', zahlung })
        else setMeldung({ text: 'PIN falsch – Storno abgelehnt.', art: 'fehler' })
      } else {
        setMeldung({ text: fehlerMeldung(e), art: 'fehler' })
        await laden()
      }
    } finally {
      setBeschaeftigt(false)
    }
  }

  const ohnePin = indexOhnePin(zahlungen)
  const gesamt = gesamtOffen(salden)
  const anzahlSchuldner = saldenMitSchuld(salden).length

  return (
    <main className="seite seite-liste seite-helfer">
      <div className="seite-kopf">
        <button type="button" className="knopf knopf-neutral knopf-gross" onClick={onZurueck}>
          ← Zurück zum Verkauf
        </button>
        <h1>Helfer</h1>
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
        <div className="helfer-gesamt" role="status">
          <span className="helfer-gesamt-label">Offene Helfer-Schulden gesamt</span>
          <span className="helfer-gesamt-betrag zahl">CHF {formatChf(gesamt)}</span>
          <span className="helfer-gesamt-zusatz">
            {anzahlSchuldner === 0 ? 'niemand schuldet etwas' : `${String(anzahlSchuldner)} Helfer mit offenem Saldo · über alle Kassentage`}
          </span>
        </div>

        <table className="tabelle tabelle-helfer">
          <thead>
            <tr>
              <th>Name</th>
              <th className="rechts">Offen CHF</th>
              <th className="rechts">Anzahl Belege</th>
              <th>letzte Zeit</th>
              <th>Bezahlen</th>
            </tr>
          </thead>
          <tbody>
            {salden.map((s) => {
              const schuld = s.offenRappen > 0
              return (
                <tr key={s.name} className={schuld ? 'zeile-schuld' : 'zeile-inaktiv'}>
                  <td className="helfer-name">{s.name}</td>
                  <td className={`rechts zahl${schuld ? ' helfer-offen' : ''}`}>{formatChf(s.offenRappen)}</td>
                  <td className="rechts zahl">{s.verkaeufeAnzahl}</td>
                  <td className="zahl">{s.letzteZeit !== null ? formatDatumUhrzeit(s.letzteZeit) : '–'}</td>
                  <td>
                    {schuld ? (
                      <button type="button" className="knopf knopf-primaer knopf-klein" disabled={beschaeftigt} onClick={() => setDialog({ art: 'zahlung', saldo: s })}>
                        Bezahlen
                      </button>
                    ) : (
                      <span className="marke marke-ok">{s.offenRappen < 0 ? 'Guthaben' : 'beglichen'}</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {salden.length === 0 ? (
              <tr>
                <td colSpan={5} className="tabelle-leer">
                  {geladen ? 'Keine Helfer mit Bewegungen. Helfer erscheinen hier nach dem ersten «Später zahlen».' : 'Wird geladen …'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        <h2 className="spenden-titel">Letzte Helfer-Zahlungen</h2>
        <table className="tabelle tabelle-spenden">
          <thead>
            <tr>
              <th>Zeit</th>
              <th>Helfer</th>
              <th>Zahlart</th>
              <th className="rechts">Betrag</th>
              <th>Status</th>
              <th>Storno</th>
            </tr>
          </thead>
          <tbody>
            {zahlungen.map((z, i) => {
              const storniert = z.storniertAm !== null
              return (
                <tr key={z.id} className={storniert ? 'zeile-storniert' : ''}>
                  <td className="zahl">{formatUhrzeit(z.zeit)}</td>
                  <td>{z.helferName}</td>
                  <td>{SPENDE_TYP_NAME[z.typ]}</td>
                  <td className="rechts zahl">{spendeBetragText(z)}</td>
                  <td>{storniert ? <span className="marke marke-storno">STORNIERT</span> : <span className="marke marke-ok">ok</span>}</td>
                  <td>
                    <button type="button" className="knopf knopf-gefahr knopf-klein" disabled={storniert || beschaeftigt} onClick={() => setDialog({ art: 'storno', zahlung: z })}>
                      Stornieren{i === ohnePin || storniert ? '' : ' (PIN)'}
                    </button>
                  </td>
                </tr>
              )
            })}
            {zahlungen.length === 0 ? (
              <tr>
                <td colSpan={6} className="tabelle-leer">
                  Noch keine Helfer-Zahlungen.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {dialog?.art === 'zahlung' ? (
        <HelferZahlungDialog
          saldo={dialog.saldo}
          kursX10000={kursX10000}
          onAbbrechen={() => setDialog(null)}
          onErfolg={(antwort, offenNachher) => {
            setDialog(null)
            setMeldung({ text: helferZahlungMeldung(dialog.saldo.name, antwort.zahlung.betragChfRappen, offenNachher), art: 'ok' })
            void laden()
          }}
        />
      ) : null}

      {dialog?.art === 'storno' ? (
        <Popup
          titel="Helfer-Zahlung stornieren?"
          art="frage"
          knoepfe={[
            { text: 'Abbrechen', art: 'neutral', onClick: () => setDialog(null) },
            { text: 'Ja, stornieren', art: 'gefahr', onClick: () => void stornieren(dialog.zahlung) }
          ]}
        >
          <p>
            Zahlung {spendeBetragText(dialog.zahlung)} ({SPENDE_TYP_NAME[dialog.zahlung.typ]}) von {dialog.zahlung.helferName} um {formatUhrzeit(dialog.zahlung.zeit)} wird storniert (Tippfehler). Die Schuld
            steigt wieder um diesen Betrag.
          </p>
        </Popup>
      ) : null}

      {dialog?.art === 'storno_pin' ? (
        <PinDialog titel="PIN für Storno der Helfer-Zahlung" onAbbrechen={() => setDialog(null)} onOk={(pin) => void stornieren(dialog.zahlung, pin)} />
      ) : null}
    </main>
  )
}
