import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { components, validateForm } from './ui-stubs'
import i18n from '../src/i18n'
import Dashboard from '../src/views/admin/Dashboard.vue'
import ProjectManagement from '../src/views/admin/ProjectManagement.vue'
import ProjectDetail from '../src/views/admin/ProjectDetail.vue'
import AdminLayout from '../src/views/admin/AdminLayout.vue'
import App from '../src/App.vue'
import PageHeader from '../src/components/PageHeader.vue'

const state = vi.hoisted(() => ({
  route: { path: '/projects/mes', query: {}, params: { id: 'mes' } },
  push: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  issue: vi.fn(),
  revoke: vi.fn(),
  logs: vi.fn(),
  nodes: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  notify: vi.fn(),
  confirm: vi.fn(),
  destroy: vi.fn(),
}))
vi.mock('../src/api/projects', () => ({
  listProjects: state.list,
  getProject: state.get,
  upsertProject: state.save,
  deleteProject: state.remove,
  issueToken: state.issue,
  revokeToken: state.revoke,
  getSyncLogs: state.logs,
  getWikiNodes: state.nodes,
}))
vi.mock('tdesign-vue-next', async (original) => ({
  ...(await original<typeof import('tdesign-vue-next')>()),
  MessagePlugin: {
    error: state.error,
    success: state.success,
    warning: state.warning,
  },
  NotifyPlugin: { error: state.notify },
  DialogPlugin: { confirm: state.confirm },
}))
vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  useRoute: () => state.route,
  useRouter: () => ({ push: state.push }),
}))

const project = {
  id: 'mes',
  name: 'MES Project',
  product: 'MES',
  version: 'v1',
  created_at: '2026-11-05T00:00:00Z',
  updated_at: '2026-11-05T00:00:00Z',
  docs: [
    {
      doc_id: 'IDD',
      bundles: ['CR-TEST'],
      ingested_at: '2026-11-05T00:00:00Z',
    },
  ],
  repos: [
    {
      name: 'service',
      branch: 'main',
      synced_at: 'invalid-date',
      module_mapping: { 'src/': 'wip' },
    },
  ],
  modules: ['wip'],
  wiki_nodes: { doc: ['doc/a'], code: ['code/b'] },
  sync_state: {
    pending_changes: ['change'],
    last_error: 'error',
    last_doc_sync: '',
    last_code_sync: '',
  },
}
const wrappers: VueWrapper[] = []
const tr = (key: string) => String(i18n.global.t(key))
function view(component: any) {
  const wrapper = mount(component, {
    global: { components, plugins: [createPinia(), i18n] },
  })
  wrappers.push(wrapper)
  return wrapper
}
async function click(wrapper: VueWrapper, key: string) {
  const node = wrapper
    .findAll('button,a')
    .find((node) => node.text().trim() === tr(key))
  expect(node, `missing action ${key}`).toBeDefined()
  await node!.trigger('click')
  await flushPromises()
}
function dialog(wrapper: VueWrapper, key: string) {
  const result = wrapper
    .findAllComponents({ name: 'TDialog' })
    .find((node) => (node.props('title') || node.props('header')) === tr(key))
  expect(result).toBeDefined()
  return result!
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  i18n.global.locale.value = 'zh-CN'
  state.route.path = '/projects/mes'
  state.route.params.id = 'mes'
  Object.defineProperty(window, 'innerWidth', {
    value: 1200,
    writable: true,
    configurable: true,
  })
  window.matchMedia = vi.fn().mockReturnValue({ matches: false })
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
  state.list.mockResolvedValue([project])
  state.get.mockResolvedValue(structuredClone(project))
  state.save.mockResolvedValue(undefined)
  state.remove.mockResolvedValue(undefined)
  state.issue.mockResolvedValue({ token: 'issued-once' })
  state.revoke.mockResolvedValue(undefined)
  state.logs.mockResolvedValue([
    {
      repo_name: 'service',
      status: 'success',
      affected_modules: ['wip'],
      duration_ms: 3,
      synced_at: project.created_at,
    },
    { status: 'failed', affected_modules: [], synced_at: '' },
  ])
  state.nodes.mockResolvedValue([
    { plane: 'doc', path: 'data/wiki/mes/doc/a.md' },
    { plane: 'code', path: 'mes/code/b.md' },
  ])
  state.confirm.mockReturnValue({ destroy: state.destroy })
  validateForm.mockResolvedValue(true)
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
})

test('dashboard aggregates available projects and reports load failures', async () => {
  state.list.mockResolvedValue([project, { ...project, id: 'missing' }])
  state.get.mockImplementation(async (id) =>
    id === 'missing' ? Promise.reject(new Error('offline')) : project,
  )
  const wrapper = view(Dashboard)
  await flushPromises()
  expect(wrapper.text()).toContain('MES Project')
  expect(wrapper.findAll('.stat-value').map((node) => node.text())).toEqual([
    '2',
    '1',
    '1',
    '1',
    '1',
    '1',
  ])
  await click(wrapper, 'dashboard.goProjects')
  expect(state.push).toHaveBeenCalledWith('/projects')
  state.list.mockRejectedValue({
    response: { data: { error: 'registry offline' } },
  })
  view(Dashboard)
  await flushPromises()
  expect(state.error).toHaveBeenCalledWith('registry offline')
  state.list.mockResolvedValue([
    { id: 'minimal', created_at: '', updated_at: '' },
  ])
  state.get.mockResolvedValue({})
  view(Dashboard)
  await flushPromises()
})

test('project editing preserves document bindings and create validates input', async () => {
  const wrapper = view(ProjectManagement)
  await flushPromises()
  await click(wrapper, 'common.edit')
  const edit = dialog(wrapper, 'project.edit')
  edit.vm.$emit('confirm')
  await flushPromises()
  expect(state.save).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'mes',
      docs: project.docs,
      repos: project.repos,
    }),
  )
  await click(wrapper, 'project.create')
  const create = dialog(wrapper, 'project.create')
  const inputs = create.findAll('input')
  await inputs[0]!.setValue('MES new!')
  await inputs[1]!.setValue('New MES')
  expect(inputs[0]!.element.value).toBe('mesnew')
  validateForm.mockResolvedValueOnce(false)
  create.vm.$emit('confirm')
  await flushPromises()
  expect(state.save).toHaveBeenCalledTimes(1)
  create.vm.$emit('confirm')
  await flushPromises()
  expect(state.save).toHaveBeenLastCalledWith(
    expect.objectContaining({ id: 'mesnew', docs: [] }),
  )
  await wrapper.find('input').setValue('does not exist')
  expect(wrapper.text()).not.toContain('MES Project')
})

test('project mutation failures remain visible and confirmation is released', async () => {
  const wrapper = view(ProjectManagement)
  await flushPromises()
  await click(wrapper, 'common.delete')
  let confirmation = state.confirm.mock.calls.at(-1)![0]
  await confirmation.onConfirm()
  expect(state.remove).toHaveBeenCalledWith('mes')
  expect(state.destroy).toHaveBeenCalled()
  state.remove.mockRejectedValue({
    response: { data: { error: 'delete failed' } },
  })
  await click(wrapper, 'common.delete')
  confirmation = state.confirm.mock.calls.at(-1)![0]
  await confirmation.onConfirm()
  expect(state.error).toHaveBeenCalledWith('delete failed')
  state.get.mockRejectedValue(new Error('offline'))
  await click(wrapper, 'common.edit')
  expect(state.error).toHaveBeenCalled()
  state.save.mockRejectedValue(new Error('offline'))
  dialog(wrapper, 'project.edit').vm.$emit('confirm')
  await flushPromises()
  expect(state.error).toHaveBeenCalled()
  state.list.mockRejectedValue(new Error('offline'))
  await click(wrapper, 'common.refresh')
  expect(state.error).toHaveBeenCalled()
})

test('detail view publishes source links and displays tokens once, then revokes them', async () => {
  const wrapper = view(ProjectDetail)
  await flushPromises()
  expect(
    wrapper
      .findAll('a')
      .some((node) => node.attributes('href') === '/wiki/mes/doc/a'),
  ).toBe(true)
  const mapping = wrapper
    .findAll('button')
    .find((node) => node.text()==='模块映射')
  expect(mapping).toBeDefined()
  await mapping!.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('src/')
  await click(wrapper, 'detail.issueToken')
  dialog(wrapper, 'detail.issueToken').vm.$emit('confirm')
  await flushPromises()
  expect(
    wrapper
      .findAll('textarea')
      .some((node) => node.element.value === 'issued-once'),
  ).toBe(true)
  await click(wrapper, 'common.copy')
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('issued-once')
  await click(wrapper, 'detail.revokeToken')
  const revoke = dialog(wrapper, 'detail.revokeTokenTitle')
  revoke.vm.$emit('confirm')
  await flushPromises()
  expect(state.warning).toHaveBeenCalled()
  await revoke.find('textarea').setValue(' issued-once ')
  revoke.vm.$emit('confirm')
  await flushPromises()
  expect(state.revoke).toHaveBeenCalledWith('mes', 'issued-once')
  expect(
    wrapper
      .findAll('textarea')
      .some((node) => node.element.value === 'issued-once'),
  ).toBe(false)
  await click(wrapper, 'common.backToList')
  expect(state.push).toHaveBeenCalledWith('/projects')
})

test('detail reload and token errors retain recoverable UI state', async () => {
  const wrapper = view(ProjectDetail)
  await flushPromises()
  await click(wrapper, 'detail.issueToken')
  state.issue.mockRejectedValue(new Error('issue failed'))
  dialog(wrapper, 'detail.issueToken').vm.$emit('confirm')
  await flushPromises()
  expect(state.notify).toHaveBeenCalledWith(
    expect.objectContaining({ content: 'issue failed' }),
  )
  state.issue.mockResolvedValue({ token: 'issued-once' })
  dialog(wrapper, 'detail.issueToken').vm.$emit('confirm')
  await flushPromises()
  vi.mocked(navigator.clipboard.writeText).mockRejectedValue(
    new Error('clipboard disabled'),
  )
  await click(wrapper, 'common.copy')
  expect(state.error).toHaveBeenCalled()
  dialog(wrapper, 'detail.tokenIssued').vm.$emit('confirm')
  await flushPromises()
  expect(
    wrapper
      .findAll('textarea')
      .some((node) => node.element.value === 'issued-once'),
  ).toBe(false)
  await click(wrapper, 'detail.revokeToken')
  await dialog(wrapper, 'detail.revokeTokenTitle')
    .find('textarea')
    .setValue('another-token')
  state.revoke.mockRejectedValue({
    response: { data: { error: 'revoke failed' } },
  })
  dialog(wrapper, 'detail.revokeTokenTitle').vm.$emit('confirm')
  await flushPromises()
  expect(state.notify).toHaveBeenCalledWith(
    expect.objectContaining({ content: 'revoke failed' }),
  )
  state.get.mockRejectedValue({})
  state.logs.mockRejectedValue({})
  state.nodes.mockRejectedValue({})
  await click(wrapper, 'common.refresh')
  expect(state.notify).toHaveBeenCalled()
})

test('settings submenu expands from collapsed navigation and closes the mobile drawer on selection', async () => {
  const wrapper = view(AdminLayout)
  await flushPromises()
  expect(wrapper.find('.settings-child').exists()).toBe(false)
  await wrapper.find('.sidebar-toggle').trigger('click')
  await wrapper.find('.settings-toggle').trigger('click')
  expect(wrapper.find('.admin-sidebar').classes()).not.toContain('admin-sidebar--collapsed')
  expect(wrapper.find('.settings-child').text()).toBe('文档模板')
  expect(wrapper.findComponent({ name: 'SystemSettingsMenu' }).findComponent({ name: 'RouterLink' }).vm.$attrs.to).toEqual({
    path: '/settings/document-templates',
    query: { project: 'mes' },
  })
  await wrapper.find('.settings-toggle').trigger('click')
  expect(wrapper.find('.settings-child').exists()).toBe(false)

  window.innerWidth = 500
  window.dispatchEvent(new Event('resize'))
  await flushPromises()
  await wrapper.find('.hamburger').trigger('click')
  await wrapper.find('.settings-toggle').trigger('click')
  expect(wrapper.find('.admin-drawer').exists()).toBe(true)
  await wrapper.find('.settings-child').trigger('click')
  expect(wrapper.find('.admin-drawer').exists()).toBe(false)
})

test('direct document template visits expand the parent and mark the child as current', async () => {
  state.route.path = '/settings/document-templates'
  const wrapper = view(AdminLayout)
  await flushPromises()
  expect(wrapper.find('.settings-toggle').attributes('aria-expanded')).toBe('true')
  expect(wrapper.find('.settings-child').attributes('aria-current')).toBe('page')
  expect(wrapper.find('.settings-child').classes()).toContain('settings-child-active')
  expect(wrapper.find('.topbar-left').text()).toContain('系统设置')
})

test('layout supports desktop and mobile navigation, language and theme preferences', async () => {
  const wrapper = view(AdminLayout)
  await flushPromises()
  await wrapper.find('.sidebar-toggle').trigger('click')
  expect(wrapper.find('.admin-sidebar').classes()).toContain(
    'admin-sidebar--collapsed',
  )
  await wrapper.find('.icon-btn').trigger('click')
  expect(document.documentElement.getAttribute('theme-mode')).toBe('dark')
  wrapper.findComponent({ name: 'TSelect' }).vm.$emit('change', 'en-US')
  await flushPromises()
  expect(localStorage.getItem('cim_wiki_admin_locale')).toBe('en-US')
  i18n.global.locale.value = 'zh-CN'
  await flushPromises()
  window.innerWidth = 500
  window.dispatchEvent(new Event('resize'))
  await flushPromises()
  await wrapper.find('.hamburger').trigger('click')
  expect(wrapper.find('.admin-drawer').exists()).toBe(true)
  await wrapper.find('.drawer-mask').trigger('click')
  expect(wrapper.find('.admin-drawer').exists()).toBe(false)
  state.route.path = '/dashboard'
  view(AdminLayout)
  await flushPromises()
  state.route.path = '/other'
  view(AdminLayout)
  await flushPromises()
  const app = view(App)
  await flushPromises()
  expect(app.findComponent({ name: 'TConfigProvider' }).exists()).toBe(true)
  i18n.global.locale.value = 'en-US'
  await flushPromises()
  const header = mount(PageHeader, {
    props: { title: 'Title', subtitle: 'Source' },
  })
  wrappers.push(header)
  expect(header.text()).toContain('Source')
})
