/**
 * Seeds beim ersten Start: Produkte aus resources/produkte-seed.json (nur wenn die Tabelle leer ist),
 * Einstellungen aus seed.local.json (falls vorhanden) sonst resources/seed.default.json
 * (nur fehlende Schlüssel; die PIN nur, wenn noch kein pin_hash existiert). Mehrfach aufrufbar.
 */
import { existsSync, readFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import type { Gruppe } from '@core/types'
import { inTransaktion } from './db'
import { erstelleRepos, type Repos } from './repos/index'
import type { Uhr } from './zeit'

export interface SeedEinstellungen {
  pin?: string
  eurKursX10000?: number
  kassenPraefix?: string
  druckerName?: string
  port?: number
  backupPfadUsb?: string | null
  /** Rabattsatz des Rabatt-Knopfs in Prozent (1 bis 99); fehlt der Schlüssel, gilt der Standard 50. */
  rabattProzent?: number
  /** Name des Anlasses (max. 40 Zeichen); fehlt der Schlüssel, bleibt er leer. */
  veranstaltung?: string
}

export interface SeedProdukt {
  name: string
  preisRappen: number | null
  gruppe: Gruppe
  reihenfolge: number
}

export interface SeedErgebnis {
  produkteAngelegt: number
  einstellungenGesetzt: string[]
  pinGesetzt: boolean
  /** Pfad der verwendeten Einstellungsdatei, null wenn keine gefunden wurde */
  einstellungsDatei: string | null
}

export interface SeedOptionen {
  db: DatabaseSync
  /** resources/produkte-seed.json */
  produktePfad: string
  /** Kandidaten in Prioritätsreihenfolge, z. B. [seed.local.json, resources/seed.default.json] */
  einstellungsPfade: string[]
  uhr?: Uhr
  neueId?: () => string
}

function istObjekt(w: unknown): w is Record<string, unknown> {
  return typeof w === 'object' && w !== null && !Array.isArray(w)
}

/** Liest und prüft die Produktliste aus der JSON-Datei; wirft bei fehlerhaften Einträgen. */
export function leseProdukteSeed(pfad: string): SeedProdukt[] {
  const inhalt: unknown = JSON.parse(readFileSync(pfad, 'utf8'))
  if (!istObjekt(inhalt) || !Array.isArray(inhalt['produkte'])) {
    throw new Error(`Produkt-Seed ${pfad}: Feld "produkte" (Liste) fehlt`)
  }
  const produkte: SeedProdukt[] = []
  inhalt['produkte'].forEach((eintrag: unknown, i: number) => {
    if (!istObjekt(eintrag)) throw new Error(`Produkt-Seed Eintrag ${String(i)}: Objekt erwartet`)
    const name = eintrag['name']
    const preis = eintrag['preis_rappen']
    const gruppe = eintrag['gruppe']
    const reihenfolge = eintrag['reihenfolge']
    if (typeof name !== 'string' || name.trim() === '' || name.length > 24) {
      throw new Error(`Produkt-Seed Eintrag ${String(i)}: name fehlt oder länger als 24 Zeichen`)
    }
    if (preis !== null && preis !== undefined && !Number.isSafeInteger(preis)) {
      throw new Error(`Produkt-Seed "${name}": preis_rappen muss eine ganze Zahl oder null sein`)
    }
    if (gruppe !== 'coupon' && gruppe !== 'kasse') {
      throw new Error(`Produkt-Seed "${name}": gruppe muss coupon oder kasse sein`)
    }
    produkte.push({
      name,
      preisRappen: typeof preis === 'number' ? preis : null,
      gruppe,
      reihenfolge:
        typeof reihenfolge === 'number' && Number.isSafeInteger(reihenfolge) ? reihenfolge : i + 1
    })
  })
  return produkte
}

/** Liest die erste vorhandene Einstellungsdatei; unbekannte Felder werden ignoriert. */
export function leseEinstellungsSeed(pfade: string[]): {
  datei: string | null
  seed: SeedEinstellungen
} {
  for (const pfad of pfade) {
    if (!existsSync(pfad)) continue
    const inhalt: unknown = JSON.parse(readFileSync(pfad, 'utf8'))
    if (!istObjekt(inhalt)) throw new Error(`Einstellungs-Seed ${pfad}: Objekt erwartet`)
    const seed: SeedEinstellungen = {}
    if (typeof inhalt['pin'] === 'string') seed.pin = inhalt['pin']
    if (typeof inhalt['eurKursX10000'] === 'number') seed.eurKursX10000 = inhalt['eurKursX10000']
    if (typeof inhalt['kassenPraefix'] === 'string') seed.kassenPraefix = inhalt['kassenPraefix']
    if (typeof inhalt['druckerName'] === 'string') seed.druckerName = inhalt['druckerName']
    if (typeof inhalt['port'] === 'number') seed.port = inhalt['port']
    if (typeof inhalt['backupPfadUsb'] === 'string' || inhalt['backupPfadUsb'] === null) {
      seed.backupPfadUsb = inhalt['backupPfadUsb'] as string | null
    }
    if (typeof inhalt['rabattProzent'] === 'number') seed.rabattProzent = inhalt['rabattProzent']
    if (typeof inhalt['veranstaltung'] === 'string') seed.veranstaltung = inhalt['veranstaltung']
    return { datei: pfad, seed }
  }
  return { datei: null, seed: {} }
}

/** Legt Produkte an, wenn die Tabelle leer ist; liefert die Anzahl der angelegten. */
export function seedProdukte(repos: Repos, produkte: SeedProdukt[]): number {
  if (repos.produkt.anzahl() > 0) return 0
  return inTransaktion(repos.kontext.db, () => {
    for (const p of produkte) {
      repos.produkt.erstelle({
        name: p.name,
        preisRappen: p.preisRappen,
        gruppe: p.gruppe,
        reihenfolge: p.reihenfolge
      })
    }
    return produkte.length
  })
}

/** Setzt fehlende Einstellungen; die PIN nur, wenn noch kein pin_hash existiert. */
export function seedEinstellungen(
  repos: Repos,
  seed: SeedEinstellungen
): { gesetzt: string[]; pinGesetzt: boolean } {
  return inTransaktion(repos.kontext.db, () => {
    const gesetzt: string[] = []
    const e = repos.einstellung
    const paare: [string, string | undefined][] = [
      [
        'eur_kurs_x10000',
        seed.eurKursX10000 === undefined ? undefined : String(seed.eurKursX10000)
      ],
      ['kassen_praefix', seed.kassenPraefix],
      ['drucker_name', seed.druckerName],
      ['port', seed.port === undefined ? undefined : String(seed.port)],
      [
        'backup_pfad_usb',
        seed.backupPfadUsb === undefined ? undefined : (seed.backupPfadUsb ?? '')
      ],
      ['rabatt_prozent', seed.rabattProzent === undefined ? undefined : String(seed.rabattProzent)],
      ['veranstaltung', seed.veranstaltung],
      ['belegzaehler', '0']
    ]
    for (const [key, value] of paare) {
      if (value === undefined) continue
      if (e.setzeFallsFehlt(key, value)) gesetzt.push(key)
    }
    let pinGesetzt = false
    if (seed.pin !== undefined && !e.hatPin()) {
      e.setzePin(seed.pin)
      pinGesetzt = true
    }
    return { gesetzt, pinGesetzt }
  })
}

/** Kompletter Seed-Lauf (idempotent). */
export function fuehreSeedAus(o: SeedOptionen): SeedErgebnis {
  const repos = erstelleRepos(o.db, o.uhr, o.neueId)
  const produkteAngelegt = seedProdukte(repos, leseProdukteSeed(o.produktePfad))
  const { datei, seed } = leseEinstellungsSeed(o.einstellungsPfade)
  const { gesetzt, pinGesetzt } = seedEinstellungen(repos, seed)
  return { produkteAngelegt, einstellungenGesetzt: gesetzt, pinGesetzt, einstellungsDatei: datei }
}
