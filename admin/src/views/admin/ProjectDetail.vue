<template>
  <t-loading :loading="loading" show-overlay class="project-detail-loading">
    <div class="project-detail">
      <div class="page-head">
        <t-button variant="text" @click="router.push('/projects')">
          <template #icon><ArrowLeftIcon /></template>
          {{ t('common.backToList') }}
        </t-button>
        <h2 v-if="project" class="page-title">{{ project.name || project.id }}</h2>
        <t-tag v-if="project" theme="primary" variant="light">{{ project.id }}</t-tag>
        <div class="head-actions">
          <t-button variant="outline" size="small" @click="loadAll">
            <template #icon><RefreshIcon /></template>
            {{ t('common.refresh') }}
          </t-button>
        </div>
      </div>

      <t-tabs v-if="project" v-model="activeTab" class="detail-tabs">
        <!-- Overview -->
        <t-tab-pane :value="'overview'" :label="t('detail.overview')">
          <t-descriptions :column="descColumn" layout="horizontal" bordered>
            <t-descriptions-item :label="t('project.product')">
              {{ project.product || '-' }}
            </t-descriptions-item>
            <t-descriptions-item :label="t('project.version')">
              {{ project.version || '-' }}
            </t-descriptions-item>
            <t-descriptions-item :label="t('project.createdAt')">
              {{ formatDate(project.created_at) }}
            </t-descriptions-item>
            <t-descriptions-item :label="t('project.updatedAt')">
              {{ formatDate(project.updated_at) }}
            </t-descriptions-item>
          </t-descriptions>

          <h4 class="sub-title">{{ t('detail.syncState') }}</h4>
          <t-descriptions :column="descColumn" layout="horizontal" bordered>
            <t-descriptions-item :label="t('detail.lastDocSync')">
              {{ formatDate(project.sync_state?.last_doc_sync) }}
            </t-descriptions-item>
            <t-descriptions-item :label="t('detail.lastCodeSync')">
              {{ formatDate(project.sync_state?.last_code_sync) }}
            </t-descriptions-item>
            <t-descriptions-item :label="t('detail.pendingChanges')">
              <template v-if="project.sync_state?.pending_changes?.length">
                <t-tag v-for="c in project.sync_state.pending_changes" :key="c" size="small" variant="light" class="tag-gap">
                  {{ c }}
                </t-tag>
              </template>
              <span v-else>{{ t('common.none') }}</span>
            </t-descriptions-item>
            <t-descriptions-item :label="t('detail.lastError')">
              <span :class="{ 'err-text': project.sync_state?.last_error }">
                {{ project.sync_state?.last_error || t('common.none') }}
              </span>
            </t-descriptions-item>
          </t-descriptions>
        </t-tab-pane>

        <!-- Docs -->
        <t-tab-pane :value="'docs'" :label="`${t('detail.docs')} (${project.docs?.length || 0})`">
          <t-table :data="project.docs || []" :columns="docColumns" row-key="doc_id" bordered>
            <template #bundles="{ row }">
              <template v-if="row.bundles?.length">
                <t-tag v-for="b in row.bundles" :key="b" size="small" variant="light" class="tag-gap">{{ b }}</t-tag>
              </template>
              <span v-else>{{ t('common.none') }}</span>
            </template>
            <template #empty>
              <t-empty :description="t('detail.docsEmpty')" />
            </template>
          </t-table>
        </t-tab-pane>

        <!-- Repos -->
        <t-tab-pane :value="'repos'" :label="`${t('detail.repos')} (${project.repos?.length || 0})`">
          <t-table :data="project.repos || []" :columns="repoColumns" row-key="name" bordered>
            <template #mappings="{ row }">
              <t-link theme="primary" @click="openMappings(row)">
                {{ t('detail.mappingCount', { count: Object.keys(row.module_mapping || {}).length }) }}
              </t-link>
            </template>
            <template #empty>
              <t-empty :description="t('detail.reposEmpty')" />
            </template>
          </t-table>
        </t-tab-pane>

        <!-- Modules -->
        <t-tab-pane :value="'modules'" :label="`${t('detail.modules')} (${project.modules?.length || 0})`">
          <div class="module-cloud">
            <t-tag v-for="m in project.modules || []" :key="m" theme="primary" variant="light" class="tag-gap">
              {{ m }}
            </t-tag>
            <span v-if="!project.modules?.length">{{ t('common.empty') }}</span>
          </div>
        </t-tab-pane>

        <!-- Tokens -->
        <t-tab-pane :value="'tokens'" :label="t('detail.tokens')">
          <div class="token-actions">
            <t-button theme="primary" @click="tokenDialogVisible = true">
              <template #icon><AddIcon /></template>
              {{ t('detail.issueToken') }}
            </t-button>
            <t-button theme="danger" variant="outline" @click="revokeDialogVisible = true">
              {{ t('detail.revokeToken') }}
            </t-button>
          </div>
          <p class="hint">{{ t('detail.tokenRevokeHint') }}</p>
        </t-tab-pane>

        <!-- Sync logs -->
        <t-tab-pane :value="'sync'" :label="t('detail.syncLogs')">
          <t-table :data="syncLogs" :columns="syncColumns" :loading="logsLoading" row-key="synced_at" bordered>
            <template #affected="{ row }">
              <template v-if="row.affected_modules?.length">
                <t-tag v-for="m in row.affected_modules" :key="m" size="small" variant="light" class="tag-gap">{{ m }}</t-tag>
              </template>
              <span v-else>{{ t('common.none') }}</span>
            </template>
            <template #status="{ row }">
              <t-tag :theme="row.status === 'success' ? 'success' : 'danger'" variant="light">
                {{ row.status === 'success' ? t('detail.statusSuccess') : t('detail.statusFailed') }}
              </t-tag>
            </template>
            <template #empty>
              <t-empty :description="t('detail.syncEmpty')" />
            </template>
          </t-table>
        </t-tab-pane>

        <!-- Wiki nodes -->
        <t-tab-pane :value="'wiki'" :label="t('detail.wikiNodes')">
          <p class="hint">
            {{ t('detail.wikiDocCount', { count: wikiDocCount }) }} ·
            {{ t('detail.wikiCodeCount', { count: wikiCodeCount }) }}
          </p>
          <t-table :data="wikiNodes" :columns="wikiColumns" :loading="wikiLoading" row-key="node_id" bordered>
            <template #plane="{ row }">
              <t-tag size="small" :theme="row.plane === 'doc' ? 'success' : 'warning'" variant="light">
                {{ row.plane }}
              </t-tag>
            </template>
            <template #path="{ row }">
              <t-link theme="primary" :href="wikiUrl(row.path)" target="_blank">
                <template #prefix-icon><BrowseIcon /></template>
                {{ row.path }}
              </t-link>
            </template>
            <template #empty>
              <t-empty :description="t('detail.wikiEmpty')" />
            </template>
          </t-table>
        </t-tab-pane>
      </t-tabs>

      <!-- Issue token dialog -->
      <t-dialog
        :visible="tokenDialogVisible"
        :title="t('detail.issueToken')"
        width="480px"
        :close-on-overlay-click="false"
        :confirm-btn="{ content: t('detail.issueToken'), loading: issuing }"
        :cancel-btn="{ content: t('common.cancel') }"
        @confirm="handleIssueToken"
        @update:visible="(v: boolean) => (tokenDialogVisible = v)"
      >
        <t-form label-align="top">
          <t-form-item :label="t('detail.tokenScopes')">
            <t-checkbox-group v-model="tokenScopes">
              <t-checkbox value="read_config">{{ t('detail.scopeReadConfig') }}</t-checkbox>
              <t-checkbox value="write_status">{{ t('detail.scopeWriteStatus') }}</t-checkbox>
              <t-checkbox value="trigger_sync">{{ t('detail.scopeTriggerSync') }}</t-checkbox>
            </t-checkbox-group>
          </t-form-item>
          <t-form-item :label="t('detail.tokenExpiry')">
            <t-input-number v-model="tokenExpiry" :min="0" theme="column" />
            <span class="hint expiry-hint">{{ t('detail.tokenNeverExpires') }} = 0</span>
          </t-form-item>
        </t-form>
      </t-dialog>

      <!-- Token result dialog: 明文仅此展示一次 -->
      <t-dialog
        :visible="tokenResultVisible"
        :title="t('detail.tokenIssued')"
        width="560px"
        :close-on-overlay-click="false"
        :close-on-esc-keydown="false"
        :cancel-btn="false"
        :confirm-btn="{ content: t('detail.tokenAck') }"
        @confirm="acknowledgeToken"
      >
        <t-alert theme="warning" :message="t('detail.tokenWarning')" :close-btn="false" class="alert-gap" />
        <div class="issued-token">
          <t-textarea :value="issuedToken?.token" readonly :autosize="{ minRows: 2, maxRows: 4 }" class="issued-token-input" />
          <t-button theme="primary" @click="copyText(issuedToken?.token || '')">
            <template #icon><CopyIcon /></template>
            {{ t('common.copy') }}
          </t-button>
        </div>
      </t-dialog>

      <!-- Revoke token dialog -->
      <t-dialog
        :visible="revokeDialogVisible"
        :title="t('detail.revokeTokenTitle')"
        width="480px"
        :close-on-overlay-click="false"
        :confirm-btn="{ content: t('detail.revokeToken'), theme: 'danger', loading: revoking }"
        :cancel-btn="{ content: t('common.cancel') }"
        @confirm="handleRevokeToken"
        @update:visible="(v: boolean) => (revokeDialogVisible = v)"
      >
        <t-textarea v-model="revokeTokenValue" :autosize="{ minRows: 2, maxRows: 4 }" :placeholder="t('detail.tokenPlaceholder')" />
      </t-dialog>

      <!-- Mappings dialog -->
      <t-dialog
        :visible="mappingsVisible"
        :title="t('detail.repoMappings')"
        width="640px"
        :close-on-overlay-click="false"
        :footer="false"
        @update:visible="(v: boolean) => (mappingsVisible = v)"
      >
        <t-table :data="mappingRows" :columns="mappingColumns" row-key="path" size="small" max-height="420" bordered>
          <template #empty>
            <t-empty :description="t('common.empty')" />
          </template>
        </t-table>
      </t-dialog>
    </div>
  </t-loading>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MessagePlugin, NotifyPlugin } from 'tdesign-vue-next'
import type { PrimaryTableCol } from 'tdesign-vue-next'
import {
  ArrowLeftIcon,
  RefreshIcon,
  AddIcon,
  BrowseIcon,
  CopyIcon,
} from 'tdesign-icons-vue-next'
import { useBreakpoint } from '@/composables/useBreakpoint'
import {
  getProject,
  issueToken,
  revokeToken,
  getSyncLogs,
  getWikiNodes,
} from '@/api/projects'
import type { ProjectConfig, SyncLog, WikiNodeEntry, RepoBinding } from '@/api/types'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const { isMobile } = useBreakpoint()

const projectId = computed(() => String(route.params.id))
const project = ref<ProjectConfig | null>(null)
const loading = ref(false)
const activeTab = ref('overview')

const descColumn = computed(() => (isMobile.value ? 1 : 2))

// 统一错误提示：优先展示后端 message，右上角通知不打断操作
function showError(e: any, fallback: string) {
  NotifyPlugin.error({
    title: t('common.error'),
    content: e?.response?.data?.error || e?.message || fallback,
    duration: 5000,
  })
}

const syncLogs = ref<SyncLog[]>([])
const logsLoading = ref(false)
const wikiNodes = ref<WikiNodeEntry[]>([])
const wikiLoading = ref(false)

const tokenDialogVisible = ref(false)
const tokenScopes = ref<string[]>(['read_config', 'write_status'])
const tokenExpiry = ref(0)
const issuing = ref(false)
const issuedToken = ref<{ token: string } | null>(null)
const tokenResultVisible = ref(false)

const revokeDialogVisible = ref(false)
const revokeTokenValue = ref('')
const revoking = ref(false)

const mappingsVisible = ref(false)
const mappingRows = ref<{ path: string; module: string }[]>([])

const wikiDocCount = computed(() => wikiNodes.value.filter((n) => n.plane === 'doc').length)
const wikiCodeCount = computed(() => wikiNodes.value.filter((n) => n.plane === 'code').length)

function formatDate(s: string) {
  if (!s) return '-'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US')
}

// DB path (data/wiki/<project>/<plane>/...) → 渲染页 URL（VitePress base=/wiki/，cleanUrls 无扩展名）
function wikiUrl(dbPath: string) {
  if (!dbPath) return '#'
  let rel = dbPath
  if (rel.startsWith('data/wiki/')) rel = rel.slice('data/wiki/'.length)
  rel = rel.replace(/\.md$/, '')
  return `/wiki/${rel}`
}

const docColumns = computed<PrimaryTableCol[]>(() => [
  { colKey: 'doc_id', title: t('detail.docId'), ellipsis: true },
  { colKey: 'type', title: t('detail.docType'), width: 130 },
  { colKey: 'path', title: t('detail.docPath'), ellipsis: true },
  { colKey: 'submodule', title: t('detail.docSubmodule'), ellipsis: true },
  { colKey: 'ingested_at', title: t('detail.docIngestedAt'), width: 170, cell: (_h, { row }) => formatDate(row.ingested_at) },
  { colKey: 'bundles', title: t('detail.docBundles'), cell: 'bundles' },
])

const repoColumns = computed<PrimaryTableCol[]>(() => [
  { colKey: 'name', title: t('detail.repoName'), width: 140, ellipsis: true },
  { colKey: 'branch', title: t('detail.repoBranch'), width: 160, ellipsis: true },
  { colKey: 'url', title: t('detail.repoUrl'), ellipsis: true },
  { colKey: 'last_sync_sha', title: t('detail.repoLastSyncSHA'), width: 130, ellipsis: true },
  { colKey: 'synced_at', title: t('detail.repoSyncedAt'), width: 170, cell: (_h, { row }) => formatDate(row.synced_at) },
  { colKey: 'mappings', title: t('detail.repoMappings'), width: 130, cell: 'mappings' },
])

const syncColumns = computed<PrimaryTableCol[]>(() => [
  { colKey: 'repo_name', title: t('detail.logRepo'), width: 130, ellipsis: true },
  { colKey: 'from_sha', title: t('detail.logFrom'), width: 120, ellipsis: true },
  { colKey: 'to_sha', title: t('detail.logTo'), width: 120, ellipsis: true },
  { colKey: 'changed_files', title: t('detail.logChangedFiles'), width: 100 },
  { colKey: 'affected', title: t('detail.logAffected'), cell: 'affected' },
  { colKey: 'status', title: t('detail.logStatus'), width: 90, cell: 'status' },
  { colKey: 'duration_ms', title: t('detail.logDuration'), width: 100, cell: (_h, { row }) => `${row.duration_ms} ms` },
  { colKey: 'synced_at', title: t('detail.logTime'), width: 170, cell: (_h, { row }) => formatDate(row.synced_at) },
])

const wikiColumns = computed<PrimaryTableCol[]>(() => [
  { colKey: 'plane', title: t('detail.wikiPlane'), width: 90, cell: 'plane' },
  { colKey: 'path', title: t('detail.wikiPath'), cell: 'path' },
  { colKey: 'node_id', title: t('detail.wikiNodeId'), ellipsis: true },
  { colKey: 'bundle_id', title: t('detail.wikiBundleId'), width: 180, ellipsis: true },
])

const mappingColumns = computed<PrimaryTableCol[]>(() => [
  { colKey: 'path', title: t('detail.mappingPath'), ellipsis: true },
  { colKey: 'module', title: t('detail.mappingModule') },
])

function openMappings(repo: RepoBinding) {
  mappingRows.value = Object.entries(repo.module_mapping || {}).map(([path, module]) => ({
    path,
    module,
  }))
  mappingsVisible.value = true
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    MessagePlugin.success(t('common.copied'))
  } catch {
    MessagePlugin.error(t('common.error'))
  }
}

async function loadProject() {
  loading.value = true
  try {
    project.value = await getProject(projectId.value)
  } catch (e: any) {
    showError(e, t('common.error'))
  } finally {
    loading.value = false
  }
}

async function loadLogs() {
  logsLoading.value = true
  try {
    syncLogs.value = await getSyncLogs(projectId.value, 50)
  } catch (e: any) {
    showError(e, t('common.error'))
  } finally {
    logsLoading.value = false
  }
}

async function loadWikiNodes() {
  wikiLoading.value = true
  try {
    wikiNodes.value = await getWikiNodes(projectId.value)
  } catch (e: any) {
    showError(e, t('common.error'))
  } finally {
    wikiLoading.value = false
  }
}

async function loadAll() {
  await Promise.all([loadProject(), loadLogs(), loadWikiNodes()])
}

async function handleIssueToken() {
  if (!tokenScopes.value.length) {
    MessagePlugin.warning(t('detail.tokenScopes'))
    return
  }
  issuing.value = true
  try {
    issuedToken.value = await issueToken(projectId.value, tokenScopes.value, tokenExpiry.value)
    tokenDialogVisible.value = false
    tokenResultVisible.value = true
  } catch (e: any) {
    showError(e, t('common.error'))
  } finally {
    issuing.value = false
  }
}

function acknowledgeToken() {
  // 关闭即销毁明文，落实"仅显示一次"
  tokenResultVisible.value = false
  issuedToken.value = null
}

async function handleRevokeToken() {
  const token = revokeTokenValue.value.trim()
  if (!token) {
    MessagePlugin.warning(t('detail.tokenPlaceholder'))
    return
  }
  revoking.value = true
  try {
    await revokeToken(projectId.value, token)
    MessagePlugin.success(t('detail.revoked'))
    revokeDialogVisible.value = false
    revokeTokenValue.value = ''
    if (issuedToken.value?.token === token) acknowledgeToken()
  } catch (e: any) {
    showError(e, t('common.error'))
  } finally {
    revoking.value = false
  }
}

onMounted(loadAll)
</script>

<style scoped>
.project-detail {
  max-width: 1200px;
}

.page-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.page-title {
  margin: 0;
}

.head-actions {
  margin-left: auto;
}

.detail-tabs {
  margin-top: 4px;
}

.sub-title {
  margin: 24px 0 12px;
}

.module-cloud {
  line-height: 2;
}

.tag-gap {
  margin: 2px 4px 2px 0;
}

.token-actions {
  display: flex;
  gap: var(--cim-space-md);
  flex-wrap: wrap;
}

.alert-gap {
  margin-top: 16px;
}

.issued-token {
  display: flex;
  align-items: flex-start;
  gap: var(--cim-space-md);
  margin-top: var(--cim-space-md);
}

.issued-token-input {
  flex: 1;
}

.issued-token .t-button {
  flex-shrink: 0;
}

.hint {
  margin-top: 12px;
  color: var(--td-text-color-secondary);
  font-size: 12px;
}

.expiry-hint {
  margin-top: 0;
  margin-left: 8px;
}

.err-text {
  color: var(--td-error-color);
}
</style>
