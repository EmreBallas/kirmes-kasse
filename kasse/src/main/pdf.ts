/**
 * Abschluss-PDF: HTML-Tabelle mit denselben Zeilen wie der Abschluss-Bon (core/bon.ts),
 * gerendert in einem versteckten BrowserWindow und mit printToPDF (A4) nach
 * <daten>/archiv/Kassenabschluss_<datum>_<praefix>.pdf geschrieben.
 *
 * Layout: zwei Spalten (links Geldzeilen/Soll-Ist/Unterschrift, rechts Stück je Produkt), kompakte
 * Schrift, damit ein normaler Kassentag mit bis zu ca. 30 Produkten auf einer A4-Seite bleibt.
 * Keine Seitenfusszeile (printToPDF ohne displayHeaderFooter); die Kennzeile steht am Ende des Inhalts.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { BrowserWindow } from 'electron'
import { formatDatum, formatDatumUhrzeit } from '@core/bon'
import { formatAbzug, formatChf, formatEur } from '@core/geld'
import type { AbschlussBericht } from '@core/types'

function html(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function offenOder(wert: number | null, format: (n: number) => string): string {
  return wert === null ? 'offen' : format(wert)
}

interface Zeile {
  label: string
  wert: string
  fett?: boolean
  klasse?: string
}

function zeileHtml(z: Zeile): string {
  const klassen = [z.fett === true ? 'fett' : '', z.klasse ?? ''].filter((k) => k !== '').join(' ')
  const attr = klassen === '' ? '' : ` class="${klassen}"`
  return `<tr${attr}><td>${html(z.label)}</td><td class="zahl">${html(z.wert)}</td></tr>`
}

function differenzKlasse(wert: number | null): string {
  if (wert === null || wert === 0) return 'differenz-null'
  return wert < 0 ? 'differenz-minus' : 'differenz-plus'
}

/**
 * Kennzeile am Ende des Inhalts (ohne UUID). Mit gesetzter Einstellung `veranstaltung`
 * "Sommerfest 2026 · Kassentag Sa 12.09.2026 K1", sonst "Kassentag Sa 12.09.2026 K1".
 * Kein fester Projektname: die Software wird von mehreren Vereinen genutzt.
 */
export function pdfKennzeile(b: AbschlussBericht): string {
  const kassentag = `Kassentag ${formatDatum(b.datum)} ${b.kassePraefix}`
  const veranstaltung = (b.veranstaltung ?? '').trim()
  return veranstaltung === '' ? kassentag : `${veranstaltung} · ${kassentag}`
}

/** Baut das HTML-Dokument des Abschlusses (reine Funktion, ohne Electron). */
export function abschlussHtml(b: AbschlussBericht): string {
  const kopf: Zeile[] = [
    { label: 'Startgeld CHF', wert: formatChf(b.startgeldChfRappen) },
    { label: 'Startgeld EUR', wert: formatEur(b.startgeldEurCent) },
    { label: 'Bar CHF (brutto)', wert: formatChf(b.barEinnahmenChfRappen) },
    { label: 'Bar EUR Stück', wert: `EUR ${formatEur(b.barEinnahmenEurCent)}` },
    { label: 'Bar EUR Gegenwert CHF', wert: formatChf(b.barEinnahmenEurChfRappen) },
    { label: 'Rückgeld aus EUR CHF', wert: formatAbzug(b.rueckgeldAusEurRappen) },
    { label: 'Twint brutto CHF', wert: formatChf(b.twintUmsatzRappen) },
    { label: '   davon storniert', wert: formatChf(b.twintStorniertRappen) },
    { label: 'Spende Bar CHF', wert: formatChf(b.barSpendeChfRappen) },
    { label: 'Spende Bar EUR (CHF)', wert: formatChf(b.barSpendeEurChfRappen) },
    { label: 'Spende Twint CHF', wert: formatChf(b.twintSpendeRappen) },
    {
      label: `   davon separat erfasst (${String(b.spendenSeparatAnzahl)})`,
      wert: formatChf(b.spendenSeparatChfRappen)
    },
    {
      label: `Storni (${String(b.storniAnzahl)})`,
      wert: formatAbzug(b.storniAuszahlungRappen)
    },
    {
      label: `Helferessen ${String(b.helferessenStueck)} Stk (entgangen)`,
      wert: formatChf(b.helferessenEntgangenRappen)
    },
    // Umsatz je Produkt bleibt brutto zu vollen Preisen; diese Zeile erklaert die Differenz zu den Einnahmen.
    { label: `Rabatte (${String(b.rabatteAnzahl)})`, wert: formatChf(b.rabatteRappen) },
    { label: 'Nachdrucke', wert: String(b.nachdrucke) }
  ]
  const soll: Zeile[] = [
    { label: 'SOLL CHF', wert: formatChf(b.sollChfRappen), fett: true },
    { label: 'IST CHF', wert: offenOder(b.istChfRappen, formatChf) },
    {
      label: 'DIFFERENZ CHF',
      wert: offenOder(b.differenzChfRappen, formatChf),
      fett: true,
      klasse: differenzKlasse(b.differenzChfRappen)
    },
    { label: 'SOLL EUR', wert: formatEur(b.sollEurCent), fett: true },
    { label: 'IST EUR', wert: offenOder(b.istEurCent, formatEur) },
    {
      label: 'DIFFERENZ EUR',
      wert: offenOder(b.differenzEurCent, formatEur),
      fett: true,
      klasse: differenzKlasse(b.differenzEurCent)
    }
  ]

  let umsatzTotal = 0
  const produktZeilen = b.produkte
    .map((p) => {
      umsatzTotal += p.umsatzRappen
      return (
        `<tr><td>${html(p.name)}</td><td class="zahl">${String(p.verkauft)}</td>` +
        `<td class="zahl">${String(p.helfer)}</td><td class="zahl">${formatChf(p.umsatzRappen)}</td></tr>`
      )
    })
    .join('\n')

  const erstellt =
    b.erstelltAm !== ''
      ? `<p class="unter">Erstellt: ${html(formatDatumUhrzeit(b.erstelltAm))}</p>`
      : ''

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Kassenabschluss ${html(b.datum)} ${html(b.kassePraefix)}</title>
<style>
  @page { size: A4; margin: 12mm 15mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #000; margin: 0; }
  h1 { font-size: 17pt; margin: 0 0 3pt 0; }
  .unter { margin: 0; font-size: 10.5pt; }
  .spalten { display: flex; gap: 8mm; align-items: flex-start; margin-top: 8pt; }
  .spalte { flex: 1 1 0; min-width: 0; }
  table { border-collapse: collapse; width: 100%; margin-top: 6pt; }
  td, th { padding: 1.5pt 4pt; border-bottom: 1px solid #bbb; vertical-align: top; }
  th { text-align: left; border-bottom: 2px solid #000; }
  .zahl { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .fett td { font-weight: bold; }
  .differenz-plus td { background: #e6f4ea; }
  .differenz-minus td { background: #fdecea; }
  .differenz-null td { background: #f2f2f2; }
  .abschnitt { margin: 8pt 0 0 0; font-size: 11pt; font-weight: bold; }
  .unterschrift { margin-top: 28pt; border-top: 1px solid #000; width: 60%; padding-top: 3pt; }
  .klein { font-size: 8.5pt; color: #444; margin: 6pt 0 0 0; }
</style>
</head>
<body>
<h1>KASSENABSCHLUSS</h1>
<p class="unter">${html(formatDatum(b.datum))} &nbsp;&nbsp; Kasse ${html(b.kassePraefix)} &nbsp;&nbsp; Kassier: ${html(b.kassier)}</p>
${erstellt}

<div class="spalten">
<div class="spalte">
<table>
<tbody>
${kopf.map(zeileHtml).join('\n')}
</tbody>
</table>

<table>
<tbody>
${soll.map(zeileHtml).join('\n')}
</tbody>
</table>

<table>
<tbody>
${zeileHtml({ label: 'Belege (ohne stornierte)', wert: String(b.anzahlBelege) })}
</tbody>
</table>

<p class="abschnitt">Kassier: ${html(b.kassier)}</p>
<div class="unterschrift">Unterschrift Kassier</div>
</div>

<div class="spalte">
<p class="abschnitt">Stück je Produkt</p>
<table>
<thead><tr><th>Produkt</th><th class="zahl">Verkauft</th><th class="zahl">Helfer</th><th class="zahl">Umsatz CHF</th></tr></thead>
<tbody>
${produktZeilen}
<tr class="fett"><td>Umsatz Produkte CHF</td><td></td><td></td><td class="zahl">${formatChf(umsatzTotal)}</td></tr>
</tbody>
</table>
</div>
</div>

<p class="klein">${html(pdfKennzeile(b))}</p>
</body>
</html>`
}

/**
 * Absoluter Dateiname ohne Kollision: bei bestehender Datei wird ein Zaehler angehaengt
 * (Kassenabschluss_<datum>_<praefix>.pdf, _2.pdf, _3.pdf ...).
 */
export function pdfDateiname(archivOrdner: string, datum: string, praefix: string): string {
  const ordner = resolve(archivOrdner)
  const basis = `Kassenabschluss_${datum}_${praefix}`
  let pfad = join(ordner, `${basis}.pdf`)
  let n = 2
  while (existsSync(pfad)) {
    pfad = join(ordner, `${basis}_${String(n)}.pdf`)
    n += 1
  }
  return pfad
}

/**
 * Rendert das HTML in einem versteckten Fenster und schreibt die A4-PDF; liefert den absoluten Pfad
 * (wird vom Main als { pdfPfad } an den Server zurueckgegeben und am Kassentag gespeichert).
 */
export async function schreibeAbschlussPdf(
  bericht: AbschlussBericht,
  archivOrdner: string
): Promise<string> {
  mkdirSync(archivOrdner, { recursive: true })
  const pfad = pdfDateiname(archivOrdner, bericht.datum, bericht.kassePraefix)
  const fenster = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  try {
    await fenster.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(abschlussHtml(bericht))}`
    )
    const pdf = await fenster.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false
    })
    await writeFile(pfad, pdf)
    return pfad
  } finally {
    fenster.destroy()
  }
}
