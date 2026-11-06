import {
  resolveSource,
  sharedRoots,
  resolveShared,
  hashFile,
} from './sources.mjs'
// 文档注册表公共库：data/documents/manifest.json（文档状态机唯一状态源）
// 状态机: draft ──freeze──▶ frozen ──compile/activate──▶ active ──新版本active──▶ superseded
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  createReadStream,
} from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { createHash } from 'node:crypto'

export const STATES = ['draft', 'frozen', 'active', 'superseded']
// 合法迁移
export const TRANSITIONS = {
  draft: ['frozen'],
  frozen: ['active', 'draft'], // 回退 draft = 重新开放修正（hash 校验作废）
  active: ['superseded'],
  superseded: [],
}

export function manifestPath(projectRoot) {
  return join(projectRoot, 'data', 'documents', 'manifest.json')
}

export function loadManifest(projectRoot) {
  const p = manifestPath(projectRoot)
  if (!existsSync(p)) return { version: 1, docs: [] }
  return JSON.parse(readFileSync(p, 'utf-8'))
}

export function saveManifest(projectRoot, m) {
  const p = manifestPath(projectRoot)
  mkdirSync(dirname(p), { recursive: true })
  m.updated_at = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf-8')
}

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

// doc_id 与版本无关（同族文档升版后共用 doc_id，靠 version 区分记录）
export function makeDocId({ system, category, subcategory, name }) {
  return slug(
    [system, category, subcategory || '', name].filter(Boolean).join('-'),
  )
}

export function findDoc(m, idOrPath) {
  const norm = String(idOrPath).replace(/^\.\//, '')
  const exact = m.docs.find((d) => d.path === norm || d.doc_id === idOrPath)
  if (exact) return exact
  const matches = m.docs.filter(
    (d) =>
      d.doc_id === slug(idOrPath) ||
      d.path === join('data', norm.replace(/^data\//, '')) ||
      basename(d.path) === basename(norm),
  )
  return matches.length === 1 ? matches[0] : undefined
}

export function sha256(file) {
  const h = createHash('sha256')
  return new Promise((res, rej) => {
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('end', () => res(h.digest('hex')))
      .on('error', rej)
  })
}

export function upsertDraft(
  projectRoot,
  { system, version, category, subcategory, path, source_file },
) {
  const m = loadManifest(projectRoot)
  const doc_id = makeDocId({
    system,
    category,
    subcategory,
    name: basename(path, '.md'),
  })
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  let rec = m.docs.find((d) => d.path === path)
  if (rec) {
    if (rec.state !== 'draft') {
      rec.history.push({
        from: rec.state,
        to: 'draft',
        at: now,
        by: 'parse.mjs',
        note: '重新摄取，状态回退',
      })
      rec.state = 'draft'
      rec.sha256 = null
    }
    rec.updated_at = now
  } else {
    rec = {
      doc_id,
      system,
      version,
      category,
      subcategory: subcategory || null,
      path,
      state: 'draft',
      sha256: null,
      bundles: [],
      created_at: now,
      updated_at: now,
      history: [{ from: null, to: 'draft', at: now, by: 'parse.mjs' }],
    }
    m.docs.push(rec)
  }
  if (source_file) rec.source_file = source_file
  saveManifest(projectRoot, m)
  return { manifest: m, record: rec }
}

async function updateSourceState(rec, to, abs, sha, roots) {
  if (to === 'frozen') {
    if (
      rec.original_uri &&
      hashFile(resolveShared(rec.original_uri, roots)) !== rec.original_sha256
    )
      throw new Error(
        'Original document content has changed; register a new version',
      )
    rec.sha256 = sha ?? (await sha256(abs))
  }
  if (to === 'draft') {
    rec.sha256 = null
  }
}

function supersedePrevious(m, rec, now) {
  for (const old of m.docs) {
    if (old !== rec && old.doc_id === rec.doc_id && old.state === 'active') {
      old.history.push({
        from: 'active',
        to: 'superseded',
        at: now,
        by: 'doc-state.mjs',
        note: `${rec.version} 发布，旧版本归档`,
      })
      old.state = 'superseded'
      old.updated_at = now
    }
  }
}

export async function transition(
  projectRoot,
  idOrPath,
  to,
  {
    by = 'doc-state.mjs',
    note = '',
    sha = undefined,
    roots = sharedRoots(),
  } = {},
) {
  const m = loadManifest(projectRoot)
  const rec = findDoc(m, idOrPath)
  if (!rec) throw new Error(`manifest 中找不到文档: ${idOrPath}`)
  if (!TRANSITIONS[rec.state]?.includes(to)) {
    throw new Error(
      `非法状态迁移: ${rec.id ?? rec.doc_id} ${rec.state} → ${to}（允许: ${(TRANSITIONS[rec.state] || []).join(', ') || '无'}）`,
    )
  }
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const abs = resolveSource(rec.path, projectRoot, roots)
  if (!existsSync(abs)) throw new Error(`文档文件不存在: ${rec.path}`)
  await updateSourceState(rec, to, abs, sha, roots)
  rec.history.push({ from: rec.state, to, at: now, by, note })
  rec.state = to
  rec.updated_at = now
  // 激活时同 doc_id 族的旧 active 记录自动 supersede
  if (to === 'active') supersedePrevious(m, rec, now)
  saveManifest(projectRoot, m)
  return rec
}

// 供 compile.mjs 在编译完成后调用：frozen → active（其余状态不动，不报错）
export function activateIfFrozen(projectRoot, paths, by, bundleId) {
  const m = loadManifest(projectRoot)
  const changed = activateFrozenRecords(m, paths, by, bundleId)
  if (changed.length) saveManifest(projectRoot, m)
  return changed
}

// Apply transitions in memory so publication can persist all validated changes together.
export function activateFrozenRecords(
  m,
  paths,
  by,
  bundleId,
  now = new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
) {
  const changed = []
  for (const p of paths) {
    const rec = m.docs.find((d) => d.path === p)
    if (!rec || rec.state !== 'frozen') continue
    rec.history ||= []
    rec.bundles ||= []
    rec.history.push({
      from: 'frozen',
      to: 'active',
      at: now,
      by,
      note: 'Activated after validated compilation',
    })
    rec.state = 'active'
    rec.updated_at = now
    if (bundleId && !rec.bundles.includes(bundleId)) rec.bundles.push(bundleId)
    changed.push(rec)
    for (const old of m.docs) {
      if (old !== rec && old.doc_id === rec.doc_id && old.state === 'active') {
        old.history ||= []
        old.history.push({
          from: 'active',
          to: 'superseded',
          at: now,
          by,
          note: `${rec.version} 发布，旧版本归档`,
        })
        old.state = 'superseded'
        old.updated_at = now
      }
    }
  }
  return changed
}
