/**
 * Warenkorb-Entwurf (eine Zeile, id = 1): Wiederherstellung des halbfertigen Warenkorbs nach Neustart.
 */
import type { Warenkorb } from '@core/types'
import { text } from '../sql'
import { isoLokal } from '../zeit'
import type { RepoKontext } from './kontext'

export interface WarenkorbRepo {
  lies(): Warenkorb
  speichere(w: Warenkorb): void
  leeren(): void
}

export function istWarenkorb(w: unknown): w is Warenkorb {
  if (typeof w !== 'object' || w === null) return false
  const zeilen = (w as { zeilen?: unknown }).zeilen
  return Array.isArray(zeilen)
}

export function erstelleWarenkorbRepo(k: RepoKontext): WarenkorbRepo {
  const { db } = k
  return {
    lies() {
      const z = db.prepare('SELECT json FROM warenkorb_entwurf WHERE id = 1').get()
      if (z === undefined) return { zeilen: [] }
      try {
        const w: unknown = JSON.parse(text(z, 'json'))
        return istWarenkorb(w) ? w : { zeilen: [] }
      } catch {
        return { zeilen: [] }
      }
    },
    speichere(w) {
      db.prepare(
        'INSERT INTO warenkorb_entwurf (id, json, aktualisiert_am) VALUES (1, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET json = excluded.json, aktualisiert_am = excluded.aktualisiert_am'
      ).run(JSON.stringify(w), isoLokal(k.uhr()))
    },
    leeren() {
      db.prepare('DELETE FROM warenkorb_entwurf WHERE id = 1').run()
    }
  }
}
