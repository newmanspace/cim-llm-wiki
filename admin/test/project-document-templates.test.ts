import { afterEach, expect, test, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ProjectDocumentTemplates from '../src/components/ProjectDocumentTemplates.vue'
import { components } from './ui-stubs'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('../src/api/client', () => ({ default: api }))
let wrapper: VueWrapper
const boundTemplate = {
  id: 'glossary', name: '项目名词表', node_type: 'knowledge_article',
  body: '# 项目已绑定正文', contract: { fields: ['文档 ID'] },
  example: '项目合规示例', invalid_example: '项目不合规示例',
}
const binding = {
  from_version: 'v1', from_digest: 'bound-digest',
  current: { templates: [boundTemplate, { ...boundTemplate, id: 'sdd', name: '设计', body: '# 已绑定设计' }] },
  target: { templates: [{ ...boundTemplate, body: '# 尚未绑定的全局新版本' }] },
}
afterEach(() => { wrapper?.unmount(); vi.resetAllMocks() })
async function render() {
  wrapper = mount(ProjectDocumentTemplates, { props: { projectId: 'mes' }, global: { stubs: components } })
  await flushPromises()
}

test('reads the project binding and shows its templates rather than the global target', async () => {
  api.get.mockResolvedValue({ data: binding })
  await render()
  expect(api.get).toHaveBeenCalledWith('/admin/system/document-templates/project', { params: { project: 'mes' } })
  expect(wrapper.text()).toContain('v1')
  expect(wrapper.text()).toContain('bound-digest')
  expect(wrapper.text()).toContain('# 项目已绑定正文')
  expect(wrapper.text()).not.toContain('尚未绑定的全局新版本')
  await wrapper.find('select').setValue('sdd')
  expect(wrapper.text()).toContain('# 已绑定设计')
  expect(api.post).not.toHaveBeenCalled()
})

test('an unbound project shows a binding action hint instead of global templates', async () => {
  api.get.mockResolvedValue({ data: { ...binding, current: null, from_version: null } })
  await render()
  expect(wrapper.findComponent({ name: 'TEmpty' }).attributes('description')).toContain('尚未绑定')
  expect(wrapper.find('select').exists()).toBe(false)
})

test('load failure clears stale content and refresh recovers', async () => {
  api.get.mockRejectedValueOnce({ response: { data: { error: '模板服务不可用' } } })
  await render()
  expect(wrapper.findComponent({ name: 'TAlert' }).attributes('message')).toBe('模板服务不可用')
  api.get.mockResolvedValue({ data: binding })
  await wrapper.find('button').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('# 项目已绑定正文')
  api.get.mockRejectedValueOnce(new Error('新项目无法读取'))
  await wrapper.setProps({ projectId: 'other' })
  await flushPromises()
  expect(wrapper.text()).not.toContain('# 项目已绑定正文')
  expect(wrapper.findComponent({ name: 'TAlert' }).attributes('message')).toBe('新项目无法读取')
})
