/**
 * Druckerauswahl in den Einstellungen und Ampel-Hinweis in der Kopfzeile (reine Logik, ohne DOM).
 *
 * Hintergrund: Der Epson-Treiber legt die Warteschlange unter einem eigenen Namen an
 * (z. B. "EPSON TM-T20 Receipt"), die Kasse sucht aber den eingestellten Namen (Standard "TM-T20II").
 * Der Server liefert ueber GET /api/drucker die installierten Warteschlangen und einen Vorschlag;
 * hier wird daraus die Auswahlliste, der Hinweiskasten und das Testdruck-Ergebnis abgeleitet.
 */
import type { Druckauftrag, DruckStatus, DruckerInfo } from '@core/types'

/** Eine installierte Windows-Warteschlange (GET /api/drucker); Typ des Servers aus @core/types. */
export type DruckerEintrag = DruckerInfo

/** Antwort von GET /api/drucker. */
export interface DruckerAntwort {
  drucker: DruckerEintrag[]
  /** eingestellter Druckername (Einstellung drucker_name) */
  eingestellt: string
  /** vom Server vorgeschlagene Warteschlange (Bondrucker-Erkennung), null wenn keine */
  vorschlag: string | null
}

/**
 * DruckStatus mit den Feldern, die der Server fuer die Druckerhilfe liefert. Die Felder sind hier
 * optional, damit der Renderer auch gegen einen aelteren Server (ohne Vorschlag) laeuft.
 */
export type DruckStatusMitVorschlag = DruckStatus & {
  vorschlag?: string | null
  meldung?: string | null
}

/** Wert der Auswahlliste fuer den Freitext-Fallback "Anderer Name …". */
export const ANDERER_NAME = '__anderer_name__'

/** Anzeige einer Warteschlange in der Auswahlliste: "Name – Port – Treiber". */
export function druckerAnzeige(d: Pick<DruckerEintrag, 'name' | 'port' | 'treiber'>): string {
  const teile = [d.name, d.port, d.treiber].map((t) => t.trim()).filter((t) => t !== '')
  return teile.join(' – ')
}

/** Namensvergleich wie Windows: Warteschlangennamen unterscheiden Gross-/Kleinschreibung nicht. */
export function gleicherDruckerName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** true, wenn der Name in der Liste der installierten Warteschlangen vorkommt. */
export function druckerInListe(
  liste: readonly Pick<DruckerEintrag, 'name'>[],
  name: string
): boolean {
  return liste.some((d) => gleicherDruckerName(d.name, name))
}

/**
 * Anfangswert der Auswahlliste: der eingestellte Name, wenn er installiert ist, sonst "Anderer Name …"
 * (der eingestellte Name landet dann im Freitextfeld).
 */
export function auswahlFuer(
  liste: readonly Pick<DruckerEintrag, 'name'>[],
  eingestellt: string
): string {
  const treffer = liste.find((d) => gleicherDruckerName(d.name, eingestellt))
  return treffer !== undefined ? treffer.name : ANDERER_NAME
}

/** Wirksamer Druckername aus Auswahl und Freitext (getrimmt; leer, wenn nichts gewaehlt). */
export function wirksamerDruckerName(auswahl: string, freitext: string): string {
  return auswahl === ANDERER_NAME ? freitext.trim() : auswahl.trim()
}

/**
 * Text des Hinweiskastens, wenn der Server einen anderen Drucker vorschlaegt als eingestellt ist;
 * null, wenn es keinen Vorschlag gibt oder er bereits eingestellt ist.
 */
export function vorschlagHinweis(
  eingestellt: string,
  vorschlag: string | null | undefined
): string | null {
  if (vorschlag === null || vorschlag === undefined || vorschlag.trim() === '') return null
  if (gleicherDruckerName(eingestellt, vorschlag)) return null
  return `Eingestellt ist "${eingestellt}", gefunden wurde "${vorschlag}".`
}

/**
 * Untertitel/Tooltip der Ampel: die Meldung des Servers (z. B. «Warteschlange fehlt, Vorschlag: …»),
 * sonst der letzte Fehler; bei gruener Ampel Druckername und Transport.
 */
export function ampelMeldung(druck: DruckStatusMitVorschlag): string {
  if (druck.ampel === 'ok') return `${druck.druckerName} (${druck.transport})`
  const meldung = druck.meldung ?? null
  if (meldung !== null && meldung.trim() !== '') return meldung
  const fehler = druck.letzterFehler ?? 'Druck fehlgeschlagen'
  const vorschlag = druck.vorschlag ?? null
  return vorschlag !== null &&
    vorschlag.trim() !== '' &&
    !gleicherDruckerName(vorschlag, druck.druckerName)
    ? `${fehler}, Vorschlag: ${vorschlag}`
    : `${fehler} (${druck.druckerName})`
}

/** Hoechstens so lange wird ein Testdruck-Auftrag verfolgt, bevor die Anzeige aufgibt. */
export const TESTDRUCK_MAX_WARTEZEIT_MS = 30_000

export interface TestdruckAnzeige {
  text: string
  art: 'ok' | 'fehler' | 'laeuft'
}

/**
 * Anzeige des Testdrucks im Einstellungsbildschirm aus dem verfolgten Druckauftrag:
 * done -> gruen «Testdruck an "<Name>" übergeben», failed -> rot mit dem Fehlertext des Auftrags,
 * sonst «Testdruck läuft …» bzw. nach der Wartezeit ein roter Hinweis.
 */
export function testdruckAnzeige(
  auftrag: Pick<Druckauftrag, 'status' | 'fehler'> | null,
  druckerName: string,
  vergangenMs: number
): TestdruckAnzeige {
  if (auftrag?.status === 'done') {
    return { text: `Testdruck an "${druckerName}" übergeben.`, art: 'ok' }
  }
  if (auftrag?.status === 'failed') {
    const grund =
      auftrag.fehler !== null && auftrag.fehler.trim() !== ''
        ? auftrag.fehler
        : 'unbekannter Fehler'
    return { text: `Testdruck fehlgeschlagen: ${grund}`, art: 'fehler' }
  }
  if (vergangenMs >= TESTDRUCK_MAX_WARTEZEIT_MS) {
    return {
      text: `Testdruck an "${druckerName}" ist nach ${String(Math.round(TESTDRUCK_MAX_WARTEZEIT_MS / 1000))} s noch nicht abgeschlossen. Drucker und Kabel prüfen.`,
      art: 'fehler'
    }
  }
  return { text: `Testdruck läuft … (Drucker "${druckerName}")`, art: 'laeuft' }
}
