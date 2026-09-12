/**
 * Gemeinsame Domänentypen der Kasse WintiKirmes 2026.
 * Reine Typen, keine Laufzeitabhängigkeiten. Wird von core, server, print, main und renderer importiert.
 *
 * Geldregeln: alle CHF-Beträge als ganze Rappen (number), alle EUR-Beträge als ganze Cent.
 * Kurs: CHF pro EUR × 10 000 (9000 = 0.90 CHF pro EUR).
 * Zeitstempel: ISO-8601 lokal ohne Zeitzone, z. B. "2026-09-19T14:32:05".
 * IDs: UUID v4 als string.
 */

export type Zahlart = 'bar_chf' | 'bar_eur' | 'twint' | 'helfer'
export type Gruppe = 'coupon' | 'kasse'
export type Waehrung = 'CHF' | 'EUR'
export type SpendeTyp = 'bar_chf' | 'bar_eur' | 'twint'
export type StornoGrund = 'tippfehler' | 'ausverkauft' | 'abgesprungen'
export type DruckauftragTyp =
  | 'beleg'
  | 'nachdruck_alles'
  | 'nachdruck_coupons'
  | 'nachdruck_bon'
  | 'abschluss'
  | 'test'
  | 'schublade'
export type DruckauftragStatus = 'queued' | 'sent' | 'done' | 'failed'

// ---------------------------------------------------------------- Stammdaten

export interface Produkt {
  id: string
  name: string // max. 24 Zeichen
  preisRappen: number | null // null = Preis offen -> Produkt bleibt inaktiv
  gruppe: Gruppe
  aktiv: boolean
  ausverkauft: boolean
  reihenfolge: number
  erstelltAm: string
}

export interface Einstellungen {
  eurKursX10000: number
  druckerName: string
  kassenPraefix: string // z. B. "K1"
  belegzaehler: number // letzte vergebene laufende Nummer
  backupPfadUsb: string | null
  port: number
}

// ---------------------------------------------------------------- Kassentag

export interface Kassentag {
  id: string
  datum: string // "2026-09-19"
  kassePraefix: string
  kassier: string
  startgeldChfRappen: number
  startgeldEurCent: number
  geoeffnetAm: string
  abgeschlossenAm: string | null
  istChfRappen: number | null
  istEurCent: number | null
  differenzChfRappen: number | null
  differenzEurCent: number | null
  bemerkung: string | null
  /** Absoluter Pfad der Abschluss-PDF (Migration 002); null, solange keine geschrieben wurde */
  pdfPfad: string | null
}

// ---------------------------------------------------------------- Verkauf

export interface Verkauf {
  id: string // UUID vom Client (Idempotenz)
  kassentagId: string
  belegnr: string // "K1-0042"
  zeit: string
  zahlart: Zahlart
  totalRappen: number
  storniertAm: string | null
  stornoId: string | null
}

export interface Position {
  id: string
  verkaufId: string
  produktId: string
  nameSnapshot: string
  preisSnapshotRappen: number
  anzahl: number
  gruppeSnapshot: Gruppe
}

export interface Zahlung {
  verkaufId: string
  waehrung: Waehrung
  kursX10000: number | null // nur bei EUR
  gegeben: number // in der Währung: Rappen (CHF, Twint) oder Cent (EUR); Helfer: 0
  gegebenChfRappen: number // CHF-Gegenwert, bei EUR auf 5 Rappen abgerundet
  rueckgeldChfRappen: number
  spendeChfRappen: number
  spendeTyp: SpendeTyp | null
}

export interface Storno {
  id: string
  verkaufId: string
  kassentagId: string // Kassentag, an dem storniert wurde
  zeit: string
  grund: StornoGrund
  auszahlungChfRappen: number
  mitPin: boolean
}

/**
 * Separat erfasste Spende (nachträglich, ohne Bon): "Rückgeld als Spende" zu einem bereits
 * abgeschlossenen Bar-Beleg (verkaufId gesetzt, betrag = dessen Rückgeld) oder freie Spende ohne Kauf.
 * Das Geld bleibt in der Lade und erhöht den Soll-Bestand. Storno nur per storniertAm, nichts wird gelöscht.
 */
export interface Spende {
  id: string
  kassentagId: string
  verkaufId: string | null
  zeit: string
  typ: SpendeTyp
  /** Rappen bei bar_chf/twint, Cent bei bar_eur */
  betrag: number
  kursX10000: number | null // nur bei bar_eur
  /** CHF-Gegenwert, bei EUR auf 5 Rappen abgerundet */
  betragChfRappen: number
  storniertAm: string | null
}

export interface SpendeAnfrage {
  id: string // UUID vom Client (Idempotenz)
  typ: SpendeTyp
  /** Rappen bei bar_chf/twint, Cent bei bar_eur */
  betrag: number
  /** Beleg, dessen Rückgeld gespendet wird; null bei freier Spende */
  verkaufId: string | null
}

export interface Druckauftrag {
  id: string
  verkaufId: string | null
  kassentagId: string | null
  typ: DruckauftragTyp
  bytesPfad: string | null
  status: DruckauftragStatus
  spoolerJobId: number | null
  fehler: string | null
  erstelltAm: string
  erledigtAm: string | null
}

// ---------------------------------------------------------------- Warenkorb (Client + core)

export interface WarenkorbZeile {
  produktId: string
  name: string
  preisRappen: number
  gruppe: Gruppe
  anzahl: number
}

export interface Warenkorb {
  zeilen: WarenkorbZeile[]
}

// ---------------------------------------------------------------- Zahlungsberechnung (core)

export interface ZahlungsEingabe {
  zahlart: Zahlart
  totalRappen: number
  /** Rappen bei bar_chf/twint, Cent bei bar_eur, 0 bei helfer */
  gegeben: number
  kursX10000: number
  /** "stimmt so": Rückgeld wird als Bar-Spende behalten */
  spendeBehalten: boolean
}

export type ZahlungsWarnung = 'nicht_gedeckt' | 'rueckgeld_ueber_200' | 'spende_ueber_200'

export interface ZahlungsErgebnis {
  /** false = blockierend (nicht gedeckt), Verkauf darf nicht gespeichert werden */
  gedeckt: boolean
  /** Warnungen, die der Kassier bestätigen muss (bestaetigtHohesRueckgeld) */
  warnungen: ZahlungsWarnung[]
  waehrung: Waehrung
  kursX10000: number | null
  gegeben: number
  gegebenChfRappen: number
  rueckgeldChfRappen: number
  spendeChfRappen: number
  spendeTyp: SpendeTyp | null
  /** nur bar_eur: Total in EUR, aufgerundet auf 10 Cent, zum Vorlesen */
  totalEurCent: number | null
}

// ---------------------------------------------------------------- Bon-Modell (core -> print)

export type BonGroesse = 'normal' | 'doppelt' | 'dreifach'
export type BonAusrichtung = 'links' | 'mitte' | 'rechts'

export interface BonZeile {
  text: string
  groesse?: BonGroesse // default normal (48 Zeichen); doppelt = 24; dreifach = 16
  ausrichtung?: BonAusrichtung // default links
  fett?: boolean
}

/** Ein Zettel: nach dem letzten Zeilenvorschub folgt ein Teilschnitt. */
export interface BonDokument {
  zeilen: BonZeile[]
}

/** Alles, was für einen Druckauftrag in EINEM WritePrinter an den Drucker geht. */
export interface DruckModell {
  schublade: boolean // Impuls zuerst
  dokumente: BonDokument[] // Reihenfolge: Coupons, dann Bon 1 (bzw. Abschluss-Bon)
}

// ---------------------------------------------------------------- Abschluss (core)

export interface ProduktZeile {
  produktId: string
  name: string
  verkauft: number // Stück, zahlart != helfer, nicht storniert
  helfer: number // Stück, zahlart = helfer, nicht storniert
  umsatzRappen: number // verkauft × preisSnapshot
}

export interface AbschlussBericht {
  kassentagId: string
  datum: string
  kassier: string
  kassePraefix: string
  startgeldChfRappen: number
  startgeldEurCent: number
  barEinnahmenChfRappen: number // Σ total bar_chf (brutto, inkl. später stornierte)
  barSpendeChfRappen: number
  barEinnahmenEurCent: number // Σ gegeben bar_eur (Stück EUR)
  barEinnahmenEurChfRappen: number // Σ gegebenChfRappen bar_eur
  rueckgeldAusEurRappen: number
  barSpendeEurChfRappen: number
  twintUmsatzRappen: number // brutto
  twintStorniertRappen: number // davon am heutigen Tag storniert
  twintSpendeRappen: number
  /** Anzahl nicht stornierter separat erfasster Spenden des Tages (informativ) */
  spendenSeparatAnzahl: number
  /** Σ CHF-Gegenwert aller nicht stornierten separaten Spenden (bereits in den Spende-Zeilen enthalten) */
  spendenSeparatChfRappen: number
  storniAnzahl: number
  storniAuszahlungRappen: number
  helferessenStueck: number
  helferessenEntgangenRappen: number
  nachdrucke: number
  sollChfRappen: number
  sollEurCent: number
  istChfRappen: number | null
  istEurCent: number | null
  differenzChfRappen: number | null
  differenzEurCent: number | null
  anzahlBelege: number // Verkäufe des Tages minus am selben Tag stornierte
  produkte: ProduktZeile[]
  erstelltAm: string
}

// ---------------------------------------------------------------- HTTP-API (server <-> renderer)

export interface VerkaufAnfrage {
  id: string // UUID, vom Client erzeugt
  positionen: { produktId: string; anzahl: number }[]
  zahlart: Zahlart
  gegeben: number // wie ZahlungsEingabe.gegeben
  spendeBehalten: boolean
  bestaetigtHohesRueckgeld: boolean
}

export interface VerkaufAntwort {
  verkauf: Verkauf
  zahlung: Zahlung
  positionen: Position[]
  sofortAusgeben: { name: string; anzahl: number }[] // Gruppe kasse
  druckauftragId: string | null
  /** true, wenn derselbe Verkauf schon existierte (Idempotenz) */
  bereitsVorhanden: boolean
}

export interface DruckStatus {
  ampel: 'ok' | 'pruefen'
  letzterFehler: string | null
  offeneAuftraege: number
  druckerName: string
  transport: 'winspool' | 'simulator'
}

export interface StatusAntwort {
  kassentag: Kassentag | null
  vortagOffen: Kassentag | null
  druck: DruckStatus
  version: string
}

export interface KassentagStartAnfrage {
  startgeldChfRappen: number
  startgeldEurCent: number
  kassier: string
}

export interface KassentagAbschlussAnfrage {
  istChfRappen: number
  istEurCent: number
  bemerkung: string | null
}

export interface StornoAnfrage {
  grund: StornoGrund
}

export interface NachdruckAnfrage {
  was: 'alles' | 'coupons' | 'bon'
}

export interface FehlerAntwort {
  fehler: string // Code, z. B. 'nicht_gedeckt', 'pin_falsch', 'kein_kassentag'
  meldung: string // deutsch, für den Bildschirm
}
