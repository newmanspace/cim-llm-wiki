#!/usr/bin/env node
// Build a synthetic Wiki outside the checkout; CI never loads business documents.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { compileBundle } from '../packages/wiki-core/compile.mjs'
import { PROJECT_ROOT } from '../packages/wiki-core/contracts.mjs'

if (!process.argv[2]) throw new Error('Usage: ci-wiki-fixture.mjs <empty external directory>')
const projectRoot = resolve(process.argv[2])
const fromRepo = relative(PROJECT_ROOT, projectRoot)
if (!fromRepo || (!fromRepo.startsWith('../') && fromRepo !== '..')) throw new Error('CI fixture must be outside the repository')
if (existsSync(projectRoot) && readdirSync(projectRoot).length) throw new Error('Fixture directory must be empty')
const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n') }
const source = '# CI source\n\nSynthetic requirement for validating the website build.\n'
const wikiRoot = join(projectRoot, 'data/wiki')
write(join(projectRoot, 'data/raw/ci-source.md'), source)
write(join(projectRoot, 'data/documents/manifest.json'), { version: 1, docs: [{ doc_id: 'ci-source', path: 'data/raw/ci-source.md',
  system: 'CIM', category: 'design', version: 'V1', state: 'frozen', sha256: createHash('sha256').update(source).digest('hex'), history: [], bundles: [] }] })
write(join(wikiRoot, 'ci/document-contract.json'), { schema_version: '1.0', project: 'ci',
  documents: [{ id: 'requirements', type: 'requirement', scope: 'project', min: 1 }] })
await compileBundle({ schema_version: '1.0', bundle_id: 'ci-fixture', project: 'ci', nodes: [{
  schema_version: '1.0', id: 'REQ-CI-001', type: 'requirement', plane: 'doc', product: 'CI', version: 'V1', domain: 'ci', module: 'ci',
  source: 'data/raw/ci-source.md', title: 'CI build requirement', content: 'The site must render a valid synthetic knowledge page.',
  confidence: .99, review_level: 'L0_auto', reviewer: 'auto', status: 'published',
  created_at: '2026-11-05T00:00:00Z', updated_at: '2026-11-05T00:00:00Z',
}] }, { projectRoot, wikiRoot })
console.log(`Synthetic Wiki built: ${wikiRoot}`)
