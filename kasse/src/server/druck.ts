/**
 * Druckdienst des Servers: baut aus einem DruckModell die ESC/POS-Bytes (@print), legt sie als
 * <bytesOrdner>/<druckauftragId>.bin ab und reiht den Druckauftrag ein. Scheitert das Schreiben der
 * Datei, wird der Auftrag als failed gespeichert; der Verkauf selbst bleibt davon unberührt.
 *
 * Ausserdem: erstelleDruckQuelle(db, bytesOrdner) für den Druck-Worker aus @print/worker.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { Druckauftrag, DruckauftragTyp, DruckModell } from '@core/types'
import { baueBytes } from '@print/escpos'
import type { DruckQuelle } from '@print/worker'
import { erstelleDruckauftragRepo, type DruckauftragRepo } from './repos/druckauftragRepo'
import { erstelleKontext } from './repos/kontext'
import type { Uhr } from './zeit'

export interface DruckauftragAnfrage {
  typ: DruckauftragTyp
  modell: DruckModell
  verkaufId: string | null
  kassentagId: string | null
}

export interface DruckDienst {
  /** Schreibt die Bytes und legt den Auftrag an (Status queued; failed, wenn die Datei nicht geschrieben werden konnte). */
  reiheEin(anfrage: DruckauftragAnfrage): Druckauftrag
  readonly bytesOrdner: string
}

function fehlerText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function erstelleDruckDienst(
  repo: DruckauftragRepo,
  bytesOrdner: string,
  neueId: () => string
): DruckDienst {
  return {
    bytesOrdner,
    reiheEin(anfrage) {
      const id = neueId()
      const dateiname = `${id}.bin`
      const bytes = baueBytes(anfrage.modell)
      let fehler: string | null = null
      try {
        mkdirSync(bytesOrdner, { recursive: true })
        writeFileSync(join(bytesOrdner, dateiname), bytes)
      } catch (e) {
        fehler = `Druckdaten konnten nicht geschrieben werden: ${fehlerText(e)}`
      }
      return repo.erstelle({
        id,
        typ: anfrage.typ,
        verkaufId: anfrage.verkaufId,
        kassentagId: anfrage.kassentagId,
        bytesPfad: fehler === null ? dateiname : null,
        status: fehler === null ? 'queued' : 'failed',
        fehler
      })
    }
  }
}

/**
 * Datenquelle für startDruckWorker aus @print/worker, umgesetzt über das druckauftragRepo.
 * bytes_pfad ist relativ zum bytesOrdner gespeichert; der Worker löst ihn bereits auf,
 * ladeBytes akzeptiert aber auch relative Pfade.
 */
export function erstelleDruckQuelle(db: DatabaseSync, bytesOrdner: string, uhr?: Uhr): DruckQuelle {
  const repo = erstelleDruckauftragRepo(erstelleKontext(db, uhr))
  return {
    naechsterQueued: () => repo.naechsterQueued(),
    async ladeBytes(auftrag) {
      if (auftrag.bytesPfad === null || auftrag.bytesPfad === '') {
        throw new Error(`Druckauftrag ${auftrag.id} hat keinen bytes_pfad`)
      }
      const pfad = isAbsolute(auftrag.bytesPfad)
        ? auftrag.bytesPfad
        : resolve(bytesOrdner, auftrag.bytesPfad)
      const puffer = await readFile(pfad)
      return new Uint8Array(puffer.buffer, puffer.byteOffset, puffer.byteLength)
    },
    markiere: (id, status, felder) => repo.markiere(id, status, felder),
    markiereAlleOffenenAlsFailed: (grund) => repo.markiereAlleOffenenAlsFailed(grund)
  }
}
