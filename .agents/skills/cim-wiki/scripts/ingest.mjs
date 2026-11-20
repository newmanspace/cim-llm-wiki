#!/usr/bin/env node
// Agent prepares the actual candidate from source material. This local command
// finalizes its mechanical checks; it never submits, freezes or builds a Wiki.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { checkCandidate, collectLocalPackage } from './dist/local-ingest.mjs'
import { outputPath, writeResponse } from './client-output.mjs'

try {
  const args = process.argv.slice(2)
  const flags = {}
  for (let index = 0; index < args.length; index += 2) {
    if (!['--rules', '--json-file', '--output', '--document', '--root'].includes(args[index]) || !args[index + 1])
      throw new Error('Usage: ingest.mjs --rules PROJECT-RULES.json --json-file CANDIDATE.json [--output REPORT.json]')
    flags[args[index]] = args[index + 1]
  }
  if (!flags['--rules'] || !flags['--json-file']) throw new Error('Project rules and a candidate request are required')
  const rules = JSON.parse(readFileSync(flags['--rules'], 'utf8'))
  const input = JSON.parse(readFileSync(flags['--json-file'], 'utf8'))
  let pack, packageError
  if (flags['--document']) {
    if (!flags['--root']) throw new Error('--document requires --root PACKAGE-DIRECTORY')
    try { pack = collectLocalPackage(flags['--root'], flags['--document']) }
    catch (error) { packageError = error.message }
    input.document = readFileSync(resolve(flags['--root'], flags['--document']), 'utf8')
  }
  const report = checkCandidate(rules, input)
  if (packageError) report.errors.push({ rule_id: 'document_package_invalid', severity: 'error', message: packageError })
  if (pack) {
    report.package_sha256 = pack.package_sha256
    report.package_manifest = { schema_version: pack.schema_version, entry: pack.entry, files: pack.files }
    report.warnings.push(...pack.warnings)
  }
  const output = outputPath(flags['--output'])
  writeResponse(output, report)
  console.log(JSON.stringify(output ? { output_file: output, errors: report.errors.length, warnings: report.warnings.length, fidelity: report.fidelity } : report, null, 2))
  if (report.errors.length) process.exitCode = 1
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
