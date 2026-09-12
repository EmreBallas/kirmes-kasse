// Erzeugt die Referenzdatei tools/testdruck.bin neu (Aufruf: node tools/testdruck-bin.mjs).
//
// Die Datei ist ein von Hand zusammengestellter Beleg eines echten Testdrucks auf dem TM-T20II und
// dient src/print/escpos.test.ts als unabhaengige Referenz fuer die ESC/POS-Sequenzen und die
// cp857-Bytes der Umlaute und der tuerkischen Zeichen. Sie wird NICHT von baueBytes() erzeugt
// (der Schubladenimpuls steht hier am Ende, nicht nach der Initialisierung), damit der Test die
// Bytes des Builders gegen etwas vergleicht, das nicht aus dem Builder stammt.
//
// Kein fester Projektname: die Kopfzeile lautet neutral "KASSE".
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import iconv from 'iconv-lite'

const CODEPAGE = 'cp857'
const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

const init = [ESC, 0x40] // ESC @
const codepage = [ESC, 0x74, 0x0d] // ESC t 13
const schublade = [ESC, 0x70, 0x00, 0x19, 0xfa] // ESC p 0 25 250
const schnitt = [GS, 0x56, 0x42, 0x00] // GS V 66 0
const groesse = (n) => [GS, 0x21, n] // GS ! 0x00 / 0x11
const ausrichtung = (n) => [ESC, 0x61, n] // ESC a 0 / 1

/** Fester Zeitstempel, damit die Referenzdatei reproduzierbar bleibt. */
const ZEITSTEMPEL = '12.09.2026 12:00:00'

const teile = []
const roh = (bytes) => teile.push(Buffer.from(bytes))
const text = (s) => teile.push(iconv.encode(s, CODEPAGE), Buffer.from([LF]))

roh(init)
roh(codepage)
roh(ausrichtung(1)) // mitte
roh(groesse(0x11)) // doppelt
text('KASSE')
roh(groesse(0x00)) // normal
text('TESTDRUCK')
roh([LF])
roh(ausrichtung(0)) // links
text('Umlaute: äöü ÄÖÜ ß')
text('Türkçe: ş ğ ı ç İ Ş Ğ Ç')
text('Gözleme  Dürüm  Lahmacun')
roh([LF])
text('Total      CHF  75.00')
text('Gegeben    CHF 100.00')
roh(groesse(0x11)) // doppelt
text('Rückgeld CHF 25.00')
roh(groesse(0x00)) // normal
roh([LF])
text(ZEITSTEMPEL)
roh([LF, LF, LF])
roh(schnitt)
roh(schublade)

const bytes = Buffer.concat(teile)
const ziel = join(dirname(fileURLToPath(import.meta.url)), 'testdruck.bin')
writeFileSync(ziel, bytes)
console.log(`${ziel}: ${String(bytes.length)} Bytes`)
