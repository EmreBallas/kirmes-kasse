/**
 * Plan B: Server ohne Electron auf 127.0.0.1:47100 mit Simulator-Transport (oder winspool bei
 * KASSE_PRINT=winspool). Aus dem Projektordner starten, z. B. mit `npx tsx src/server/standalone.ts`
 * (tsx löst die Aliase @core/@print/@server über tsconfig.node.json auf).
 *
 * Umgebungsvariablen: KASSE_DATEN (Datenordner, Standard ./data), KASSE_PORT (Standard Einstellung port),
 * KASSE_PRINT (sim | winspool), KASSE_MIGRATIONEN (Standard ./src/server/migrations),
 * KASSE_RENDERER (Standard ./out/renderer).
 */
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { erstelleTransport, listeDrucker, startDruckWorker } from '@print/index'
import { erstelleKassenApp } from './app'
import { migriere, oeffneDb } from './db'
import { erstelleDruckQuelle } from './druck'
import { fuehreSeedAus } from './seed'

const wurzel = process.cwd()
const datenOrdner = process.env['KASSE_DATEN'] ?? resolve(wurzel, 'data')
const bytesOrdner = join(datenOrdner, 'bytes')
const archivOrdner = join(datenOrdner, 'archiv')
mkdirSync(bytesOrdner, { recursive: true })
mkdirSync(archivOrdner, { recursive: true })

const db = oeffneDb(join(datenOrdner, 'kasse.sqlite'))
const neueMigrationen = migriere(
  db,
  process.env['KASSE_MIGRATIONEN'] ?? resolve(wurzel, 'src/server/migrations')
)
const seed = fuehreSeedAus({
  db,
  produktePfad: resolve(wurzel, 'resources/produkte-seed.json'),
  einstellungsPfade: [
    resolve(wurzel, 'seed.local.json'),
    resolve(wurzel, 'resources/seed.default.json')
  ]
})
console.log(
  `[standalone] Migrationen neu: ${String(neueMigrationen)}, Produkte angelegt: ${String(seed.produkteAngelegt)}, ` +
    `Einstellungen aus: ${seed.einstellungsDatei ?? 'keine Datei'}`
)

const { app, repos } = erstelleKassenApp({
  db,
  bytesOrdner,
  version: `${process.env['npm_package_version'] ?? '0.0.0'}-standalone`,
  dev: true,
  rendererOrdner: process.env['KASSE_RENDERER'] ?? resolve(wurzel, 'out/renderer'),
  druckStatus: () => worker.status(),
  nachDruckauftrag: () => {
    void worker.verarbeiteOffene()
  },
  listeDrucker: () => listeDrucker(),
  setzeDruckerName: (name) => worker.setzeDruckerName(name)
})

const einstellungen = repos.einstellung.einstellungen()
const transport = erstelleTransport({
  KASSE_PRINT: process.env['KASSE_PRINT'] ?? 'sim',
  devModus: true,
  druckerName: einstellungen.druckerName,
  skriptPfad: resolve(wurzel, 'tools/print-raw.ps1'),
  archivOrdner
})
const worker = startDruckWorker({
  quelle: erstelleDruckQuelle(db, bytesOrdner),
  transport,
  bytesOrdner,
  druckerName: einstellungen.druckerName
})

const port = Number(process.env['KASSE_PORT'] ?? einstellungen.port)
void worker.bereit.then(() => {
  serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
    console.log(
      `[standalone] Kasse läuft auf http://127.0.0.1:${String(info.port)} (Transport ${transport.name})`
    )
  })
})

function beenden(): void {
  worker.stop()
  db.close()
  process.exit(0)
}
process.on('SIGINT', beenden)
process.on('SIGTERM', beenden)
