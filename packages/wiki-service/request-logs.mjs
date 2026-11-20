import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

const requests = new AsyncLocalStorage()
const validID = value => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value)

export function requestID() { return requests.getStore()?.id }

// Values come from selected protocol fields, never arbitrary bodies or headers.
export function requestFields(input = {}) {
  const context = requests.getStore()
  if (!context) return
  for (const key of ['project', 'bundle_id', 'document_id', 'artifact_id', 'run_id', 'source_doc_id']) {
    if (input[key] === null) delete context.fields[key]
    if (validID(input[key])) context.fields[key] = input[key]
  }
  if (Number.isSafeInteger(input.node_count) && input.node_count >= 0) context.fields.node_count = input.node_count
}

export function requestStep(step) {
  const context = requests.getStore()
  if (!context) return
  context.step = step
  context.emit('operation.step', 'info', { operation: { step } })
}

function statusLevel(status) {
  if (status >= 500) return 'error'
  if ([400, 404, 409, 422].includes(status)) return 'info'
  return status >= 400 ? 'warn' : 'info'
}

function errorDetails(error, status) {
  const message = String(error.message || '')
  // Do not log dynamic diagnostics, JSON parser excerpts, filesystem paths or stacks.
  const reasons = [
    'Critical or modified business rules require L2_arch review',
    'Source must be frozen before extraction/submission',
    'Project document record not found',
    'Project source documents require artifact_ids and quality evaluations',
    'Bundle ID is already submitted; use a new ID for revisions',
    'Document ledger is required for this quality-linked bundle',
    'Bearer token required',
    'Administrator service authentication required',
  ]
  let reason = reasons.includes(message) ? message : 'Request rejected; inspect the response using the request ID'
  if (message.startsWith('Document contract failed:')) reason = 'Document contract validation failed'
  if (error.code === 'BUNDLE_SCHEMA_INVALID') reason = 'Bundle schema validation failed'
  if (error instanceof SyntaxError) reason = 'Invalid JSON payload'
  return { code: validID(error.code) ? error.code : `HTTP_${status}`, message: reason }
}

export function requestFailure(error, status) {
  const context = requests.getStore()
  context?.emit('request.failed', statusLevel(status), {
    error: errorDetails(error, status),
    operation: { step: context.step },
    http: { response: { status_code: status } },
    event: { outcome: 'failure' },
    ...(Array.isArray(error.diagnostics) ? { validation: { error_count: error.diagnostics.length } } : {}),
  })
}

export function createRequestLogs(write = line => process.stdout.write(line)) {
  return function run(req, res, handler) {
    const incoming = req.headers['x-request-id']
    const id = validID(incoming) ? incoming : randomUUID()
    const start = process.hrtime.bigint()
    let path = '/invalid-request-target'
    try { path = new URL(req.url, 'http://localhost').pathname.slice(0, 2048) } catch { /* HTTP handler reports the invalid target. */ }
    const context = { id, fields: {}, step: 'request.received' }
    context.emit = (action, level, extra = {}) => {
      const event = { action, ...extra.event }
      const http = { request: { id, method: req.method }, ...extra.http }
      const record = { '@timestamp': new Date().toISOString(), 'ecs.version': '8.11.0',
        service: { name: 'cim-wiki-knowledge' }, log: { level }, url: { path },
        ...extra, event, http, cim: { ...context.fields } }
      write(JSON.stringify(record) + '\n')
    }
    res.setHeader('X-Request-ID', id)
    let ended = false
    const complete = aborted => {
      if (ended) return
      ended = true
      const status = res.statusCode
      context.emit(aborted ? 'request.aborted' : 'request.completed', aborted ? 'error' : statusLevel(status), {
        http: { response: { status_code: status } }, operation: { step: context.step },
        event: { duration: Number(process.hrtime.bigint() - start), outcome: aborted || status >= 400 ? 'failure' : 'success' },
      })
    }
    res.once('finish', () => complete(false))
    res.once('close', () => complete(!res.writableFinished))
    return requests.run(context, () => {
      context.emit('request.started', 'info')
      return handler()
    })
  }
}
