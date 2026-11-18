import { test } from 'node:test'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Keep the PostgreSQL-backed bridge in the JavaScript coverage run as well as Go CI.
test('document quality bridge uses real project-scoped PostgreSQL transactions', {
  skip: !process.env.TEST_DATABASE_URL,
  timeout: 120000,
}, async () => {
  await promisify(execFile)('go', ['test', './internal/handler', '-run', '^TestDocumentQualityLiveBridge$', '-count=1'], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    env: process.env,
    timeout: 110000,
    maxBuffer: 4 * 1024 * 1024,
  })
})
