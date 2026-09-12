// Wird nach "electron-builder --win dir" ausgefuehrt: legt seed.local.json (PIN, Kurs, Druckername)
// neben die gepackte Kasse.exe, weil electron-builder den Ordner dist/win-unpacked jedes Mal neu erzeugt.
import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const quelle = join(process.cwd(), 'seed.local.json')
const ziel = join(process.cwd(), 'dist', 'win-unpacked', 'seed.local.json')
if (existsSync(quelle) && existsSync(join(process.cwd(), 'dist', 'win-unpacked'))) {
  copyFileSync(quelle, ziel)
  console.log('seed.local.json neben Kasse.exe kopiert')
} else {
  console.log('seed.local.json nicht kopiert (Quelle oder Paketordner fehlt)')
}
