/**
 * Reine Entscheidungslogik des Bezahldialogs (ohne React), damit sie testbar bleibt.
 */
import type {
  Druckauftrag,
  DruckStatus,
  Position,
  Spende,
  Storno,
  VerkaufAnfrage,
  VerkaufAntwort,
  Warenkorb,
  Zahlart,
  ZahlungsErgebnis,
  ZahlungsWarnung
} from '@core/types'
import { formatChf } from '@core/geld'
import { betragAusText } from './betrag'

/** Schnellwahl-Betraege in Rappen bzw. Cent (10, 20, 50, 100, 200). */
export const SCHNELLWAHL: readonly number[] = [1000, 2000, 5000, 10000, 20000]

export const ZAHLART_NAME: Record<Zahlart, string> = {
  bar_chf: 'Bar CHF',
  bar_eur: 'Bar EUR',
  twint: 'Twint',
  helfer: 'Helfer'
}

export const STORNO_GRUND_NAME = {
  tippfehler: 'Tippfehler',
  ausverkauft: 'Ausverkauft',
  abgesprungen: 'Kunde abgesprungen'
} as const

export type VorSenden = 'nicht_gedeckt' | 'bestaetigung_noetig' | 'ok'

/** Gegebener Betrag aus dem Eingabetext: Rappen (CHF/Twint), Cent (EUR), 0 bei Helfer. */
export function gegebenAusText(zahlart: Zahlart, text: string): number {
  if (zahlart === 'helfer') return 0
  return betragAusText(text)
}

/** Welche Warnung eine Bestaetigung verlangt (Fachregel 3). */
export function bestaetigungsWarnung(warnungen: readonly ZahlungsWarnung[]): ZahlungsWarnung | null {
  if (warnungen.includes('rueckgeld_ueber_200')) return 'rueckgeld_ueber_200'
  if (warnungen.includes('spende_ueber_200')) return 'spende_ueber_200'
  return null
}

/** Entscheidet vor dem Senden: blockieren, rueckfragen oder senden. */
export function pruefeVorSenden(ergebnis: ZahlungsErgebnis, bestaetigt: boolean): VorSenden {
  if (!ergebnis.gedeckt) return 'nicht_gedeckt'
  if (bestaetigungsWarnung(ergebnis.warnungen) !== null && !bestaetigt) return 'bestaetigung_noetig'
  return 'ok'
}

/**
 * Baut die Verkaufsanfrage. `rabattProzent` ist der für diesen Beleg wirksame Satz (0 = kein Rabatt,
 * bei Zahlart `helfer` immer 0); die Positionen gehen mit voller Menge und vollem Preis an den Server,
 * der Rabatt gilt für den ganzen Beleg.
 */
export function baueVerkaufAnfrage(
  id: string,
  warenkorb: Warenkorb,
  zahlart: Zahlart,
  gegeben: number,
  spendeBehalten: boolean,
  bestaetigtHohesRueckgeld: boolean,
  rabattProzent: number
): VerkaufAnfrage {
  return {
    id,
    positionen: warenkorb.zeilen.map((z) => ({ produktId: z.produktId, anzahl: z.anzahl })),
    zahlart,
    gegeben,
    spendeBehalten,
    bestaetigtHohesRueckgeld,
    rabattProzent: zahlart === 'helfer' ? 0 : rabattProzent
  }
}

/** Coupons, die bei Druckerausfall von Hand geschrieben werden muessen (Gruppe coupon). */
export function handschreibListe(positionen: readonly Position[]): { name: string; anzahl: number }[] {
  return positionen
    .filter((p) => p.gruppeSnapshot === 'coupon')
    .map((p) => ({ name: p.nameSnapshot, anzahl: p.anzahl }))
}

/** "2x Getränk Dose, 1x Kaffee" */
export function listeAlsText(liste: readonly { name: string; anzahl: number }[]): string {
  return liste.map((z) => `${String(z.anzahl)}x ${z.name}`).join(', ')
}

// ---------------------------------------------------------------- Druckverlauf im Banner

/** Ab dieser Wartezeit ohne "done" zeigt das Banner die Handschreib-Liste (winspool braucht 12-20 s bis failed). */
export const DRUCK_WARTEZEIT_MS = 5000
/** Abstand der Abfragen von GET /api/druck/:id */
export const DRUCK_POLL_MS = 1000

export type DruckVerlauf = 'unbekannt' | 'laeuft' | 'lange' | 'done' | 'failed'

/**
 * Verlauf des eigenen Druckauftrags: unbekannt (kein Auftrag zu verfolgen), laeuft (queued/sent, noch
 * innerhalb der Wartezeit), lange (noch nicht done nach der Wartezeit), done, failed.
 */
export function druckVerlauf(
  auftrag: Pick<Druckauftrag, 'status'> | null,
  verfolgt: boolean,
  vergangenMs: number
): DruckVerlauf {
  if (!verfolgt) return 'unbekannt'
  if (auftrag?.status === 'done') return 'done'
  if (auftrag?.status === 'failed') return 'failed'
  return vergangenMs >= DRUCK_WARTEZEIT_MS ? 'lange' : 'laeuft'
}

/**
 * Ob das Banner "Drucker pruefen" mit Handschreib-Liste zeigt: eigener Auftrag failed oder zu lange
 * offen; ohne verfolgbaren Auftrag entscheidet die Ampel. Ein fertig gedruckter Beleg ist nie ein Problem,
 * auch wenn die Ampel wegen eines frueheren Auftrags noch rot ist.
 */
export function bannerDruckProblem(verlauf: DruckVerlauf, ampel: DruckStatus['ampel'] | null): boolean {
  if (verlauf === 'failed' || verlauf === 'lange') return true
  if (verlauf === 'unbekannt') return ampel === 'pruefen'
  return false
}

// ---------------------------------------------------------------- Banner nach Storno

/**
 * Zustand des Banners nach dem Bezahlen: die Verkaufsantwort, falls inzwischen storniert der Storno und,
 * falls das Rueckgeld nachtraeglich gespendet wurde, die separate Spende (auch eine stornierte, dann
 * erscheint der Knopf "Rueckgeld als Spende" wieder).
 */
export interface BannerZustand {
  antwort: VerkaufAntwort
  storno: Storno | null
  spende: Spende | null
}

/** Neuer Banner-Zustand fuer eine frische Verkaufsantwort (kein Storno, keine Spende). */
export function bannerAusAntwort(antwort: VerkaufAntwort | null): BannerZustand | null {
  return antwort === null ? null : { antwort, storno: null, spende: null }
}

/**
 * Wird zum Beleg des Banners nachtraeglich "Rueckgeld als Spende" erfasst (oder diese Spende storniert),
 * merkt sich das Banner die Spende. Eine Spende zu einem anderen Beleg laesst das Banner unveraendert.
 */
export function bannerNachSpende(banner: BannerZustand | null, spende: Spende): BannerZustand | null {
  if (banner === null) return null
  if (spende.verkaufId !== banner.antwort.verkauf.id) return banner
  return { ...banner, spende }
}

/**
 * Wird der Beleg storniert, der gerade im Banner steht, merkt sich das Banner den Storno und zeigt
 * statt "Rueckgeld" die Storno-Zeile. Ein Storno eines anderen Belegs laesst das Banner unveraendert.
 */
export function bannerNachStorno(banner: BannerZustand | null, storno: Storno): BannerZustand | null {
  if (banner === null) return null
  if (banner.antwort.verkauf.id !== storno.verkaufId) return banner
  return { ...banner, storno }
}

/** "Beleg K1-0004 storniert · Auszahlung CHF 2.50" bzw. ohne Auszahlung bei Helfer/0. */
export function stornoBannerText(belegnr: string, storno: Pick<Storno, 'auszahlungChfRappen'>): string {
  const basis = `Beleg ${belegnr} storniert`
  if (storno.auszahlungChfRappen <= 0) return basis
  return `${basis} · Auszahlung CHF ${formatChf(storno.auszahlungChfRappen)}`
}

/** Erzeugt die Verkaufs-UUID (Idempotenz, Fachregel 17). */
export function neueVerkaufsId(): string {
  return crypto.randomUUID()
}
