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
  route: { path: '/projects/mes', query: {} as Record<string, string>, params: { id: 'mes' } },
  push: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  issue: vi.fn(),
  revoke: vi.fn(),
  logs: vi.fn(),
  nodes: vi.fn(),
  wiki: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  notify: vi.fn(),
  confirm: vi.fn(),
  destroy: vi.fn(),
}))
vi.mock('../src/components/ProjectDocumentTemplates.vue', () => ({ default: { props: ['projectId'], template: '<div data-test="project-templates">{{ projectId }}</div>' } }))
vi.mock('../src/api/projects', () => ({
  listProjects: state.list,
  getProjectWiki: state.wiki,
  getProject: state.get,
  createProject: state.save,
  updateProject: state.update,
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
vi.mock('vue-router', async (original) => {
  const { reactive } = await import('vue')
  state.route = reactive(state.route)
  return ({
  ...(await original<typeof import('vue-router')>()),
  useRoute: () => state.route,
  useRouter: () => ({ push: state.push }),
})
})

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
  state.wiki.mockResolvedValue({ initialized: false, published: false })
  vi.clearAllMocks()
  localStorage.clear()
  i18n.global.locale.value = 'zh-CN'
  state.route.path = '/projects/mes'
  state.route.params.id = 'mes'
  state.route.query = {}
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
  state.update.mockResolvedValue(undefined)
  state.remove.mockResolvedValue(undefined)
  state.issue.mockResolvedValue({ token: 'issued-once' })
  state.revoke.mockResolvedValue(undefined)
  state.logs.mockResolvedValue({ logs: [
    {
      repo_name: 'service',
      status: 'success',
      affected_modules: ['wip'],
      duration_ms: 3,
      synced_at: project.created_at,
    },
    { status: 'failed', affected_modules: [], synced_at: '' },
  ], total: 2 })
  state.nodes.mockResolvedValue([
    { plane: 'doc', path: 'data/wiki/mes/doc/a.md' },
    { plane: 'code', path: 'mes/code/b.md' },
    { plane: 'code', path: 'data/projects/mes/custom-markdown/code/apis/api-new.md' },
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

test('project editing submits only changed basic fields; unchanged saves make no request', async () => {
  const wrapper = view(ProjectManagement)
  await flushPromises()
  await click(wrapper, 'common.edit')
  const edit = dialog(wrapper, 'project.edit')
  edit.vm.$emit('confirm')
  await flushPromises()
  expect(state.update).not.toHaveBeenCalled()
  expect(state.save).not.toHaveBeenCalled()
  expect(state.get).not.toHaveBeenCalled()
  await click(wrapper, 'common.edit')
  const changed = dialog(wrapper, 'project.edit')
  await changed.findAll('input')[1]!.setValue('Changed name')
  changed.vm.$emit('confirm')
  await flushPromises()
  expect(state.update).toHaveBeenCalledExactlyOnceWith('mes', { name: 'Changed name' })
  expect(state.save).not.toHaveBeenCalled()

  await click(wrapper, 'project.create')
  const create = dialog(wrapper, 'project.create')
  const inputs = create.findAll('input')
  await inputs[0]!.setValue('MES new!')
  await inputs[1]!.setValue('New MES')
  expect(inputs[0]!.element.value).toBe('mesnew')
  validateForm.mockResolvedValueOnce(false)
  create.vm.$emit('confirm')
  await flushPromises()
  expect(state.save).not.toHaveBeenCalled()
  create.vm.$emit('confirm')
  await flushPromises()
  expect(state.save).toHaveBeenLastCalledWith({ id: 'mesnew', name: 'New MES', product: 'Semiconductor-MES', version: '' })
  await wrapper.find('input').setValue('does not exist')
  expect(wrapper.text()).not.toContain('MES Project')
  const clearBtn = wrapper.findAll('button').find(b => b.text().includes('清空搜索'))
  expect(clearBtn).toBeDefined()
  await clearBtn!.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('MES Project')
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
  state.error.mockClear()
  await click(wrapper, 'common.edit')
  expect(state.get).not.toHaveBeenCalled()
  state.update.mockRejectedValue({ response: { data: { error: 'update failed' } } })
  await dialog(wrapper, 'project.edit').findAll('input')[1]!.setValue('Changed')
  dialog(wrapper, 'project.edit').vm.$emit('confirm')
  await flushPromises()
  expect(state.error).toHaveBeenCalledExactlyOnceWith('update failed')
  state.list.mockRejectedValue(new Error('offline'))
  await click(wrapper, 'common.refresh')
  expect(state.error).toHaveBeenCalled()
})

test('detail view publishes source links and displays tokens once, then revokes them', async () => {
  const wrapper = view(ProjectDetail)
  await flushPromises()
  expect(wrapper.find('a[href="/wiki/mes/code/apis/api-new"]').exists()).toBe(true)
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
  const hamburger = wrapper.find('.hamburger')
  expect(hamburger.attributes('aria-expanded')).toBe('false')
  await hamburger.trigger('click')
  await flushPromises()
  expect(hamburger.attributes('aria-expanded')).toBe('true')
  expect(wrapper.find('.admin-drawer').exists()).toBe(true)

  const mask = wrapper.find('.drawer-mask')
  await mask.trigger('keydown', { key: 'Tab' })
  await mask.trigger('keydown', { key: 'Tab', shiftKey: true })
  await mask.trigger('keydown', { key: 'Escape' })
  await flushPromises()
  expect(wrapper.find('.admin-drawer').exists()).toBe(false)

  await hamburger.trigger('click')
  await flushPromises()
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

 test('detail navigation selects the requested template tab and reloads the new project', async () => {
  const wrapper = view(ProjectDetail)
  await flushPromises()
  expect(wrapper.find('[data-test="project-templates"]').exists()).toBe(false)
  state.route.query = { tab: 'document-templates' }
  await flushPromises()
  expect(wrapper.find('[data-test="project-templates"]').text()).toBe('mes')
  state.get.mockResolvedValue({ ...structuredClone(project), id: 'other', name: 'Other project' })
  state.route.params.id = 'other'
  await flushPromises()
  expect(state.get).toHaveBeenLastCalledWith('other')
  expect(wrapper.text()).toContain('Other project')
  expect(wrapper.find('[data-test="project-templates"]').text()).toBe('other')
 })

test('late replies from the previous project do not overwrite its replacement or reveal its token', async () => {
  let finishProject!: (value: typeof project) => void
  let finishToken!: (value: { token: string }) => void
  state.get.mockImplementationOnce(() => new Promise(resolve => { finishProject = resolve }))
  const wrapper = view(ProjectDetail)
  await flushPromises()
  state.get.mockResolvedValue({ ...structuredClone(project), id: 'other', name: 'Other project' })
  state.route.params.id = 'other'
  await flushPromises()
  finishProject(structuredClone(project))
  await flushPromises()
  expect(wrapper.text()).toContain('Other project')
  expect(wrapper.text()).not.toContain('MES Project')
  state.issue.mockImplementationOnce(() => new Promise(resolve => { finishToken = resolve }))
  await click(wrapper, 'detail.issueToken')
  dialog(wrapper, 'detail.issueToken').vm.$emit('confirm')
  await flushPromises()
  state.get.mockResolvedValue(structuredClone(project))
  state.route.params.id = 'mes'
  await flushPromises()
  finishToken({ token: 'previous-project-token' })
  await flushPromises()
  expect(wrapper.findAll('textarea').some(node => node.element.value === 'previous-project-token')).toBe(false)
})

test('project Wiki column links published sites and shows initialization, build and fetch failure states', async () => {
  state.list.mockResolvedValue([
    { ...project, id: 'ready' }, { ...project, id: 'pending' }, { ...project, id: 'new' }, { ...project, id: 'offline' },
  ])
  state.wiki.mockImplementation(async (id: string) => {
    if (id === 'offline') throw new Error('Wiki unavailable')
    return { initialized: id !== 'new', published: id === 'ready', siteUrl: '/wiki/ready/' }
  })
  const wrapper = view(ProjectManagement)
  await flushPromises()
  expect(wrapper.find('a[href="/wiki/ready/"]').exists()).toBe(true)
  expect(wrapper.text()).toContain('待构建')
  expect(wrapper.text()).toContain('设置 Wiki')
  expect(wrapper.text()).toContain('Wiki 设置读取失败')
  await wrapper.findAll('a').find(a => a.text() === '待构建')!.trigger('click')
  expect(state.push).toHaveBeenLastCalledWith({ path: '/wiki-builds', query: { project: 'pending' } })
  await click(wrapper, 'project.create')
  const form = dialog(wrapper, 'project.create'), inputs = form.findAll('input')
  await inputs[0]!.setValue('custom')
  await inputs[1]!.setValue('Custom Wiki')
  await inputs[4]!.setValue('/app/data/projects/custom/markdown')
  form.vm.$emit('confirm'); await flushPromises()
  expect(state.save).toHaveBeenLastCalledWith({ id: 'custom', name: 'Custom Wiki', product: 'Semiconductor-MES', version: '', wiki_source_directory: '/app/data/projects/custom/markdown' })
})
