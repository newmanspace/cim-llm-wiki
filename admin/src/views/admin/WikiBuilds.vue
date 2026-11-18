<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import client from '@/api/client'
import ProjectWikiSettings from '@/components/ProjectWikiSettings.vue'
import { listProjects } from '@/api/projects'
import { Button as TButton, Input as TInput, Select as TSelect, Option as TOption, Tag as TTag } from 'tdesign-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import ListPagination from '@/components/ListPagination.vue'
import { usePagination } from '@/composables/usePagination'

type Job = { id: string; mode: string; gitCommit: string; state: string; bundleId?: string; error?: string; diagnostics?: { code: string; message: string; issues?: { code: string; path?: string; message: string }[] }[]; expiresAt?: number; attempts: { stage: string; error?: string }[]; result?: { previewUrl?: string; updated?: boolean; reason?: string } }
const route = useRoute(), router = useRouter()
const project = ref(String(route.query.project || ''))
const projects = ref<{id: string; name: string}[]>([]), jobs = ref<Job[]>([])
const bundleId = ref(''), error = ref(''), busy = ref(false), fetching = ref(false)
const endpoint = computed(() => `/admin/projects/${encodeURIComponent(project.value)}/wiki-builds`)
const { page, pageSize, paged: pagedJobs } = usePagination(jobs, [project])
let generation = 0, poll: ReturnType<typeof setInterval> | undefined
let disposed = false
async function load() {
  if (!project.value) { jobs.value = []; return }
  const current = ++generation
  fetching.value = true
  try {
    const response = await client.get(endpoint.value)
    if (generation === current) { jobs.value = response.data.data; error.value = '' }
  } catch (e: any) { if (generation === current) error.value = e.response?.data?.error || '构建任务读取失败' }
  finally { if (generation === current) fetching.value = false }
}
async function action(operation: string, data: Record<string, string>) {
  const selected = project.value
  busy.value = true; error.value = ''
  try { await client.post(endpoint.value + '/' + operation, data); if (selected === project.value) await load() }
  catch (e: any) { if (selected === project.value) error.value = e.response?.data?.error || '任务操作失败' }
  finally { busy.value = false }
}
watch(project, async value => {
  ++generation; fetching.value = false; jobs.value = []; bundleId.value = ''; error.value = ''
  await router.replace({ query: { ...route.query, project: value || undefined } })
  await load()
})
onMounted(async () => {
  try { projects.value = await listProjects() }
  catch { error.value = '项目列表读取失败'; return }
  if (disposed) return
  await load()
  if (!disposed) poll = setInterval(load, 5000)
})
onUnmounted(() => { disposed = true; generation++; clearInterval(poll) })
</script>

<template>
  <section class="wiki-builds">
    <PageHeader title="Wiki 构建与预览" subtitle="构建已提交内容，跟踪任务与站点状态。">
      <template #actions>
        <TSelect v-model="project" aria-label="项目" placeholder="请选择项目" clearable class="project-select">
          <TOption v-for="item in projects" :key="item.id" :value="item.id" :label="item.name || item.id" />
        </TSelect>
        <TButton variant="outline" :loading="fetching" :disabled="!project || busy" @click="load">刷新任务</TButton>
        <TButton theme="primary" :disabled="!project" :loading="busy" @click="action('build', {})">构建当前 Wiki</TButton>
      </template>
    </PageHeader>
    <p v-if="project" class="hint">首次构建或重新生成站点可直接构建当前 Wiki；服务会检查已发布内容、Git 基线和完整库，不会自动提交未审核变更。</p>
    <ProjectWikiSettings :project="project" />
    <details v-if="project" class="preview-settings">
      <summary>高级操作 · 预览已审核 Bundle</summary>
      <form @submit.prevent="action('preview', { bundle_id: bundleId })">
        <label for="preview-bundle">已审核 Bundle</label>
        <TInput id="preview-bundle" v-model="bundleId" required placeholder="Bundle ID" class="bundle-input" />
        <TButton type="submit" :disabled="!bundleId" :loading="busy">预览完整 Wiki</TButton>
        <small class="hint">服务会重新核验审核、来源、质量及完整候选库。</small>
      </form>
    </details>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="fetching" role="status" class="hint">正在加载构建任务…</p>
    <p v-if="project && !jobs.length && !error && !fetching">暂无构建任务。点击“构建当前 Wiki”发起首次构建；正式节点发布成功后也会自动创建任务。</p>
    <div class="table-scroll"><table v-if="jobs.length">
      <thead><tr><th>任务</th><th>类型 / Bundle</th><th>来源 Git commit</th><th>状态 / 阶段</th><th>尝试</th><th>诊断</th><th>操作</th></tr></thead>
      <tbody><tr v-for="job in pagedJobs" :key="job.id">
        <td>{{ job.id }}</td><td>{{ job.mode }}<br />{{ job.bundleId }}</td><td><code>{{ job.gitCommit }}</code></td>
        <td><TTag size="small" variant="light" :theme="job.state === 'succeeded' ? 'success' : ['failed', 'blocked'].includes(job.state) ? 'danger' : 'default'">{{ ({ succeeded: '成功', failed: '失败', blocked: '构建受阻', queued: '排队中', running: '运行中', revoked: '已撤销', expired: '已过期' } as Record<string, string>)[job.state] || job.state }}</TTag><br />{{ job.attempts.at(-1)?.stage }}<br /><small v-if="job.expiresAt">失效：{{ new Date(job.expiresAt).toLocaleString() }}</small></td>
        <td>{{ job.attempts.length }}</td><td>
          {{ job.error || job.result?.reason || '—' }}
          <details v-for="diagnostic in job.diagnostics" :key="diagnostic.code"><summary>{{ diagnostic.message }}</summary>
            <ul><li v-for="(issue, index) in diagnostic.issues" :key="index"><code>{{ issue.code }}</code> {{ issue.path }}：{{ issue.message }}</li></ul>
          </details>
        </td>
        <td>
          <a v-if="job.state === 'succeeded' && job.result?.previewUrl" :href="job.result.previewUrl" target="_blank" rel="noopener">打开预览</a>
          <TButton size="small" variant="outline" v-if="job.state === 'failed'" :disabled="busy" @click="action('retry', { id: job.id })">重试原 Git 输入</TButton>
          <TButton size="small" variant="outline" v-if="job.mode === 'preview' && !['revoked', 'expired'].includes(job.state)" :disabled="busy" @click="action('revoke', { id: job.id })">撤销预览</TButton>
        </td>
      </tr></tbody>
    </table></div>
    <ListPagination v-if="project" v-model:page="page" v-model:page-size="pageSize" :total="jobs.length" :disabled="fetching || busy" />
  </section>
</template>

<style scoped>
.wiki-builds { color: var(--td-text-color-primary); font: var(--td-font-body-medium); }
.project-select { width: 220px; }
.hint { color: var(--td-text-color-secondary); margin: 8px 0; }
.preview-settings { margin: 8px 0; }
summary { cursor: pointer; padding: 8px 0; font-weight: 500; }
form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 8px 0; }
.bundle-input { width: 240px; }
.table-scroll { overflow: auto; max-height: 60vh; background: var(--td-bg-color-container); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { padding: 6px 12px; border-bottom: 1px solid var(--td-component-stroke); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { position: sticky; top: 0; background: var(--td-bg-color-secondarycontainer); z-index: 1; white-space: nowrap; }
td { max-width: 320px; }
a { color: var(--td-text-color-link); }
[role='alert'] { color: var(--td-error-color); }
@media (max-width:767px) { .project-select, .bundle-input { width: 100%; } :deep(.page-header__actions) { flex-wrap: wrap; } }
</style>
