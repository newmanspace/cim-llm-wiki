import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT, schemaErrors, REFERENCE_TYPES, readContractJson } from './contracts.mjs'
import { structureErrors } from './markdown.mjs'

export const DOCUMENT_CONTRACT_FILE = 'document-contract.json'

export function validateDocumentSets({ wikiRoot, projects, pages, resolveLink }) {
  const errors = []
  const add = (code, path, message) => errors.push({ code, path, message })
  for (const project of [...projects].sort()) {
    const path = `${project}/${DOCUMENT_CONTRACT_FILE}`
    const absolute = join(wikiRoot, path)
    if (!existsSync(absolute)) {
      add('document_contract_missing', path, 'Every project must declare its document delivery contract')
      continue
    }
    let c
    try {
      c = readContractJson(absolute)
      const problems = schemaErrors('documentSet', c)
      if (problems.length) throw new Error(problems.join('; '))
      if (c.project !== project) throw new Error(`Contract project must match its directory: ${project}`)
      const ids = new Set()
      for (const rule of c.documents) {
        if (ids.has(rule.id)) throw new Error(`Duplicate document rule ID: ${rule.id}`)
        ids.add(rule.id)
        if (rule.max !== undefined && rule.max < rule.min) throw new Error(`${rule.id}: max must be greater than or equal to min`)
        if (rule.scope === 'project' && rule.modules) throw new Error(`${rule.id}: modules is only valid for module scope`)
        if (rule.scope === 'module') {
          if (!c.modules?.length) throw new Error(`${rule.id}: module scope requires a nonempty project module inventory`)
          for (const module of rule.modules || c.modules) {
            if (!c.modules.includes(module)) throw new Error(`${rule.id}: undeclared module ${module}`)
          }
        }
        if (rule.template && ![
          join(wikiRoot, project, 'templates', rule.template),
          join(wikiRoot, 'templates', rule.template),
          join(PROJECT_ROOT, '.agents/skills/cim-wiki/assets', rule.template),
        ].some(p => statSync(p, { throwIfNoEntry: false })?.isFile())) throw new Error(`${rule.id}: missing template ${rule.template}`)
      }
      for (const rule of c.documents) for (const ref of rule.references || []) {
        const target = c.documents.find(r => r.id === ref.target_rule)
        if (!target) throw new Error(`${rule.id}: unknown reference target rule ${ref.target_rule}`)
        if (!REFERENCE_TYPES[ref.field].includes(target.type)) throw new Error(`${rule.id}: ${ref.field} cannot target document type ${target.type}`)
      }
    } catch (e) {
      add('document_contract_error', path, e.message)
      continue
    }

    const active = [...pages].filter(([, p]) => p.project === project && p.fm.status === 'published')
    const matches = (rule, page) => page.fm.type === rule.type &&
      Object.entries(rule.where || {}).every(([field, value]) => page.fm[field] === value) &&
      (rule.scope !== 'module' || (rule.modules || c.modules).includes(page.fm.module))
    const selected = new Map(c.documents.map(rule => [rule.id, active.filter(([, p]) => matches(rule, p))]))
    for (const [key, page] of active) {
      if (c.modules?.length && !c.modules.includes(page.fm.module)) add('document_module_unknown', key, `Module ${page.fm.module} is not in the project module inventory`)
      if (c.allow_unlisted === false && !c.documents.some(r => matches(r, page))) add('document_unlisted', key, 'Published document is outside the declared delivery list')
    }
    for (const rule of c.documents) {
      const entries = selected.get(rule.id)
      const scopes = rule.scope === 'module' ? (rule.modules || c.modules) : [null]
      for (const module of scopes) {
        const count = entries.filter(([, p]) => module === null || p.fm.module === module).length
        if (count < rule.min || (rule.max !== undefined && count > rule.max)) {
          add('document_count', path, `${rule.id}${module === null ? '' : ` [module=${module}]`}: found ${count}, required ${rule.min}..${rule.max ?? 'unbounded'} published document(s)`)
        }
      }
      for (const [key, page] of entries) {
        if (rule.structure) {
          const requiredSections = [...new Set([...(rule.structure.requiredSections || []), ...(rule.structure.tables || []).map(t => t.section)])]
          const extra = structureErrors(page.tokens, { ...rule.structure, requiredSections }, page.fm)
          for (const e of extra) add('document_structure', key, `${rule.id}: [${e.code}] ${e.message}`)
        }
        for (const ref of rule.references || []) {
          const targets = new Set(selected.get(ref.target_rule)
            .filter(([, p]) => !ref.same_module || p.fm.module === page.fm.module).map(([key]) => key))
          const found = new Set()
          for (const link of Array.isArray(page.fm[ref.field]) ? page.fm[ref.field] : []) {
            if (typeof link !== 'string' || !/^\[\[[^\]]+\]\]$/.test(link)) continue
            const dest = resolveLink(link.slice(2, -2), key, true)
            if (dest && targets.has(dest)) found.add(dest)
          }
          if (found.size < ref.min) add('document_reference', key,
            `${rule.id}: ${ref.field} requires at least ${ref.min} distinct published target(s) from rule ${ref.target_rule}${ref.same_module ? ' in the same module' : ''}; found ${found.size}`)
        }
      }
    }
  }
  return errors
}
