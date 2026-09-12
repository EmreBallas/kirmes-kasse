import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@server': resolve(__dirname, 'src/server'),
      '@print': resolve(__dirname, 'src/print'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    include: ['src/core/**/*.test.ts', 'src/server/**/*.test.ts', 'src/print/**/*.test.ts', 'src/renderer/**/*.test.ts'],
    passWithNoTests: false
  }
})
