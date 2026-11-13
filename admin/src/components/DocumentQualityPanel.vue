<template>
  <section class="quality-panel">
    <div v-if="mode === 'sources' || mode === 'all'" class="panel-toolbar">
      <p>{{ sectionTitle }}</p>
      <t-button variant="outline" :loading="busy" @click="refresh"
        >刷新</t-button
      >
    </div>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <details v-if="mode === 'all' || mode === 'sources'" open>
      <summary>文档数据源</summary>
      <ul>
        <li v-for="source in sources" :key="source.id">
          {{ source.name }} · {{ source.enabled ? '启用' : '停用' }}
          <button @click="editSource(source)">编辑</button>
        </li>
      </ul>
      <label>名称 <input v-model="sourceForm.name" /></label>
      <label
        >类型
        <select
          v-model="sourceForm.type"
          :disabled="Boolean(sourceForm.id)"
          data-testid="source-type"
        >
          <option value="svn">SVN</option>
          <option value="git">Git</option>
        </select></label
      >
      <label
        >仓库地址
        <input
          v-model="sourceForm.url"
          type="url"
          placeholder="https:// 或 ssh://git@host/repo.git"
      /></label>
      <label>采集子路径 <input v-model="sourceForm.subpath" /></label>
      <label
        >{{ sourceForm.type === 'git' ? '分支 / 标签 / Commit' : '修订号' }}
        <input v-model="sourceForm.revision_selector" placeholder="HEAD"
      /></label>
      <label><input v-model="sourceForm.enabled" type="checkbox" />启用</label>
      <p>
        SVN 使用本机凭据缓存；Git 使用 HTTPS 凭据助手或 SSH
        key/agent。系统不保存密码、Token 或私钥。
      </p>
      <button :disabled="busy" @click="saveSource">保存数据源</button>
      <button @click="resetSource">新增数据源</button>
    </details>
    <div v-if="mode !== 'sources'" class="document-browser">
      <nav class="directory-tree" aria-label="项目文档目录">
        <div class="tree-heading">
          <h3>文档目录</h3>
          <button
            v-if="mode === 'directories' || mode === 'all'"
            class="icon-action"
            aria-label="新建目录"
            title="新建目录"
            :aria-expanded="showCreateDirectory"
            aria-controls="new-directory-form"
            @click="openDirectoryForm"
          >
            ＋
          </button>
        </div>
        <form
          v-if="
            showCreateDirectory && (mode === 'directories' || mode === 'all')
          "
          id="new-directory-form"
          class="create-directory"
          @submit.prevent="createDirectory"
        >
          <label
            >新建目录路径<input
              v-model="newDirectory"
              placeholder="doc/50-designs/modules"
              ref="directoryInput"
              data-testid="new-directory"
              required
          /></label>
          <p>填写完整相对路径，评分默认继承父目录。</p>
          <div class="button-row">
            <button class="primary" :disabled="busy" type="submit">
              新增目录</button
            ><button type="button" @click="showCreateDirectory = false">
              取消
            </button>
          </div>
        </form>
        <input
          v-model="directorySearch"
          class="tree-search"
          placeholder="查找目录"
          aria-label="查找目录"
        />
        <div role="tree" class="tree-items">
          <button
            role="treeitem"
            :aria-selected="folderFilter === ''"
            @click="selectDirectory('')"
          >
            <span class="folder-icon">▤</span
            ><span class="tree-label">{{
              mode === 'directories' ? '项目默认规则' : '全部文档'
            }}</span
            ><span class="directory-count">{{ artifacts.length }}</span>
          </button>
          <button
            v-for="directory in filteredDirectoryPaths"
            :key="directory"
            role="treeitem"
            :aria-level="directory.split('/').length"
            :aria-selected="folderFilter === directory"
            :title="directory"
            :style="{
              paddingLeft: (directory.split('/').length - 1) * 14 + 12 + 'px',
            }"
            @click="selectDirectory(directory)"
          >
            <span class="folder-icon">▱</span
            ><span class="tree-label">{{ directoryLabel(directory) }}</span
            ><span class="directory-count">{{
              directoryCount(directory)
            }}</span>
          </button>
        </div>
        <p
          v-if="directorySearch && !filteredDirectoryPaths.length"
          class="tree-hint"
        >
          没有匹配的目录
        </p>

        <p class="tree-hint">
          {{ directoryPaths.length }} 个目录 · 评分逐级继承
        </p>
      </nav>
      <div class="directory-content" :aria-busy="busy">
        <div class="workspace-heading">
          <div>
            <h3>
              {{
                folderFilter
                  ? directoryLabel(folderFilter)
                  : mode === 'directories'
                    ? '项目默认评分'
                    : '全部文档'
              }}
            </h3>
            <p class="directory-path">
              {{
                folderFilter ||
                (mode === 'directories'
                  ? '所有目录的默认质量标准'
                  : '浏览当前项目的归类文档')
              }}
            </p>
          </div>
          <t-button variant="outline" :loading="busy" @click="refresh"
            >刷新</t-button
          >
        </div>
        <details v-if="mode === 'all' || mode === 'directories'" open>
          <summary>
            目录评分规则 <span class="subtle">未覆盖项继承父目录</span>
          </summary>
          <div v-if="mode === 'all'" class="policy-path-picker">
            <label
              >归类目录
              <input
                v-model="policyPath"
                placeholder="doc/50-designs，留空为项目默认"
            /></label>
            <button @click="readPolicy">查看生效规则</button>
          </div>
          <template v-if="effective">
            <div class="threshold-row">
              <label
                >人工审核分数线
                <input
                  v-model.number="threshold"
                  type="number"
                  min="0"
                  max="100"
              /></label>
              <p>
                当前阈值来源：{{
                  effective.origins.review_threshold
                }}。未覆盖的配置继承父目录。
              </p>
            </div>
            <div class="dimension-heading">
              <span>质量维度</span><span>权重</span><span>评分说明</span>
            </div>
            <div
              v-for="dimension in dimensionNames"
              :key="dimension.id"
              class="dimension"
            >
              <strong>{{ dimension.label }}</strong>
              <label
                >权重
                <input
                  v-model.number="weights[dimension.id]"
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
              /></label>
              <label
                >评分说明 <textarea v-model="rubrics[dimension.id]" />
              </label>
              <small
                >权重来源：{{
                  effective.origins['dimensions.' + dimension.id + '.weight']
                }}</small
              >
            </div>
            <div class="policy-actions">
              <button
                class="primary"
                :disabled="busy"
                @click="savePolicy(false)"
              >
                仅覆盖分数线（其余继承）
              </button>
              <button :disabled="busy" @click="savePolicy(true)">
                设置分数线及全部维度
              </button>
              <button :disabled="busy" @click="inheritPolicy">
                恢复全部继承
              </button>
            </div>
          </template>
        </details>
        <template v-if="mode === 'all' || mode === 'results'">
          <div class="results-heading">
            <h3>
              文档列表
              <span class="result-count">{{ visibleArtifacts.length }}</span>
            </h3>
            <button v-if="hasFilters" class="text-action" @click="resetFilters">
              清除筛选
            </button>
          </div>
          <div class="result-filters">
            <label
              >检索文档<input
                v-model="searchText"
                placeholder="文件名、归类路径或来源路径"
                data-testid="document-search"
            /></label>
            <label
              >审核状态
              <select v-model="statusFilter">
                <option value="">全部</option>
                <option value="pending">待审核</option>
                <option value="approved">已通过</option>
                <option value="rejected">已驳回</option>
                <option value="changes_requested">待修订</option>
              </select></label
            >
            <label
              >数据源
              <select v-model="sourceFilter">
                <option value="">全部</option>
                <option
                  v-for="source in sources"
                  :key="source.id"
                  :value="source.id"
                >
                  {{ source.name }}
                </option>
              </select></label
            >
            <label
              >质量结论
              <select v-model="qualityFilter">
                <option value="">全部</option>
                <option value="needs_review">需人工核对</option>
                <option value="blocked">存在阻断问题</option>
                <option value="qualified">分数合格</option>
                <option value="not_assessed">未完成评估</option>
              </select></label
            >
          </div>
          <div class="results-table">
            <table>
              <thead>
                <tr>
                  <th>归类文件</th>
                  <th>版本</th>
                  <th>质量分数</th>
                  <th>审核状态</th>
                  <th>详情</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in visibleArtifacts" :key="item.id">
                  <td>{{ item.target_path }}</td>
                  <td>{{ item.version }}</td>
                  <td>
                    {{ latestEvaluation(item.id)?.total ?? '未完成评估' }}
                  </td>
                  <td>
                    <span
                      class="status-badge"
                      :data-status="taskFor(item.id)?.status"
                      >{{ reviewStatusLabel(taskFor(item.id)?.status, taskFor(item.id)?.approval_mode) }}</span
                    >
                  </td>
                  <td>
                    <button class="text-action" @click="selected = item">
                      查看
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="!busy && !visibleArtifacts.length" class="results-empty">
            <span class="empty-symbol">▤</span>
            <h4>{{ hasFilters ? '没有匹配的文档' : '此目录暂无文档' }}</h4>
            <p>当前目录下没有匹配的文档。</p>
            <p class="subtle">
              {{
                hasFilters
                  ? '请调整检索条件，或清除筛选后重试。'
                  : '文档采集、转换并登记归类结果后，将在这里展示。'
              }}
            </p>
            <button v-if="hasFilters" @click="resetFilters">清除筛选</button>
          </div>
          <p v-if="busy" class="loading-hint" role="status">
            正在加载项目文档…
          </p>
          <article v-if="selected" class="document-detail">
            <div class="detail-header">
              <h3>文档详情</h3>
              <button @click="selected = null">关闭详情</button>
            </div>
            <h3>{{ selected.target_path }}</h3>
            <p>输出摘要：{{ selected.content_sha256 }}</p>
            <p>转换稿：{{ selected.parsed_uri }}</p>
            <ul>
              <li v-for="source in selectedSources" :key="source.id">
                原件：{{ source.original_uri }} ·
                {{ source.source_type === 'git' ? 'Git commit' : 'SVN r' }}
                {{ source.commit_sha || source.operative_revision }} ·
                {{ source.repository_path }} · 摘要 {{ source.original_sha256 }}
              </li>
            </ul>
            <h4>质量评估</h4>
            <div v-for="evaluation in selectedEvaluations" :key="evaluation.id">
              <p>
                {{ evaluation.created_at }} ·
                {{ evaluation.total ?? '不可评分' }} ·
                {{ evaluation.evaluator_version }}
              </p>
              <ul>
                <li v-for="dimension in dimensionNames" :key="dimension.id">
                  {{ dimension.label }}：{{
                    evaluation.dimensions[dimension.id]?.score ?? '待评估'
                  }}
                  · {{ evaluation.dimensions[dimension.id]?.reason }}
                </li>
              </ul>
              <ul>
                <li
                  v-for="issue in issues.filter(
                    (i) => i.evaluation_id === evaluation.id,
                  )"
                  :key="issue.id"
                >
                  {{ issue.severity }} · {{ issue.description }} ·
                  {{ JSON.stringify(issue.location) }}
                </li>
              </ul>
            </div>
            <h4>审核历史</h4>
            <ul>
              <li v-for="event in selectedEvents" :key="event.id">
                {{ event.created_at }} · {{ event.actor_id }} ·
                {{ event.decision }} ·
                {{ event.note }}
              </li>
            </ul>
            <label
              >独立审核凭据
              <input
                v-model="reviewToken"
                type="password"
                autocomplete="off"
                placeholder="仅保留在当前页面内存"
            /></label>
            <button @click="preview">查看候选正文与原文转换稿</button>
            <template v-if="previewData"
              ><h4>候选正文</h4>
              <pre>{{ previewData.markdown }}</pre>
              <h4>原文转换稿</h4>
              <pre>{{ previewData.parsed }}</pre>
              <button @click="downloadOriginal">下载原件核对</button></template
            >
            <label>审核意见 <textarea v-model="reviewNote" /></label>
            <button
              :disabled="busy || taskFor(selected.id)?.status !== 'pending'"
              @click="decide('approve')"
            >
              通过
            </button>
            <button
              :disabled="busy || taskFor(selected.id)?.status !== 'pending'"
              @click="decide('reject')"
            >
              驳回
            </button>
            <button
              :disabled="busy || taskFor(selected.id)?.status !== 'pending'"
              @click="decide('changes_requested')"
            >
              退回修订
            </button>
          </article>
        </template>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import client from '@/api/client'
const props = withDefaults(
  defineProps<{
    projectId: string
    mode?: 'all' | 'sources' | 'directories' | 'results'
  }>(),
  { mode: 'all' },
)
const sectionTitle = computed(
  () =>
    ({
      all: '项目文档管理',
      sources: '管理项目 SVN / Git 数据源',
      directories: '维护项目文档目录及继承评分规则',
      results: '按项目目录浏览、检索文档结果与审核历史',
    })[props.mode],
)
const directoryInput = ref<HTMLInputElement | null>(null)
async function openDirectoryForm() {
 showCreateDirectory.value = !showCreateDirectory.value
 if (!showCreateDirectory.value) return
 if (!newDirectory.value) newDirectory.value = folderFilter.value ? folderFilter.value + '/' : 'doc/'
 await nextTick()
 directoryInput.value?.focus({ preventScroll: true })
 directoryInput.value?.scrollIntoView?.({ block: 'nearest' })
}
const showCreateDirectory = ref(false)
const directorySearch = ref('')
const stageNames: Record<string, string> = {
  '00-overview': '产品总览',
  '10-planning': '产品规划',
  '20-architecture': '系统架构',
  '30-standards': '工程规范',
  '40-requirements': '业务需求',
  '50-designs': '设计方案',
  '60-test': '测试验证',
  '70-release': '版本发布',
  '80-deploy': '部署运维',
  '90-guides': '使用指南',
  '99-templates': '文档模板',
}
function directoryLabel(path: string) {
 const configured = directories.value.find(row => row.path === path)?.display_name
 if (configured) return configured
  const name = path.split('/').at(-1)!
  return stageNames[name]
    ? name.slice(0, 2) + ' · ' + stageNames[name]
    : name === 'doc'
      ? '产品文档'
      : name === 'code'
        ? '代码契约'
        : name
}
function directoryCount(path: string) {
  return artifacts.value.filter((item) =>
    item.target_path.startsWith(path + '/'),
  ).length
}
function reviewStatusLabel(status?: string, approvalMode?: string) {
  if (status === 'approved' && approvalMode === 'auto') return '自动批准'
  return (
    (
      {
        pending: '待审核',
        approved: '已通过',
        rejected: '已驳回',
        changes_requested: '待修订',
        superseded: '已替代',
      } as Record<string, string>
    )[status || ''] || '未提交'
  )
}
const filteredDirectoryPaths = computed(() =>
  directoryPaths.value.filter((path) =>
    (path + directoryLabel(path))
      .toLocaleLowerCase()
      .includes(directorySearch.value.trim().toLocaleLowerCase()),
  ),
)
const hasFilters = computed(() =>
  Boolean(
    searchText.value ||
    statusFilter.value ||
    sourceFilter.value ||
    qualityFilter.value,
  ),
)
function resetFilters() {
  searchText.value = ''
  statusFilter.value = ''
  sourceFilter.value = ''
  qualityFilter.value = ''
  selected.value = null
}
async function refresh() {
  await load()
  if (!error.value && (props.mode === 'directories' || props.mode === 'all'))
    await readPolicy()
}
const directories = ref<Row[]>([])
const newDirectory = ref('')
const searchText = ref('')
const directoryPaths = computed(() => {
  const paths = new Set<string>()
  const add = (path: string) => {
    const parts = path.split('/').filter(Boolean)
    for (let i = 1; i <= parts.length; i++)
      paths.add(parts.slice(0, i).join('/'))
  }
  directories.value.forEach((row) => add(row.path))
  policies.value.forEach((row) => add(row.path))
  artifacts.value.forEach((row) =>
    add(row.target_path.split('/').slice(0, -1).join('/')),
  )
  return [...paths].sort()
})
async function selectDirectory(path: string) {
  folderFilter.value = path
  policyPath.value = path
  selected.value = null
  if (props.mode === 'directories' || props.mode === 'all') await readPolicy()
}
async function createDirectory() {
  await run(async () => {
    await command('document-directories', { path: newDirectory.value })
    newDirectory.value = ''
    showCreateDirectory.value = false
  })
  if (!error.value) await load()
}
type Row = Record<string, any>
const sources = ref<Row[]>([]),
  configs = ref<Row[]>([]),
  policies = ref<Row[]>([]),
  artifacts = ref<Row[]>([]),
  evaluations = ref<Row[]>([]),
  tasks = ref<Row[]>([]),
  events = ref<Row[]>([]),
  originals = ref<Row[]>([]),
  issues = ref<Row[]>([])
const busy = ref(false),
  error = ref(''),
  selected = ref<Row | null>(null),
  folderFilter = ref(''),
  statusFilter = ref('')
const reviewToken = ref(''),
  reviewNote = ref(''),
  previewData = ref<Row | null>(null)
const sourceForm = ref<Row>({
  name: '',
  type: 'svn',
  url: '',
  subpath: '',
  revision_selector: 'HEAD',
  enabled: true,
})
const policyPath = ref(''),
  effective = ref<Row | null>(null),
  threshold = ref(80),
  weights = ref<Record<string, number>>({}),
  rubrics = ref<Record<string, string>>({})
const sourceFilter = ref(''),
  qualityFilter = ref('')
const dimensionNames = [
  { id: 'fidelity', label: '转换准确性' },
  { id: 'completeness', label: '完整性' },
  { id: 'traceability', label: '来源追溯' },
  { id: 'consistency', label: '一致性' },
  { id: 'structure', label: '结构与归类' },
  { id: 'usability', label: '可用性' },
  { id: 'validity', label: '状态可信度' },
]
const base = computed(
  () =>
    `/admin/projects/${encodeURIComponent(props.projectId)}/document-quality/`,
)
async function run(action: () => Promise<void>) {
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (e: any) {
    error.value = e.response?.data?.error || e.message || '操作失败'
  } finally {
    busy.value = false
  }
}
async function list(resource: string): Promise<Row[]> {
  const result: Row[] = []
  let cursor = ''
  do {
    const response = await client.get(base.value + resource, {
      params: { cursor, limit: 200 },
    })
    result.push(...response.data.data.items)
    cursor = response.data.data.next_cursor
  } while (cursor)
  return result
}
async function command(operation: string, body: Row) {
  return client.post(base.value + operation, body, {
    headers: { 'Idempotency-Key': crypto.randomUUID() },
  })
}
async function load() {
  await run(async () => {
    const resources = [
      'document-directories',
      'data-sources',
      'source-revisions',
      'quality-policies',
      'document-results',
      'document-evaluations',
      'document-review-tasks',
      'document-review-events',
      'source-observations',
      'quality-issues',
    ]
    const values = await Promise.all(resources.map(list))
    ;[
      directories.value,
      sources.value,
      configs.value,
      policies.value,
      artifacts.value,
      evaluations.value,
      tasks.value,
      events.value,
      originals.value,
      issues.value,
    ] = values as Row[][]
  })
}
function resetSource() {
  sourceForm.value = {
    name: '',
    type: 'svn',
    url: '',
    subpath: '',
    revision_selector: 'HEAD',
    enabled: true,
  }
}
function editSource(source: Row) {
  sourceForm.value = {
    ...configs.value.find((c) => c.id === source.config_id),
    ...source,
    expected_revision: source.revision,
  }
}
async function saveSource() {
  await run(async () => {
    const form = sourceForm.value
    await command('data-sources', {
      name: form.name,
      url: form.url,
      subpath: form.subpath,
      revision_selector: form.revision_selector,
      type: form.type,
      enabled: form.enabled,
      ...(form.id
        ? { id: form.id, expected_revision: form.expected_revision }
        : {}),
    })
    resetSource()
  })
  if (!error.value) await load()
}
async function readPolicy() {
  await run(async () => {
    const response = await client.get(base.value + 'quality-policy-effective', {
      params: { path: policyPath.value },
    })
    effective.value = response.data.data
    threshold.value = effective.value!.review_threshold
    for (const d of dimensionNames) {
      weights.value[d.id] = effective.value!.dimensions[d.id].weight
      rubrics.value[d.id] = effective.value!.dimensions[d.id].rubric
    }
  })
}
function policyRevision() {
  return policies.value
    .filter((p) => p.path === policyPath.value)
    .reduce((n, p) => Math.max(n, p.policy_revision), 0)
}
async function writePolicy(patch: Row) {
  await run(async () => {
    await command('quality-policies', {
      path: policyPath.value,
      expected_revision: policyRevision(),
      patch,
    })
  })
  if (!error.value) await load()
  await readPolicy()
}
async function savePolicy(full: boolean) {
  const patch: Row = { review_threshold: threshold.value }
  if (full)
    patch.dimensions = Object.fromEntries(
      dimensionNames.map((d) => [
        d.id,
        { weight: weights.value[d.id], rubric: rubrics.value[d.id] },
      ]),
    )
  await writePolicy(patch)
}
async function inheritPolicy() {
  await writePolicy({})
}
function latestEvaluation(id: string) {
  return evaluations.value.filter((e) => e.artifact_id === id).at(-1)
}
function taskFor(id: string) {
  const evaluation = latestEvaluation(id)
  return tasks.value.find((t) => t.evaluation_id === evaluation?.id)
}
function matchesQualityFilters(artifact: Row) {
  if (
    sourceFilter.value &&
    !artifact.source_links.some((link: Row) =>
      originals.value.some(
        (source) =>
          source.id === link.source_version_id &&
          source.source_id === sourceFilter.value,
      ),
    )
  )
    return false
  const evaluation = latestEvaluation(artifact.id)
  let quality = 'qualified'
  if (!evaluation || evaluation.total == null) quality = 'not_assessed'
  else if (evaluation.blocking) quality = 'blocked'
  else if (evaluation.needs_review) quality = 'needs_review'
  return !qualityFilter.value || quality === qualityFilter.value
}
const visibleArtifacts = computed(() =>
  artifacts.value.filter(
    (a) =>
      matchesQualityFilters(a) &&
      (!searchText.value.trim() ||
        [
          a.target_path,
          ...originals.value
            .filter((source) =>
              a.source_links.some(
                (link: Row) => link.source_version_id === source.id,
              ),
            )
            .map((source) => source.repository_path),
        ].some((value) =>
          String(value || '')
            .toLocaleLowerCase()
            .includes(searchText.value.trim().toLocaleLowerCase()),
        )) &&
      (!folderFilter.value ||
        a.target_path.startsWith(folderFilter.value + '/')) &&
      (!statusFilter.value || taskFor(a.id)?.status === statusFilter.value),
  ),
)
const selectedSources = computed(() =>
  originals.value.filter((s) =>
    selected.value?.source_links.some(
      (link: Row) => link.source_version_id === s.id,
    ),
  ),
)
const selectedEvaluations = computed(() =>
  evaluations.value.filter((e) => e.artifact_id === selected.value?.id),
)
const selectedEvents = computed(() =>
  events.value.filter((event) =>
    tasks.value.some(
      (task) =>
        task.id === event.task_id && task.artifact_id === selected.value?.id,
    ),
  ),
)
async function humanRequest(path: string, body?: Row) {
  if (!reviewToken.value) throw new Error('请填写独立审核凭据')
  const response = await fetch('/api/v2/knowledge/' + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${reviewToken.value}`,
      'Content-Type': 'application/json',
      ...(body ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'error',
  })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || '审核请求失败')
  return value.data
}
async function preview() {
  await run(async () => {
    previewData.value = await humanRequest(
      `document-result-preview?project=${encodeURIComponent(props.projectId)}&id=${selected.value!.id}`,
    )
  })
}
async function downloadOriginal() {
  await run(async () => {
    const value = await humanRequest(
      `document-result-original?project=${encodeURIComponent(props.projectId)}&id=${selected.value!.id}`,
    )
    const bytes = Uint8Array.from(atob(value.base64), (c) => c.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes]))
    const link = document.createElement('a')
    link.href = url
    link.download = value.name
    link.click()
    URL.revokeObjectURL(url)
  })
}
async function decide(decision: string) {
  await run(async () => {
    const task = taskFor(selected.value!.id)
    if (!task || !reviewNote.value.trim())
      throw new Error('请填写意见并选择当前待审任务')
    await humanRequest('document-review-decisions', {
      project: props.projectId,
      task_id: task.id,
      expected_revision: task.revision,
      decision,
      note: reviewNote.value,
    })
    reviewNote.value = ''
  })
  if (!error.value) await load()
}
watch(policyPath, () => {
  effective.value = null
})
watch(selected, () => {
  previewData.value = null
  reviewNote.value = ''
})
watch(
  () => props.projectId,
  () => {
    reviewToken.value = ''
    folderFilter.value = ''
    policyPath.value = ''
    searchText.value = ''
    newDirectory.value = ''
    directories.value = []
    artifacts.value = []
    selected.value = null
    resetSource()
    effective.value = null
    void load()
  },
)
onMounted(() => { const path = useRoute()?.query?.folder; if (typeof path === 'string' && props.mode === 'results') folderFilter.value = path; void refresh() })
</script>

<style scoped>
.quality-panel {
  color: var(--td-text-color-primary);
  font: 14px/1.6 var(--app-font-family);
}
.quality-panel *,
.quality-panel *::before,
.quality-panel *::after {
  box-sizing: border-box;
}
h3,
h4,
p {
  margin: 0;
}
h3 {
  font-size: 16px;
  font-weight: 600;
}
h4 {
  font-size: 14px;
}
.panel-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.panel-toolbar p,
.subtle {
  color: var(--td-text-color-secondary);
  font-size: 12px;
  font-weight: 400;
}
.document-browser {
  display: grid;
  grid-template-columns: 252px minmax(0, 1fr);
  min-height: 640px;
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-stroke);
  border-radius: 10px;
  overflow: hidden;
}
.directory-tree {
  padding: 18px 12px;
  background: var(--td-bg-color-container);
  border-right: 1px solid var(--td-component-stroke);
  min-width: 0;
}
.tree-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 14px;
}
.tree-heading h3 {
  font-size: 14px;
}
.tree-search {
  width: calc(100% - 16px);
  margin: 0 8px 14px;
}
.tree-items {
  max-height: 620px;
  overflow: auto;
}
.tree-items [role='treeitem'] {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 2px 0;
  padding: 8px 12px;
  text-align: left;
  border: 0;
  border-radius: 5px;
  background: transparent;
  line-height: 22px;
}
.tree-items [role='treeitem']:hover {
  background: var(--td-bg-color-container-hover);
}
.tree-items [aria-selected='true'] {
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
  font-weight: 600;
}
.folder-icon {
  width: 16px;
  flex-shrink: 0;
  color: var(--td-text-color-placeholder);
  font-size: 19px;
  line-height: 1;
}
.tree-items [aria-selected='true'] .folder-icon {
  color: inherit;
}
.tree-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.directory-count {
  color: var(--td-text-color-placeholder);
  font-size: 12px;
  font-weight: 400;
}
.tree-hint {
  margin: 16px 8px 0;
  color: var(--td-text-color-placeholder);
  font-size: 12px;
}
.create-directory {
  margin: 0 4px 16px;
  padding: 12px;
  background: var(--td-bg-color-page);
  border-radius: 6px;
}
.create-directory label {
  width: 100%;
}
.create-directory p {
  margin: 8px 0;
  font-size: 12px;
  color: var(--td-text-color-secondary);
}
.create-directory input {
  width: 100%;
  min-width: 0;
}
.directory-content {
  min-width: 0;
  padding: 24px;
}
.workspace-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--td-component-stroke);
  margin-bottom: 20px;
}
.workspace-heading h3 {
  font-size: 18px;
}
.directory-path {
  color: var(--td-text-color-secondary);
  font-size: 12px;
  margin-top: 4px;
  overflow-wrap: anywhere;
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--td-text-color-secondary);
  font-size: 12px;
  min-width: 0;
}
input,
textarea,
select {
  font: 14px/1.5 var(--app-font-family);
  color: var(--td-text-color-primary);
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-stroke);
  border-radius: 5px;
  padding: 7px 10px;
  max-width: 100%;
  min-width: 0;
  transition: border-color 0.15s;
}
input:hover,
textarea:hover,
select:hover {
  border-color: var(--td-text-color-placeholder);
}
input:focus-visible,
textarea:focus-visible,
select:focus-visible,
button:focus-visible {
  outline: 2px solid var(--td-brand-color);
  outline-offset: 2px;
}
input[type='number'] {
  width: 100px;
}
textarea {
  resize: vertical;
  min-height: 64px;
}
button {
  font: 13px/1.5 var(--app-font-family);
  color: var(--td-text-color-primary);
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-stroke);
  padding: 7px 12px;
  border-radius: 5px;
  cursor: pointer;
  white-space: nowrap;
}
button:hover {
  color: var(--td-brand-color);
  border-color: var(--td-brand-color);
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
button.primary {
  background: var(--td-brand-color);
  border-color: var(--td-brand-color);
  color: white;
}
button.text-action {
  padding: 2px 0;
  color: var(--td-brand-color);
  border: 0;
  background: transparent;
}
button.icon-action {
  font-size: 20px;
  border: 0;
  padding: 0 6px;
  background: transparent;
}
.button-row,
.policy-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
details {
  padding: 20px;
  border: 1px solid var(--td-component-stroke);
  border-radius: 8px;
}
summary {
  list-style: none;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 20px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.threshold-row {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 0 20px;
}
.threshold-row p {
  font-size: 12px;
  color: var(--td-text-color-secondary);
}
.dimension-heading,
.dimension {
  display: grid;
  grid-template-columns: 145px 110px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
  padding: 14px 0;
  border-bottom: 1px solid var(--td-component-stroke);
}
.dimension-heading {
  background: var(--td-bg-color-page);
  padding: 10px 12px;
  font-size: 12px;
  color: var(--td-text-color-secondary);
  border: 0;
  border-radius: 5px;
}
.dimension strong {
  font-size: 13px;
  padding-top: 8px;
}
.dimension label {
  font-size: 0;
  gap: 0;
}
.dimension label input,
.dimension label textarea {
  font-size: 13px;
  width: 100%;
}
.dimension small {
  grid-column: 2/4;
  color: var(--td-text-color-placeholder);
  font-size: 11px;
  margin-top: -8px;
}
.policy-actions {
  padding-top: 20px;
}
.policy-path-picker {
  display: flex;
  align-items: end;
  gap: 12px;
  margin-bottom: 16px;
}
.results-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.result-count {
  font-size: 12px;
  font-weight: 400;
  background: var(--td-bg-color-page);
  color: var(--td-text-color-secondary);
  padding: 2px 7px;
  border-radius: 10px;
  margin-left: 6px;
}
.result-filters {
  display: grid;
  grid-template-columns: minmax(200px, 2fr) repeat(3, minmax(100px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.result-filters label:first-child {
  min-width: 0;
}
.result-filters input,
.result-filters select {
  width: 100%;
}
.results-table {
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th,
td {
  padding: 13px 12px;
  border-bottom: 1px solid var(--td-component-stroke);
  text-align: left;
}
th {
  font-weight: 500;
  font-size: 12px;
  color: var(--td-text-color-secondary);
  background: var(--td-bg-color-page);
  white-space: nowrap;
}
td:first-child {
  overflow-wrap: anywhere;
  min-width: 180px;
}
tbody tr:hover {
  background: var(--td-bg-color-container-hover);
}
.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--td-bg-color-page);
  color: var(--td-text-color-secondary);
  white-space: nowrap;
  font-size: 12px;
}
.status-badge[data-status='pending'] {
  background: var(--td-warning-color-light);
  color: var(--td-warning-color);
}
.status-badge[data-status='approved'] {
  background: var(--td-success-color-light);
  color: var(--td-success-color);
}
.status-badge[data-status='rejected'] {
  background: var(--td-error-color-light);
  color: var(--td-error-color);
}
.results-empty {
  text-align: center;
  padding: 64px 12px;
  color: var(--td-text-color-secondary);
}
.empty-symbol {
  font-size: 36px;
  color: var(--td-text-color-placeholder);
}
.results-empty h4 {
  color: var(--td-text-color-primary);
  margin: 12px 0 6px;
}
.results-empty p {
  font-size: 12px;
  margin-bottom: 8px;
}
.loading-hint {
  text-align: center;
  padding: 40px;
  color: var(--td-text-color-secondary);
}
.document-detail {
  margin-top: 24px;
  border: 1px solid var(--td-component-stroke);
  border-radius: 8px;
  padding: 20px;
}
.document-detail p,
.document-detail h4 {
  margin: 12px 0;
  overflow-wrap: anywhere;
}
.document-detail label {
  margin: 12px 0;
}
.document-detail button {
  margin: 4px 8px 4px 0;
}
.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 400px;
  overflow: auto;
  background: var(--td-bg-color-page);
  border-radius: 6px;
  padding: 16px;
}
.error {
  color: var(--td-error-color);
  padding: 12px 16px;
  background: var(--td-error-color-light);
  border-radius: 6px;
  margin-bottom: 16px;
}
@media (max-width: 1100px) {
  .document-browser {
    grid-template-columns: 220px minmax(0, 1fr);
  }
  .directory-content {
    padding: 18px;
  }
  .result-filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .dimension-heading,
  .dimension {
    grid-template-columns: 100px 80px minmax(0, 1fr);
    gap: 12px;
  }
}
@media (max-width: 767px) {
  .document-browser {
    display: block;
    min-height: 0;
  }
  .directory-tree {
    border-right: 0;
    border-bottom: 1px solid var(--td-component-stroke);
  }
  .tree-items {
    max-height: 220px;
  }
  .directory-content {
    padding: 16px;
  }
  .result-filters {
    grid-template-columns: 1fr;
  }
  .dimension-heading {
    display: none;
  }
  .dimension {
    grid-template-columns: 1fr 80px;
  }
  .dimension label:last-of-type {
    grid-column: 1/3;
  }
  .dimension small {
    grid-column: 1/3;
  }
  .threshold-row {
    flex-wrap: wrap;
    gap: 8px;
  }
  details {
    padding: 14px;
  }
}
</style>
