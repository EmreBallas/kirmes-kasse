/**
 * Reine Entscheidungslogik des Bezahldialogs (ohne React), damit sie testbar bleibt.
 */
import type {
  Druckauftrag,
  DruckStatus,
  Position,
  VerkaufAnfrage,
  Warenkorb,
  Zahlart,
  ZahlungsErgebnis,
  ZahlungsWarnung
} from '@core/types'
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

export function baueVerkaufAnfrage(
  id: string,
  warenkorb: Warenkorb,
  zahlart: Zahlart,
  gegeben: number,
  spendeBehalten: boolean,
  bestaetigtHohesRueckgeld: boolean
): VerkaufAnfrage {
  return {
    id,
    positionen: warenkorb.zeilen.map((z) => ({ produktId: z.produktId, anzahl: z.anzahl })),
    zahlart,
    gegeben,
    spendeBehalten,
    bestaetigtHohesRueckgeld
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

/** Erzeugt die Verkaufs-UUID (Idempotenz, Fachregel 17). */
export function neueVerkaufsId(): string {
  return crypto.randomUUID()
}
