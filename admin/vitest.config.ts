import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: { dedupe: ['mermaid', 'dompurify'], alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reportOnFailure: true,
      include: ['src/**/*.{ts,vue}'],
      exclude: ['src/**/*.d.ts'],
      reporter: ['text', 'json-summary', 'lcov', 'html'],
      reportsDirectory: 'coverage',
    },
  },
})
