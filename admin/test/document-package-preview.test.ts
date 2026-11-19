import { test, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import DocumentPackagePreview from '../src/components/DocumentPackagePreview.vue'
const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../src/api/client', () => ({ default: api }))
vi.mock('../../wiki/.vitepress/theme/mermaid-renderer.mjs', () => ({ renderDiagram: vi.fn() }))
afterEach(() => vi.restoreAllMocks())
test('package images use authenticated blobs and links use the version resource route', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:package-image')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  api.get.mockResolvedValue({ data: new Blob(['image']) })
  const props = { markdown: '![流程图](assets/流程%20图.png)\n\n[附件](附件.txt)', pack: { entry: 'document.md', files: [{ path: 'document.md', media_type: 'text/markdown' }, { path: 'assets/流程 图.png', media_type: 'image/png' }, { path: '附件.txt', media_type: 'text/plain' }] }, base: '/projects/demo/document-quality/', artifactId: 'version1', scope: 'candidate' }
  const wrapper = mount(DocumentPackagePreview, { props })
  await flushPromises()
  expect(wrapper.find('img').attributes('src')).toBe('blob:package-image')
  expect(api.get).toHaveBeenCalledWith('/projects/demo/document-quality/resource', { params: { id: 'version1', scope: 'candidate', path: 'assets/流程 图.png' }, responseType: 'blob' })
  expect(wrapper.find('a').attributes('data-resource')).toBe('附件.txt')
  expect(wrapper.find('a').attributes('href')).toBe('#')
  await wrapper.setProps({ artifactId: 'version2' }); await flushPromises()
  expect(revoke).toHaveBeenCalledWith('blob:package-image')
  wrapper.unmount()
})
test('remote and active image URLs do not trigger unauthenticated requests', () => {
  const wrapper = mount(DocumentPackagePreview, { props: { markdown: '![external](https://example.test/image.png)\n![svg](data:image/svg+xml;base64,abcd)\n<script>alert(1)</script>', base: '/', artifactId: '1', scope: 'candidate' } })
  expect(wrapper.find('img').exists()).toBe(false)
  expect(wrapper.find('script').exists()).toBe(false)
  wrapper.unmount()
})
