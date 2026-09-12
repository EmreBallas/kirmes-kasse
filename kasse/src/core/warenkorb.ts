/**
 * Warenkorb-Logik (rein, unveränderlich): jede Funktion liefert einen neuen Warenkorb.
 */
import type { Gruppe, Produkt, Warenkorb, WarenkorbZeile } from './types'

/** Was der Warenkorb von einem Produkt braucht (Produkt oder Teilmenge davon). */
export type WarenkorbProdukt = Pick<Produkt, 'id' | 'name' | 'preisRappen' | 'gruppe'>

export function leererWarenkorb(): Warenkorb {
  return { zeilen: [] }
}

/** Fügt ein Produkt hinzu; erneutes Antippen erhöht die Menge der bestehenden Zeile. */
export function hinzufuegen(w: Warenkorb, produkt: WarenkorbProdukt, anzahl = 1): Warenkorb {
  if (produkt.preisRappen === null) {
    throw new Error(`Produkt "${produkt.name}" hat keinen Preis und kann nicht verkauft werden`)
  }
  if (!Number.isSafeInteger(anzahl) || anzahl <= 0) {
    throw new Error(`Anzahl muss eine positive ganze Zahl sein, erhalten: ${String(anzahl)}`)
  }
  const preisRappen = produkt.preisRappen
  const vorhanden = w.zeilen.some((z) => z.produktId === produkt.id)
  if (vorhanden) {
    return {
      zeilen: w.zeilen.map((z) => (z.produktId === produkt.id ? { ...z, anzahl: z.anzahl + anzahl } : z))
    }
  }
  const neu: WarenkorbZeile = {
    produktId: produkt.id,
    name: produkt.name,
    preisRappen,
    gruppe: produkt.gruppe,
    anzahl
  }
  return { zeilen: [...w.zeilen, neu] }
}

/** Ändert die Menge um delta; sinkt die Menge auf 0 oder darunter, wird die Zeile entfernt. */
export function mengeAendern(w: Warenkorb, produktId: string, delta: number): Warenkorb {
  if (!Number.isSafeInteger(delta)) {
    throw new Error(`Mengenänderung muss eine ganze Zahl sein, erhalten: ${String(delta)}`)
  }
  const zeilen: WarenkorbZeile[] = []
  for (const z of w.zeilen) {
    if (z.produktId !== produktId) {
      zeilen.push(z)
      continue
    }
    const anzahl = z.anzahl + delta
    if (anzahl > 0) zeilen.push({ ...z, anzahl })
  }
  return { zeilen }
}

export function entfernen(w: Warenkorb, produktId: string): Warenkorb {
  return { zeilen: w.zeilen.filter((z) => z.produktId !== produktId) }
}

/** Total in Rappen: Σ preis × anzahl. Keine Rundung auf Positionen (Fachregel 5). */
export function total(w: Warenkorb): number {
  return w.zeilen.reduce((summe, z) => summe + z.preisRappen * z.anzahl, 0)
}

/** Anzahl Artikel (Σ anzahl über alle Zeilen). */
export function anzahlArtikel(w: Warenkorb): number {
  return w.zeilen.reduce((summe, z) => summe + z.anzahl, 0)
}

/** Zeilen der Gruppe `kasse`, die nach dem Bezahlen sofort ausgegeben werden. */
export function sofortAusgeben(
  zeilen: readonly { name: string; anzahl: number; gruppe: Gruppe }[]
): { name: string; anzahl: number }[] {
  return zeilen.filter((z) => z.gruppe === 'kasse').map((z) => ({ name: z.name, anzahl: z.anzahl }))
}
