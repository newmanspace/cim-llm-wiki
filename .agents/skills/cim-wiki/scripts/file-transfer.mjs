import { open } from 'node:fs/promises'
import { constants, mkdirSync, writeFileSync, existsSync, renameSync, rmSync, mkdtempSync } from 'node:fs'
import { basename, resolve, dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { collectLocalPackage, packagePath, packageDigest } from './dist/local-ingest.mjs'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
export function transferClient(origin, token, receiptsDirectory) {
  async function request(path, input, binary) {
    const body = binary ?? (input ? JSON.stringify(input) : undefined)
    const response = await fetch(new URL('/api/v2/knowledge/' + path, origin), {
      method: body === undefined ? 'GET' : 'POST', body,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': binary ? 'application/octet-stream' : 'application/json', ...(body === undefined || binary ? {} : { 'Idempotency-Key': digest(body) }) },
      ...(binary ? { duplex: 'half' } : {}),
      redirect: 'error', signal: AbortSignal.timeout(15 * 60 * 1000),
    })
    if (!response.ok) throw new Error('Knowledge service HTTP ' + response.status + ': ' + await response.text())
    if (receiptsDirectory && body !== undefined) {
      mkdirSync(receiptsDirectory, { recursive: true, mode: 0o700 })
      writeFileSync(join(receiptsDirectory, randomUUID() + '.json'), JSON.stringify({ operation: path.split('?')[0], result: await response.clone().json() }), { mode: 0o600, flag: 'wx' })
    }
    return response
  }
  async function upload(project, path) {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    let stream
    try {
      if (!(await file.stat()).isFile()) throw new Error('Regular file required: ' + path)
      stream = file.createReadStream()
      const hash = createHash('sha256')
      let size = 0
      async function * chunks() {
        for await (const chunk of stream) {
          hash.update(chunk); size += chunk.length
          yield chunk
        }
      }
      const response = await request('upload?' + new URLSearchParams({ project, filename: basename(path) }), null, chunks())
      const saved = await response.json()
      if (saved.sha256 !== hash.digest('hex') || saved.size !== size) throw new Error('Uploaded file receipt mismatch')
      return saved
    } finally {
      stream?.destroy()
      await file.close()
    }
  }

  async function uploadPackage(project, root, entry, expectedDigest) {
    const pack = collectLocalPackage(root, entry)
    if (expectedDigest && pack.package_sha256 !== expectedDigest) throw new Error('Document or attachments changed; rerun local ingest')
    const files = []
    for (const file of pack.files) {
      const saved = await upload(project, resolve(root, file.path))
      if (saved.sha256 !== file.sha256) throw new Error('File changed during upload')
      files.push({ path: file.path, uri: saved.uri, sha256: saved.sha256 })
    }
    const result = await (await request('document-packages', { project, entry, files })).json()
    if (result.package_sha256 !== pack.package_sha256) throw new Error('Document package receipt mismatch')
    return result
  }
  async function downloadPackage(project, pack, destination) {
    if (packageDigest(pack) !== pack.package_sha256) throw new Error('Invalid download package')
    const path = resolve(destination)
    if (existsSync(path)) throw new Error('Download directory already exists')
    mkdirSync(dirname(path), { recursive: true })
    const temp = mkdtempSync(join(dirname(path), '.cim-download-'))
    try {
      for (const file of pack.files) {
        packagePath(file.path)
        const response = await request('uploads/content?' + new URLSearchParams({ project, uri: file.uri }))
        const chunks = []; let size = 0
        for await (const chunk of response.body) {
          size += chunk.length
          if (size > file.size) throw new Error('Download exceeds expected size')
          chunks.push(chunk)
        }
        const bytes = Buffer.concat(chunks)
        if (size !== file.size || digest(bytes) !== file.sha256) throw new Error('Downloaded attachment hash mismatch')
        const output = join(temp, file.path)
        mkdirSync(dirname(output), { recursive: true })
        writeFileSync(output, bytes, { mode: 0o600, flag: 'wx' })
      }
      if (existsSync(path)) throw new Error('Download destination changed')
      renameSync(temp, path)
    } finally { rmSync(temp, { recursive: true, force: true }) }
    return path
  }
  return { request, upload, uploadPackage, downloadPackage }
}
