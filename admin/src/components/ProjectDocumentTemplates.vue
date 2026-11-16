<template>
  <section class="project-templates">
    <t-button variant="outline" :loading="loading" @click="load">刷新模板</t-button>
    <p>查看当前项目已绑定的生效模板；模板定义在系统设置中维护。</p>
    <t-alert v-if="error" theme="error" :message="error" />
    <t-loading :loading="loading">
      <template v-if="binding?.current">
        <p>绑定版本：{{ binding.from_version }} · 模板数量：{{ binding.current.templates.length }}</p>
        <p class="digest">绑定摘要：{{ binding.from_digest }}</p>
        <label>
          文档模板
          <select v-model="selected" aria-label="文档模板">
            <option v-for="item in binding.current.templates" :key="item.id" :value="item.id">
              {{ item.name }}（{{ item.id }}）
            </option>
          </select>
        </label>
        <template v-if="template">
          <h3>{{ template.name }}</h3>
          <p>节点类型：{{ template.node_type }}</p>
          <h4>模板正文</h4>
          <pre>{{ template.body }}</pre>
          <h4>契约</h4>
          <pre>{{ JSON.stringify(template.contract, null, 2) }}</pre>
          <h4>合规示例</h4>
          <pre>{{ template.example }}</pre>
          <h4>不合规示例</h4>
          <pre>{{ template.invalid_example }}</pre>
        </template>
      </template>
      <t-empty v-else-if="!loading && !error" description="项目尚未绑定文档模板，请在系统设置中绑定已发布版本。" />
    </t-loading>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import client from '@/api/client'

type ProjectTemplate = {
  id: string
  name: string
  node_type: string
  body: string
  contract: Record<string, unknown>
  example: string
  invalid_example: string
}
type ProjectBinding = {
  from_version: string | null
  from_digest: string | null
  current: { templates: ProjectTemplate[] } | null
}
const props = defineProps<{ projectId: string }>()
const binding = ref<ProjectBinding | null>(null)
const selected = ref('')
const loading = ref(false)
const error = ref('')
const template = computed(() => binding.value?.current?.templates.find((item) => item.id === selected.value))
let requestId = 0

async function load() {
  const currentRequest = ++requestId
  loading.value = true
  error.value = ''
  binding.value = null
  try {
    const response = await client.get<ProjectBinding>('/admin/system/document-templates/project', {
      params: { project: props.projectId },
    })
    if (currentRequest !== requestId) return
    binding.value = response.data
    selected.value = response.data.current?.templates[0]?.id || ''
  } catch (cause: unknown) {
    if (currentRequest !== requestId) return
    const failure = cause as { response?: { data?: { error?: string } }; message?: string }
    error.value = failure.response?.data?.error || failure.message || '无法读取项目文档模板'
  } finally {
    if (currentRequest === requestId) loading.value = false
  }
}

watch(() => props.projectId, load, { immediate: true })
</script>

<style scoped>
.project-templates select { display: block; max-width: 100%; margin-top: 8px; padding: 8px; }
.project-templates pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: 16px; background: var(--td-bg-color-secondarycontainer); }
.digest { overflow-wrap: anywhere; }
</style>
