/**
 * Einstellungen (hinter PIN): EUR-Kurs, Druckername, Kassen-Praefix, Rabattsatz, Veranstaltung,
 * PIN aendern, Testdruck, Testdaten loeschen (doppelte Rueckfrage), Transport-Anzeige.
 */
import { useEffect, useState, type JSX } from 'react'
import type { Einstellungen as EinstellungenTyp, StatusAntwort } from '@core/types'
import { RABATT_PROZENT_MAX, RABATT_PROZENT_MIN, chfZuEurCentAufgerundet, formatEur, formatKurs } from '@core/geld'
import { VERANSTALTUNG_MAX_LAENGE } from '@core/bon'
import { ApiFehler, api, fehlerMeldung, type EinstellungenAenderung } from '../api'
import { istGueltigePin, parseKurs } from '../betrag'
import { parseRabattSatz, rabattSatz } from '../rabatt'
import { Popup } from './Popup'

/** Freitext aus den Einstellungen; fehlt das Feld (aelterer Server), gilt leer. */
function textOderLeer(wert: string | undefined): string {
  return typeof wert === 'string' ? wert : ''
}

interface Props {
  pin: string
  status: StatusAntwort | null
  einstellungen: EinstellungenTyp | null
  onGeaendert: (e: EinstellungenTyp) => void
  onZurueck: () => void
  onPinUngueltig: () => void
}

export function Einstellungen({ pin, status, einstellungen, onGeaendert, onZurueck, onPinUngueltig }: Props): JSX.Element {
  const [kurs, setKurs] = useState('')
  const [druckerName, setDruckerName] = useState('')
  const [praefix, setPraefix] = useState('')
  const [rabatt, setRabatt] = useState('')
  const [veranstaltung, setVeranstaltung] = useState('')
  const [pin1, setPin1] = useState('')
  const [pin2, setPin2] = useState('')
  const [meldung, setMeldung] = useState<{ text: string; art: 'ok' | 'fehler' } | null>(null)
  const [sendet, setSendet] = useState(false)
  const [loeschStufe, setLoeschStufe] = useState<0 | 1 | 2>(0)

  useEffect(() => {
    if (einstellungen !== null) {
      setKurs(formatKurs(einstellungen.eurKursX10000))
      setDruckerName(einstellungen.druckerName)
      setPraefix(einstellungen.kassenPraefix)
      setRabatt(String(rabattSatz(einstellungen)))
      setVeranstaltung(textOderLeer(einstellungen.veranstaltung))
    }
  }, [einstellungen])

  const kursX10000 = parseKurs(kurs)
  const rabattProzent = parseRabattSatz(rabatt)
  const beispielEur = kursX10000 !== null ? chfZuEurCentAufgerundet(7500, kursX10000) : null

  const fehlerBehandeln = (e: unknown): void => {
    if (e instanceof ApiFehler && e.fehler === 'pin_falsch') {
      onPinUngueltig()
      return
    }
    setMeldung({ text: fehlerMeldung(e), art: 'fehler' })
  }

  const speichern = async (mitPin: boolean): Promise<void> => {
    if (sendet) return
    const daten: EinstellungenAenderung = {}
    if (mitPin) {
      if (!istGueltigePin(pin1)) {
        setMeldung({ text: 'Neue PIN muss aus genau 4 Ziffern bestehen.', art: 'fehler' })
        return
      }
      if (pin1 !== pin2) {
        setMeldung({ text: 'Die beiden PIN-Eingaben stimmen nicht überein.', art: 'fehler' })
        return
      }
      daten.neuePin = pin1
    } else {
      if (kursX10000 === null) {
        setMeldung({ text: 'EUR-Kurs ungültig (z. B. 0.90).', art: 'fehler' })
        return
      }
      const dn = druckerName.trim()
      const pf = praefix.trim()
      if (dn === '' || pf === '') {
        setMeldung({ text: 'Druckername und Kassen-Präfix dürfen nicht leer sein.', art: 'fehler' })
        return
      }
      if (rabattProzent === null) {
        setMeldung({
          text: `Rabattsatz muss eine ganze Zahl zwischen ${String(RABATT_PROZENT_MIN)} und ${String(RABATT_PROZENT_MAX)} sein.`,
          art: 'fehler'
        })
        return
      }
      const va = veranstaltung.trim()
      if (va.length > VERANSTALTUNG_MAX_LAENGE) {
        setMeldung({ text: `Veranstaltung darf höchstens ${String(VERANSTALTUNG_MAX_LAENGE)} Zeichen lang sein.`, art: 'fehler' })
        return
      }
      daten.eurKursX10000 = kursX10000
      daten.druckerName = dn
      daten.kassenPraefix = pf
      daten.rabattProzent = rabattProzent
      daten.veranstaltung = va
    }
    setSendet(true)
    try {
      const neu = await api.einstellungenSpeichern(daten, pin)
      onGeaendert(neu)
      setMeldung({ text: mitPin ? 'PIN geändert.' : 'Einstellungen gespeichert.', art: 'ok' })
      if (mitPin) {
        setPin1('')
        setPin2('')
      }
    } catch (e) {
      fehlerBehandeln(e)
    } finally {
      setSendet(false)
    }
  }

  const testdruck = async (): Promise<void> => {
    if (sendet) return
    setSendet(true)
    try {
      await api.testdruck()
      setMeldung({ text: 'Testdruck gestartet (Umlaute, Schnitt, Schubladenimpuls).', art: 'ok' })
    } catch (e) {
      fehlerBehandeln(e)
    } finally {
      setSendet(false)
    }
  }

  const testdatenLoeschen = async (): Promise<void> => {
    setLoeschStufe(0)
    if (sendet) return
    setSendet(true)
    try {
      const r = await api.testdatenLoeschen(pin)
      setMeldung({ text: `Testdaten gelöscht. Backup: ${r.backupPfad}`, art: 'ok' })
    } catch (e) {
      fehlerBehandeln(e)
    } finally {
      setSendet(false)
    }
  }

  const druck = status?.druck ?? null

  return (
    <main className="seite seite-liste">
      <div className="seite-kopf">
        <button type="button" className="knopf knopf-neutral knopf-gross" onClick={onZurueck}>
          ← Zurück zum Verkauf
        </button>
        <h1>Einstellungen</h1>
      </div>

      {meldung !== null ? (
        <div className={`meldung-leiste ${meldung.art === 'ok' ? 'meldung-ok' : 'meldung-fehler'}`} role="status">
          {meldung.text}
          <button type="button" className="knopf knopf-neutral knopf-klein" onClick={() => setMeldung(null)}>
            OK
          </button>
        </div>
      ) : null}

      <div className="einstellungen-inhalt">
        <form
          className="karte formular"
          onSubmit={(ev) => {
            ev.preventDefault()
            void speichern(false)
          }}
        >
          <h2>Kasse und Drucker</h2>
          <label className="feld">
            <span>EUR-Kurs (CHF pro EUR)</span>
            <input type="text" inputMode="decimal" className={`eingabe zahl${kursX10000 === null ? ' eingabe-fehler' : ''}`} value={kurs} onChange={(ev) => setKurs(ev.target.value)} />
            <span className="feld-hinweis zahl">
              {kursX10000 !== null && beispielEur !== null
                ? `1 EUR = ${formatKurs(kursX10000)} CHF · Beispiel: CHF 75.00 = EUR ${formatEur(beispielEur)}`
                : 'ungültiger Kurs'}
            </span>
          </label>
          <label className="feld">
            <span>Druckername (Windows-Warteschlange)</span>
            <input type="text" className="eingabe" value={druckerName} onChange={(ev) => setDruckerName(ev.target.value)} autoComplete="off" />
          </label>
          <label className="feld">
            <span>Kassen-Präfix (Belegnummer, z. B. K1)</span>
            <input type="text" className="eingabe" value={praefix} onChange={(ev) => setPraefix(ev.target.value)} maxLength={8} autoComplete="off" />
            <span className="feld-hinweis zahl">
              Letzte Belegnummer: {einstellungen !== null ? `${einstellungen.kassenPraefix}-${String(einstellungen.belegzaehler).padStart(4, '0')}` : '–'}
            </span>
          </label>
          <label className="feld">
            <span>Rabattsatz in Prozent (Knopf im Warenkorb)</span>
            <input
              type="text"
              inputMode="numeric"
              className={`eingabe zahl${rabattProzent === null ? ' eingabe-fehler' : ''}`}
              value={rabatt}
              onChange={(ev) => setRabatt(ev.target.value)}
              maxLength={2}
              autoComplete="off"
            />
            <span className="feld-hinweis">
              {rabattProzent !== null
                ? `Knopf im Warenkorb: «${String(rabattProzent)}% Rabatt» auf den ganzen Beleg`
                : `ganze Zahl von ${String(RABATT_PROZENT_MIN)} bis ${String(RABATT_PROZENT_MAX)}`}
            </span>
          </label>
          <label className="feld">
            <span>Veranstaltung (Freitext)</span>
            <input
              type="text"
              className="eingabe"
              value={veranstaltung}
              onChange={(ev) => setVeranstaltung(ev.target.value)}
              maxLength={VERANSTALTUNG_MAX_LAENGE}
              autoComplete="off"
            />
            <span className="feld-hinweis">
              erscheint auf dem Abschluss-Bon und in der PDF · höchstens {VERANSTALTUNG_MAX_LAENGE} Zeichen · leer lassen = kein Name
            </span>
          </label>
          <div className="feld">
            <span>Druck-Transport (nur Anzeige)</span>
            <span className="feld-wert">
              {druck !== null ? `${druck.transport} · ${druck.druckerName} · ${druck.ampel === 'ok' ? 'Druck OK' : 'Druck prüfen'}` : '–'}
              {druck !== null && druck.letzterFehler !== null ? ` · letzter Fehler: ${druck.letzterFehler}` : ''}
              {druck !== null && druck.offeneAuftraege > 0 ? ` · offene Aufträge: ${String(druck.offeneAuftraege)}` : ''}
            </span>
          </div>
          <div className="knopfgruppe">
            <button type="submit" className="knopf knopf-primaer knopf-gross" disabled={sendet}>
              Speichern
            </button>
            <button type="button" className="knopf knopf-neutral knopf-gross" onClick={() => void testdruck()} disabled={sendet}>
              Testdruck
            </button>
          </div>
        </form>

        <form
          className="karte formular"
          onSubmit={(ev) => {
            ev.preventDefault()
            void speichern(true)
          }}
        >
          <h2>PIN ändern</h2>
          <label className="feld">
            <span>Neue PIN (4 Ziffern)</span>
            <input type="password" inputMode="numeric" className="eingabe zahl" value={pin1} onChange={(ev) => setPin1(ev.target.value)} maxLength={4} autoComplete="off" />
          </label>
          <label className="feld">
            <span>Neue PIN wiederholen</span>
            <input type="password" inputMode="numeric" className={`eingabe zahl${pin2 !== '' && pin1 !== pin2 ? ' eingabe-fehler' : ''}`} value={pin2} onChange={(ev) => setPin2(ev.target.value)} maxLength={4} autoComplete="off" />
          </label>
          <button type="submit" className="knopf knopf-primaer knopf-gross" disabled={sendet || !istGueltigePin(pin1) || pin1 !== pin2}>
            PIN ändern
          </button>
        </form>

        <section className="karte karte-gefahr">
          <h2>Testdaten löschen</h2>
          <p>Löscht Verkäufe, Positionen, Zahlungen, Storni, Druckaufträge, Kassentage und den Warenkorb-Entwurf; setzt den Belegzähler zurück. Produkte und Einstellungen bleiben. Vorher wird ein Backup angelegt.</p>
          <button type="button" className="knopf knopf-gefahr knopf-gross" onClick={() => setLoeschStufe(1)} disabled={sendet}>
            Testdaten löschen …
          </button>
        </section>
      </div>

      {loeschStufe === 1 ? (
        <Popup titel="Wirklich alle Testdaten löschen?" art="frage" knoepfe={[{ text: 'Abbrechen', art: 'neutral', autoFokus: true, onClick: () => setLoeschStufe(0) }, { text: 'Weiter', art: 'gefahr', onClick: () => setLoeschStufe(2) }]}>
          <p>Alle Verkäufe und Kassentage werden gelöscht. Das lässt sich nur über das Backup rückgängig machen.</p>
        </Popup>
      ) : null}
      {loeschStufe === 2 ? (
        <Popup titel="Letzte Rückfrage: Testdaten jetzt löschen?" art="fehler" knoepfe={[{ text: 'Abbrechen', art: 'neutral', autoFokus: true, onClick: () => setLoeschStufe(0) }, { text: 'Ja, endgültig löschen', art: 'gefahr', onClick: () => void testdatenLoeschen() }]}>
          <p>Nur vor dem Event ausführen, nie während des Betriebs.</p>
        </Popup>
      ) : null}
    </main>
  )
}
