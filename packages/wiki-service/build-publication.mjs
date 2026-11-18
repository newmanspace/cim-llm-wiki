import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { copySafe, treeDigest } from '../wiki-core/build-snapshot.mjs'
import { atomicJson } from '../wiki-core/build-job-store.mjs'

export function createSitePublisher(root) {
  mkdirSync(root, { recursive: true })
  const html = join(root, 'html'), backup = join(root, '.publish-backup'), staging = join(root, '.publish-staging'), intent = join(root, '.publish-intent.json'), maintenance = join(root, '.maintenance')
  function recover() {
    if (!existsSync(intent)) { rmSync(maintenance, { force: true }); return }
    const record = JSON.parse(readFileSync(intent, 'utf8'))
    if (existsSync(html) && treeDigest(html) === record.digest) {
      atomicJson(join(root, 'source.json'), { gitCommit: record.gitCommit, updatedAt: new Date().toISOString() })
      rmSync(backup, { recursive: true, force: true })
    } else if (existsSync(backup)) {
      rmSync(html, { recursive: true, force: true }); renameSync(backup, html)
    } else if (record.hadHtml) throw new Error('Site update recovery requires operator inspection')
    else rmSync(html, { recursive: true, force: true })
    rmSync(staging, { recursive: true, force: true }); rmSync(intent); rmSync(maintenance, { force: true })
  }
  recover()
  function publish(output, gitCommit) {
    if (!existsSync(join(output, 'index.html'))) throw new Error('Build output is missing its home page')
    recover()
    rmSync(staging, { recursive: true, force: true }); copySafe(output, staging)
    const digest = treeDigest(staging)
    atomicJson(intent, { gitCommit, digest, hadHtml: existsSync(html) })
    writeFileSync(maintenance, 'Site update in progress')
    try {
      if (existsSync(html)) renameSync(html, backup)
      renameSync(staging, html)
      if (treeDigest(html) !== digest) throw new Error('Site output integrity check failed')
      atomicJson(join(root, 'source.json'), { gitCommit, updatedAt: new Date().toISOString() })
      rmSync(backup, { recursive: true, force: true }); rmSync(intent); rmSync(maintenance)
    } catch (error) { recover(); throw error }
    return { gitCommit, updated: true }
  }
  return { publish, recover }
}
