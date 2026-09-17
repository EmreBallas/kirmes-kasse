/**
 * Kassenabschluss-Aggregation nach roadmap-v1.md Abschnitt 4.
 * Alle Geldsummen brutto über ALLE Verkäufe des Kassentags (einschliesslich später stornierter);
 * Storni ausschliesslich als Gegenbuchung über storno.kassentagId (Tag des Stornos).
 * Stückzahlen (je Produkt und Helferessen) zählen nur Verkäufe, die nicht am selben Tag storniert wurden.
 * Separat erfasste Spenden (nachträglich, ohne Bon) fliessen in die bestehenden Spende-Zeilen ein und
 * erhöhen den Soll-Bestand (Bar CHF -> Soll CHF, Bar EUR -> Soll EUR, Twint -> kein Bargeld); stornierte zählen nirgends.
 * Beleg-Rabatte sind in verkauf.totalRappen bereits abgezogen (das ist der kassierte Betrag), darum bleiben alle
 * Soll-Formeln unverändert; die Zeile "Rabatte" erklärt nur die Differenz zum Produkt-Umsatz (brutto, volle Preise).
 *
 * Helfer (ab 17.9.2026, Helfer zahlen ihr Essen): Ein Helfer-Verkauf trägt den Helfernamen. «Gleich zahlen» ist ein
 * normaler Verkauf mit echter Zahlart (steckt in Bar-/Twint-Einnahmen); «später zahlen» (zahlart helfer) hat das volle,
 * ggf. rabattierte Total als offene Schuld, kein Geld in der Lade. Helfer-Zahlungen auf diese Schuld (Tabelle
 * helfer_zahlung) des Tages erhöhen den Soll-Bestand wie Spenden (Bar CHF -> Soll CHF, Bar EUR -> Soll EUR, Twint nichts).
 * Die offenen Salden je Name rechnet der Server über alle Kassentage; der Core übernimmt sie nur (Saldo > 0, sortiert).
 */
import type {
  AbschlussBericht,
  HelferSaldo,
  HelferZahlung,
  Kassentag,
  Position,
  ProduktZeile,
  Spende,
  Storno,
  Verkauf,
  Zahlung
} from './types'

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
  /** Helfer-Zahlungen mit kassentagId = Kassentag (stornierte werden ignoriert). */
  helferZahlungen: readonly HelferZahlung[]
  /** Offene Helfer-Salden über ALLE Kassentage (vom Server berechnet); der Core filtert Saldo > 0 und summiert. */
  helferSalden: readonly HelferSaldo[]
  /** Anzahl Druckaufträge typ LIKE 'nachdruck_%' des Tages. */
  nachdrucke: number
  /** Name des Anlasses (Einstellung `veranstaltung`); leer/fehlend = keine Kopfzeile auf Bon und PDF. */
  veranstaltung?: string
  istChfRappen: number | null
  istEurCent: number | null
  /** Zeitstempel des Berichts (ISO lokal); wird unverändert übernommen. */
  erstelltAm?: string
}

/**
 * Helfer-Verkauf = Beleg mit Helfernamen (sofort oder später bezahlt). Belege mit zahlart helfer aus älteren
 * Datenbeständen ohne Namen zählen ebenfalls als Helfer-Verkauf («später zahlen»).
 */
export function istHelferVerkauf(v: Verkauf): boolean {
  return v.zahlart === 'helfer' || (typeof v.helferName === 'string' && v.helferName.trim() !== '')
}

export function berechneAbschluss(input: AbschlussInput): AbschlussBericht {
  const { kassentag } = input
  const verkaeufe = input.verkaeufe.filter((v) => v.kassentagId === kassentag.id)
  const storni = input.storni.filter((s) => s.kassentagId === kassentag.id)
  const spenden = input.spenden.filter((s) => s.kassentagId === kassentag.id && s.storniertAm === null)
  const helferZahlungen = input.helferZahlungen.filter((h) => h.kassentagId === kassentag.id && h.storniertAm === null)

  const verkaufIds = new Set(verkaeufe.map((v) => v.id))
  const zahlartVon = new Map(verkaeufe.map((v) => [v.id, v.zahlart] as const))
  const zahlungen = input.zahlungen.filter((z) => verkaufIds.has(z.verkaufId))
  const positionen = input.positionen.filter((p) => verkaufIds.has(p.verkaufId))
  /** Verkäufe, die am HEUTIGEN Tag storniert wurden (Vortags-Storni betreffen nur die Auszahlung). */
  const heuteStorniert = new Set(storni.map((s) => s.verkaufId))
  /** Helfer-Verkäufe des Tages (sofort und später), nicht am selben Tag storniert. */
  const helferVerkaufIds = new Set(verkaeufe.filter((v) => istHelferVerkauf(v) && !heuteStorniert.has(v.id)).map((v) => v.id))

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

  // --- Helferessen: Stück und Betrag der Helfer-Verkäufe des Tages (sofort + später), ohne am selben Tag stornierte,
  // konsistent zur Spalte "Helfer" der Produktzeilen (Testfall 28: Storno Helfer-Beleg -> Stück und Betrag sinken).
  // «sofort» steckt bereits in den Bar-/Twint-Einnahmen (Brutto-Regel), «später» ist heute entstandene Schuld.
  const helferVerkaeufe = verkaeufe.filter((v) => helferVerkaufIds.has(v.id))
  const helferessenStueck = summe(positionen.filter((p) => helferVerkaufIds.has(p.verkaufId)), (p) => p.anzahl)
  const helferessenBetragRappen = summe(helferVerkaeufe, (v) => v.totalRappen)
  const helferSpaeterRappen = summe(helferVerkaeufe.filter((v) => v.zahlart === 'helfer'), (v) => v.totalRappen)
  const helferSofortRappen = helferessenBetragRappen - helferSpaeterRappen

  // --- Helfer-Zahlungen des Tages (auf offene Schulden, ggf. aus früheren Tagen): Bargeld in der Lade wie Spenden
  const helferZahlungenBarChfRappen = summe(helferZahlungen.filter((h) => h.typ === 'bar_chf'), (h) => h.betragChfRappen)
  const helferZahlungenEur = helferZahlungen.filter((h) => h.typ === 'bar_eur')
  const helferZahlungenEurCent = summe(helferZahlungenEur, (h) => h.betrag)
  const helferZahlungenEurChfRappen = summe(helferZahlungenEur, (h) => h.betragChfRappen)
  const helferZahlungenTwintRappen = summe(helferZahlungen.filter((h) => h.typ === 'twint'), (h) => h.betragChfRappen)

  // --- Offene Helfer-Schulden über alle Tage (Salden vom Server): nur Saldo > 0, nach Name sortiert
  const helferOffen = input.helferSalden
    .filter((s) => s.offenRappen > 0)
    .map((s) => ({ ...s }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de-CH'))
  const helferOffenGesamtRappen = summe(helferOffen, (s) => s.offenRappen)

  // --- Rabatte: nur nicht (am selben Tag) stornierte Belege mit Rabatt; rein informativ, kein Einfluss auf Soll
  const rabattierte = verkaeufe.filter((v) => !heuteStorniert.has(v.id) && rabattVon(v) > 0)
  const rabatteAnzahl = rabattierte.length
  const rabatteRappen = summe(rabattierte, rabattVon)

  // --- Soll / Ist / Differenz (Helfer-Zahlungen Bar CHF / Bar EUR liegen in der Lade)
  const sollChfRappen =
    kassentag.startgeldChfRappen +
    barEinnahmenChfRappen +
    barSpendeChfRappen -
    rueckgeldAusEurRappen -
    storniAuszahlungRappen +
    helferZahlungenBarChfRappen
  const sollEurCent = kassentag.startgeldEurCent + barEinnahmenEurCent + spendenEurCent + helferZahlungenEurCent
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
    helferessenBetragRappen,
    helferSofortRappen,
    helferSpaeterRappen,
    helferZahlungenBarChfRappen,
    helferZahlungenEurCent,
    helferZahlungenEurChfRappen,
    helferZahlungenTwintRappen,
    helferOffenGesamtRappen,
    helferOffen,
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
    produkte: produktZeilen(positionen, helferVerkaufIds, heuteStorniert),
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

/**
 * Stück je Produkt: nur nicht (am selben Tag) stornierte Verkäufe; Spalte "Helfer" = Verkäufe mit Helfername
 * (sofort und später), "verkauft" = übrige; Umsatz = beide zusammen zu vollen Preisen; sortiert nach Name.
 */
function produktZeilen(
  positionen: readonly Position[],
  helferVerkaufIds: ReadonlySet<string>,
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
    if (helferVerkaufIds.has(p.verkaufId)) {
      zeile.helfer += p.anzahl
    } else {
      zeile.verkauft += p.anzahl
    }
    zeile.umsatzRappen += p.anzahl * p.preisSnapshotRappen
    zeilen.set(p.produktId, zeile)
  }
  return [...zeilen.values()].sort((a, b) => a.name.localeCompare(b.name, 'de-CH'))
}

function summe<T>(liste: readonly T[], wert: (t: T) => number): number {
  return liste.reduce((s, t) => s + wert(t), 0)
}
