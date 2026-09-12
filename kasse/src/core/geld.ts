/**
 * Geldfunktionen der Kasse WintiKirmes 2026.
 * Alle Beträge sind ganze Rappen (CHF) bzw. ganze Cent (EUR), der Kurs ist CHF pro EUR × 10 000.
 * Keine Fliesskomma-Arithmetik für Geld: alle Rundungen laufen über Ganzzahl-Modulo.
 */

/** Wirft, wenn ein Wert keine endliche Ganzzahl ist (Schutz gegen Fliesskomma-Geld). */
export function pruefeGanzzahl(wert: number, bezeichnung: string): void {
  if (!Number.isSafeInteger(wert)) {
    throw new Error(`${bezeichnung} muss eine ganze Zahl sein, erhalten: ${String(wert)}`)
  }
}

/** Wirft, wenn ein Kurs fehlt oder nicht positiv ist. */
export function pruefeKurs(kursX10000: number): void {
  pruefeGanzzahl(kursX10000, 'Kurs (x10000)')
  if (kursX10000 <= 0) {
    throw new Error(`Kurs muss positiv sein, erhalten: ${String(kursX10000)}`)
  }
}

/** Formatiert ganze Untereinheiten (Rappen/Cent) als "12.50"; negative Beträge mit Minus. */
function formatBetrag(einheiten: number): string {
  const ganz = Math.round(einheiten) // defensiv: Anzeige darf nie abstürzen
  const vorzeichen = ganz < 0 ? '-' : ''
  const abs = Math.abs(ganz)
  const franken = (abs - (abs % 100)) / 100
  const rest = abs % 100
  return `${vorzeichen}${String(franken)}.${String(rest).padStart(2, '0')}`
}

/** formatChf(7500) = "75.00", formatChf(5) = "0.05" */
export function formatChf(rappen: number): string {
  return formatBetrag(rappen)
}

/** formatEur(2000) = "20.00" */
export function formatEur(cent: number): string {
  return formatBetrag(cent)
}

/** formatKurs(9000) = "0.90"; krumme Kurse (z. B. 9250) mit vier Stellen: "0.9250" */
export function formatKurs(kursX10000: number): string {
  const ganz = Math.round(kursX10000)
  const chf = (ganz - (ganz % 10000)) / 10000
  const rest = ganz % 10000
  if (rest % 100 === 0) {
    return `${String(chf)}.${String(rest / 100).padStart(2, '0')}`
  }
  return `${String(chf)}.${String(rest).padStart(4, '0')}`
}

/** Rundet auf 5 Rappen ab (zugunsten des Vereins): 651 -> 650, 1209 -> 1205. */
export function rundeAb5Rappen(rappen: number): number {
  pruefeGanzzahl(rappen, 'Betrag in Rappen')
  return rappen - (((rappen % 5) + 5) % 5)
}

/**
 * CHF-Gegenwert eines EUR-Betrags: cent × kurs ÷ 10 000, abgerundet auf ganze Rappen,
 * danach auf 5 Rappen abgerundet. 20 EUR bei 9000 -> 1800; 7 EUR bei 9300 -> 650; 13 EUR bei 9300 -> 1205.
 */
export function eurZuChfRappen(cent: number, kursX10000: number): number {
  pruefeGanzzahl(cent, 'Betrag in Cent')
  pruefeKurs(kursX10000)
  if (cent < 0) {
    throw new Error(`EUR-Betrag darf nicht negativ sein, erhalten: ${String(cent)}`)
  }
  const produkt = cent * kursX10000
  const rappen = (produkt - (produkt % 10000)) / 10000
  return rundeAb5Rappen(rappen)
}

/**
 * Total in EUR zum Vorlesen: rappen ÷ kurs, aufgerundet auf 10 Cent.
 * 1200 bei 9300 -> 1300 (12.903 -> 13.00); 500 bei 9000 -> 560 (5.556 -> 5.60).
 */
export function chfZuEurCentAufgerundet(rappen: number, kursX10000: number): number {
  pruefeGanzzahl(rappen, 'Betrag in Rappen')
  pruefeKurs(kursX10000)
  if (rappen < 0) {
    throw new Error(`CHF-Betrag darf nicht negativ sein, erhalten: ${String(rappen)}`)
  }
  if (rappen === 0) return 0
  // Zehntel-EUR = rappen × 1000 ÷ kurs, aufgerundet (Ganzzahl-Division)
  const zaehler = rappen * 1000
  const rest = zaehler % kursX10000
  const zehntel = (zaehler - rest) / kursX10000 + (rest === 0 ? 0 : 1)
  return zehntel * 10
}

/**
 * Wandelt eine Betragseingabe in Rappen/Cent: "12.5" -> 1250, "12,50" -> 1250, "12" -> 1200,
 * "1'000" -> 100000. Ungültige Eingaben (Buchstaben, mehr als zwei Nachkommastellen, negativ) -> null.
 */
export function parseBetrag(text: string): number | null {
  const bereinigt = text
    .trim()
    .replace(/[\s'’`]/g, '')
    .replace(',', '.')
  if (bereinigt === '' || bereinigt === '.') return null
  if (!/^\d*(\.\d{0,2})?$/.test(bereinigt)) return null
  const [ganzTeil, dezimalTeil = ''] = bereinigt.split('.')
  const ganz = ganzTeil === '' ? 0 : Number(ganzTeil)
  const dezimal = Number((dezimalTeil + '00').slice(0, 2))
  const betrag = ganz * 100 + dezimal
  return Number.isSafeInteger(betrag) ? betrag : null
}
