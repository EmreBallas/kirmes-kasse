/**
 * Preload: nur die zwei IPC-Bruecken fuer das Beenden hinter PIN (contextIsolation an, sandbox an).
 * Der Renderer spricht sonst ausschliesslich HTTP gegen den lokalen Server.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { KasseBruecke } from './index.d'

const kasse: KasseBruecke = {
  onBeendenAnfragen(callback) {
    const handler = (): void => callback()
    ipcRenderer.on('beenden-anfragen', handler)
    return () => {
      ipcRenderer.removeListener('beenden-anfragen', handler)
    }
  },
  beendenBestaetigt() {
    ipcRenderer.send('beenden-bestaetigt')
  }
}

contextBridge.exposeInMainWorld('kasse', kasse)
