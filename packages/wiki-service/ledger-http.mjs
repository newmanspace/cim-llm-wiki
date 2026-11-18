import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

// The destination comes only from validated service configuration. Request data
// is confined to the HTTP path/body; it cannot replace the hostname or protocol.
export function requestLedger(origin, options) {
  const request = origin.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    const req = request(origin, { path: options.path, method: options.method, headers: options.headers, signal: AbortSignal.timeout(30000) }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        res.destroy(); reject(new Error('Ledger redirects are forbidden')); return
      }
      const chunks = []; let size = 0
      res.on('data', chunk => {
        size += chunk.length
        if (size > 8 * 1024 * 1024) res.destroy(new Error('Ledger response exceeds limit'))
        else chunks.push(chunk)
      })
      res.on('error', reject)
      res.on('aborted', () => reject(new Error('Ledger response was interrupted')))
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
        } catch { reject(new Error('Document ledger returned an invalid response')) }
      })
    })
    req.on('error', reject)
    req.end(options.body)
  })
}
