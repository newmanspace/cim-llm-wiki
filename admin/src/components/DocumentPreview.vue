<script setup lang="ts">
import { computed, ref } from 'vue'
import DocumentPackagePreview from './DocumentPackagePreview.vue'
type Package = { entry: string; files: { path: string; media_type: string }[] }
const props = defineProps<{ markdown: string; parsed: string; project: string; base?: string; artifactId?: string; candidatePackage?: Package | null; parsedPackage?: Package | null }>()
const mode = ref('render')
const differences = computed(() => {
  const left = props.parsed.split('\n'), right = props.markdown.split('\n')
  let start = 0
  while (start < left.length && start < right.length && left[start] === right[start]) start++
  let end = 0
  while (end < left.length - start && end < right.length - start && left[left.length - end - 1] === right[right.length - end - 1]) end++
  return [...left.slice(start, left.length - end).map(text => ({ kind: 'removed', text })), ...right.slice(start, right.length - end).map(text => ({ kind: 'added', text }))]
})
</script>

<template>
  <section class="document-preview">
    <p role="status">候选，未发布 · 项目：{{ project }} · 来源、评分及审核状态见当前文档详情</p>
    <nav aria-label="预览视图">
      <button v-for="option in [{ id: 'render', label: '渲染' }, { id: 'source', label: '原始 Markdown' }, { id: 'diff', label: '差异' }]" :key="option.id" :aria-pressed="mode === option.id" @click="mode = option.id">{{ option.label }}</button>
    </nav>
    <div v-if="mode === 'diff'" aria-label="正文差异">
      <p v-if="!differences.length">正文没有差异</p>
      <pre v-for="(line, index) in differences" :key="index" :class="line.kind">{{ line.kind === 'added' ? '+' : '−' }} {{ line.text }}</pre>
    </div>
    <div v-else class="comparison">
      <section><h4>候选正文</h4><DocumentPackagePreview v-if="mode === 'render'" :markdown="markdown" :pack="candidatePackage" :base="base || ''" :artifact-id="artifactId || ''" scope="candidate" /><pre v-else>{{ markdown }}</pre></section>
      <section><h4>原文转换稿</h4><DocumentPackagePreview v-if="mode === 'render'" :markdown="parsed" :pack="parsedPackage" :base="base || ''" :artifact-id="artifactId || ''" scope="parsed" /><pre v-else>{{ parsed }}</pre></section>
    </div>
  </section>
</template>

<style scoped>
.comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.comparison section { min-width: 0; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.added { background: #dcfce7; color: #14532d; margin: 0; }
.removed { background: #fee2e2; color: #7f1d1d; margin: 0; }
@media (max-width: 800px) { .comparison { grid-template-columns: 1fr; } }
</style>
