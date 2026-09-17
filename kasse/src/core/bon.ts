/**
 * Bon-Modelle (core -> print): Beleg (Coupons + Bon 1), Kassenabschluss, Testdruck.
 * Layout für 80 mm, Font A: 48 Zeichen normal, 24 doppelt, 16 dreifach.
 * Das Modell garantiert, dass keine Zeile länger als ihre Spaltenzahl ist.
 */
import { formatChf, formatEur, formatKurs, formatAbzug } from './geld'
import type {
  AbschlussBericht,
  BonAusrichtung,
  BonDokument,
  BonGroesse,
  BonZeile,
  DruckModell,
  Position,
  Verkauf,
  Zahlung
} from './types'

export type NachdruckArt = 'alles' | 'coupons' | 'bon' | null

export interface BonOptionen {
  nachdruck: NachdruckArt
}

/** Zeichen pro Zeile je Schriftgrösse (80 mm, Font A). */
export const SPALTEN: Record<BonGroesse, number> = { normal: 48, doppelt: 24, dreifach: 16 }

/** Maximale Länge eines Produktnamens (passt doppelt breit auf den Coupon). */
export const NAME_MAX = 24

/** Maximale Länge des Helfernamens auf dem Bon (wie Produktnamen: passt doppelt breit). */
export const HELFER_NAME_MAX = NAME_MAX
/** Zeile unter dem Helfernamen bei «später zahlen» (doppelt, 24 Zeichen; Bindestrich statt Gedankenstrich wegen cp857). */
export const HELFER_OFFEN_TEXT = 'OFFEN - zahlt später'

const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'] as const

// ---------------------------------------------------------------- Text-Helfer

/** Schneidet Text hart auf n Zeichen ab. */
export function kuerze(text: string, n: number): string {
  return text.length > n ? text.slice(0, n) : text
}

/** Label links, Wert rechts, aufgefüllt auf `breite` Zeichen; passt der Wert nicht, wird das Label gekürzt. */
export function labelWert(label: string, wert: string, breite = SPALTEN.normal): string {
  const wertKurz = kuerze(wert, breite)
  const platz = breite - wertKurz.length
  const labelKurz = kuerze(label, Math.max(0, platz - 1))
  return labelKurz.padEnd(platz) + wertKurz
}

/** Positionszeile `{anzahl:>3} {name:<34}{betrag:>10}` (48 Zeichen). */
export function positionsZeile(anzahl: number, name: string, betrag: string): string {
  const anzahlText = String(anzahl).padStart(3)
  const betragText = betrag.padStart(10)
  const nameBreite = SPALTEN.normal - anzahlText.length - 1 - betragText.length
  return `${anzahlText} ${kuerze(name, nameBreite).padEnd(nameBreite)}${betragText}`
}

function zeile(text: string, groesse: BonGroesse = 'normal', ausrichtung: BonAusrichtung = 'links', fett = false): BonZeile {
  const z: BonZeile = { text: kuerze(text, SPALTEN[groesse]) }
  if (groesse !== 'normal') z.groesse = groesse
  if (ausrichtung !== 'links') z.ausrichtung = ausrichtung
  if (fett) z.fett = true
  return z
}

const LEER: BonZeile = { text: '' }
const TRENNLINIE: BonZeile = { text: '-'.repeat(SPALTEN.normal) }

// ---------------------------------------------------------------- Datum / Zeit

interface ZeitTeile {
  jahr: number
  monat: number
  tag: number
  stunde: number
  minute: number
}

/** Zerlegt ISO lokal ("2026-09-19T14:32:05") oder ein reines Datum ("2026-09-19"); null bei Fremdformat. */
function zerlegeZeit(iso: string): ZeitTeile | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(iso)
  if (m === null) return null
  return {
    jahr: Number(m[1]),
    monat: Number(m[2]),
    tag: Number(m[3]),
    stunde: m[4] === undefined ? 0 : Number(m[4]),
    minute: m[5] === undefined ? 0 : Number(m[5])
  }
}

const zweistellig = (n: number): string => String(n).padStart(2, '0')

/** "Sa 19.09.2026" aus ISO-Zeit oder Datum; unbekanntes Format wird unverändert zurückgegeben. */
export function formatDatum(iso: string): string {
  const t = zerlegeZeit(iso)
  if (t === null) return iso
  const wochentag = WOCHENTAGE[new Date(Date.UTC(t.jahr, t.monat - 1, t.tag)).getUTCDay()] ?? ''
  return `${wochentag} ${zweistellig(t.tag)}.${zweistellig(t.monat)}.${String(t.jahr)}`
}

/** "14:32" aus ISO-Zeit; unbekanntes Format wird unverändert zurückgegeben. */
export function formatUhrzeit(iso: string): string {
  const t = zerlegeZeit(iso)
  if (t === null) return iso
  return `${zweistellig(t.stunde)}:${zweistellig(t.minute)}`
}

/** "Sa 19.09.2026  14:32" (zwei Leerzeichen zwischen Datum und Uhrzeit). */
export function formatDatumUhrzeit(iso: string): string {
  return `${formatDatum(iso)}  ${formatUhrzeit(iso)}`
}

// ---------------------------------------------------------------- Beleg

function couponDokument(
  position: Position,
  n: number,
  m: number,
  verkauf: Verkauf,
  nachdruck: boolean
): BonDokument {
  const zeilen: BonZeile[] = []
  if (nachdruck) zeilen.push(zeile('NACHDRUCK', 'doppelt', 'mitte', true))
  zeilen.push(zeile(`${String(position.anzahl)}x`, 'dreifach', 'mitte', true))
  zeilen.push(zeile(kuerze(position.nameSnapshot, NAME_MAX), 'doppelt', 'mitte', true))
  zeilen.push(LEER)
  zeilen.push(zeile(formatDatumUhrzeit(verkauf.zeit), 'normal', 'mitte'))
  zeilen.push(zeile(`${verkauf.belegnr}   Coupon ${String(n)}/${String(m)}`, 'normal', 'mitte'))
  return { zeilen }
}

function bon1Dokument(verkauf: Verkauf, positionen: readonly Position[], zahlung: Zahlung, nachdruck: boolean): BonDokument {
  const zeilen: BonZeile[] = []
  if (nachdruck) {
    zeilen.push(zeile('NACHDRUCK', 'doppelt', 'mitte', true))
    zeilen.push(LEER)
  }
  for (const p of positionen) {
    zeilen.push(zeile(positionsZeile(p.anzahl, p.nameSnapshot, formatChf(p.anzahl * p.preisSnapshotRappen))))
  }
  zeilen.push(TRENNLINIE)
  // Beleg-Rabatt (ganzer Beleg, nicht einzelne Positionen): Zwischensumme zu vollen Preisen, dann der Abzug.
  const rabattRappen = rabattVon(verkauf)
  if (rabattRappen > 0) {
    zeilen.push(zeile(labelWert('Zwischensumme', formatChf(verkauf.totalRappen + rabattRappen))))
    zeilen.push(zeile(labelWert(`Rabatt ${String(verkauf.rabattProzent)}%`, formatAbzug(rabattRappen))))
  }
  zeilen.push(zeile(labelWert('TOTAL CHF', formatChf(verkauf.totalRappen)), 'normal', 'links', true))

  switch (verkauf.zahlart) {
    case 'bar_chf':
      zeilen.push(zeile(labelWert('Gegeben CHF', formatChf(zahlung.gegeben))))
      if (zahlung.spendeChfRappen > 0) zeilen.push(zeile(labelWert('Spende CHF', formatChf(zahlung.spendeChfRappen))))
      zeilen.push(zeile(labelWert('RÜCKGELD CHF', formatChf(zahlung.rueckgeldChfRappen), SPALTEN.doppelt), 'doppelt', 'links', true))
      break
    case 'bar_eur':
      zeilen.push(zeile(labelWert('Gegeben EUR', formatEur(zahlung.gegeben))))
      zeilen.push(zeile(labelWert(`Kurs ${formatKurs(zahlung.kursX10000 ?? 0)}`, `CHF ${formatChf(zahlung.gegebenChfRappen)}`)))
      if (zahlung.spendeChfRappen > 0) zeilen.push(zeile(labelWert('Spende CHF', formatChf(zahlung.spendeChfRappen))))
      zeilen.push(zeile(labelWert('RÜCKGELD CHF', formatChf(zahlung.rueckgeldChfRappen), SPALTEN.doppelt), 'doppelt', 'links', true))
      break
    case 'twint':
      // Kennzeichnung TWINT: der Kassier sieht bei Reklamation/Storno sofort, dass kein Bargeld in der Lade liegt.
      zeilen.push(zeile(labelWert('Gegeben CHF - TWINT', formatChf(zahlung.gegeben))))
      if (zahlung.spendeChfRappen > 0) zeilen.push(zeile(labelWert('Spende CHF - TWINT', formatChf(zahlung.spendeChfRappen))))
      break
    case 'helfer':
      // «Später zahlen»: statt Gegeben/Rückgeld der Helfername (doppelt) und der Hinweis, dass das Total offen ist.
      zeilen.push(...helferZeilenDoppelt(helferNameVon(verkauf)))
      zeilen.push(zeile(HELFER_OFFEN_TEXT, 'doppelt', 'mitte', true))
      break
  }
  // «Gleich zahlen»: normale Zahlungszeilen, dazu der Helfername (der Beleg gehört zum Helferessen).
  const helferName = helferNameVon(verkauf)
  if (verkauf.zahlart !== 'helfer' && helferName !== null) {
    zeilen.push(zeile(`Helfer: ${kuerze(helferName, HELFER_NAME_MAX)}`))
  }

  zeilen.push(LEER)
  zeilen.push(zeile(`${verkauf.belegnr}  ${formatUhrzeit(verkauf.zeit)}`, 'normal', 'rechts'))
  return { zeilen }
}

/** Helfername eines Belegs, getrimmt; null bei gewöhnlichen Verkäufen (und älteren Datenbeständen ohne Feld). */
function helferNameVon(verkauf: Verkauf): string | null {
  const name = typeof verkauf.helferName === 'string' ? verkauf.helferName.trim() : ''
  return name === '' ? null : name
}

/**
 * «HELFER: <Name>» doppelt fett zentriert. Passt Name samt Präfix nicht in 24 Zeichen, stehen «HELFER:» und der
 * (auf 24 Zeichen gekürzte) Name auf zwei Zeilen, damit der Name nie abgeschnitten wird. Ohne Namen (alte Belege) «HELFER».
 */
function helferZeilenDoppelt(name: string | null): BonZeile[] {
  if (name === null) return [zeile('HELFER', 'doppelt', 'mitte', true)]
  const kurz = kuerze(name, HELFER_NAME_MAX)
  const einzeilig = `HELFER: ${kurz}`
  if (einzeilig.length <= SPALTEN.doppelt) return [zeile(einzeilig, 'doppelt', 'mitte', true)]
  return [zeile('HELFER:', 'doppelt', 'mitte', true), zeile(kurz, 'doppelt', 'mitte', true)]
}

/** Rabatt eines Belegs in Rappen; Belege ohne Rabatt (oder aus älteren Datenbeständen) ergeben 0. */
function rabattVon(verkauf: Verkauf): number {
  return Number.isSafeInteger(verkauf.rabattRappen) && verkauf.rabattRappen > 0 ? verkauf.rabattRappen : 0
}

/**
 * Druckmodell eines Belegs: Coupons (je Position der Gruppe `coupon`), dann Bon 1.
 * Schublade nur beim Erstdruck von Bar-Zahlungen (Fachregel 10), beim Nachdruck nie (Fachregel 14).
 */
export function bonModellVerkauf(
  verkauf: Verkauf,
  positionen: readonly Position[],
  zahlung: Zahlung,
  opts: BonOptionen
): DruckModell {
  const nachdruck = opts.nachdruck !== null
  const mitCoupons = opts.nachdruck === null || opts.nachdruck === 'alles' || opts.nachdruck === 'coupons'
  const mitBon = opts.nachdruck === null || opts.nachdruck === 'alles' || opts.nachdruck === 'bon'

  const dokumente: BonDokument[] = []
  if (mitCoupons) {
    const couponPositionen = positionen.filter((p) => p.gruppeSnapshot === 'coupon')
    couponPositionen.forEach((p, i) => {
      dokumente.push(couponDokument(p, i + 1, couponPositionen.length, verkauf, nachdruck))
    })
  }
  if (mitBon) dokumente.push(bon1Dokument(verkauf, positionen, zahlung, nachdruck))

  const bar = verkauf.zahlart === 'bar_chf' || verkauf.zahlart === 'bar_eur'
  return { schublade: bar && !nachdruck, dokumente }
}

// ---------------------------------------------------------------- Abschluss

const offenOder = (wert: number | null, format: (n: number) => string): string => (wert === null ? 'offen' : format(wert))

export interface AbschlussBonOptionen {
  /** true: Nachdruck eines bereits abgeschlossenen Tages, erste Zeile "NACHDRUCK" doppelt fett */
  nachdruck: boolean
}

/** Maximale Länge des Veranstaltungsnamens (Einstellung `veranstaltung`); passt doppelt breit auf den Bon. */
export const VERANSTALTUNG_MAX_LAENGE = 40

/**
 * Abschluss-Bon: alle Zeilen des Berichts, Stück je Produkt, offene Helfer-Schulden, Kassier, Unterschriftslinie.
 * Keine Schublade.
 * Der Name des Anlasses kommt über `bericht.veranstaltung` (Einstellung `veranstaltung`, vom Server in den
 * AbschlussInput gelegt) und steht – falls nicht leer – zentriert und doppelt gross über "KASSENABSCHLUSS".
 */
export function bonModellAbschluss(b: AbschlussBericht, opts: AbschlussBonOptionen = { nachdruck: false }): DruckModell {
  const z: BonZeile[] = []
  if (opts.nachdruck) z.push(zeile('NACHDRUCK', 'doppelt', 'mitte', true))
  const veranstaltung = kuerze((b.veranstaltung ?? '').trim(), VERANSTALTUNG_MAX_LAENGE)
  if (veranstaltung !== '') z.push(zeile(veranstaltung, 'doppelt', 'mitte', true))
  z.push(zeile('KASSENABSCHLUSS', 'doppelt', 'mitte', true))
  z.push(zeile(`${formatDatum(b.datum)}   Kasse ${b.kassePraefix}`, 'normal', 'mitte'))
  z.push(zeile(`Kassier: ${b.kassier}`, 'normal', 'mitte'))
  if (b.erstelltAm !== '') z.push(zeile(`Erstellt: ${formatDatumUhrzeit(b.erstelltAm)}`, 'normal', 'mitte'))
  z.push(TRENNLINIE)

  z.push(zeile(labelWert('Startgeld CHF', formatChf(b.startgeldChfRappen))))
  z.push(zeile(labelWert('Startgeld EUR', formatEur(b.startgeldEurCent))))
  z.push(zeile(labelWert('Bar CHF (brutto)', formatChf(b.barEinnahmenChfRappen))))
  z.push(zeile(labelWert('Bar EUR Stück', `EUR ${formatEur(b.barEinnahmenEurCent)}`)))
  z.push(zeile(labelWert('Bar EUR Gegenwert CHF', formatChf(b.barEinnahmenEurChfRappen))))
  z.push(zeile(labelWert('Rückgeld aus EUR CHF', formatAbzug(b.rueckgeldAusEurRappen))))
  z.push(zeile(labelWert('Twint brutto CHF', formatChf(b.twintUmsatzRappen))))
  z.push(zeile(labelWert('  davon storniert', formatChf(b.twintStorniertRappen))))
  z.push(zeile(labelWert('Spende Bar CHF', formatChf(b.barSpendeChfRappen))))
  z.push(zeile(labelWert('Spende Bar EUR (CHF)', formatChf(b.barSpendeEurChfRappen))))
  z.push(zeile(labelWert('Spende Twint CHF', formatChf(b.twintSpendeRappen))))
  z.push(zeile(labelWert(`  davon separat erfasst (${String(b.spendenSeparatAnzahl)})`, formatChf(b.spendenSeparatChfRappen))))
  z.push(zeile(labelWert(`Storni (${String(b.storniAnzahl)})`, formatAbzug(b.storniAuszahlungRappen))))
  // Helferessen: Betrag aller Helfer-Verkäufe des Tages; «sofort» steckt schon in Bar/Twint, «später» ist Schuld.
  z.push(zeile(labelWert(`Helferessen (${String(b.helferessenStueck)} Stück)`, formatChf(b.helferessenBetragRappen))))
  z.push(zeile(labelWert('  davon sofort bezahlt', formatChf(b.helferSofortRappen))))
  z.push(zeile(labelWert('  davon später zahlen (heute offen)', formatChf(b.helferSpaeterRappen))))
  // Helfer-Zahlungen (heute erhalten): Bar CHF/EUR liegen in der Lade und stecken im Soll, Twint nicht.
  z.push(zeile(labelWert('Helfer-Zahlungen Bar CHF', formatChf(b.helferZahlungenBarChfRappen))))
  z.push(zeile(labelWert('Helfer-Zahlungen Bar EUR (CHF-Gegenwert)', formatChf(b.helferZahlungenEurChfRappen))))
  z.push(zeile(labelWert('  davon Stück EUR', `EUR ${formatEur(b.helferZahlungenEurCent)}`)))
  z.push(zeile(labelWert('Helfer-Zahlungen Twint', formatChf(b.helferZahlungenTwintRappen))))
  // Rabatte: Umsatz je Produkt bleibt brutto (volle Preise), diese Zeile erklärt die Differenz zu den Einnahmen.
  z.push(zeile(labelWert(`Rabatte (${String(b.rabatteAnzahl)} Belege)`, formatChf(b.rabatteRappen))))
  z.push(zeile(labelWert('Nachdrucke', String(b.nachdrucke))))
  z.push(TRENNLINIE)

  z.push(zeile(labelWert('SOLL CHF', formatChf(b.sollChfRappen)), 'normal', 'links', true))
  z.push(zeile(labelWert('IST CHF', offenOder(b.istChfRappen, formatChf))))
  z.push(zeile(labelWert('DIFFERENZ CHF', offenOder(b.differenzChfRappen, formatChf), SPALTEN.doppelt), 'doppelt', 'links', true))
  z.push(zeile(labelWert('SOLL EUR', formatEur(b.sollEurCent)), 'normal', 'links', true))
  z.push(zeile(labelWert('IST EUR', offenOder(b.istEurCent, formatEur))))
  z.push(zeile(labelWert('DIFFERENZ EUR', offenOder(b.differenzEurCent, formatEur), SPALTEN.doppelt), 'doppelt', 'links', true))
  z.push(TRENNLINIE)

  z.push(zeile(labelWert('Belege (ohne stornierte)', String(b.anzahlBelege))))
  z.push(LEER)
  z.push(zeile(produktZeile('Produkt', 'Verk.', 'Helfer', 'Umsatz'), 'normal', 'links', true))
  let umsatzTotal = 0
  for (const p of b.produkte) {
    umsatzTotal += p.umsatzRappen
    z.push(zeile(produktZeile(p.name, String(p.verkauft), String(p.helfer), formatChf(p.umsatzRappen))))
  }
  z.push(zeile(labelWert('Umsatz Produkte CHF', formatChf(umsatzTotal))))
  z.push(TRENNLINIE)

  // Offene Helfer-Schulden über ALLE Kassentage (nicht nur heute): Gesamtsumme, dann je Helfer eine Zeile.
  z.push(zeile('OFFENE HELFER-SCHULDEN', 'normal', 'links', true))
  z.push(zeile(labelWert('Gesamt CHF', formatChf(b.helferOffenGesamtRappen)), 'normal', 'links', true))
  if (b.helferOffen.length === 0) {
    z.push(zeile('  keine'))
  }
  for (const h of b.helferOffen) {
    z.push(zeile(labelWert(`  ${kuerze(h.name, HELFER_NAME_MAX)}`, formatChf(h.offenRappen))))
  }
  z.push(TRENNLINIE)
  z.push(LEER)
  z.push(zeile(`Kassier: ${b.kassier}`))
  z.push(LEER)
  z.push(LEER)
  z.push(zeile('_'.repeat(SPALTEN.normal)))
  z.push(zeile('Unterschrift Kassier'))
  return { schublade: false, dokumente: [{ zeilen: z }] }
}

/** `{name:<24}{verkauft:>6}{helfer:>6}{umsatz:>12}` = 48 Zeichen. */
export function produktZeile(name: string, verkauft: string, helfer: string, umsatz: string): string {
  return `${kuerze(name, NAME_MAX).padEnd(NAME_MAX)}${verkauft.padStart(6)}${helfer.padStart(6)}${umsatz.padStart(12)}`
}

// ---------------------------------------------------------------- Testdruck

export function bonModellTest(): DruckModell {
  return {
    schublade: false,
    dokumente: [
      {
        zeilen: [
          zeile('TESTDRUCK', 'doppelt', 'mitte', true),
          zeile('Vereins-Kasse', 'normal', 'mitte'),
          LEER,
          zeile('Umlaute: Ärger Öl Übung äöü', 'normal', 'links'),
          zeile('123456789012345678901234567890123456789012345678'),
          TRENNLINIE,
          zeile('dreifach 16 Zeich', 'dreifach', 'links', true),
          zeile('doppelt 24 Zeichen', 'doppelt', 'mitte'),
          zeile('rechts', 'normal', 'rechts'),
          LEER,
          zeile('Druck OK, wenn alles lesbar ist.', 'normal', 'mitte')
        ]
      }
    ]
  }
}
