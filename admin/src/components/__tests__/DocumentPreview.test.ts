import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import DocumentPreview from '../DocumentPreview.vue'
import MarkdownPreview from '../MarkdownPreview.vue'
const diagrams = vi.hoisted(() => ({ renderDiagram: vi.fn() }))
vi.mock('../../../../wiki/.vitepress/theme/mermaid-renderer.mjs', () => diagrams)

describe('candidate document preview', () => {
  it('renders text without executing HTML, Vue expressions, images or unsafe links', () => {
    const wrapper = mount(MarkdownPreview, { props: { markdown: '# Candidate\n\n{{ 7 * 7 }}\n\n<script>window.executed=true</script>\n\n![remote](https://example.invalid/track.png)\n\n[unsafe](javascript:alert(1))' } })
    expect(wrapper.find('h1').text()).toBe('Candidate')
    expect(wrapper.text()).toContain('{{ 7 * 7 }}')
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('[href^="javascript:"]').exists()).toBe(false)
  })
  it('switches between render, source and differences without changing document input', async () => {
    const markdown = '# Changed\n\nnew', parsed = '# Original\n\nold'
    const wrapper = mount(DocumentPreview, { props: { markdown, parsed, project: 'demo' } })
    expect(wrapper.text()).toContain('候选，未发布')
    await wrapper.findAll('button').find(button => button.text() === '原始 Markdown')!.trigger('click')
    expect(wrapper.find('pre').text()).toBe(markdown)
    await wrapper.findAll('button').find(button => button.text() === '差异')!.trigger('click')
    expect(wrapper.find('.added').text()).toContain('# Changed')
    expect(wrapper.find('.removed').text()).toContain('# Original')
    expect(wrapper.props('markdown')).toBe(markdown)
    expect(wrapper.emitted('update:markdown')).toBeUndefined()
    expect(wrapper.props('parsed')).toBe(parsed)
  })
  it('renders Mermaid through the strict renderer, reports invalid graphs, and bounds large inputs', async () => {
    diagrams.renderDiagram.mockResolvedValueOnce('<svg><text>审核</text></svg>').mockRejectedValueOnce(new Error('invalid graph'))
    const wrapper = mount(MarkdownPreview, { props: { markdown: '```mermaid\nflowchart LR\n A[审核] --> B[预览]\n```\n\n```js\nconst plain = true\n```' } })
    await flushPromises()
    expect(wrapper.find('svg').text()).toBe('审核')
    expect(diagrams.renderDiagram).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('A[审核]'), false)
    expect(wrapper.find('code').text()).toContain('const plain = true')
    await wrapper.setProps({ markdown: '```mermaid\ninvalid graph\n```' }); await flushPromises()
    expect(wrapper.text()).toContain('图表解析失败')
    await wrapper.setProps({ markdown: '```mermaid\n' + 'x'.repeat(50001) + '\n```' }); await flushPromises()
    expect(wrapper.text()).toContain('图表超过50,000字符限制')
    expect(diagrams.renderDiagram).toHaveBeenCalledTimes(2)
  })
})
