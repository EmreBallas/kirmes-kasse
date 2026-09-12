/**
 * Zeitfunktionen des Servers. Zeitstempel sind ISO-8601 lokal ohne Zeitzone ("2026-09-19T14:32:05"),
 * wie in core/types.ts vereinbart. Die Uhr ist injizierbar, damit Tests deterministisch laufen.
 */

export type Uhr = () => Date

export const systemUhr: Uhr = () => new Date()

function zweistellig(n: number): string {
  return String(n).padStart(2, '0')
}

/** "2026-09-19" aus lokaler Zeit. */
export function datumLokal(d: Date): string {
  return `${String(d.getFullYear())}-${zweistellig(d.getMonth() + 1)}-${zweistellig(d.getDate())}`
}

/** "2026-09-19T14:32:05" aus lokaler Zeit (ohne Millisekunden, ohne Zeitzone). */
export function isoLokal(d: Date): string {
  return `${datumLokal(d)}T${zweistellig(d.getHours())}:${zweistellig(d.getMinutes())}:${zweistellig(d.getSeconds())}`
}

/** Feste Uhr für Tests: liefert immer denselben Zeitpunkt, bis er neu gesetzt wird. */
export function festeUhr(start: string): Uhr & { setze(iso: string): void } {
  let aktuell = new Date(start)
  const uhr = ((): Date => new Date(aktuell.getTime())) as Uhr & { setze(iso: string): void }
  uhr.setze = (iso: string): void => {
    aktuell = new Date(iso)
  }
  return uhr
}
