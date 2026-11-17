import { createServer, request } from 'node:http'
import { chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'

async function readBody(req) {
  const chunks = []; let size = 0
  for await (const chunk of req) { size += chunk.length; if (size > 16384) throw new Error('Worker request exceeds limit'); chunks.push(chunk) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}
export function socketRequest(socketPath, action, value = {}, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path: '/' + action, method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, timeout: 65000 }, res => {
      const chunks = []; let size = 0
      res.on('data', chunk => { size += chunk.length; if (size > 2 * 1024 * 1024) res.destroy(new Error('Worker reply exceeds limit')); else chunks.push(chunk) })
      res.on('error', reject)
      res.on('end', () => {
        try { const body = JSON.parse(Buffer.concat(chunks).toString()); if (res.statusCode !== 200) throw new Error(body.error || 'Worker request rejected'); resolve(body) }
        catch (error) { reject(error) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('Worker request timed out')))
    req.on('error', reject); req.end(JSON.stringify(value))
  })
}
export async function startBuildSocket({ socketPath, coordinator, acceptOutput, waitMs = 25000 }) {
  mkdirSync(dirname(socketPath), { recursive: true })
  // Only a coordinator holding the job-store lock may remove its old socket.
  if (existsSync(socketPath)) rmSync(socketPath)
  const server = createServer(async (req, res) => {
    const abort = new AbortController()
    res.on('close', () => abort.abort())
    try {
      if (req.method !== 'POST') throw new Error('Worker POST required')
      const data = await readBody(req)
      let value
      switch (req.url) {
        case '/claim':
          if (typeof data.worker !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(data.worker)) throw new Error('Invalid worker identity')
          value = await coordinator.waitClaim(data.worker, waitMs, abort.signal); break
        case '/heartbeat': value = coordinator.heartbeat(data.id, data.claimToken, data.stage); break
        case '/complete': {
          value = coordinator.completeWith(data.id, data.claimToken, acceptOutput); break
        }
        case '/fail': value = coordinator.fail(data.id, data.claimToken, data.error, data.recoverable === true); break
        default: throw new Error('Unknown worker operation')
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value))
    } catch (error) {
      if (res.destroyed) return
      res.writeHead(error.status || 409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message }))
    }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve) })
  chmodSync(socketPath, 0o660)
  return server
}
