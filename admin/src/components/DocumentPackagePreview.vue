<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import MarkdownPreview from './MarkdownPreview.vue'
import client from '../api/client'
type PackageFile = { path: string; media_type: string }
type Package = { entry: string; files: PackageFile[] }
const props = defineProps<{ markdown: string; pack?: Package | null; base: string; artifactId: string; scope: string }>()
const resources = ref<Record<string, string>>({}), failure = ref('')
let generation = 0
function release() { for (const url of Object.values(resources.value)) URL.revokeObjectURL(url); resources.value = {} }
onBeforeUnmount(() => { generation++; release() })
watch(() => [props.pack, props.base, props.artifactId, props.scope], async () => {
  const current = ++generation
  release(); failure.value = ''
  const files = props.pack?.files.filter(file => ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.media_type)) || []
  for (const file of files) {
    if (generation !== current) return
    try {
      const response = await client.get(props.base + 'resource', { params: { id: props.artifactId, scope: props.scope, path: file.path }, responseType: 'blob' })
      if (generation !== current) return
      resources.value[file.path] = URL.createObjectURL(new Blob([response.data], { type: file.media_type }))
    } catch { if (generation === current) failure.value = '部分图片读取失败，请重试预览。' }
  }
}, { immediate: true })
function resourceClick(path: string) {
  const file = props.pack?.files.find(item => item.path === path)
  if (file) void download(file)
  else failure.value = '未归档的本地引用无法读取。'
}
async function download(file: PackageFile) {
  try {
    const response = await client.get(props.base + 'resource', { params: { id: props.artifactId, scope: props.scope, path: file.path }, responseType: 'blob' })
    const url = URL.createObjectURL(new Blob([response.data], { type: 'application/octet-stream' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.path.split('/').pop() || 'attachment'; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch { failure.value = '附件下载失败，请重试。' }
}
</script>
<template>
  <p v-if="failure" role="alert">{{ failure }}</p>
  <MarkdownPreview :markdown="markdown" :entry="pack?.entry" :resources="resources" @resource-click="resourceClick" />
  <ul v-if="pack" aria-label="文档附件">
    <li v-for="file in pack.files.filter(item => item.path !== pack?.entry)" :key="file.path"><button @click="download(file)">下载 {{ file.path }}</button></li>
  </ul>
</template>
