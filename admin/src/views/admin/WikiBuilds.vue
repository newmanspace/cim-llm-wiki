<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import client from '@/api/client'
import ProjectWikiSettings from '@/components/ProjectWikiSettings.vue'
import { listProjects } from '@/api/projects'

type Job = { id: string; mode: string; gitCommit: string; state: string; bundleId?: string; error?: string; diagnostics?: { code: string; message: string; issues?: { code: string; path?: string; message: string }[] }[]; expiresAt?: number; attempts: { stage: string; error?: string }[]; result?: { previewUrl?: string; updated?: boolean; reason?: string } }
const route = useRoute(), router = useRouter()
const project = ref(String(route.query.project || ''))
const projects = ref<{id: string; name: string}[]>([]), jobs = ref<Job[]>([])
const bundleId = ref(''), error = ref(''), busy = ref(false)
const endpoint = computed(() => `/admin/projects/${encodeURIComponent(project.value)}/wiki-builds`)
let generation = 0, poll: ReturnType<typeof setInterval> | undefined
let disposed = false
async function load() {
  if (!project.value) { jobs.value = []; return }
  const current = ++generation
  try {
    const response = await client.get(endpoint.value)
    if (generation === current) { jobs.value = response.data.data; error.value = '' }
  } catch (e: any) { if (generation === current) error.value = e.response?.data?.error || '构建任务读取失败' }
}
async function action(operation: string, data: Record<string, string>) {
  const selected = project.value
  busy.value = true; error.value = ''
  try { await client.post(endpoint.value + '/' + operation, data); if (selected === project.value) await load() }
  catch (e: any) { if (selected === project.value) error.value = e.response?.data?.error || '任务操作失败' }
  finally { busy.value = false }
}
watch(project, async value => {
  ++generation; jobs.value = []; bundleId.value = ''; error.value = ''
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
    <h2>Wiki 构建与预览</h2>
    <p>内容版本由 Git 管理；构建成功后更新唯一正式站点。</p>
    <label>项目 <select v-model="project"><option value="">请选择项目</option><option v-for="item in projects" :key="item.id" :value="item.id">{{ item.name || item.id }}</option></select></label>
    <button :disabled="!project || busy" @click="load">刷新任务</button>
    <button :disabled="!project || busy" @click="action('build', {})">构建当前 Wiki</button>
    <p v-if="project">首次构建或重新生成站点可直接构建当前 Wiki；服务会检查已发布内容、Git 基线和完整库，不会自动提交未审核变更。</p>
    <ProjectWikiSettings :project="project" />
    <form v-if="project" @submit.prevent="action('preview', { bundle_id: bundleId })">
      <label>已审核 Bundle <input v-model="bundleId" required placeholder="Bundle ID" /></label>
      <button :disabled="busy || !bundleId">预览完整 Wiki</button>
      <small>服务会重新核验审核、来源、质量及完整候选库。</small>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="project && !jobs.length && !error">暂无构建任务。点击“构建当前 Wiki”发起首次构建；正式节点发布成功后也会自动创建任务。</p>
    <div class="table-scroll"><table v-if="jobs.length">
      <thead><tr><th>任务</th><th>类型 / Bundle</th><th>来源 Git commit</th><th>状态 / 阶段</th><th>尝试</th><th>诊断</th><th>操作</th></tr></thead>
      <tbody><tr v-for="job in jobs" :key="job.id">
        <td>{{ job.id }}</td><td>{{ job.mode }}<br />{{ job.bundleId }}</td><td><code>{{ job.gitCommit }}</code></td>
        <td>{{ job.state === 'blocked' ? '构建受阻' : job.state }}<br />{{ job.attempts.at(-1)?.stage }}<br /><small v-if="job.expiresAt">失效：{{ new Date(job.expiresAt).toLocaleString() }}</small></td>
        <td>{{ job.attempts.length }}</td><td>
          {{ job.error || job.result?.reason || '—' }}
          <details v-for="diagnostic in job.diagnostics" :key="diagnostic.code"><summary>{{ diagnostic.message }}</summary>
            <ul><li v-for="(issue, index) in diagnostic.issues" :key="index"><code>{{ issue.code }}</code> {{ issue.path }}：{{ issue.message }}</li></ul>
          </details>
        </td>
        <td>
          <a v-if="job.state === 'succeeded' && job.result?.previewUrl" :href="job.result.previewUrl" target="_blank" rel="noopener">打开预览</a>
          <button v-if="job.state === 'failed'" :disabled="busy" @click="action('retry', { id: job.id })">重试原 Git 输入</button>
          <button v-if="job.mode === 'preview' && !['revoked', 'expired'].includes(job.state)" :disabled="busy" @click="action('revoke', { id: job.id })">撤销预览</button>
        </td>
      </tr></tbody>
    </table></div>
  </section>
</template>

<style scoped>
form { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin: 20px 0; }
input, select, button { padding: 8px; margin: 4px; }
.table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 10px; border: 1px solid #ccc; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
[role='alert'] { color: #b42318; }
</style>
