/**
 * Kleine Prüfhelfer für JSON-Bodies (kein Schema-Paket nötig). Jeder Fehler wird als
 * EingabeFehler geworfen und im Router als 400 ungueltige_eingabe beantwortet.
 */

export class EingabeFehler extends Error {
  readonly code: string
  constructor(meldung: string, code = 'ungueltige_eingabe') {
    super(meldung)
    this.name = 'EingabeFehler'
    this.code = code
  }
}

export type Objekt = Record<string, unknown>

export function istObjekt(w: unknown): w is Objekt {
  return typeof w === 'object' && w !== null && !Array.isArray(w)
}

export function objekt(w: unknown, was = 'Body'): Objekt {
  if (!istObjekt(w)) throw new EingabeFehler(`${was}: JSON-Objekt erwartet`)
  return w
}

export function textFeld(
  o: Objekt,
  feld: string,
  opts: { min?: number; max?: number } = {}
): string {
  const v = o[feld]
  if (typeof v !== 'string') throw new EingabeFehler(`Feld "${feld}" fehlt oder ist kein Text`)
  const min = opts.min ?? 1
  if (v.trim().length < min) throw new EingabeFehler(`Feld "${feld}" ist leer`)
  if (opts.max !== undefined && v.length > opts.max) {
    throw new EingabeFehler(`Feld "${feld}" ist länger als ${String(opts.max)} Zeichen`)
  }
  return v
}

export function textFeldOptional(
  o: Objekt,
  feld: string,
  opts: { max?: number } = {}
): string | undefined {
  if (o[feld] === undefined) return undefined
  return textFeld(o, feld, { min: 0, max: opts.max })
}

export function textOderNullFeld(o: Objekt, feld: string): string | null {
  const v = o[feld]
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') throw new EingabeFehler(`Feld "${feld}" muss Text oder null sein`)
  return v
}

export function ganzzahlFeld(
  o: Objekt,
  feld: string,
  opts: { min?: number; max?: number } = {}
): number {
  const v = o[feld]
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) {
    throw new EingabeFehler(`Feld "${feld}" muss eine ganze Zahl sein`)
  }
  if (opts.min !== undefined && v < opts.min)
    throw new EingabeFehler(`Feld "${feld}" darf nicht kleiner als ${String(opts.min)} sein`)
  if (opts.max !== undefined && v > opts.max)
    throw new EingabeFehler(`Feld "${feld}" darf nicht grösser als ${String(opts.max)} sein`)
  return v
}

export function ganzzahlFeldOptional(
  o: Objekt,
  feld: string,
  opts: { min?: number; max?: number } = {}
): number | undefined {
  if (o[feld] === undefined) return undefined
  return ganzzahlFeld(o, feld, opts)
}

/** Ganze Zahl oder null (z. B. Preis offen). */
export function ganzzahlOderNullFeld(
  o: Objekt,
  feld: string,
  opts: { min?: number } = {}
): number | null {
  if (o[feld] === null) return null
  return ganzzahlFeld(o, feld, opts)
}

export function boolFeld(o: Objekt, feld: string, standard?: boolean): boolean {
  const v = o[feld]
  if (v === undefined && standard !== undefined) return standard
  if (typeof v !== 'boolean') throw new EingabeFehler(`Feld "${feld}" muss true oder false sein`)
  return v
}

export function boolFeldOptional(o: Objekt, feld: string): boolean | undefined {
  if (o[feld] === undefined) return undefined
  return boolFeld(o, feld)
}

export function listeFeld(o: Objekt, feld: string): unknown[] {
  const v = o[feld]
  if (!Array.isArray(v)) throw new EingabeFehler(`Feld "${feld}" muss eine Liste sein`)
  return v
}

export function auswahlFeld<T extends string>(o: Objekt, feld: string, erlaubt: readonly T[]): T {
  const v = o[feld]
  if (typeof v !== 'string' || !(erlaubt as readonly string[]).includes(v)) {
    throw new EingabeFehler(`Feld "${feld}" muss eines von ${erlaubt.join(', ')} sein`)
  }
  return v as T
}

/** PIN: 4 bis 8 Ziffern. */
export function istGueltigePin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin)
}
