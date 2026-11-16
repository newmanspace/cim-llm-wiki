import test from 'node:test'
import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import { mermaidMarkdown } from '../.vitepress/mermaid-markdown.mjs'
import { decodeSource } from '../.vitepress/theme/mermaid-renderer.mjs'

test('Chinese diagrams and template-like text survive as data, never Vue markup', () => {
  const source = 'flowchart LR\nA["中文 {{ 7 * 7 }} </MermaidDiagram><script>alert(1)</script>"]\n'
  const md = new MarkdownIt().use(mermaidMarkdown)
  const rendered = md.render('```mermaid\n' + source + '```')
  const encoded = rendered.match(/source="([A-Za-z0-9+/=]+)"/)[1]
  assert.equal(decodeSource(encoded), source)
  assert.doesNotMatch(rendered, /<script>|\{\{|中文/)
})

test('only Mermaid fences change; ordinary code keeps its escaping and renderer', () => {
  const source = '```js\nconst tag = "<script>"\n```'
  assert.equal(new MarkdownIt().use(mermaidMarkdown).render(source), new MarkdownIt().render(source))
})

test('multiple diagrams produce independent components including nested fences', () => {
  const result = new MarkdownIt().use(mermaidMarkdown).render(
    '```mermaid\nflowchart LR\nA-->B\n```\n\n> ```mermaid\n> sequenceDiagram\n> A->>B: test\n> ```'
  )
  assert.equal((result.match(/<MermaidDiagram /g) || []).length, 2)
})
