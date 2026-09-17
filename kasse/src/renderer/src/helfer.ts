/**
 * Reine Logik rund um Helfer (ohne React), damit sie testbar bleibt.
 *
 * Fachlicher Hintergrund (Auftrag 17.9.2026): Helfer bekommen das Essen nicht mehr gratis. Sie holen es
 * schnell und zahlen entweder sofort («Gleich zahlen» = normaler Verkauf mit echter Zahlart, der Beleg
 * traegt den Helfernamen) oder erst am Abend («Spaeter zahlen» = zahlart helfer, der Betrag ist eine
 * offene Schuld). Die Schuld wird spaeter ueber Helfer-Zahlungen (Bar CHF / Bar EUR / Twint, Teilzahlungen
 * erlaubt) beglichen. Gerechnet wird in ganzen Rappen bzw. Cent; der offene Saldo kommt vom Server.
 */
import type {
  Helfer,
  HelferSaldo,
  HelferZahlung,
  HelferZahlungAnfrage,
  SpendeTyp,
  Verkauf,
  VerkaufAnfrage,
  VerkaufAntwort,
  Warenkorb,
  Zahlart
} from '@core/types'
import { HELFER_NAME_MAX } from '@core/bon'
import { chfZuEurCentAufgerundet, eurZuChfRappen, formatChf } from '@core/geld'
import { ZAHLART_NAME } from './bezahlen'

export { HELFER_NAME_MAX }

/** Zahlarten, mit denen ein Helfer seine Schuld begleicht (Reihenfolge der Umschalter im Dialog). */
export const HELFER_ZAHLUNG_TYPEN: readonly SpendeTyp[] = ['bar_chf', 'twint', 'bar_eur']

/**
 * Verkaufsantwort des Servers: bei zahlart helfer traegt `offenRappen` den mit diesem Beleg geschuldeten
 * Betrag («spaeter zahlen»), sonst null; fehlt bei alten Servern.
 */
export type VerkaufAntwortMitSaldo = VerkaufAntwort & { offenRappen?: number | null }

/**
 * Antwort von POST /api/helfer/zahlung: die gespeicherte Zahlung und der Saldo des Helfers danach
 * (ueber alle Kassentage, negativ bei Ueberzahlung); `druckauftragId` = Schubladen-Auftrag bei Bargeld.
 */
export interface HelferZahlungAntwort {
  zahlung: HelferZahlung
  saldoNachher: HelferSaldo
  druckauftragId: string | null
  bereitsVorhanden: boolean
}

/** Zeile von GET /api/helfer/zahlungen/letzte: Zahlung, bei Storno mit PIN-Kennzeichen (fehlt bei alten Servern). */
export type LetzteHelferZahlung = HelferZahlung & { mitPin?: boolean }

/**
 * Bereinigt eine Namenseingabe: Rand- und Mehrfach-Leerzeichen weg, hoechstens HELFER_NAME_MAX Zeichen
 * (so viel passt auf den Bon). Leer = kein Name.
 */
export function bereinigeHelferName(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, HELFER_NAME_MAX).trim()
}

/** Ein Name ist gueltig, wenn nach der Bereinigung etwas uebrig bleibt. */
export function istGueltigerHelferName(text: string): boolean {
  return bereinigeHelferName(text) !== ''
}

/** Vergleichsschluessel: Gross-/Kleinschreibung spielt keine Rolle (wie die Tabelle helfer). */
export function helferSchluessel(name: string): string {
  return bereinigeHelferName(name).toLocaleLowerCase('de-CH')
}

/** Alphabetisch (de-CH, ohne Beachtung der Gross-/Kleinschreibung); liefert eine neue Liste. */
export function sortiereHelferNamen(namen: readonly string[]): string[] {
  return [...namen].sort((a, b) => a.localeCompare(b, 'de-CH', { sensitivity: 'base' }))
}

/**
 * Namen fuer die Auswahlknoepfe: alle gespeicherten Helfer plus Namen, die nur in den Salden vorkommen
 * (aeltere Belege), ohne Doppelte (case-insensitiv, erste Schreibweise gewinnt), alphabetisch.
 */
export function helferNamenZurAuswahl(helfer: readonly Pick<Helfer, 'name'>[], salden: readonly Pick<HelferSaldo, 'name'>[]): string[] {
  const gesehen = new Set<string>()
  const namen: string[] = []
  for (const eintrag of [...helfer, ...salden]) {
    const name = bereinigeHelferName(eintrag.name)
    if (name === '') continue
    const schluessel = helferSchluessel(name)
    if (gesehen.has(schluessel)) continue
    gesehen.add(schluessel)
    namen.push(name)
  }
  return sortiereHelferNamen(namen)
}

/**
 * Findet zu einer Eingabe den bereits gespeicherten Namen (gleiche Schreibweise wie in der Tabelle),
 * damit «anna» und «Anna» nicht zwei Helfer werden; null, wenn der Name neu ist.
 */
export function findeBekanntenNamen(namen: readonly string[], eingabe: string): string | null {
  const schluessel = helferSchluessel(eingabe)
  if (schluessel === '') return null
  return namen.find((n) => helferSchluessel(n) === schluessel) ?? null
}

/** Helfername eines Belegs fuer die Anzeige; fehlendes Feld (alter Server) oder leer ergibt null. */
export function helferNameVon(verkauf: Pick<Verkauf, 'helferName'>): string | null {
  const name: unknown = verkauf.helferName
  if (typeof name !== 'string') return null
  const bereinigt = name.trim()
  return bereinigt === '' ? null : bereinigt
}

/** Zahlart-Text in Listen: bei zahlart helfer «offen» (zahlt spaeter), sonst der Zahlartname. */
export function verkaufZahlartText(verkauf: Pick<Verkauf, 'zahlart'>): string {
  return verkauf.zahlart === 'helfer' ? 'offen' : ZAHLART_NAME[verkauf.zahlart]
}

/** Verkaufsanfrage «Spaeter zahlen»: zahlart helfer, keine Zahlung, Rabatt gilt, Name Pflicht. */
export function baueHelferSpaeterAnfrage(id: string, warenkorb: Warenkorb, rabattProzent: number, helferName: string): VerkaufAnfrage {
  return {
    id,
    positionen: warenkorb.zeilen.map((z) => ({ produktId: z.produktId, anzahl: z.anzahl })),
    zahlart: 'helfer',
    gegeben: 0,
    rabattProzent,
    helferName: bereinigeHelferName(helferName),
    spendeBehalten: false,
    bestaetigtHohesRueckgeld: false
  }
}

/** Rueckfrage vor «Spaeter zahlen»: «CHF 12.50 als offene Schuld für Anna speichern?» */
export function spaeterZahlenFrage(name: string, betragRappen: number): string {
  return `CHF ${formatChf(betragRappen)} als offene Schuld für ${name} speichern?`
}

/** Banner nach «Spaeter zahlen»: «Helfer Anna: CHF 12.50 offen (zahlt später)». */
export function helferOffenBannerText(name: string | null, betragRappen: number): string {
  return `Helfer ${name ?? '(ohne Name)'}: CHF ${formatChf(betragRappen)} offen (zahlt später)`
}

/**
 * Zusatz zum Banner, wenn der Server den Gesamtsaldo des Helfers nach diesem Beleg liefert und er sich
 * vom Beleg unterscheidet (mehrere offene Belege): «Saldo gesamt CHF 25.00»; sonst null.
 */
export function helferSaldoZusatz(antwort: Pick<VerkaufAntwortMitSaldo, 'offenRappen'>, belegRappen: number): string | null {
  const offen = antwort.offenRappen
  if (typeof offen !== 'number' || !Number.isFinite(offen) || offen === belegRappen) return null
  return `Saldo gesamt CHF ${formatChf(offen)}`
}

/** Meldung nach einer Helfer-Zahlung: «Anna hat CHF 10.00 bezahlt, offen: CHF 2.50». */
export function helferZahlungMeldung(name: string, bezahltChfRappen: number, offenRappen: number): string {
  return `${name} hat CHF ${formatChf(bezahltChfRappen)} bezahlt, offen: CHF ${formatChf(offenRappen)}`
}

/** Anfrage einer Helfer-Zahlung (betrag in Rappen bzw. Cent bei bar_eur). */
export function baueHelferZahlung(id: string, helferName: string, typ: SpendeTyp, betrag: number): HelferZahlungAnfrage {
  return { id, helferName, typ, betrag }
}

/** CHF-Gegenwert einer Zahlung fuer die Anzeige: bei bar_eur ueber den Kurs (auf 5 Rappen abgerundet), sonst der Betrag. */
export function zahlungChfGegenwert(typ: SpendeTyp, betrag: number, kursX10000: number): number {
  if (typ !== 'bar_eur') return betrag
  if (kursX10000 <= 0 || betrag < 0) return 0
  return eurZuChfRappen(betrag, kursX10000)
}

/**
 * Vorschlag fuer die Betragseingabe: der offene Saldo in der Einheit der Zahlart (bei bar_eur in Cent,
 * auf 10 Cent aufgerundet wie «Total in EUR» im Bezahldialog); ohne Kurs oder ohne Schuld 0.
 */
export function zahlungVorschlag(typ: SpendeTyp, offenRappen: number, kursX10000: number): number {
  if (offenRappen <= 0) return 0
  if (typ !== 'bar_eur') return offenRappen
  if (kursX10000 <= 0) return 0
  return chfZuEurCentAufgerundet(offenRappen, kursX10000)
}

/** Zahlt der Helfer mehr als offen ist? (erlaubt, aber mit Warnung) */
export function ueberSaldo(gegenwertChfRappen: number, offenRappen: number): boolean {
  return gegenwertChfRappen > offenRappen
}

/** Saldo nach einer Zahlung, falls der Server keinen liefert (Anzeige, nie Buchung). */
export function saldoNachZahlung(offenRappen: number, bezahltChfRappen: number): number {
  return offenRappen - bezahltChfRappen
}

/**
 * Offener Saldo aus der Antwort des Servers (`saldoNachher.offenRappen`); fehlt er (alter Server), wird er
 * aus dem bisherigen Saldo und dem CHF-Gegenwert der Zahlung geschaetzt.
 */
export function saldoAusAntwort(antwort: { saldoNachher?: Partial<Pick<HelferSaldo, 'offenRappen'>> | null }, offenVorher: number, bezahltChfRappen: number): number {
  const s: unknown = antwort.saldoNachher?.offenRappen
  if (typeof s === 'number' && Number.isFinite(s)) return s
  return saldoNachZahlung(offenVorher, bezahltChfRappen)
}

/** Salden mit Schuld (> 0), nach Name sortiert (fuer die Tabelle und den Abschluss). */
export function saldenMitSchuld(salden: readonly HelferSaldo[]): HelferSaldo[] {
  return salden
    .filter((s) => s.offenRappen > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'de-CH', { sensitivity: 'base' }))
}

/** Summe aller offenen Schulden (nur Salden > 0; ein Guthaben mindert die Summe nicht). */
export function gesamtOffen(salden: readonly Pick<HelferSaldo, 'offenRappen'>[]): number {
  return salden.reduce((summe, s) => summe + (s.offenRappen > 0 ? s.offenRappen : 0), 0)
}

/** Ob die Zahlart ein Helfer-Weg «Spaeter zahlen» ist (kein Geld in der Lade). */
export function istSpaeterZahlen(zahlart: Zahlart): boolean {
  return zahlart === 'helfer'
}

/** Erzeugt die UUID einer Helfer-Zahlung (Idempotenz wie beim Verkauf). */
export function neueHelferZahlungId(): string {
  return crypto.randomUUID()
}
