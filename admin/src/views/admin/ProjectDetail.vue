<template>
  <div class="project-detail" v-loading="loading">
    <div class="page-head">
      <el-button text @click="router.push('/projects')">
        <el-icon><ArrowLeft /></el-icon>
        {{ t('common.backToList') }}
      </el-button>
      <h2 v-if="project">{{ project.name || project.id }}</h2>
      <el-tag v-if="project" type="primary" effect="light">{{ project.id }}</el-tag>
      <div class="head-actions">
        <el-button plain size="small" :icon="RefreshIcon" @click="loadAll">
          {{ t('common.refresh') }}
        </el-button>
      </div>
    </div>

    <el-tabs v-if="project" v-model="activeTab" class="detail-tabs">
      <!-- Overview -->
      <el-tab-pane :label="t('detail.overview')" name="overview">
        <el-descriptions :column="descColumn" border>
          <el-descriptions-item :label="t('project.product')">
            {{ project.product || '-' }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('project.version')">
            {{ project.version || '-' }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('project.createdAt')">
            {{ formatDate(project.created_at) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('project.updatedAt')">
            {{ formatDate(project.updated_at) }}
          </el-descriptions-item>
        </el-descriptions>

        <h4 class="sub-title">{{ t('detail.syncState') }}</h4>
        <el-descriptions :column="descColumn" border>
          <el-descriptions-item :label="t('detail.lastDocSync')">
            {{ formatDate(project.sync_state?.last_doc_sync) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('detail.lastCodeSync')">
            {{ formatDate(project.sync_state?.last_code_sync) }}
          </el-descriptions-item>
          <el-descriptions-item :label="t('detail.pendingChanges')" :span="descColumn">
            <template v-if="project.sync_state?.pending_changes?.length">
              <el-tag v-for="c in project.sync_state.pending_changes" :key="c" size="small" class="tag-gap">
                {{ c }}
              </el-tag>
            </template>
            <span v-else>{{ t('common.none') }}</span>
          </el-descriptions-item>
          <el-descriptions-item :label="t('detail.lastError')" :span="descColumn">
            <span :class="{ 'err-text': project.sync_state?.last_error }">
              {{ project.sync_state?.last_error || t('common.none') }}
            </span>
          </el-descriptions-item>
        </el-descriptions>
      </el-tab-pane>

      <!-- Docs -->
      <el-tab-pane :label="`${t('detail.docs')} (${project.docs?.length || 0})`" name="docs">
        <el-table :data="project.docs || []" style="width: 100%">
          <el-table-column prop="doc_id" :label="t('detail.docId')" min-width="160" show-overflow-tooltip />
          <el-table-column prop="type" :label="t('detail.docType')" width="130" />
          <el-table-column prop="path" :label="t('detail.docPath')" min-width="220" show-overflow-tooltip />
          <el-table-column prop="submodule" :label="t('detail.docSubmodule')" min-width="160" show-overflow-tooltip />
          <el-table-column :label="t('detail.docIngestedAt')" width="170">
            <template #default="{ row }">{{ formatDate(row.ingested_at) }}</template>
          </el-table-column>
          <el-table-column :label="t('detail.docBundles')" min-width="160">
            <template #default="{ row }">
              <template v-if="row.bundles?.length">
                <el-tag v-for="b in row.bundles" :key="b" size="small" class="tag-gap">{{ b }}</el-tag>
              </template>
              <span v-else>{{ t('common.none') }}</span>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty :description="t('detail.docsEmpty')" :image-size="72" />
          </template>
        </el-table>
      </el-tab-pane>

      <!-- Repos -->
      <el-tab-pane :label="`${t('detail.repos')} (${project.repos?.length || 0})`" name="repos">
        <el-table :data="project.repos || []" style="width: 100%">
          <el-table-column prop="name" :label="t('detail.repoName')" width="140" show-overflow-tooltip />
          <el-table-column prop="branch" :label="t('detail.repoBranch')" width="160" show-overflow-tooltip />
          <el-table-column prop="url" :label="t('detail.repoUrl')" min-width="220" show-overflow-tooltip />
          <el-table-column prop="last_sync_sha" :label="t('detail.repoLastSyncSHA')" width="130" show-overflow-tooltip />
          <el-table-column :label="t('detail.repoSyncedAt')" width="170">
            <template #default="{ row }">{{ formatDate(row.synced_at) }}</template>
          </el-table-column>
          <el-table-column :label="t('detail.repoMappings')" width="130">
            <template #default="{ row }">
              <el-link type="primary" :underline="false" @click="openMappings(row)">
                {{ t('detail.mappingCount', { count: Object.keys(row.module_mapping || {}).length }) }}
              </el-link>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty :description="t('detail.reposEmpty')" :image-size="72" />
          </template>
        </el-table>
      </el-tab-pane>

      <!-- Modules -->
      <el-tab-pane :label="`${t('detail.modules')} (${project.modules?.length || 0})`" name="modules">
        <div class="module-cloud">
          <el-tag v-for="m in project.modules || []" :key="m" type="primary" effect="light" class="tag-gap">
            {{ m }}
          </el-tag>
          <span v-if="!project.modules?.length">{{ t('common.empty') }}</span>
        </div>
      </el-tab-pane>

      <!-- Tokens -->
      <el-tab-pane :label="t('detail.tokens')" name="tokens">
        <el-space wrap>
          <el-button type="primary" :icon="AddIcon" @click="tokenDialogVisible = true">
            {{ t('detail.issueToken') }}
          </el-button>
          <el-button type="danger" plain @click="revokeDialogVisible = true">
            {{ t('detail.revokeToken') }}
          </el-button>
        </el-space>
        <p class="hint">{{ t('detail.tokenRevokeHint') }}</p>
      </el-tab-pane>

      <!-- Sync logs -->
      <el-tab-pane :label="t('detail.syncLogs')" name="sync">
        <el-table :data="syncLogs" v-loading="logsLoading" style="width: 100%">
          <el-table-column prop="repo_name" :label="t('detail.logRepo')" width="130" show-overflow-tooltip />
          <el-table-column prop="from_sha" :label="t('detail.logFrom')" width="120" show-overflow-tooltip />
          <el-table-column prop="to_sha" :label="t('detail.logTo')" width="120" show-overflow-tooltip />
          <el-table-column prop="changed_files" :label="t('detail.logChangedFiles')" width="100" />
          <el-table-column :label="t('detail.logAffected')" min-width="160">
            <template #default="{ row }">
              <template v-if="row.affected_modules?.length">
                <el-tag v-for="m in row.affected_modules" :key="m" size="small" class="tag-gap">{{ m }}</el-tag>
              </template>
              <span v-else>{{ t('common.none') }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('detail.logStatus')" width="90">
            <template #default="{ row }">
              <el-tag :type="row.status === 'success' ? 'success' : 'danger'" effect="light">
                {{ row.status === 'success' ? t('detail.statusSuccess') : t('detail.statusFailed') }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="t('detail.logDuration')" width="100">
            <template #default="{ row }">{{ row.duration_ms }} ms</template>
          </el-table-column>
          <el-table-column :label="t('detail.logTime')" width="170">
            <template #default="{ row }">{{ formatDate(row.synced_at) }}</template>
          </el-table-column>
          <template #empty>
            <el-empty :description="t('detail.syncEmpty')" :image-size="72" />
          </template>
        </el-table>
      </el-tab-pane>

      <!-- Wiki nodes -->
      <el-tab-pane :label="t('detail.wikiNodes')" name="wiki">
        <p class="hint">
          {{ t('detail.wikiDocCount', { count: wikiDocCount }) }} ·
          {{ t('detail.wikiCodeCount', { count: wikiCodeCount }) }}
        </p>
        <el-table :data="wikiNodes" v-loading="wikiLoading" style="width: 100%">
          <el-table-column :label="t('detail.wikiPlane')" width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="row.plane === 'doc' ? 'success' : 'warning'" effect="light">
                {{ row.plane }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="t('detail.wikiPath')" min-width="260">
            <template #default="{ row }">
              <el-link type="primary" :underline="false" :href="wikiUrl(row.path)" target="_blank">
                <el-icon><TopRight /></el-icon>
                {{ row.path }}
              </el-link>
            </template>
          </el-table-column>
          <el-table-column prop="node_id" :label="t('detail.wikiNodeId')" min-width="160" show-overflow-tooltip />
          <el-table-column prop="bundle_id" :label="t('detail.wikiBundleId')" width="180" show-overflow-tooltip />
          <template #empty>
            <el-empty :description="t('detail.wikiEmpty')" :image-size="72" />
          </template>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- Issue token dialog -->
    <el-dialog v-model="tokenDialogVisible" :title="t('detail.issueToken')" width="480px" :close-on-click-modal="false" top="8vh">
      <el-form label-position="top">
        <el-form-item :label="t('detail.tokenScopes')">
          <el-checkbox-group v-model="tokenScopes">
            <el-checkbox value="read_config">{{ t('detail.scopeReadConfig') }}</el-checkbox>
            <el-checkbox value="write_status">{{ t('detail.scopeWriteStatus') }}</el-checkbox>
            <el-checkbox value="trigger_sync">{{ t('detail.scopeTriggerSync') }}</el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item :label="t('detail.tokenExpiry')">
          <el-input-number v-model="tokenExpiry" :min="0" />
          <span class="hint" style="margin-left: 8px">{{ t('detail.tokenNeverExpires') }} = 0</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="tokenDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="issuing" @click="handleIssueToken">{{ t('detail.issueToken') }}</el-button>
      </template>
    </el-dialog>

    <!-- Token result dialog: 明文仅此展示一次 -->
    <el-dialog
      v-model="tokenResultVisible"
      :title="t('detail.tokenIssued')"
      width="560px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
      align-center
    >
      <el-alert :title="t('detail.tokenWarning')" type="warning" show-icon :closable="false" class="alert-gap" />
      <div class="issued-token">
        <el-input :model-value="issuedToken?.token" readonly type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" resize="none" />
        <el-button type="primary" :icon="CopyDocument" @click="copyText(issuedToken?.token || '')">
          {{ t('common.copy') }}
        </el-button>
      </div>
      <template #footer>
        <el-button type="primary" @click="acknowledgeToken">{{ t('detail.tokenAck') }}</el-button>
      </template>
    </el-dialog>

    <!-- Revoke token dialog -->
    <el-dialog v-model="revokeDialogVisible" :title="t('detail.revokeTokenTitle')" width="480px" :close-on-click-modal="false" top="8vh">
      <el-input v-model="revokeTokenValue" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" :placeholder="t('detail.tokenPlaceholder')" />
      <template #footer>
        <el-button @click="revokeDialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="danger" :loading="revoking" @click="handleRevokeToken">{{ t('detail.revokeToken') }}</el-button>
      </template>
    </el-dialog>

    <!-- Mappings dialog -->
    <el-dialog v-model="mappingsVisible" :title="t('detail.repoMappings')" width="640px" :close-on-click-modal="false" top="8vh">
      <el-table :data="mappingRows" size="small" max-height="420" style="width: 100%">
        <el-table-column prop="path" :label="t('detail.mappingPath')" min-width="300" show-overflow-tooltip />
        <el-table-column prop="module" :label="t('detail.mappingModule')" min-width="140" />
        <template #empty>
          <el-empty :description="t('common.empty')" :image-size="72" />
        </template>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElNotification } from 'element-plus'
import { ArrowLeft, Refresh as RefreshIcon, Plus as AddIcon, TopRight, CopyDocument } from '@element-plus/icons-vue'
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

// 响应式描述列表列数
const descColumn = computed(() => (isMobile.value ? 1 : 2))

// 统一错误提示：优先展示后端 message，右上角通知不打断操作
function showError(e: any, fallback: string) {
  ElNotification.error({
    title: t('common.error'),
    message: e?.response?.data?.error || e?.message || fallback,
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
    ElMessage.success(t('common.copied'))
  } catch {
    ElMessage.error(t('common.error'))
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
    ElMessage.warning(t('detail.tokenScopes'))
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
    ElMessage.warning(t('detail.tokenPlaceholder'))
    return
  }
  revoking.value = true
  try {
    await revokeToken(projectId.value, token)
    ElMessage.success(t('detail.revoked'))
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

.page-head h2 {
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

.alert-gap {
  margin-top: 16px;
}

.issued-token {
  display: flex;
  align-items: flex-start;
  gap: var(--cim-space-md);
  margin-top: var(--cim-space-md);
}

.issued-token :deep(.el-textarea),
.issued-token :deep(.el-input) {
  flex: 1;
}

.issued-token .el-button {
  flex-shrink: 0;
}

.hint {
  margin-top: 12px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.err-text {
  color: var(--el-color-danger);
}
</style>
