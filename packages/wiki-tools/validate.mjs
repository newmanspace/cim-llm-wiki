#!/usr/bin/env node
// Compatibility entrypoint for strict, versioned wiki validation.
import { runCli } from '../wiki-core/cli.mjs'
await runCli(['validate', ...process.argv.slice(2)])
