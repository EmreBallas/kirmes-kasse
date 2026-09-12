/**
 * Reine Logik der separaten Spenden (ohne React), damit sie testbar bleibt.
 *
 * Fachlicher Hintergrund: Der Verkauf ist schon gespeichert und gedruckt, die Schublade offen, und erst
 * jetzt sagt der Kunde "passt schon". Deshalb gibt es separate, nachtraeglich erfasste Spenden:
 * "Rueckgeld als Spende" zu einem abgeschlossenen Bar-Beleg (Betrag = dessen Rueckgeld, das Geld bleibt
 * als CHF in der Lade) und die freie Spende ohne Kauf (Bar CHF / Twint / Bar EUR). Spenden drucken keinen Bon.
 */
import type { Spende, SpendeAnfrage, SpendeTyp, Verkauf, Zahlung } from '@core/types'
import { eurZuChfRappen, formatChf, formatEur } from '@core/geld'

export const SPENDE_TYP_NAME: Record<SpendeTyp, string> = {
  bar_chf: 'Bar CHF',
  twint: 'Twint',
  bar_eur: 'Bar EUR'
}

/** Reihenfolge der Umschalter im Spendedialog. */
export const SPENDE_TYPEN: readonly SpendeTyp[] = ['bar_chf', 'twint', 'bar_eur']

/** Bildschirmtext bei 409 bereits_gespendet. */
export const BEREITS_GESPENDET_TEXT = 'Für diesen Beleg wurde bereits eine Spende erfasst'

/**
 * Ob zu einem Beleg "Rueckgeld als Spende" angeboten wird: Bar-Beleg (CHF oder EUR) mit Rueckgeld > 0,
 * nicht storniert und noch ohne (nicht stornierte) Spende. Eine stornierte Spende zaehlt nicht (Tippfehler).
 */
export function rueckgeldSpendeMoeglich(
  verkauf: Pick<Verkauf, 'zahlart' | 'storniertAm'>,
  zahlung: Pick<Zahlung, 'rueckgeldChfRappen'>,
  storniert: boolean,
  spende: Pick<Spende, 'storniertAm'> | null | undefined
): boolean {
  if (verkauf.zahlart !== 'bar_chf' && verkauf.zahlart !== 'bar_eur') return false
  if (zahlung.rueckgeldChfRappen <= 0) return false
  if (storniert || verkauf.storniertAm !== null) return false
  return spende === null || spende === undefined || spende.storniertAm !== null
}

/**
 * Anfrage "Rueckgeld als Spende": Betrag = Rueckgeld des Belegs in Rappen. Auch bei einem EUR-Beleg wird
 * das Rueckgeld in CHF gerechnet und bleibt als CHF in der Lade, deshalb immer typ bar_chf.
 */
export function baueRueckgeldSpende(
  id: string,
  verkauf: Pick<Verkauf, 'id'>,
  zahlung: Pick<Zahlung, 'rueckgeldChfRappen'>
): SpendeAnfrage {
  return { id, typ: 'bar_chf', betrag: zahlung.rueckgeldChfRappen, verkaufId: verkauf.id }
}

/** Anfrage einer freien Spende ohne Kauf (betrag in Rappen bzw. Cent bei bar_eur). */
export function baueFreieSpende(id: string, typ: SpendeTyp, betrag: number): SpendeAnfrage {
  return { id, typ, betrag, verkaufId: null }
}

/** CHF-Gegenwert einer Spende fuer die Anzeige: bei bar_eur ueber den Kurs (auf 5 Rappen abgerundet), sonst der Betrag. */
export function spendeChfGegenwert(typ: SpendeTyp, betrag: number, kursX10000: number): number {
  if (typ !== 'bar_eur') return betrag
  if (kursX10000 <= 0 || betrag < 0) return 0
  return eurZuChfRappen(betrag, kursX10000)
}

/** "CHF 5.00" bzw. bei EUR "EUR 5.00 (CHF 4.50)". */
export function spendeBetragText(spende: Pick<Spende, 'typ' | 'betrag' | 'betragChfRappen'>): string {
  if (spende.typ === 'bar_eur') return `EUR ${formatEur(spende.betrag)} (CHF ${formatChf(spende.betragChfRappen)})`
  return `CHF ${formatChf(spende.betrag)}`
}

/** Banner nach einer freien Spende: "Spende CHF 5.00 (Twint) erfasst". */
export function spendeBannerText(spende: Pick<Spende, 'typ' | 'betrag' | 'betragChfRappen'>): string {
  return `Spende ${spendeBetragText(spende)} (${SPENDE_TYP_NAME[spende.typ]}) erfasst`
}

/** Banner nach "Rueckgeld als Spende": "Spende CHF 2.00 erfasst". */
export function rueckgeldSpendeText(spende: Pick<Spende, 'betragChfRappen'>): string {
  return `Spende CHF ${formatChf(spende.betragChfRappen)} erfasst`
}

/**
 * Index der Spende, die ohne PIN storniert werden darf (die zuletzt erfasste, nicht stornierte) in einer
 * Liste "neueste zuerst"; -1, wenn keine. Der Server entscheidet endgueltig (403 pin_falsch -> PIN-Dialog).
 */
export function indexOhnePin(spenden: readonly Pick<Spende, 'storniertAm'>[]): number {
  return spenden.findIndex((s) => s.storniertAm === null)
}

/** Erzeugt die Spenden-UUID (Idempotenz wie beim Verkauf). */
export function neueSpendeId(): string {
  return crypto.randomUUID()
}
