import { afterAll, expect, test } from 'vitest'
import router from '../src/router'

afterAll(() => router.options.history.destroy())

test('Admin history, redirects and project parameters survive router upgrades', async () => {
  await router.push('/')
  expect(router.currentRoute.value.name).toBe('adminDashboard')
  expect(window.location.pathname).toBe('/admin/dashboard')

  await router.push('/projects')
  expect(router.currentRoute.value.name).toBe('adminProjects')

  await router.push({
    name: 'adminProjectDetail',
    params: { id: '产线 A/1' },
    query: { tab: 'docs' },
  })
  expect(router.currentRoute.value.params.id).toBe('产线 A/1')
  expect(router.currentRoute.value.query.tab).toBe('docs')
  expect(window.location.pathname).toContain('/admin/projects/')
  expect(router.resolve({ name: 'adminDashboard' }).href).toBe('/admin/dashboard')
})
