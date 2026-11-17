import { expect, it, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ProjectWikiSettings from '../ProjectWikiSettings.vue'
const api = vi.hoisted(() => ({ getProjectWiki: vi.fn(), configureProjectWiki: vi.fn(), initializeProjectWiki: vi.fn() }))
vi.mock('@/api/projects', () => api)
const status = { project: 'demo', sourceDirectory: '/storage/projects/demo/wiki', storageRoot: '/storage/projects', siteDirectory: '/storage/projects/demo/site/html', siteUrl: '/wiki/demo/', initialized: false, published: false, gitStatus: 'uninitialized' }
beforeEach(() => {
  vi.resetAllMocks()
  api.getProjectWiki.mockResolvedValue(status)
  api.configureProjectWiki.mockResolvedValue(status)
  api.initializeProjectWiki.mockResolvedValue({ ...status, initialized: true, gitStatus: 'clean' })
})
it('shows source and site paths and supports directory setup without legacy operations', async () => {
  const wrapper = mount(ProjectWikiSettings, { props: { project: 'demo' } }); await flushPromises()
  const click = async (label: string) => { const button = wrapper.findAll('button').find(b => b.text() === label); expect(button).toBeDefined(); await button?.trigger('click'); await flushPromises() }
  expect(wrapper.text()).toContain(status.siteDirectory)
  await wrapper.find('input').setValue('/storage/projects/demo/markdown')
  await click('保存目录'); expect(api.configureProjectWiki).toHaveBeenCalledWith('demo', '/storage/projects/demo/markdown')
  expect(wrapper.text()).not.toContain('复制旧项目内容')
  await click('初始化 Wiki Git'); expect(api.initializeProjectWiki).toHaveBeenCalledWith('demo')
  expect(wrapper.find('input').attributes('disabled')).toBeDefined()
  expect(wrapper.text()).not.toContain('盘点旧目录')
  expect(wrapper.text()).not.toContain('归档过期全局模板配置')
  wrapper.unmount()
})
it('keeps errors visible and discards responses after switching projects', async () => {
  let finish: (value: unknown) => void = () => {}
  api.getProjectWiki.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  const wrapper = mount(ProjectWikiSettings, { props: { project: 'demo' } })
  api.getProjectWiki.mockResolvedValueOnce({ ...status, project: 'other', siteUrl: '/wiki/other/', published: true })
  await wrapper.setProps({ project: 'other' }); await flushPromises()
  finish(status); await flushPromises()
  expect(wrapper.find('a').attributes('href')).toBe('/wiki/other/')
  api.configureProjectWiki.mockRejectedValueOnce(new Error('Directory conflicts'))
  await wrapper.findAll('button').find(b => b.text() === '保存目录')?.trigger('click'); await flushPromises()
  expect(wrapper.find('[role=alert]').text()).toContain('Directory conflicts')
  wrapper.unmount()
})

it('refreshes the published site status and reports loading failures', async () => {
  api.getProjectWiki.mockResolvedValueOnce({ ...status, initialized: true, gitStatus: 'clean' })
  const wrapper = mount(ProjectWikiSettings, { props: { project: 'demo' } }); await flushPromises()
  const click = async (label: string) => { await wrapper.findAll('button').find(b => b.text() === label)?.trigger('click'); await flushPromises() }
  api.getProjectWiki.mockResolvedValueOnce({ ...status, initialized: true, published: true, gitStatus: 'clean' })
  await click('刷新目录状态')
  expect(wrapper.find('a').attributes('href')).toBe('/wiki/demo/')
  wrapper.unmount()
  api.getProjectWiki.mockRejectedValueOnce(new Error('offline'))
  const failed = mount(ProjectWikiSettings, { props: { project: 'demo' } }); await flushPromises()
  expect(failed.find('[role=alert]').text()).toContain('设置读取失败')
  failed.unmount()
})
