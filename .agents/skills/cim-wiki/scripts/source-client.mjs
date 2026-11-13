import { randomUUID } from 'node:crypto'
function parseOptions(args) {
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    if (
      !['--project', '--source-id', '--shared-root', '--mount'].includes(
        args[i],
      ) ||
      !args[i + 1]
    )
      throw new Error(
        'Use --project ID --source-id ID --shared-root PATH --mount NAME',
      )
    options[args[i]] = args[i + 1]
  }
  return options
}
function serviceConnection(options) {
  const project = options['--project'],
    base = process.env.CIM_WIKI_URL,
    token = process.env.CIM_WIKI_TOKEN
  if (!base || !token || !project)
    throw new Error(
      'CIM_WIKI_URL, CIM_WIKI_TOKEN and explicit project are required',
    )
  const origin = new URL(base)
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('Invalid service origin')
  return { project, origin, token }
}
export async function runSourceCLI(collect, type) {
  const options = parseOptions(process.argv.slice(2))
  const { project, origin, token } = serviceConnection(options)
  const call = async (path, data, key) => {
    const response = await fetch(new URL('/api/v2/knowledge/' + path, origin), {
      method: data ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(15 * 60 * 1000),
    })
    const value = await response.json()
    if (!response.ok)
      throw new Error(`Knowledge service HTTP ${response.status}`)
    return value.data || value
  }
  const context = await call('context?project=' + encodeURIComponent(project)),
    source = context.data_sources?.find(
      (s) => String(s.id) === options['--source-id'],
    )
  if (!source || !source.enabled || source.type !== type)
    throw new Error('Selected source is not enabled in the bound project')
  let collected
  try {
    collected = await collect({
      source,
      project,
      sharedRoot: options['--shared-root'],
      mount: options['--mount'],
    })
  } catch (error) {
    await call(
      'ingest-runs',
      {
        project,
        source_id: String(source.id),
        source_config_id: String(source.config_id),
        recipe_version: `${type}-skill-v1`,
        status: 'failed',
        error_code: `${type.toUpperCase()}_COLLECTION_FAILED`,
      },
      randomUUID(),
    )
    throw error
  }
  const prefix = randomUUID(),
    run = await call(
      'ingest-runs',
      {
        project,
        source_id: String(source.id),
        source_config_id: String(source.config_id),
        ...(type === 'git'
          ? {
              commit_sha: collected.commit_sha,
              repository_url: collected.repository_url,
            }
          : {
              operative_revision: collected.revision,
              repository_uuid: collected.repository_uuid,
            }),
        recipe_version: `${type}-skill-v1`,
      },
      prefix + '-run',
    )
  for (const [i, file] of collected.files.entries()) {
    const record = await call(
      'source-observations',
      {
        project,
        run_id: run.id,
        repository_path: file.repository_path,
        original_uri: file.source_uri,
        original_sha256: file.sha256,
        ...(type === 'git'
          ? {
              git_info_uri: collected.git_info_uri,
              git_blob_oid: file.blob_oid,
            }
          : { svn_info_uri: collected.svn_info_uri }),
      },
      prefix + '-' + i,
    )
    file.source_version_id = record.id
    file.source_uri = record.original_uri
  }
  console.log(JSON.stringify({ ...collected, run_id: run.id }, null, 2))
}
