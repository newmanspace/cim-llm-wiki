import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { socketRequest } from '../wiki-service/build-socket.mjs'
import { buildSite } from './build-runner.mjs'
import { buildConfig } from '../wiki-service/build-config.mjs'

export async function runBuildWorker({ socketPath, buildsRoot, sourceRoot, signal, heartbeatMs = 10000, timeoutMs = 600000, build = buildSite }) {
  const worker = randomUUID()
  while (!signal.aborted) {
    let job
    try { job = await socketRequest(socketPath, 'claim', { worker }, { signal }) }
    catch (error) {
      if (signal.aborted) break
      console.error('Wiki worker connection failed:', error.message)
      await delay(1000, undefined, { signal }).catch(() => {})
      continue
    }
    if (!job) continue
    const controller = new AbortController(), combined = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(timeoutMs)])
    let stage = 'validate', sending = false
    const heartbeat = setInterval(async () => {
      if (sending) return
      sending = true
      try { await socketRequest(socketPath, 'heartbeat', { id: job.id, claimToken: job.claimToken, stage }, { signal: combined }) }
      catch { controller.abort() }
      finally { sending = false }
    }, heartbeatMs)
    try {
      await build({ job, buildsRoot, sourceRoot, signal: combined, stage: value => { stage = value } })
      await socketRequest(socketPath, 'complete', { id: job.id, claimToken: job.claimToken }, { signal: combined })
    } catch (error) {
      if (!signal.aborted) {
        await socketRequest(socketPath, 'fail', { id: job.id, claimToken: job.claimToken, error: error.message, recoverable: combined.aborted || error.recoverable === true }).catch(failure => console.error('Wiki failure report rejected:', failure.message))
      }
    } finally { clearInterval(heartbeat) }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new AbortController()
  for (const name of ['SIGTERM', 'SIGINT']) process.once(name, () => controller.abort())
  const sourceRoot = fileURLToPath(new URL('../../', import.meta.url))
  await runBuildWorker({ ...buildConfig(process.env.CIM_WIKI_WORKSPACE || sourceRoot), buildsRoot: join(process.env.CIM_WIKI_WORKSPACE || sourceRoot, 'data/wiki-builds'), sourceRoot, signal: controller.signal })
}
