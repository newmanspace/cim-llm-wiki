// register-admin.mjs: Register project, issue token, and sync wiki nodes to Admin API
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ADMIN_URL = (process.env.ADMIN_URL || 'http://localhost:8080').replace(/\/+$/, '')
const REGISTRY_FILE = resolve(PROJECT_ROOT, 'data/documents/project-registry.json')

async function main() {
  const reg = JSON.parse(readFileSync(REGISTRY_FILE, 'utf-8'))
  const project = reg.projects['cim-llm-wiki']
  if (!project) {
    console.error('cim-llm-wiki not found in project-registry.json')
    process.exit(1)
  }

  console.log(`1. Registering/Updating project "${project.id}" to Admin API at ${ADMIN_URL}...`)
  const upsertRes = await fetch(`${ADMIN_URL}/api/v1/admin/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(project)
  })
  const upsertData = await upsertRes.json()
  console.log('Upsert response:', upsertRes.status, upsertData)

  if (!upsertRes.ok) {
    console.error('Failed to register project:', upsertData)
    process.exit(1)
  }

  console.log(`2. Issuing Project Token for "${project.id}"...`)
  const tokenRes = await fetch(`${ADMIN_URL}/api/v1/admin/projects/${project.id}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scopes: ['read_config', 'write_status'],
      expires_in_hours: 720,
      created_by: 'admin'
    })
  })
  const tokenData = await tokenRes.json()
  const token = tokenData.token
  console.log('Token generated:', token)

  console.log(`3. Synchronizing existing 24 wiki nodes to Admin system...`)
  const nodes = []
  for (const p of (project.wiki_nodes?.doc || [])) {
    const filename = p.split('/').pop().replace(/\.md$/, '')
    nodes.push({
      plane: 'doc',
      path: p,
      node_id: filename.toUpperCase(),
      bundle_id: 'CR-20261003-0002'
    })
  }
  for (const p of (project.wiki_nodes?.code || [])) {
    const filename = p.split('/').pop().replace(/\.md$/, '')
    nodes.push({
      plane: 'code',
      path: p,
      node_id: filename.toUpperCase(),
      bundle_id: 'CR-20261003-0002'
    })
  }

  const nodesRes = await fetch(`${ADMIN_URL}/api/v1/admin/projects/${project.id}/wiki-nodes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodes })
  })
  const nodesData = await nodesRes.json()
  console.log('Wiki nodes response:', nodesRes.status, nodesData)

  console.log('\n=============================================')
  console.log(`SUCCESS! Project "${project.id}" published to Admin.`)
  console.log(`Token: ${token}`)
  console.log(`Nodes Count: ${nodes.length}`)
  console.log('=============================================\n')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
