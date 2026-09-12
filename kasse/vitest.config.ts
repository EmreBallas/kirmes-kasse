import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
      '@server': resolve(__dirname, 'src/server'),
      '@print': resolve(__dirname, 'src/print')
    }
  },
  test: {
    environment: 'node',
    include: ['src/core/**/*.test.ts', 'src/server/**/*.test.ts', 'src/print/**/*.test.ts'],
    passWithNoTests: false
  }
})
