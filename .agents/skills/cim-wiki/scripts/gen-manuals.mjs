#!/usr/bin/env node
// Manual publication uses the same reviewed bundle contract as atomic nodes.
import { runCli } from '../../../../packages/wiki-core/cli.mjs'

if (!process.argv[2]) {
  console.error('Usage: gen-manuals.mjs <reviewed-manual-bundle.json> [--preview]. Unvalidated raw-document rebuilds are disabled.')
  process.exitCode = 1
} else {
  await runCli(['compile', ...process.argv.slice(2)])
}
