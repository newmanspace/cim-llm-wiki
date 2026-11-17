import { beforeEach, expect, test, vi } from 'vitest'
import client from '../src/api/client'
import * as api from '../src/api/projects'

vi.mock('../src/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))
beforeEach(() => vi.resetAllMocks())

test('project registry, token and synchronization requests preserve their API contract', async () => {
  const project = {
    id: 'mes',
    name: 'MES',
    product: 'MES',
    version: 'v1',
  }

  vi.mocked(client.get).mockResolvedValue({ data: { projects: [project] } })
  expect(await api.listProjects()).toEqual([project])
  vi.mocked(client.get).mockResolvedValue({ data: {} })
  expect(await api.listProjects()).toEqual([])
  vi.mocked(client.get).mockResolvedValue({ data: project })
  expect(await api.getProject('mes')).toEqual(project)
  await api.createProject(project)
  expect(client.post).toHaveBeenLastCalledWith('/admin/projects', project)
  await api.updateProject('mes', { name: 'Updated' })
  expect(client.patch).toHaveBeenLastCalledWith('/admin/projects/mes', { name: 'Updated' })
  await api.deleteProject('mes')
  expect(client.delete).toHaveBeenLastCalledWith('/admin/projects/mes')
  vi.mocked(client.post).mockResolvedValue({ data: { token: 'issued-once' } })
  expect(await api.issueToken('mes', ['read_config'], 24)).toEqual({
    token: 'issued-once',
  })
  expect(client.post).toHaveBeenLastCalledWith('/admin/projects/mes/token', {
    project_id: 'mes',
    scopes: ['read_config'],
    expires_in_hours: 24,
  })
  await api.revokeToken('mes', 'issued-once')
  expect(client.delete).toHaveBeenLastCalledWith('/admin/projects/mes/token', {
    data: { token: 'issued-once' },
  })
  vi.mocked(client.get).mockResolvedValue({
    data: { logs: [{ status: 'success' }], nodes: [{ plane: 'doc' }] },
  })
  expect(await api.getSyncLogs('mes')).toEqual([{ status: 'success' }])
  expect(client.get).toHaveBeenLastCalledWith('/admin/projects/mes/sync-logs', {
    params: { limit: 20 },
  })
  expect(await api.getWikiNodes('mes')).toEqual([{ plane: 'doc' }])
  vi.mocked(client.get).mockResolvedValue({ data: {} })
  expect(await api.getSyncLogs('mes', 50)).toEqual([])
  expect(await api.getWikiNodes('mes')).toEqual([])
})

test('project Wiki requests keep the URL project scope and return directory settings', async () => {
  const status = { project: 'demo', initialized: true, siteUrl: '/wiki/demo/' }
  vi.mocked(client.get).mockResolvedValue({ data: { data: status } })
  expect(await api.getProjectWiki('demo')).toEqual(status)
  expect(client.get).toHaveBeenLastCalledWith('/admin/projects/demo/wiki')
  vi.mocked(client.post).mockResolvedValue({ data: { data: status } })
  expect(await api.configureProjectWiki('demo', '/storage/projects/demo/wiki')).toEqual(status)
  expect(client.post).toHaveBeenLastCalledWith('/admin/projects/demo/wiki/configure', { sourceDirectory: '/storage/projects/demo/wiki' })
  expect(await api.initializeProjectWiki('demo')).toEqual(status)
  expect(client.post).toHaveBeenLastCalledWith('/admin/projects/demo/wiki/initialize', {})
})
