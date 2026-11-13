import { createHash } from 'node:crypto'
const fail = (message) => {
  throw Object.assign(new Error(message), { status: 409 })
}
export function verifyGitEvidence(info, source, run, bytes) {
  let evidence
  try {
    evidence = JSON.parse(info)
  } catch (error) {
    throw new Error('Git evidence must be valid JSON', { cause: error })
  }
  if (
    evidence.source_type !== 'git' ||
    evidence.repository_url !== run.repository_url ||
    evidence.commit_sha !== run.commit_sha ||
    !Array.isArray(evidence.files)
  )
    fail('Git evidence differs from the pinned repository or commit')
  const file = evidence.files.find(
    (item) => item.repository_path === source.repository_path,
  )
  if (
    !file ||
    file.sha256 !== source.original_sha256 ||
    file.blob_oid !== source.git_blob_oid
  )
    fail('Git file evidence differs from the registered document')
  const algorithm = source.git_blob_oid.length === 64 ? 'sha256' : 'sha1'
  const blob = createHash(algorithm)
    .update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes)
    .digest('hex')
  if (blob !== source.git_blob_oid)
    fail('Git blob object ID does not match the original document bytes')
}
