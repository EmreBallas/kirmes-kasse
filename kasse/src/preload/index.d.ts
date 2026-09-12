/**
 * Typen der IPC-Bruecke (contextBridge, Name "kasse"). Im Renderer als window.kasse verfuegbar,
 * sofern die Seite im Electron-Fenster laeuft (im normalen Browser ist window.kasse undefined).
 */
export interface KasseBruecke {
  /** Main bittet um die Beenden-PIN (Ctrl+Shift+Q oder Alt+F4/close); liefert die Abmeldefunktion. */
  onBeendenAnfragen(callback: () => void): () => void
  /** PIN wurde im Renderer ueber /api/pin/pruefen bestaetigt: Main darf die App beenden. */
  beendenBestaetigt(): void
}

declare global {
  interface Window {
    kasse?: KasseBruecke
  }
}
