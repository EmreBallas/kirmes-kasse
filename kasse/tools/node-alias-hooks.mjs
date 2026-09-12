// Resolve-Hook fuer tools/node-alias.mjs (siehe dort).
import { existsSync } from 'node:fs'
import { dirname, resolve as resolvePfad } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const wurzel = resolvePfad(dirname(fileURLToPath(import.meta.url)), '..')
const ALIASE = {
  '@core/': resolvePfad(wurzel, 'src/core'),
  '@server/': resolvePfad(wurzel, 'src/server'),
  '@print/': resolvePfad(wurzel, 'src/print')
}

function mitEndung(pfad) {
  if (/\.(m?ts|m?js|json)$/.test(pfad)) return pfad
  if (existsSync(`${pfad}.ts`)) return `${pfad}.ts`
  if (existsSync(resolvePfad(pfad, 'index.ts'))) return resolvePfad(pfad, 'index.ts')
  return pfad
}

export async function resolve(specifier, context, next) {
  for (const [praefix, ordner] of Object.entries(ALIASE)) {
    if (specifier.startsWith(praefix)) {
      const pfad = mitEndung(resolvePfad(ordner, specifier.slice(praefix.length)))
      return next(pathToFileURL(pfad).href, context)
    }
  }
  const parent = context.parentURL
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    typeof parent === 'string' &&
    parent.startsWith('file:') &&
    parent.endsWith('.ts')
  ) {
    const pfad = mitEndung(resolvePfad(dirname(fileURLToPath(parent)), specifier))
    return next(pathToFileURL(pfad).href, context)
  }
  return next(specifier, context)
}
