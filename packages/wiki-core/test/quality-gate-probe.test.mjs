import { test } from 'node:test'
import assert from 'node:assert/strict'

// Temporary negative probe. Remove after GitHub confirms the merge is blocked.
test('quality gate rejects a failing test', () => {
  assert.fail('Intentional failure to verify the required GitHub quality gate')
})
