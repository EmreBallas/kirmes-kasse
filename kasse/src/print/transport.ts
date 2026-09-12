/**
 * Schnittstelle zwischen Druck-Worker und dem konkreten Druckweg (Windows-Spooler oder Simulator).
 */

export type TransportName = 'winspool' | 'simulator'

export type DruckErgebnisStatus = 'accepted' | 'removed' | 'error'

export interface DruckErgebnis {
  /** true nur bei status 'accepted' */
  ok: boolean
  /** accepted = vom Drucker uebernommen, removed = hing im Spooler und wurde entfernt, error = Fehler */
  status: DruckErgebnisStatus
  /** Spooler-Job-ID, null wenn unbekannt (Simulator, Fehler vor StartDocPrinter) */
  jobId: number | null
  /** deutsche Fehlermeldung, null bei Erfolg */
  fehler: string | null
}

export interface DruckTransport {
  name: TransportName
  /** Sendet die fertigen ESC/POS-Bytes; wirft nie, Fehler kommen als DruckErgebnis zurueck. */
  senden(bytes: Uint8Array, bezeichnung: string): Promise<DruckErgebnis>
}
