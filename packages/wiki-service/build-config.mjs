import { join } from 'node:path'

function seconds(env, name, fallback) {
  const value = env[name] === undefined ? fallback : Number(env[name])
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${name}`)
  return value * 1000
}
export function buildConfig(projectRoot, env = process.env) {
  const heartbeatMs = seconds(env, 'CIM_WIKI_BUILD_HEARTBEAT_INTERVAL_SECONDS', 10)
  const leaseMs = seconds(env, 'CIM_WIKI_BUILD_LEASE_SECONDS', 60)
  if (leaseMs <= heartbeatMs * 3) throw new Error('Build lease must exceed three heartbeat intervals')
  if (env.CIM_WIKI_BUILD_CONCURRENCY && env.CIM_WIKI_BUILD_CONCURRENCY !== '1') throw new Error('Only one build execution slot is supported')
  const retryDelays = (env.CIM_WIKI_BUILD_RETRY_DELAYS_SECONDS || '5,30,120').split(',').map(value => {
    const number = Number(value)
    if (!Number.isFinite(number) || number <= 0) throw new Error('Invalid retry delay')
    return number * 1000
  })
  const waitMs = seconds(env, 'CIM_WIKI_BUILD_WAIT_TIMEOUT_SECONDS', 25)
  if (waitMs > 60000) throw new Error('Build wait timeout cannot exceed 60 seconds')
  return { socketPath: env.CIM_WIKI_BUILD_SOCKET || '/run/cim-wiki-build/coordinator.sock', jobsRoot: env.CIM_WIKI_BUILD_JOBS_ROOT || join(projectRoot, 'data/wiki-jobs'), heartbeatMs, leaseMs, retryDelays,
    waitMs, reconcileMs: seconds(env, 'CIM_WIKI_BUILD_RECONCILE_INTERVAL_SECONDS', 30),
    timeoutMs: seconds(env, 'CIM_WIKI_BUILD_TIMEOUT_SECONDS', 600), previewTtlMs: seconds(env, 'CIM_WIKI_PREVIEW_TTL_SECONDS', 86400) }
}
