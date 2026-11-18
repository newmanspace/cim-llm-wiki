import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/browser',
  workers: 1,
  // A cold browser loads Mermaid and the individual diagram parsers on demand.
  expect: { timeout: 15000 },
  use: { baseURL: 'http://127.0.0.1:4179', channel: 'chromium' },
  webServer: {
    command: 'node node_modules/vitepress/bin/vitepress.js preview --host 127.0.0.1 --port 4179',
    url: 'http://127.0.0.1:4179/wiki/',
    reuseExistingServer: false
  }
})
