import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'

export function atomicJson(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp'
  const fd = openSync(temporary, 'wx', 0o640)
  try { writeFileSync(fd, JSON.stringify(value) + '\n'); fsyncSync(fd) }
  finally { closeSync(fd) }
  try { renameSync(temporary, path) } finally { rmSync(temporary, { force: true }) }
  const directory = openSync(join(path, '..'), 'r')
  try { fsyncSync(directory) } finally { closeSync(directory) }
}

const read = path => JSON.parse(readFileSync(path, 'utf8'))
const identity = () => ({ host: hostname(), pid: process.pid, start: readFileSync('/proc/self/stat', 'utf8').split(' ').at(21) })
function alive(owner) {
  if (owner.host !== hostname()) return true
  try { return readFileSync(`/proc/${owner.pid}/stat`, 'utf8').split(' ').at(21) === owner.start }
  catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

export function createBuildJobStore(root) {
  mkdirSync(root, { recursive: true })
  const lock = join(root, '.coordinator.lock'), owner = { ...identity(), token: randomUUID() }
  if (existsSync(lock) && !alive(read(lock))) rmSync(lock)
  const descriptor = openSync(lock, 'wx', 0o640)
  writeFileSync(descriptor, JSON.stringify(owner)); closeSync(descriptor)
  let closed = false
  return {
    list: () => readdirSync(root).filter(n => /^[a-f0-9-]{36}\.json$/.test(n)).map(n => {
      const record = read(join(root, n))
      if (record.schemaVersion !== 1 || record.id + '.json' !== n) throw new Error('Invalid persisted build job')
      return record
    }),
    save: job => atomicJson(join(root, job.id + '.json'), job),
    close() {
      if (closed) return
      closed = true
      if (existsSync(lock) && read(lock).token === owner.token) rmSync(lock)
    },
  }
}
