<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useData } from 'vitepress'
import { decodeSource, renderDiagram } from './mermaid-renderer.mjs'

const props = defineProps({ source: { type: String, required: true } })
const { isDark } = useData()
const diagram = computed(() => decodeSource(props.source))
const id = `mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, '-')}`
const svg = ref('')
const failed = ref(false)
let revision = 0
let stop

async function render() {
  const current = ++revision
  svg.value = ''
  failed.value = false
  try {
    const result = await renderDiagram(`${id}-${current}`, diagram.value, isDark.value)
    if (current === revision) svg.value = result
  } catch {
    if (current === revision) failed.value = true
  }
}

onMounted(() => {
  stop = watch([() => props.source, isDark], render, { immediate: true })
})
onBeforeUnmount(() => {
  ++revision
  stop?.()
})
</script>

<template>
  <figure class="mermaid-diagram" :data-render-state="failed ? 'error' : svg ? 'ready' : 'pending'">
    <div v-if="svg" class="mermaid-svg" v-html="svg" />
    <template v-else>
      <p v-if="failed" role="alert">图表渲染失败，请检查 Mermaid 语法；源码保留如下。</p>
      <pre><code>{{ diagram }}</code></pre>
    </template>
    <details v-if="svg">
      <summary>查看图表源码</summary>
      <pre><code>{{ diagram }}</code></pre>
    </details>
  </figure>
</template>

<style scoped>
.mermaid-diagram { margin: 24px 0; }
.mermaid-svg { overflow-x: auto; text-align: center; }
.mermaid-svg :deep(svg) { max-width: 100%; height: auto; }
summary { cursor: pointer; color: var(--vp-c-text-2); font-size: 13px; }
pre { overflow-x: auto; padding: 16px; background: var(--vp-code-block-bg); }
[role="alert"] { color: var(--vp-c-danger-1); }
</style>
