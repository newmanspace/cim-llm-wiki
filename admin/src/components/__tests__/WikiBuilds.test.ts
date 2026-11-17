import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import WikiBuilds from '../../views/admin/WikiBuilds.vue'

const mock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), projects: vi.fn(), replace: vi.fn(), route: { query: {} as Record<string, string> } }))
vi.mock('../ProjectWikiSettings.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/api/client', () => ({ default: { get: mock.get, post: mock.post } }))
vi.mock('@/api/projects', () => ({ listProjects: mock.projects }))
vi.mock('vue-router', () => ({ useRoute: () => mock.route, useRouter: () => ({ replace: mock.replace }) }))
let wrapper: VueWrapper | undefined
const jobs = [
  { id: 'preview', mode: 'preview', state: 'succeeded', gitCommit: 'a'.repeat(40), bundleId: 'CR-1', expiresAt: Date.now() + 86400000, attempts: [{ stage: 'build' }], result: { previewUrl: '/wiki-preview/preview/' } },
  { id: 'failed', mode: 'formal', state: 'failed', gitCommit: 'b'.repeat(40), attempts: [{ stage: 'validate' }], error: 'Snapshot invalid' },
]
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mock.route.query = { project: 'demo' }
  mock.projects.mockResolvedValue([{ id: 'demo', name: 'Demo' }, { id: 'other', name: 'Other' }])
  mock.get.mockResolvedValue({ data: { data: jobs } }); mock.post.mockResolvedValue({ data: {} }); mock.replace.mockResolvedValue(undefined)
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; vi.useRealTimers() })
const click = async (text: string) => { await wrapper!.findAll('button').find(button => button.text() === text)!.trigger('click'); await flushPromises() }

it('loads project-scoped tasks, previews approved bundles, retries failures and revokes previews', async () => {
  wrapper = mount(WikiBuilds); await flushPromises()
  expect(mock.get).toHaveBeenCalledWith('/admin/projects/demo/wiki-builds')
  expect(wrapper.find('a').attributes('href')).toBe('/wiki-preview/preview/')
  expect(wrapper.text()).toContain('Snapshot invalid')
  await wrapper.find('input').setValue('CR-1'); await wrapper.find('form').trigger('submit'); await flushPromises()
  expect(mock.post).toHaveBeenLastCalledWith('/admin/projects/demo/wiki-builds/preview', { bundle_id: 'CR-1' })
  await click('重试原 Git 输入'); expect(mock.post).toHaveBeenLastCalledWith('/admin/projects/demo/wiki-builds/retry', { id: 'failed' })
  await click('撤销预览'); expect(mock.post).toHaveBeenLastCalledWith('/admin/projects/demo/wiki-builds/revoke', { id: 'preview' })
  await vi.advanceTimersByTimeAsync(5000); expect(mock.get.mock.calls.length).toBeGreaterThan(3)
  await wrapper.find('select').setValue('other'); await flushPromises()
  expect(mock.replace).toHaveBeenCalledWith({ query: { project: 'other' } })
  expect(wrapper.find('input').element.value).toBe('')
  expect(mock.get).toHaveBeenLastCalledWith('/admin/projects/other/wiki-builds')
  await wrapper.find('select').setValue(''); await flushPromises(); expect(wrapper.find('table').exists()).toBe(false)
})

it('keeps operation and fetch failures visible and allows an explicit refresh', async () => {
  wrapper = mount(WikiBuilds); await flushPromises()
  mock.post.mockRejectedValueOnce({ response: { data: { error: 'Baseline changed' } } })
  await click('重试原 Git 输入'); expect(wrapper.find('[role=alert]').text()).toBe('Baseline changed')
  mock.get.mockRejectedValueOnce(new Error('offline')); await click('刷新任务')
  expect(wrapper.find('[role=alert]').text()).toBe('构建任务读取失败')
  mock.get.mockResolvedValueOnce({ data: { data: [] } }); await click('刷新任务')
  expect(wrapper.text()).toContain('暂无构建任务')
})

it('does not publish stale responses after a project switch or retain polling after unmount', async () => {
  let resolve!: (value: unknown) => void
  mock.get.mockReturnValueOnce(new Promise(done => { resolve = done }))
  wrapper = mount(WikiBuilds); await flushPromises()
  mock.get.mockResolvedValue({ data: { data: [] } })
  await wrapper.find('select').setValue('other'); await flushPromises()
  resolve({ data: { data: jobs } }); await flushPromises()
  expect(wrapper.find('table').exists()).toBe(false)
  wrapper.unmount(); wrapper = undefined
  const calls = mock.get.mock.calls.length
  await vi.advanceTimersByTimeAsync(10000); expect(mock.get).toHaveBeenCalledTimes(calls)
})

it('reports project discovery errors and avoids starting a poll after early disposal', async () => {
  mock.projects.mockRejectedValueOnce(new Error('offline'))
  wrapper = mount(WikiBuilds); await flushPromises()
  expect(wrapper.find('[role=alert]').text()).toBe('项目列表读取失败')
  expect(mock.get).not.toHaveBeenCalled()
  wrapper.unmount()
  let resolve!: (value: unknown) => void
  mock.projects.mockReturnValueOnce(new Promise(done => { resolve = done }))
  wrapper = mount(WikiBuilds); wrapper.unmount(); wrapper = undefined
  resolve([{ id: 'demo' }]); await flushPromises(); await vi.advanceTimersByTimeAsync(10000)
  expect(mock.get).not.toHaveBeenCalled()
})

it('offers a first build and keeps preflight failures visible with expandable diagnostics', async () => {
  mock.get.mockResolvedValueOnce({ data: { data: [] } })
  wrapper = mount(WikiBuilds); await flushPromises()
  expect(wrapper.text()).toContain('发起首次构建')
  mock.get.mockResolvedValueOnce({ data: { data: [{ id: 'blocked', mode: 'formal', gitCommit: '', state: 'blocked', attempts: [], error: 'Git 基线不可构建', diagnostics: [{ code: 'wiki_validation', message: '全库严格校验未通过，共 1 项错误', issues: [{ code: 'review_required', path: 'demo/doc/test.md', message: '缺少审核身份' }] }] }] } })
  await click('构建当前 Wiki')
  expect(mock.post).toHaveBeenLastCalledWith('/admin/projects/demo/wiki-builds/build', {})
  expect(wrapper.text()).toContain('构建受阻')
  expect(wrapper.find('details').text()).toContain('缺少审核身份')
  expect(wrapper.find('details').text()).toContain('demo/doc/test.md')
  expect(wrapper.text()).not.toContain('暂无构建任务')
  expect(wrapper.findAll('button').some(button => button.text() === '重试原 Git 输入')).toBe(false)
})
