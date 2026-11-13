import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import DocumentTemplates from '../src/views/admin/DocumentTemplates.vue'
import { components } from './ui-stubs'
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('../src/api/client', () => ({ default: api }))
vi.mock('../src/api/projects', () => ({
  listProjects: vi.fn(async () => []),
  getProject: vi.fn(),
}))
const definition = {
  name: 'Defaults',
  templates: [
    {
      id: 'glossary',
      name: 'Glossary',
      node_type: 'knowledge_article',
      body: '# Glossary',
      example: '# Valid',
      invalid_example: '# Invalid',
      contract: { format: 'markdown-v1', fields: ['文档 ID'], sections: ['文档信息'], tables: [] },
    },
  ],
  directories: [],
  terms: [],
  delivery: [],
}
let wrapper: VueWrapper
async function click(label: string) {
  const button = wrapper.findAll('button').find((b) => b.text() === label)
  expect(button).toBeTruthy()
  await button!.trigger('click')
  await flushPromises()
}
beforeEach(async () => {
  api.get.mockResolvedValue({
    data: {
      revision: 3,
      published_version: 'v1',
      draft: structuredClone(definition),
    },
  })
  api.post.mockResolvedValue({
    data: {
      revision: 4,
      published_version: 'v1',
      draft: structuredClone(definition),
    },
  })
  wrapper = mount(DocumentTemplates, { global: { stubs: components } })
  await flushPromises()
})
afterEach(() => {
  wrapper.unmount()
  vi.clearAllMocks()
})
test('saves edited template body and contract with the loaded revision', async () => {
  await wrapper.findAll('textarea')[0]!.setValue('# Updated')
  await wrapper.findAll('textarea')[1]!.setValue(
    JSON.stringify({
      fields: ['文档 ID'],
      sections: ['文档信息', '参考文档'],
      tables: [],
    }),
  )
  await click('保存草稿')
  expect(api.post).toHaveBeenCalledWith(
    '/admin/system/document-templates/save',
    expect.objectContaining({
      expected_revision: 3,
      definition: expect.objectContaining({
        templates: [
          expect.objectContaining({
            body: '# Updated',
            contract: expect.objectContaining({
              sections: ['文档信息', '参考文档'],
            }),
          }),
        ],
      }),
    }),
  )
})
test('invalid contract JSON prevents writes and displays an actionable error', async () => {
  await wrapper.findAll('textarea')[1]!.setValue('{broken')
  await click('保存草稿')
  expect(api.post).not.toHaveBeenCalled()
  expect(wrapper.text()).not.toContain('检查通过。')
})
test('publishing saves the draft first and uses the returned revision', async () => {
  await click('发布规则版本')
  expect(api.post.mock.calls.map((c) => c[0])).toEqual([
    '/admin/system/document-templates/save',
    '/admin/system/document-templates/publish',
  ])
  expect(api.post).toHaveBeenLastCalledWith(
    '/admin/system/document-templates/publish',
    { expected_revision: 4 },
  )
})
test('contract diagnostics from the service appear with section and line location', async () => {
  api.post.mockResolvedValueOnce({
    data: {
      errors: [
        {
          rule_id: 'section_required',
          severity: 'error',
          section: '参考文档',
          line: 7,
          message: 'Missing reference section',
        },
      ],
    },
  })
  await click('检查模板契约')
  expect(wrapper.text()).toContain('section_required')
  expect(wrapper.text()).toContain('第 7 行')
  expect(wrapper.text()).toContain('Missing reference section')
})

test('copying a template creates an independently editable definition before saving', async () => {
  await wrapper
    .find('input[placeholder="新模板标识，如 module-guide"]')
    .setValue('module-glossary')
  await wrapper
    .find('input[placeholder="新模板名称"]')
    .setValue('Module glossary')
  await click('复制当前模板')
  await wrapper.findAll('textarea')[0]!.setValue('# Module glossary')
  await click('保存草稿')
  const saved = api.post.mock.calls.at(-1)![1].definition.templates
  expect(saved).toHaveLength(2)
  expect(saved[0].body).toBe('# Glossary')
  expect(saved[1]).toMatchObject({
    id: 'module-glossary',
    name: 'Module glossary',
    body: '# Module glossary',
  })
})

test('supplementary templates identify their optional API entry purpose', async () => {
  const draft = structuredClone(definition)
  Object.assign(draft.templates[0]!, { id: 'idd', name: 'IDD', node_type: 'design', usage: 'supplementary' })
  api.get.mockResolvedValueOnce({ data: { revision: 4, published_version: null, draft } })
  await click('刷新')
  expect(wrapper.find('.supplementary-note').text()).toContain('最上层后端 API')
  expect(wrapper.findAllComponents({ name: 'TOption' }).some((option) =>
    option.attributes('label') === 'IDD（可选补充）',
  )).toBe(true)
})

test('other supplementary templates show general guidance rather than IDD entry instructions', async () => {
  const draft = structuredClone(definition)
  Object.assign(draft.templates[0]!, { id: 'code-index', name: 'Code Index', node_type: 'code_index', usage: 'supplementary' })
  api.get.mockResolvedValueOnce({ data: { revision: 4, published_version: null, draft } })
  await click('刷新')
  const note = wrapper.find('.supplementary-note').text()
  expect(note).toContain('以项目交付契约为准')
  expect(note).not.toContain('最上层后端 API')
})
