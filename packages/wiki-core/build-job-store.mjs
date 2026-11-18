import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { readRegularFile } from './safe-files.mjs'

export function atomicJson(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp'
  const fd = openSync(temporary, 'wx', 0o640)
  try { writeFileSync(fd, JSON.stringify(value) + '\n'); fsyncSync(fd) }
  finally { closeSync(fd) }
  try { renameSync(temporary, path) } finally { rmSync(temporary, { force: true }) }
  const directory = openSync(join(path, '..'), 'r')
  try { fsyncSync(directory) } finally { closeSync(directory) }
}

const read = path => JSON.parse(readRegularFile(path, 'utf8'))
function readOwner(path) {
  try { return read(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
function acquireLock(root, lock, owner) {
  // Serialize stale-owner recovery as well as creation; never unlink another contender's new lock.
  // A crash during acquisition leaves this guard for explicit recovery after verifying the acquirer is dead.
  const guard = join(root, '.coordinator-acquisition')
  mkdirSync(guard)
  try {
    const previous = readOwner(lock)
    if (previous && !alive(previous)) rmSync(lock)
    const fd = openSync(lock, 'wx', 0o640)
    try { writeFileSync(fd, JSON.stringify(owner)) } finally { closeSync(fd) }
  } finally { rmSync(guard, { recursive: true }) }
}
const identity = () => ({ host: hostname(), pid: process.pid, start: readFileSync('/proc/self/stat', 'utf8').split(' ').at(21) })
function alive(owner) {
  if (owner.host !== hostname()) return true
  try { return readFileSync(`/proc/${owner.pid}/stat`, 'utf8').split(' ').at(21) === owner.start }
  catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

export function createBuildJobStore(root) {
  mkdirSync(root, { recursive: true })
  const lock = join(root, '.coordinator.lock'), owner = { ...identity(), token: randomUUID() }
  acquireLock(root, lock, owner)
  let closed = false
  return {
    list: () => readdirSync(root).filter(n => /^[a-f0-9-]{36}\.json$/.test(n)).map(n => {
      const record = read(join(root, n))
      if (record.schemaVersion !== 1 || record.id + '.json' !== n) throw new Error('Invalid persisted build job')
      return record
    }),
    save(job) {
      if (typeof job.id !== 'string' || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(job.id)) throw new Error('Invalid build job identity')
      atomicJson(join(root, job.id + '.json'), job)
    },
    close() {
      if (closed) return
      closed = true
      if (readOwner(lock)?.token === owner.token) rmSync(lock)
    },
  }
}
