/**
 * Beleg-Rabatt im Verkaufsbildschirm (reine Logik, ohne React).
 *
 * Fachlicher Hintergrund: Bei Vereinsfesten bekommen angereiste Mitglieder anderer Vereine einen
 * Rabatt auf die ganze Bestellung. Der Kassier gibt ihn mit einem Knopf auf den GANZEN Warenkorb,
 * nie auf einzelne Positionen; die Positionen behalten den vollen Preis.
 *
 * Gerechnet wird ausschliesslich mit @core (`summeMitRabatt` -> `rabattBetrag`), damit Anzeige,
 * Bezahldialog, Server und Bon dieselben Rappen liefern. Dieses Modul entscheidet nur, WELCHER Satz
 * gerade gilt (Einstellung, Umschalter) und liefert die Bildschirmtexte. Der Rabatt gilt für alle
 * Zahlarten, seit 17.9.2026 auch für Helfer (sie zahlen echte Beträge, sofort oder später).
 */
import type { Einstellungen, Warenkorb, WarenkorbSumme } from '@core/types'
import {
  RABATT_PROZENT_MAX,
  RABATT_PROZENT_MIN,
  RABATT_PROZENT_STANDARD,
  formatChf
} from '@core/geld'
import { summeMitRabatt } from '@core/warenkorb'

/** Warenkorb-Entwurf auf dem Server: Warenkorb plus der gemerkte Zustand des Rabatt-Knopfs. */
export interface WarenkorbEntwurf extends Warenkorb {
  /** true = Rabatt-Knopf war aktiv; fehlt bei alten Entwürfen und alten Servern (dann false) */
  rabattAktiv?: boolean
}

/** Ganzzahliger Satz im erlaubten Bereich 1 bis 99? */
export function istGueltigerSatz(satz: number): boolean {
  return Number.isInteger(satz) && satz >= RABATT_PROZENT_MIN && satz <= RABATT_PROZENT_MAX
}

/**
 * Eingestellter Rabattsatz. Fehlt die Einstellung oder liefert ein älterer Server sie nicht
 * (bzw. ausserhalb 1 bis 99), gilt der Standard von 50 Prozent.
 */
export function rabattSatz(e: Einstellungen | null): number {
  const satz: unknown = e?.rabattProzent
  if (typeof satz !== 'number' || !istGueltigerSatz(satz)) return RABATT_PROZENT_STANDARD
  return satz
}

/**
 * Satz, der für diesen Beleg wirklich gilt: 0, wenn der Knopf aus ist oder der Satz unsinnig ist;
 * sonst der eingestellte Satz, unabhängig von der Zahlart (auch Helfer «gleich» und «später zahlen»).
 */
export function wirksamerSatz(aktiv: boolean, satz: number): number {
  if (!aktiv) return 0
  return istGueltigerSatz(satz) ? satz : 0
}

/**
 * Summe des Warenkorbs zur Anzeige: Zwischensumme (volle Preise), Abzug, zu kassierender Betrag.
 * Rechnet mit @core; ein unsinniger Satz (defekte Einstellung) ergibt sicher «kein Rabatt»,
 * damit der Bildschirm nie mit einer Ausnahme stehenbleibt.
 */
export function warenkorbSumme(w: Warenkorb, rabattProzent: number): WarenkorbSumme {
  const satz = istGueltigerSatz(rabattProzent) ? rabattProzent : 0
  return summeMitRabatt(w, satz)
}

/** Knopftext des Umschalters: «50% Rabatt». */
export function rabattKnopfText(satz: number): string {
  return `${String(satz)}% Rabatt`
}

/** Zeilenbeschriftung im Warenkorb und im Bezahldialog: «Rabatt 50%». */
export function rabattZeileLabel(satz: number): string {
  return `Rabatt ${String(satz)}%`
}

/** Kleine Zeile im Kopf des Bezahldialogs: «inkl. 50% Rabatt (− CHF 13.50)». */
export function rabattKopfText(satz: number, rabattRappen: number): string {
  return `inkl. ${String(satz)}% Rabatt (− CHF ${formatChf(rabattRappen)})`
}

/** Entwurf zum Sichern: Warenkorb plus Rabatt-Zustand. */
export function entwurfMitRabatt(w: Warenkorb, rabattAktiv: boolean): WarenkorbEntwurf {
  return { zeilen: w.zeilen, rabattAktiv }
}

/** Rabatt-Zustand aus einem gelesenen Entwurf; fehlendes oder fremdes Feld ergibt false. */
export function rabattAusEntwurf(entwurf: unknown): boolean {
  if (typeof entwurf !== 'object' || entwurf === null) return false
  return (entwurf as { rabattAktiv?: unknown }).rabattAktiv === true
}

/**
 * Eingabe des Rabattsatzes in den Einstellungen ("50") -> 50; leer, nicht ganzzahlig oder
 * ausserhalb 1 bis 99 ergibt null (Feld wird als fehlerhaft markiert).
 */
export function parseRabattSatz(text: string): number | null {
  const bereinigt = text.trim()
  if (!/^\d{1,3}$/.test(bereinigt)) return null
  const satz = Number(bereinigt)
  return istGueltigerSatz(satz) ? satz : null
}
