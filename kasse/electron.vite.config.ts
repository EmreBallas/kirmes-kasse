import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Gemeinsame Aliase: @core ist reine Geschaeftslogik ohne Node/DOM und wird
// von Main, Server und Renderer gleichermassen importiert.
const aliases = {
  '@core': resolve('src/core'),
  '@server': resolve('src/server'),
  '@print': resolve('src/print'),
  '@renderer': resolve('src/renderer/src')
}

export default defineConfig({
  main: {
    resolve: { alias: aliases }
  },
  preload: {},
  renderer: {
    resolve: { alias: aliases },
    plugins: [react()]
  }
})
