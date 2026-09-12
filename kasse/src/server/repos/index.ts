/**
 * Alle Repositories mit gemeinsamem Kontext.
 */
import type { DatabaseSync } from 'node:sqlite'
import { inTransaktion } from '../db'
import type { Uhr } from '../zeit'
import { erstelleDruckauftragRepo, type DruckauftragRepo } from './druckauftragRepo'
import { erstelleEinstellungRepo, type EinstellungRepo } from './einstellungRepo'
import { erstelleKassentagRepo, type KassentagRepo } from './kassentagRepo'
import { erstelleKontext, type RepoKontext } from './kontext'
import { erstelleProduktRepo, type ProduktRepo } from './produktRepo'
import { erstelleStornoRepo, type StornoRepo } from './stornoRepo'
import { erstelleVerkaufRepo, type VerkaufRepo } from './verkaufRepo'
import { erstelleWarenkorbRepo, type WarenkorbRepo } from './warenkorbRepo'

export interface Repos {
  kontext: RepoKontext
  produkt: ProduktRepo
  kassentag: KassentagRepo
  verkauf: VerkaufRepo
  storno: StornoRepo
  druckauftrag: DruckauftragRepo
  einstellung: EinstellungRepo
  warenkorb: WarenkorbRepo
  /**
   * Werkzeug "Testdaten löschen": entfernt Verkäufe, Positionen, Zahlungen, Storni, Druckaufträge,
   * Kassentage und den Warenkorb-Entwurf; setzt den Belegzähler auf 0; behält Produkte und Einstellungen.
   */
  loescheTestdaten(): void
}

export function erstelleRepos(db: DatabaseSync, uhr?: Uhr, neueId?: () => string): Repos {
  const kontext = erstelleKontext(db, uhr, neueId)
  const einstellung = erstelleEinstellungRepo(kontext)
  const druckauftrag = erstelleDruckauftragRepo(kontext)
  return {
    kontext,
    produkt: erstelleProduktRepo(kontext),
    kassentag: erstelleKassentagRepo(kontext),
    verkauf: erstelleVerkaufRepo(kontext, einstellung, druckauftrag),
    storno: erstelleStornoRepo(kontext),
    druckauftrag,
    einstellung,
    warenkorb: erstelleWarenkorbRepo(kontext),
    loescheTestdaten() {
      inTransaktion(db, () => {
        for (const tabelle of [
          'druckauftrag',
          'storno',
          'zahlung',
          'position',
          'verkauf',
          'kassentag',
          'warenkorb_entwurf'
        ]) {
          db.exec(`DELETE FROM ${tabelle}`)
        }
        einstellung.setzeBelegzaehler(0)
      })
    }
  }
}

export type { RepoKontext } from './kontext'
export { erstelleKontext } from './kontext'
export { erstelleProduktRepo, istGruppe } from './produktRepo'
export type { ProduktRepo, ProduktNeu, ProduktAenderung } from './produktRepo'
export { erstelleKassentagRepo } from './kassentagRepo'
export type { KassentagRepo, KassentagNeu, KassentagAbschlussDaten } from './kassentagRepo'
export { erstelleVerkaufRepo, istZahlart } from './verkaufRepo'
export type {
  VerkaufRepo,
  VerkaufNeu,
  VerkaufDetail,
  VerkaufErstellt,
  PositionNeu,
  ZahlungNeu
} from './verkaufRepo'
export { erstelleStornoRepo, istStornoGrund } from './stornoRepo'
export type { StornoRepo, StornoNeu } from './stornoRepo'
export { erstelleDruckauftragRepo } from './druckauftragRepo'
export type { DruckauftragRepo, DruckauftragNeu, DruckauftragMarkierung } from './druckauftragRepo'
export {
  erstelleEinstellungRepo,
  hashPin,
  erzeugeSalt,
  formatBelegnummer,
  STANDARD_EINSTELLUNGEN
} from './einstellungRepo'
export type { EinstellungRepo, EinstellungenAenderung } from './einstellungRepo'
export { erstelleWarenkorbRepo, istWarenkorb } from './warenkorbRepo'
export type { WarenkorbRepo } from './warenkorbRepo'
