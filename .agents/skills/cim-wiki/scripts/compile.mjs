#!/usr/bin/env node
// Compatibility entrypoint for the shared compiler.
import { runCli } from '../../../../packages/wiki-core/cli.mjs'
await runCli(['compile', ...process.argv.slice(2)])
