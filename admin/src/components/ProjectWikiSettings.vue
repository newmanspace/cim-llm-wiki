<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { isAxiosError } from 'axios'
import { configureProjectWiki, getProjectWiki, initializeProjectWiki, type ProjectWikiStatus } from '@/api/projects'
const props = defineProps<{ project: string }>()
const status = ref<ProjectWikiStatus>(), source = ref(''), error = ref(''), busy = ref(false)
let generation = 0
onUnmounted(() => { generation++ })
watch(() => props.project, async project => {
  const current = ++generation
  status.value = undefined; source.value = ''; error.value = ''
  if (!project) return
  try {
    const value = await getProjectWiki(project)
    if (current === generation) { status.value = value; source.value = value.sourceDirectory }
  } catch { if (current === generation) error.value = 'Wiki 设置读取失败，请刷新后重试' }
}, { immediate: true })
async function run(operation: 'save' | 'initialize' | 'refresh') {
  const current = generation, project = props.project
  busy.value = true; error.value = ''
  try {
    const result = operation === 'refresh' ? await getProjectWiki(project) : operation === 'save' ? await configureProjectWiki(project, source.value) : await initializeProjectWiki(project)
    if (generation === current) { status.value = result; source.value = result.sourceDirectory }
  } catch (e: unknown) {
    if (generation === current) error.value = operationError(e)
  } finally { busy.value = false }
}
function operationError(error: unknown) {
  if (isAxiosError<{ error: string }>(error)) return error.response?.data.error || error.message
  return error instanceof Error ? error.message : 'Wiki 操作失败'
}
</script>
<template>
  <section v-if="project" class="wiki-settings">
    <h3>项目 Wiki 目录</h3>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="status">
      <dl>
        <dt>内容格式</dt><dd>{{ status.contentKind === 'repository_docs' ? '标准文档仓（构建 Git 已提交版本）' : '严格知识节点' }}</dd>
        <dt>Markdown 源目录</dt><dd><input v-model="source" :disabled="busy || status.initialized" aria-label="Markdown 源目录" /><button v-if="!status.initialized" :disabled="busy" @click="run('save')">保存目录</button></dd>
        <dt>允许的存储根目录</dt><dd><code>{{ status.storageRoot }}</code></dd>
        <dt>编译后站点目录</dt><dd><code>{{ status.siteDirectory }}</code></dd>
        <dt>Git 状态</dt><dd>{{ status.gitStatus === 'uninitialized' ? '尚未初始化' : status.gitStatus === 'dirty' ? '有未提交内容，请检查后提交' : '工作区干净' }}</dd>
        <dt v-if="status.contentKind === 'repository_docs'">构建范围</dt><dd v-if="status.contentKind === 'repository_docs'">仅 Git 已提交文档；未提交修改保留在源目录</dd>
        <dt>站点</dt><dd><a v-if="status.published" :href="status.siteUrl" target="_blank" rel="noopener">访问 Wiki</a><span v-else>尚未构建</span></dd>
      </dl>
      <button :disabled="busy" @click="run('refresh')">刷新目录状态</button>
      <button v-if="!status.initialized" :disabled="busy" @click="run('initialize')">初始化 Wiki Git</button>
    </template>
  </section>
</template>
<style scoped>
.wiki-settings { padding: 16px; margin: 16px 0; border: 1px solid #ddd; border-radius: 6px; }
dl { display: grid; grid-template-columns: 160px 1fr; gap: 10px; } dd { margin: 0; overflow-wrap: anywhere; } input { min-width: min(600px, 70vw); } button { margin: 4px; padding: 6px 10px; } [role='alert'] { color: #b42318; }
</style>
