// Eigene vitest-Konfiguration fuer den Renderer: die Projekt-Konfiguration (vitest.config.ts)
// schliesst nur core/server/print ein und darf nicht geaendert werden.
// Aufruf: npx vitest run --config src/renderer/vitest.config.ts
import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

const wurzel = resolve(__dirname, '../..')

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(wurzel, 'src/core'),
      '@renderer': resolve(wurzel, 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/renderer/**/*.test.ts'],
    passWithNoTests: false
  }
})
