/**
 * Warenkorb-Entwurf (eine Zeile, id = 1): Wiederherstellung des halbfertigen Warenkorbs nach Neustart.
 */
import type { Warenkorb } from '@core/types'
import { text } from '../sql'
import { isoLokal } from '../zeit'
import type { RepoKontext } from './kontext'

/**
 * Gesicherter Entwurf: Warenkorb plus der Zustand des Rabatt-Knopfs. Der Rabatt gilt für den ganzen
 * Beleg, gehört also zum Entwurf und nicht zu einer Zeile; ohne ihn stünde der Knopf nach einem
 * Neustart wieder auf «kein Rabatt», obwohl der Warenkorb wiederhergestellt wird.
 */
export interface WarenkorbEntwurf extends Warenkorb {
  /** true = Rabatt-Knopf war aktiv; fehlt bei Entwürfen aus älteren Fassungen (dann false) */
  rabattAktiv: boolean
}

export interface WarenkorbRepo {
  lies(): WarenkorbEntwurf
  speichere(w: WarenkorbEntwurf): void
  leeren(): void
}

export function istWarenkorb(w: unknown): w is Warenkorb {
  if (typeof w !== 'object' || w === null) return false
  const zeilen = (w as { zeilen?: unknown }).zeilen
  return Array.isArray(zeilen)
}

/** Rabatt-Zustand eines gelesenen Entwurfs; fehlendes oder fremdes Feld ergibt false. */
function rabattAusEntwurf(w: unknown): boolean {
  if (typeof w !== 'object' || w === null) return false
  return (w as { rabattAktiv?: unknown }).rabattAktiv === true
}

export function erstelleWarenkorbRepo(k: RepoKontext): WarenkorbRepo {
  const { db } = k
  return {
    lies() {
      const leer: WarenkorbEntwurf = { zeilen: [], rabattAktiv: false }
      const z = db.prepare('SELECT json FROM warenkorb_entwurf WHERE id = 1').get()
      if (z === undefined) return leer
      try {
        const w: unknown = JSON.parse(text(z, 'json'))
        return istWarenkorb(w) ? { zeilen: w.zeilen, rabattAktiv: rabattAusEntwurf(w) } : leer
      } catch {
        return leer
      }
    },
    speichere(w) {
      db.prepare(
        'INSERT INTO warenkorb_entwurf (id, json, aktualisiert_am) VALUES (1, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET json = excluded.json, aktualisiert_am = excluded.aktualisiert_am'
      ).run(JSON.stringify({ zeilen: w.zeilen, rabattAktiv: w.rabattAktiv }), isoLokal(k.uhr()))
    },
    leeren() {
      db.prepare('DELETE FROM warenkorb_entwurf WHERE id = 1').run()
    }
  }
}
