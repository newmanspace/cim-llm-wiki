<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
import { renderDiagram } from '../../../wiki/.vitepress/theme/mermaid-renderer.mjs'

const props = defineProps<{ markdown: string }>()
const root = ref<HTMLElement | null>(null)
const parser = new MarkdownIt({ html: false, linkify: false })
const fence = parser.renderer.rules.fence!
parser.renderer.rules.image = (tokens, index) => parser.utils.escapeHtml(tokens[index]?.content || '[图片]')
parser.renderer.rules.fence = (tokens, index, options, env, renderer) => {
  const token = tokens[index]!
  if (token.info.trim() !== 'mermaid') return fence(tokens, index, options, env, renderer)
  if (token.content.length > 50000) return '<pre>图表超过50,000字符限制</pre>'
  const encoded = btoa(Array.from(new TextEncoder().encode(token.content), byte => String.fromCharCode(byte)).join(''))
  return `<div data-mermaid="${encoded}"></div>`
}
const html = computed(() => DOMPurify.sanitize(parser.render(props.markdown), {
  ALLOWED_TAGS: ['p', 'a', 'strong', 'em', 's', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'hr', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div'],
  ALLOWED_ATTR: ['href', 'title', 'class', 'data-mermaid'],
}))
let revision = 0
watch(html, async () => {
  const current = ++revision
  await nextTick()
  for (const node of root.value?.querySelectorAll<HTMLElement>('[data-mermaid]') || []) {
    const source = new TextDecoder().decode(Uint8Array.from(atob(node.dataset.mermaid!), c => c.charCodeAt(0)))
    try {
      const svg = await renderDiagram('candidate-' + crypto.randomUUID(), source, false)
      if (current !== revision) return
      node.innerHTML = svg
    } catch {
      if (current !== revision) return
      node.textContent = '图表解析失败：\n' + source
    }
  }
}, { immediate: true })
</script>

<template><div ref="root" class="markdown-preview" v-html="html" /></template>

<style scoped>
.markdown-preview { overflow: auto; overflow-wrap: anywhere; line-height: 1.7; }
.markdown-preview :deep(table) { border-collapse: collapse; width: 100%; }
.markdown-preview :deep(td), .markdown-preview :deep(th) { border: 1px solid #ccc; padding: 6px; }
.markdown-preview :deep(pre) { white-space: pre-wrap; padding: 12px; background: #f4f5f7; color: #222; }
.markdown-preview :deep(svg) { max-width: 100%; height: auto; }
</style>
