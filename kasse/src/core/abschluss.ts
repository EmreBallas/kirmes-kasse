/**
 * Kassenabschluss-Aggregation nach roadmap-v1.md Abschnitt 4.
 * Alle Geldsummen brutto über ALLE Verkäufe des Kassentags (einschliesslich später stornierter);
 * Storni ausschliesslich als Gegenbuchung über storno.kassentagId (Tag des Stornos).
 * Stückzahlen (je Produkt und Helferessen) zählen nur Verkäufe, die nicht am selben Tag storniert wurden.
 * Separat erfasste Spenden (nachträglich, ohne Bon) fliessen in die bestehenden Spende-Zeilen ein und
 * erhöhen den Soll-Bestand (Bar CHF -> Soll CHF, Bar EUR -> Soll EUR, Twint -> kein Bargeld); stornierte zählen nirgends.
 * Beleg-Rabatte sind in verkauf.totalRappen bereits abgezogen (das ist der kassierte Betrag), darum bleiben alle
 * Soll-Formeln unverändert; die Zeile "Rabatte" erklärt nur die Differenz zum Produkt-Umsatz (brutto, volle Preise).
 */
import type { AbschlussBericht, Kassentag, Position, ProduktZeile, Spende, Storno, Verkauf, Zahlung } from './types'

export interface AbschlussInput {
  kassentag: Kassentag
  /** Verkäufe des Kassentags (andere werden ignoriert). */
  verkaeufe: readonly Verkauf[]
  /** Positionen dieser Verkäufe. */
  positionen: readonly Position[]
  /** Zahlungen dieser Verkäufe. */
  zahlungen: readonly Zahlung[]
  /** Storni mit kassentagId = Kassentag des STORNOS (auch Storni von Vortags-Belegen). */
  storni: readonly Storno[]
  /** Separat erfasste Spenden mit kassentagId = Kassentag (stornierte werden ignoriert). */
  spenden: readonly Spende[]
  /** Anzahl Druckaufträge typ LIKE 'nachdruck_%' des Tages. */
  nachdrucke: number
  /** Name des Anlasses (Einstellung `veranstaltung`); leer/fehlend = keine Kopfzeile auf Bon und PDF. */
  veranstaltung?: string
  istChfRappen: number | null
  istEurCent: number | null
  /** Zeitstempel des Berichts (ISO lokal); wird unverändert übernommen. */
  erstelltAm?: string
}

export function berechneAbschluss(input: AbschlussInput): AbschlussBericht {
  const { kassentag } = input
  const verkaeufe = input.verkaeufe.filter((v) => v.kassentagId === kassentag.id)
  const storni = input.storni.filter((s) => s.kassentagId === kassentag.id)
  const spenden = input.spenden.filter((s) => s.kassentagId === kassentag.id && s.storniertAm === null)

  const verkaufIds = new Set(verkaeufe.map((v) => v.id))
  const zahlartVon = new Map(verkaeufe.map((v) => [v.id, v.zahlart] as const))
  const zahlungen = input.zahlungen.filter((z) => verkaufIds.has(z.verkaufId))
  const positionen = input.positionen.filter((p) => verkaufIds.has(p.verkaufId))
  /** Verkäufe, die am HEUTIGEN Tag storniert wurden (Vortags-Storni betreffen nur die Auszahlung). */
  const heuteStorniert = new Set(storni.map((s) => s.verkaufId))

  // --- Separate Spenden (nachträglich erfasst, ohne Bon), je Typ
  const spendenBarChf = spenden.filter((s) => s.typ === 'bar_chf')
  const spendenBarEur = spenden.filter((s) => s.typ === 'bar_eur')
  const spendenTwint = spenden.filter((s) => s.typ === 'twint')
  const spendenSeparatAnzahl = spenden.length
  const spendenSeparatChfRappen = summe(spenden, (s) => s.betragChfRappen)

  // --- Bar CHF
  const barEinnahmenChfRappen = summe(verkaeufe.filter((v) => v.zahlart === 'bar_chf'), (v) => v.totalRappen)
  const barSpendeChfRappen =
    summe(zahlungen.filter((z) => z.spendeTyp === 'bar_chf'), (z) => z.spendeChfRappen) +
    summe(spendenBarChf, (s) => s.betragChfRappen)

  // --- Bar EUR: Stück EUR nur aus Verkäufen; separate EUR-Spenden erhöhen nur den Soll-Bestand EUR
  const zahlungenEur = zahlungen.filter((z) => zahlartVon.get(z.verkaufId) === 'bar_eur')
  const barEinnahmenEurCent = summe(zahlungenEur, (z) => z.gegeben)
  const barEinnahmenEurChfRappen = summe(zahlungenEur, (z) => z.gegebenChfRappen)
  const rueckgeldAusEurRappen = summe(zahlungenEur, (z) => z.rueckgeldChfRappen)
  const barSpendeEurChfRappen =
    summe(zahlungen.filter((z) => z.spendeTyp === 'bar_eur'), (z) => z.spendeChfRappen) +
    summe(spendenBarEur, (s) => s.betragChfRappen)
  const spendenEurCent = summe(spendenBarEur, (s) => s.betrag)

  // --- Twint (Twint-Spenden ändern den Bargeld-Soll nicht)
  const twintVerkaeufe = verkaeufe.filter((v) => v.zahlart === 'twint')
  const twintUmsatzRappen = summe(twintVerkaeufe, (v) => v.totalRappen)
  const twintStorniertRappen = summe(twintVerkaeufe.filter((v) => heuteStorniert.has(v.id)), (v) => v.totalRappen)
  const twintSpendeRappen =
    summe(zahlungen.filter((z) => z.spendeTyp === 'twint'), (z) => z.spendeChfRappen) +
    summe(spendenTwint, (s) => s.betragChfRappen)

  // --- Storni (Gegenbuchung am Tag des Stornos)
  const storniAnzahl = storni.length
  const storniAuszahlungRappen = summe(storni, (s) => s.auszahlungChfRappen)

  // --- Helferessen (Regel 8): Stück nur aus nicht am selben Tag stornierten Helfer-Belegen,
  // konsistent zur Spalte "Helfer" der Produktzeilen (Testfall 28: Storno Helfer-Beleg -> Stück sinken).
  // Die Brutto-Regel gilt für die Geldsummen (Soll); bei Helferessen fliesst kein Geld.
  const helferPositionen = positionen.filter(
    (p) => zahlartVon.get(p.verkaufId) === 'helfer' && !heuteStorniert.has(p.verkaufId)
  )
  const helferessenStueck = summe(helferPositionen, (p) => p.anzahl)
  const helferessenEntgangenRappen = summe(helferPositionen, (p) => p.anzahl * p.preisSnapshotRappen)

  // --- Rabatte: nur nicht (am selben Tag) stornierte Belege mit Rabatt; rein informativ, kein Einfluss auf Soll
  const rabattierte = verkaeufe.filter((v) => !heuteStorniert.has(v.id) && rabattVon(v) > 0)
  const rabatteAnzahl = rabattierte.length
  const rabatteRappen = summe(rabattierte, rabattVon)

  // --- Soll / Ist / Differenz
  const sollChfRappen =
    kassentag.startgeldChfRappen + barEinnahmenChfRappen + barSpendeChfRappen - rueckgeldAusEurRappen - storniAuszahlungRappen
  const sollEurCent = kassentag.startgeldEurCent + barEinnahmenEurCent + spendenEurCent
  const istChfRappen = input.istChfRappen
  const istEurCent = input.istEurCent
  const differenzChfRappen = istChfRappen === null ? null : istChfRappen - sollChfRappen
  const differenzEurCent = istEurCent === null ? null : istEurCent - sollEurCent

  // --- Belege: Verkäufe des Tages minus am selben Tag stornierte
  const anzahlBelege = verkaeufe.filter((v) => !heuteStorniert.has(v.id)).length

  const bericht: AbschlussBericht = {
    kassentagId: kassentag.id,
    datum: kassentag.datum,
    kassier: kassentag.kassier,
    kassePraefix: kassentag.kassePraefix,
    startgeldChfRappen: kassentag.startgeldChfRappen,
    startgeldEurCent: kassentag.startgeldEurCent,
    barEinnahmenChfRappen,
    barSpendeChfRappen,
    barEinnahmenEurCent,
    barEinnahmenEurChfRappen,
    rueckgeldAusEurRappen,
    barSpendeEurChfRappen,
    twintUmsatzRappen,
    twintStorniertRappen,
    twintSpendeRappen,
    spendenSeparatAnzahl,
    spendenSeparatChfRappen,
    storniAnzahl,
    storniAuszahlungRappen,
    helferessenStueck,
    helferessenEntgangenRappen,
    rabatteAnzahl,
    rabatteRappen,
    nachdrucke: input.nachdrucke,
    sollChfRappen,
    sollEurCent,
    istChfRappen,
    istEurCent,
    differenzChfRappen,
    differenzEurCent,
    anzahlBelege,
    produkte: produktZeilen(positionen, zahlartVon, heuteStorniert),
    erstelltAm: input.erstelltAm ?? ''
  }
  const veranstaltung = (input.veranstaltung ?? '').trim()
  if (veranstaltung !== '') bericht.veranstaltung = veranstaltung
  return bericht
}

/** Rabatt eines Belegs in Rappen; Belege aus älteren Datenbeständen ohne Feld zählen als 0. */
function rabattVon(v: Verkauf): number {
  return Number.isSafeInteger(v.rabattRappen) && v.rabattRappen > 0 ? v.rabattRappen : 0
}

/** Stück je Produkt: nur nicht (am selben Tag) stornierte Verkäufe; verkauft/helfer getrennt; sortiert nach Name. */
function produktZeilen(
  positionen: readonly Position[],
  zahlartVon: ReadonlyMap<string, Verkauf['zahlart']>,
  storniert: ReadonlySet<string>
): ProduktZeile[] {
  const zeilen = new Map<string, ProduktZeile>()
  for (const p of positionen) {
    if (storniert.has(p.verkaufId)) continue
    const zeile = zeilen.get(p.produktId) ?? {
      produktId: p.produktId,
      name: p.nameSnapshot,
      verkauft: 0,
      helfer: 0,
      umsatzRappen: 0
    }
    if (zahlartVon.get(p.verkaufId) === 'helfer') {
      zeile.helfer += p.anzahl
    } else {
      zeile.verkauft += p.anzahl
      zeile.umsatzRappen += p.anzahl * p.preisSnapshotRappen
    }
    zeilen.set(p.produktId, zeile)
  }
  return [...zeilen.values()].sort((a, b) => a.name.localeCompare(b.name, 'de-CH'))
}

function summe<T>(liste: readonly T[], wert: (t: T) => number): number {
  return liste.reduce((s, t) => s + wert(t), 0)
}
