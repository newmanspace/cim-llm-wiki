#!/usr/bin/env node
import {
  resolveSource,
  resolveShared,
  hashFile,
} from '../wiki-core/sources.mjs'
// 文档状态管控 CLI：data/documents/manifest.json
// 状态机: draft ──freeze──▶ frozen ──activate(或 compile 自动)──▶ active ──新版本active──▶ superseded
//
// 用法:
//   node doc-state.mjs list
//   node doc-state.mjs show <doc_id|path>
//   node doc-state.mjs freeze <doc_id|path> [--note "修正完成说明"]     # 记录 sha256，正文定稿
//   node doc-state.mjs unfreeze <doc_id|path> [--force] [--note ...]   # frozen → draft（重新开放修正）
//   node doc-state.mjs activate <doc_id|path> [--force] [--note ...]   # 校验其 bundle 已全部编译入库
//   node doc-state.mjs supersede <doc_id|path> [--note ...]
//   node doc-state.mjs verify                                           # 全量 sha256/存在性校验
// 规则: freeze 前必须处于 draft；activate 前必须处于 frozen 且引用该文档的 bundle 均有 compiled_at
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadManifest, findDoc, transition, sha256 } from './docstore.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(
  process.env.CIM_WIKI_WORKSPACE || resolve(__dirname, '..', '..'),
)

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

function referencedBundles() {
  // doc path -> bundles whose nodes cite it as source
  const work = join(ROOT, 'data', 'work')
  const out = {}
  if (!existsSync(work)) return out
  for (const b of readdirSync(work)) {
    const p = join(work, b, 'nodes.json')
    if (!existsSync(p)) continue
    const d = JSON.parse(readFileSync(p, 'utf-8'))
    for (const s of new Set(
      [d.source_doc, ...(d.nodes || []).map((n) => n.source)].filter(Boolean),
    )) {
      if (!String(s).startsWith('data/') && !String(s).startsWith('shared://'))
        continue
      ;(out[s] ||= []).push({
        bundle: d.bundle_id || b,
        compiled: !!d.compiled_at,
      })
    }
  }
  return out
}

async function main() {
  const args = process.argv.slice(2)
  const cmd = args[0]
  const opt = (name) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : null
  }
  const flag = (name) => args.includes(name)
  const m = loadManifest(ROOT)
  const need = (target) => {
    const rec = findDoc(m, target)
    if (!rec)
      fail(
        `manifest 中找不到文档: ${target}\n可先执行: node doc-state.mjs list`,
      )
    return rec
  }

  const commands = {
    list: async () => {
      if (!m.docs.length) {
        console.log('(manifest 为空，尚无登记文档)')
        return
      }
      const bundles = referencedBundles(m)
      const rows = m.docs.map((r) =>
        [
          r.doc_id,
          r.state,
          r.version ?? '-',
          (bundles[r.path] || []).length,
          r.path,
        ].join('  '),
      )
      console.log('doc_id  state  version  bundles  path')
      console.log(rows.join('\n'))
      return
    },
    show: async () => {
      const rec = need(args[1])
      console.log(JSON.stringify(rec, null, 2))
      return
    },
    freeze: async () => {
      const rec = need(args[1])
      const abs = resolveSource(rec.path, ROOT)
      if (!existsSync(abs)) fail(`文档文件不存在: ${rec.path}`)
      const h = await sha256(abs)
      const updated = await transition(ROOT, rec.doc_id, 'frozen', {
        by: process.env.USER || 'user',
        note: opt('--note') || '修正完成，正文定稿',
      })
      console.log(
        `frozen: ${updated.doc_id} (${updated.version ?? '-'}) sha256=${h.slice(0, 12)}…`,
      )
      return
    },
    unfreeze: async () => {
      const rec = need(args[1])
      const updated = await transition(ROOT, rec.doc_id, 'draft', {
        by: process.env.USER || 'user',
        note: opt('--note') || '重新开放修正',
      })
      console.log(`draft: ${updated.doc_id}（sha256 校验已作废）`)
      return
    },
    activate: async () => {
      const rec = need(args[1])
      if (!flag('--force')) {
        const bs = referencedBundles(m)[rec.path] || []
        if (!bs.length)
          fail(
            `${rec.doc_id}: 无任何 bundle 引用该文档，不能激活。 (--force 跳过)`,
          )
        const pending = bs.filter((b) => !b.compiled).map((b) => b.bundle)
        if (pending.length)
          fail(
            `${rec.doc_id}: 以下 bundle 尚未编译入库，不能激活: ${pending.join(', ')}`,
          )
      }
      const updated = await transition(ROOT, rec.doc_id, 'active', {
        by: process.env.USER || 'user',
        note: opt('--note') || '发布',
      })
      console.log(`active: ${updated.doc_id} (${updated.version ?? '-'})`)
      return
    },
    supersede: async () => {
      const rec = need(args[1])
      const updated = await transition(ROOT, rec.doc_id, 'superseded', {
        by: process.env.USER || 'user',
        note: opt('--note') || '人工归档',
      })
      console.log(`superseded: ${updated.doc_id} (${updated.version ?? '-'})`)
      return
    },
    verify: async () => {
      let bad = 0
      for (const r of m.docs) {
        const abs = resolveSource(r.path, ROOT)
        if (!existsSync(abs)) {
          console.log(`ERROR [doc_missing] ${r.doc_id}: ${r.path}`)
          bad++
          continue
        }
        if (
          r.original_uri &&
          hashFile(resolveShared(r.original_uri)) !== r.original_sha256
        ) {
          console.log(`ERROR [original_drift] ${r.doc_id}`)
          bad++
        }
        if (r.state !== 'draft' && r.sha256) {
          const h = await sha256(abs)
          if (h !== r.sha256) {
            console.log(
              `ERROR [doc_drift] ${r.doc_id}: 内容已变更但状态为 ${r.state}（freeze 后禁止修改，需先 unfreeze）`,
            )
            bad++
          }
        }
      }
      console.log(
        bad
          ? `\nverify: ${bad} error`
          : `verify: ${m.docs.length} 篇文档全部通过`,
      )
      process.exit(bad ? 1 : 0)
      return
    },
  }
  if (!Object.hasOwn(commands, cmd)) {
    console.log(
      '用法: node doc-state.mjs <list|show|freeze|unfreeze|activate|supersede|verify> [doc_id|path] [--note ...] [--force]',
    )
    process.exit(cmd ? 1 : 0)
    return
  }
  await commands[cmd]()
}

main().catch((e) => fail(String(e.message || e)))
