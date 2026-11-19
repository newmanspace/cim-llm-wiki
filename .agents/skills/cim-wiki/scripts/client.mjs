#!/usr/bin/env node
import { transferClient } from './file-transfer.mjs'
// Thin HTTP client: no parser, compiler, scoring model or project imports.
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { outputPath, contextSummary, writeResponse, responseError } from './client-output.mjs'

function validateSubmit(input) {
      const report = input.local_report
      if (!report || !Array.isArray(report.errors) || report.errors.length || report.project !== input.project)
        throw new Error('Submit requires a local ingest report without errors for this project')
      if (report.target_path !== input.target_path || report.document_id !== (input.document_id ?? null))
        throw new Error('Rerun local ingest checks after changing the target path or document identity')
}

async function prepareBody(command, options, input, transfers) {
    if (options['--file'] && options['--package-root']) throw new Error('Choose a single file or a document package')
    if (options['--report']) input.local_report = JSON.parse(readFileSync(options['--report'], 'utf8'))
    if (command === 'submit') validateSubmit(input)
    if (command === 'convert' && options['--file']) input.source = (await transfers.upload(input.project, options['--file'])).uri
    if (['submit', 'save-draft', 'register', 'convert'].includes(command) && options['--package-root']) {
      if (command === 'submit' && !input.local_report.package_sha256) throw new Error('Rerun local ingest using --document and --root to check attachments')
      const pack = await transfers.uploadPackage(input.project, options['--package-root'], options['--entry'], input.local_report?.package_sha256)
      if (['register', 'convert'].includes(command)) { input.source = pack.uri; input.parsed = pack.uri }
      else input.content_uri = pack.uri
    }
  return JSON.stringify(input)
}

async function finishDownload(transfers, project, value, directory, output) {
  try { return await transfers.downloadPackage(project, value, directory) }
  catch (error) {
    value.download_error = error.message
    writeResponse(output, value)
    if (!output) console.error(JSON.stringify({ parsed_uri: value.parsed_uri || value.uri, download_error: error.message }))
    throw error
  }
}

try {
  const [command, ...args] = process.argv.slice(2)
  const routes = { upload: ['POST', 'upload'], 'upload-package': ['POST', 'document-packages'], 'download-package': ['GET', 'document-packages'], project: ['GET', 'projects'], templates: ['GET', 'projects'], 'reserve-document-identity': ['POST', 'document-identities/reserve'], initialize: ['POST', 'initialize'], directories: ['GET', 'directories'], context: ['GET', 'context'], document: ['GET', 'document'],
    'render-document':['POST','render-document'], convert: ['POST', 'convert'], register: ['POST', 'register'], state: ['POST', 'state'],
    submit: ['POST', 'document-submit'], 'save-draft': ['POST', 'document-drafts'], freeze: ['POST', 'document-freeze'], review: ['POST', 'document-review-requests'] }
  for (const resource of ['document-identities','naming-settings','data-sources','source-revisions','ingest-runs','source-observations','ingest-source-links','ingest-artifact-links','document-results','quality-policies','quality-policy-effective','document-evaluations','quality-issues','document-review-tasks','document-review-events','publications']) routes['list-'+resource] = ['GET',resource]
  for (const resource of ['ingest-runs','source-observations','document-evaluations']) routes[resource] = ['POST',resource]
  if (!routes[command]) throw new Error('Usage: client.mjs project|templates|initialize|directories|context|document|convert|register|state|save-draft|submit|freeze|review [--project ID|--source URI|--id ID|--json-file FILE] [--output FILE] [--summary]')
  const base = process.env.CIM_WIKI_URL
  const token = process.env.CIM_WIKI_TOKEN
  if (!base || !token) throw new Error('Set CIM_WIKI_URL and CIM_WIKI_TOKEN')
  const origin = new URL(base)
  if (origin.pathname !== '/' || origin.search || origin.hash) throw new Error('CIM_WIKI_URL must be the service origin without an API path')
  const url = new URL(base.replace(/\/+$/, '') + '/api/v2/knowledge/' + routes[command][1])
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('CIM_WIKI_URL must be an HTTP(S) service origin without credentials')
  const options = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--summary') { options['--summary'] = true; continue }
    if (!['--file', '--package-root', '--entry', '--download-dir', '--report', '--output', '--template-id', '--doc-type', '--module', '--topic', '--document-id', '--project', '--source', '--id', '--json-file', '--path', '--cursor', '--limit', '--status', '--folder', '--source-id', '--quality-status', '--review-status', '--run-id'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid client option')
    options[args[i]] = args[++i]
  }
  for (const flag of ['--template-id', '--doc-type', '--module', '--topic', '--document-id', '--project', '--source', '--id', '--path', '--cursor', '--limit', '--status', '--folder', '--source-id', '--quality-status', '--review-status', '--run-id']) if (options[flag]) url.searchParams.set(flag.slice(2).replaceAll('-', '_'), options[flag])
  if (['project', 'templates'].includes(command)) {
    const project = options['--project']
    if (!project || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(project) || ['__proto__', 'constructor', 'prototype'].includes(project)) throw new Error('An explicit valid --project ID is required')
    url.pathname += '/' + encodeURIComponent(project) + (command === 'templates' ? '/templates' : '')
    url.searchParams.delete('project')
  }
  if (options['--summary'] && command !== 'context') throw new Error('--summary is only supported for context')
  const output = outputPath(options['--output'])
  if (options['--download-dir'] && existsSync(options['--download-dir'])) throw new Error('Download directory already exists')
  const transfers = transferClient(origin, token, output ? output + '.receipts' : undefined)
  const method = routes[command][0]
  let body
  if (['upload', 'upload-package', 'download-package'].includes(command)) {
    const project = options['--project']
    if (!project) throw new Error('--project is required')
    let result
    if (command === 'upload') result = await transfers.upload(project, options['--file'])
    if (command === 'upload-package') result = await transfers.uploadPackage(project, options['--package-root'], options['--entry'])
    if (command === 'download-package') {
      result = await (await transfers.request('document-packages?' + new URLSearchParams({ project, uri: options['--source'] }))).json()
      result = { ...result, local_directory: await finishDownload(transfers, project, result, options['--download-dir'], output) }
    }
    writeResponse(output, result)
    console.log(JSON.stringify(output ? { output_file: output } : result, null, 2))
  } else {
  if (method === 'POST') {
    if (!options['--json-file']) throw new Error('POST commands require --json-file FILE (use - for stdin)')
    body = readFileSync(options['--json-file'] === '-' ? 0 : options['--json-file'], 'utf8')
    const input = JSON.parse(body)
    body = await prepareBody(command, options, input, transfers)
  }
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(body ? { 'Idempotency-Key': command + '-' + createHash('sha256').update(body).digest('hex') } : {}) },
    body, redirect: 'error', signal: AbortSignal.timeout(15 * 60 * 1000) })
  const value = await response.json()
  const requestId = response.headers.get('x-request-id')
  if (!response.ok && requestId) value.request_id = requestId
  if (response.ok && options['--download-dir']) value.local_directory = await finishDownload(transfers, JSON.parse(body).project, value, options['--download-dir'], output)
  writeResponse(output, value)
  if (!response.ok) throw new Error(responseError(response.status, value))
  const result = options['--summary'] ? { ...contextSummary(value), ...(output ? { output_file: output } : {}) } : output ? { output_file: output, http_status: response.status } : value
  console.log(JSON.stringify(result, null, 2))
  }
} catch (e) { console.error(e.message); process.exitCode = 1 }
