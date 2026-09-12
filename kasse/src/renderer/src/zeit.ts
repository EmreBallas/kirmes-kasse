/**
 * Zeit-Helfer fuer die Anzeige. Die Formatierung selbst kommt aus @core/bon
 * (formatDatum, formatUhrzeit), damit Bildschirm und Bon dieselbe Schreibweise haben.
 */
import { formatDatum, formatUhrzeit } from '@core/bon'

const zweistellig = (n: number): string => String(n).padStart(2, '0')

/** Lokale ISO-Zeit ohne Zeitzone, z. B. "2026-09-19T14:32:05" (wie die Zeitstempel des Servers). */
export function lokalIso(d: Date): string {
  return (
    `${String(d.getFullYear())}-${zweistellig(d.getMonth() + 1)}-${zweistellig(d.getDate())}` +
    `T${zweistellig(d.getHours())}:${zweistellig(d.getMinutes())}:${zweistellig(d.getSeconds())}`
  )
}

/** "Sa 19.09.2026" */
export function datumAnzeige(d: Date): string {
  return formatDatum(lokalIso(d))
}

/** "14:32" */
export function uhrzeitAnzeige(d: Date): string {
  return formatUhrzeit(lokalIso(d))
}

/** "14:32:05" */
export function uhrzeitMitSekunden(d: Date): string {
  return `${uhrzeitAnzeige(d)}:${zweistellig(d.getSeconds())}`
}
