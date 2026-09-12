/**
 * Kassenabschluss: Bericht-Vorschau, Ist-Zaehlung CHF/EUR, Differenz live, Bemerkung, Abschliessen.
 */
import { useEffect, useState, type JSX } from 'react'
import type { AbschlussBericht, Kassentag } from '@core/types'
import { formatChf, formatEur, parseBetrag } from '@core/geld'
import { formatDatum } from '@core/bon'
import { api, fehlerMeldung } from '../api'
import { AbschlussPdf } from './AbschlussPdf'
import { Popup } from './Popup'

/** Abfrage des PDF-Pfads nach dem Abschluss: alle 1 s, hoechstens 20 s. */
const PDF_ABFRAGE_MS = 1000
const PDF_ABFRAGEN_MAX = 20

type PdfZustand = { art: 'wartet' } | { art: 'bereit'; pfad: string } | { art: 'unbekannt' }

interface Props {
  kassentag: Kassentag
  onFertig: () => void
  onZurueck: () => void
}

function Zeile({ label, wert, klasse }: { label: string; wert: string; klasse?: string }): JSX.Element {
  return (
    <div className={`bericht-zeile${klasse !== undefined ? ` ${klasse}` : ''}`}>
      <span>{label}</span>
      <span className="zahl">{wert}</span>
    </div>
  )
}

function differenzKlasse(d: number | null): string {
  if (d === null) return ''
  return d === 0 ? 'differenz-null' : 'differenz-abweichung'
}

export function Abschluss({ kassentag, onFertig, onZurueck }: Props): JSX.Element {
  const [bericht, setBericht] = useState<AbschlussBericht | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [istChf, setIstChf] = useState('')
  const [istEur, setIstEur] = useState('')
  const [bemerkung, setBemerkung] = useState('')
  const [rueckfrage, setRueckfrage] = useState(false)
  const [sendet, setSendet] = useState(false)
  const [fertig, setFertig] = useState<AbschlussBericht | null>(null)
  const [nachdruckMeldung, setNachdruckMeldung] = useState<{ text: string; art: 'ok' | 'fehler' } | null>(null)
  const [nachdruckLaeuft, setNachdruckLaeuft] = useState(false)
  const [pdf, setPdf] = useState<PdfZustand>({ art: 'wartet' })

  /**
   * Nach dem Abschluss schreibt der Main die PDF im Hintergrund und der Server merkt den Pfad am
   * Kassentag. Hier wird er alle 1 s abgefragt (max. 20 s), damit der Kassier sieht, wo die Datei liegt.
   */
  useEffect(() => {
    if (fertig === null) return
    let aktiv = true
    let versuche = 0
    let laeuft = false
    const timer = setInterval(() => {
      if (laeuft) return
      versuche += 1
      laeuft = true
      api
        .kassentag(kassentag.id)
        .then((k) => {
          if (!aktiv) return
          if (k.pdfPfad !== null) {
            setPdf({ art: 'bereit', pfad: k.pdfPfad })
            clearInterval(timer)
          } else if (versuche >= PDF_ABFRAGEN_MAX) {
            setPdf({ art: 'unbekannt' })
            clearInterval(timer)
          }
        })
        .catch(() => {
          if (aktiv && versuche >= PDF_ABFRAGEN_MAX) {
            setPdf({ art: 'unbekannt' })
            clearInterval(timer)
          }
        })
        .finally(() => {
          laeuft = false
        })
    }, PDF_ABFRAGE_MS)
    return () => {
      aktiv = false
      clearInterval(timer)
    }
  }, [fertig, kassentag.id])

  /** Nachdruck des Abschluss-Bons, z. B. nach Druckerausfall beim Abschluss (Testfall 32). */
  const nachdrucken = async (): Promise<void> => {
    if (nachdruckLaeuft) return
    setNachdruckLaeuft(true)
    setNachdruckMeldung(null)
    try {
      await api.abschlussNachdruck(kassentag.id)
      setNachdruckMeldung({ text: 'Nachdruck des Abschluss-Bons gestartet.', art: 'ok' })
    } catch (e) {
      setNachdruckMeldung({ text: fehlerMeldung(e), art: 'fehler' })
    } finally {
      setNachdruckLaeuft(false)
    }
  }

  useEffect(() => {
    let aktiv = true
    api
      .bericht()
      .then((b) => {
        if (aktiv) setBericht(b)
      })
      .catch((e: unknown) => {
        if (aktiv) setFehler(fehlerMeldung(e))
      })
    return () => {
      aktiv = false
    }
  }, [kassentag.id])

  const istChfRappen = parseBetrag(istChf)
  const istEurCent = parseBetrag(istEur)
  const differenzChf = bericht !== null && istChfRappen !== null ? istChfRappen - bericht.sollChfRappen : null
  const differenzEur = bericht !== null && istEurCent !== null ? istEurCent - bericht.sollEurCent : null
  const gueltig = istChfRappen !== null && istEurCent !== null && bericht !== null

  const abschliessen = async (): Promise<void> => {
    if (!gueltig || sendet || istChfRappen === null || istEurCent === null) return
    setSendet(true)
    setRueckfrage(false)
    try {
      const b = await api.abschluss(kassentag.id, {
        istChfRappen,
        istEurCent,
        bemerkung: bemerkung.trim() === '' ? null : bemerkung.trim()
      })
      setFertig(b)
    } catch (e) {
      setFehler(fehlerMeldung(e))
    } finally {
      setSendet(false)
    }
  }

  if (fertig !== null) {
    return (
      <main className="seite seite-abschluss">
        <div className="karte karte-ok abschluss-fertig">
          <h1>Abgeschlossen</h1>
          <p>
            Kassentag {formatDatum(fertig.datum)} ({fertig.kassier}) ist abgeschlossen. Der Abschluss-Bon wird gedruckt.
          </p>
          {pdf.art === 'unbekannt' ? (
            <div className="abschluss-pdf" role="status">
              <span>Abschluss-PDF noch nicht bestätigt. Sie erscheint im Archivordner; der Pfad steht später im Kassenstart.</span>
            </div>
          ) : (
            <AbschlussPdf pfad={pdf.art === 'bereit' ? pdf.pfad : null} />
          )}
          <Zeile label="Soll CHF" wert={formatChf(fertig.sollChfRappen)} />
          <Zeile label="Ist CHF" wert={formatChf(fertig.istChfRappen ?? 0)} />
          <Zeile label="Differenz CHF" wert={formatChf(fertig.differenzChfRappen ?? 0)} klasse={differenzKlasse(fertig.differenzChfRappen)} />
          <Zeile label="Soll EUR" wert={formatEur(fertig.sollEurCent)} />
          <Zeile label="Ist EUR" wert={formatEur(fertig.istEurCent ?? 0)} />
          <Zeile label="Differenz EUR" wert={formatEur(fertig.differenzEurCent ?? 0)} klasse={differenzKlasse(fertig.differenzEurCent)} />
          <button type="button" className="knopf knopf-primaer knopf-riesig" onClick={onFertig} autoFocus>
            Zum Kassenstart
          </button>
          <div className="abschluss-nachdruck">
            <p>Druckt der Abschluss-Bon nicht (Drucker prüfen): Drucker anstecken und hier oder im Kassenstart nachdrucken.</p>
            <button type="button" className="knopf knopf-neutral knopf-gross" onClick={() => void nachdrucken()} disabled={nachdruckLaeuft}>
              Abschluss-Bon nachdrucken
            </button>
            {nachdruckMeldung !== null ? (
              <p className={nachdruckMeldung.art === 'ok' ? 'meldung-ok' : 'meldung-fehler'} role="status">
                {nachdruckMeldung.text}
              </p>
            ) : null}
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="seite seite-abschluss">
      <div className="seite-kopf">
        <button type="button" className="knopf knopf-neutral knopf-gross" onClick={onZurueck}>
          ← Zurück
        </button>
        <h1>
          Kassenabschluss {formatDatum(kassentag.datum)} · {kassentag.kassier}
        </h1>
      </div>

      {fehler !== null ? (
        <div className="meldung-fehler meldung-leiste" role="alert">
          {fehler}
        </div>
      ) : null}

      <div className="abschluss-inhalt">
        <section className="karte bericht">
          <h2>Bericht (Vorschau)</h2>
          {bericht === null ? (
            <p>Bericht wird geladen …</p>
          ) : (
            <>
              <Zeile label="Startgeld CHF" wert={formatChf(bericht.startgeldChfRappen)} />
              <Zeile label="Bar-Einnahmen CHF (brutto)" wert={formatChf(bericht.barEinnahmenChfRappen)} />
              <Zeile label="Bar-Spende CHF" wert={formatChf(bericht.barSpendeChfRappen)} />
              <Zeile label="Bar-Einnahmen EUR (Stück)" wert={`EUR ${formatEur(bericht.barEinnahmenEurCent)}`} />
              <Zeile label="Bar-Einnahmen EUR (CHF-Gegenwert)" wert={formatChf(bericht.barEinnahmenEurChfRappen)} />
              <Zeile label="Rückgeld aus EUR-Verkäufen" wert={`− ${formatChf(bericht.rueckgeldAusEurRappen)}`} />
              <Zeile label="Bar-Spende EUR (CHF-Gegenwert)" wert={formatChf(bericht.barSpendeEurChfRappen)} />
              <Zeile label="Twint-Umsatz (brutto)" wert={formatChf(bericht.twintUmsatzRappen)} />
              <Zeile label="  davon storniert (bar ausbezahlt)" wert={formatChf(bericht.twintStorniertRappen)} />
              <Zeile label="Twint-Spende" wert={formatChf(bericht.twintSpendeRappen)} />
              <Zeile label={`Storni (${String(bericht.storniAnzahl)})`} wert={`− ${formatChf(bericht.storniAuszahlungRappen)}`} />
              <Zeile label={`Helferessen (${String(bericht.helferessenStueck)} Stück, entgangen)`} wert={formatChf(bericht.helferessenEntgangenRappen)} />
              <Zeile label="Nachdrucke" wert={String(bericht.nachdrucke)} />
              <Zeile label="Belege" wert={String(bericht.anzahlBelege)} />
              <Zeile label="Startgeld EUR" wert={`EUR ${formatEur(bericht.startgeldEurCent)}`} />
              <Zeile label="SOLL CHF" wert={formatChf(bericht.sollChfRappen)} klasse="bericht-soll" />
              <Zeile label="SOLL EUR" wert={`EUR ${formatEur(bericht.sollEurCent)}`} klasse="bericht-soll" />

              <h3>Stück je Produkt</h3>
              <table className="tabelle tabelle-klein">
                <thead>
                  <tr>
                    <th>Produkt</th>
                    <th className="rechts">verkauft</th>
                    <th className="rechts">Helfer</th>
                    <th className="rechts">Umsatz CHF</th>
                  </tr>
                </thead>
                <tbody>
                  {bericht.produkte.map((pz) => (
                    <tr key={pz.produktId}>
                      <td>{pz.name}</td>
                      <td className="rechts zahl">{pz.verkauft}</td>
                      <td className="rechts zahl">{pz.helfer}</td>
                      <td className="rechts zahl">{formatChf(pz.umsatzRappen)}</td>
                    </tr>
                  ))}
                  {bericht.produkte.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="tabelle-leer">
                        keine Positionen
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </>
          )}
        </section>

        <section className="karte zaehlung">
          <h2>Ist-Zählung</h2>
          <label className="feld">
            <span>Ist CHF (gezählt)</span>
            <input type="text" inputMode="decimal" className={`eingabe zahl eingabe-gross${istChfRappen === null && istChf !== '' ? ' eingabe-fehler' : ''}`} value={istChf} onChange={(ev) => setIstChf(ev.target.value)} autoFocus />
          </label>
          <Zeile label="Soll CHF" wert={bericht !== null ? formatChf(bericht.sollChfRappen) : '–'} />
          <Zeile label="Differenz CHF" wert={differenzChf !== null ? formatChf(differenzChf) : '–'} klasse={`differenz ${differenzKlasse(differenzChf)}`} />

          <label className="feld">
            <span>Ist EUR (gezählt)</span>
            <input type="text" inputMode="decimal" className={`eingabe zahl eingabe-gross${istEurCent === null && istEur !== '' ? ' eingabe-fehler' : ''}`} value={istEur} onChange={(ev) => setIstEur(ev.target.value)} />
          </label>
          <Zeile label="Soll EUR" wert={bericht !== null ? formatEur(bericht.sollEurCent) : '–'} />
          <Zeile label="Differenz EUR" wert={differenzEur !== null ? formatEur(differenzEur) : '–'} klasse={`differenz ${differenzKlasse(differenzEur)}`} />

          <label className="feld">
            <span>Bemerkung</span>
            <textarea className="eingabe" rows={3} value={bemerkung} onChange={(ev) => setBemerkung(ev.target.value)} />
          </label>

          <button type="button" className="knopf knopf-primaer knopf-riesig" disabled={!gueltig || sendet} onClick={() => setRueckfrage(true)}>
            Kassentag abschliessen
          </button>
        </section>
      </div>

      {rueckfrage && bericht !== null && differenzChf !== null && differenzEur !== null ? (
        <Popup
          titel="Kassentag abschliessen?"
          art="frage"
          knoepfe={[
            { text: 'Abbrechen', art: 'neutral', onClick: () => setRueckfrage(false) },
            { text: 'Ja, abschliessen', art: 'primaer', autoFokus: true, onClick: () => void abschliessen() }
          ]}
        >
          <p>
            Differenz CHF <span className={`zahl ${differenzKlasse(differenzChf)}`}>{formatChf(differenzChf)}</span>, Differenz EUR{' '}
            <span className={`zahl ${differenzKlasse(differenzEur)}`}>{formatEur(differenzEur)}</span>. Danach sind keine Verkäufe mehr auf diesem Kassentag möglich.
          </p>
        </Popup>
      ) : null}
    </main>
  )
}
