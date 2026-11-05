#!/usr/bin/env node
// Thin HTTP client: no parser, compiler, scoring model or project imports.
import { readFileSync } from 'node:fs'

try {
  const [command, ...args] = process.argv.slice(2)
  const routes = { context: ['GET', 'context'], document: ['GET', 'document'], bundle: ['GET', 'bundle'],
    convert: ['POST', 'convert'], register: ['POST', 'register'], state: ['POST', 'state'],
    submit: ['POST', 'bundles'], review: ['POST', 'review'], compile: ['POST', 'compile'], validate: ['POST', 'validate'] }
  if (!routes[command]) throw new Error('Usage: client.mjs context|document|bundle|convert|register|state|submit|review|compile|validate [--project ID|--source URI|--id ID|--json-file FILE]')
  const base = process.env.CIM_WIKI_URL
  const token = command === 'review' ? process.env.CIM_WIKI_REVIEW_TOKEN : process.env.CIM_WIKI_TOKEN
  if (!base || !token) throw new Error(command === 'review' ? 'Human reviewers must set CIM_WIKI_URL and their independent CIM_WIKI_REVIEW_TOKEN' : 'Set CIM_WIKI_URL and CIM_WIKI_TOKEN')
  const origin = new URL(base)
  if (origin.pathname !== '/' || origin.search || origin.hash) throw new Error('CIM_WIKI_URL must be the service origin without an API path')
  const url = new URL(base.replace(/\/+$/, '') + '/api/v2/knowledge/' + routes[command][1])
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('CIM_WIKI_URL must be an HTTP(S) service origin without credentials')
  const options = {}
  for (let i = 0; i < args.length; i++) {
    if (!['--project', '--source', '--id', '--json-file'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid client option')
    options[args[i]] = args[++i]
  }
  for (const flag of ['--project', '--source', '--id']) if (options[flag]) url.searchParams.set(flag.slice(2), options[flag])
  const method = routes[command][0]
  let body
  if (method === 'POST') {
    if (!options['--json-file'] && command !== 'validate') throw new Error('POST commands require --json-file FILE (use - for stdin)')
    body = options['--json-file'] ? readFileSync(options['--json-file'] === '-' ? 0 : options['--json-file'], 'utf8') : '{}'
    JSON.parse(body)
  }
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body, redirect: 'error', signal: AbortSignal.timeout(15 * 60 * 1000) })
  const value = await response.json()
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${value.error || 'Request failed'}`)
  console.log(JSON.stringify(value, null, 2))
  if (command === 'validate' && value.errors?.length) process.exitCode = 1
} catch (e) { console.error(e.message); process.exitCode = 1 }
