<template>
  <div class="project-management">
    <PageHeader :title="t('project.title')">
      <template #actions>
        <el-button :icon="RefreshIcon" @click="load">{{ t('common.refresh') }}</el-button>
        <el-button type="primary" :icon="AddIcon" @click="openCreate">{{ t('project.create') }}</el-button>
      </template>
    </PageHeader>

    <el-card shadow="never">
      <div class="toolbar">
        <el-input
          v-model="searchQuery"
          :placeholder="t('project.search')"
          clearable
          class="search-input"
          :prefix-icon="SearchIcon"
        />
      </div>

      <el-skeleton v-if="loading && !projects.length" :rows="6" animated />
      <template v-else>
        <el-table :data="paged" v-loading="loading" style="width: 100%">
          <el-table-column prop="id" :label="t('project.id')" min-width="160" show-overflow-tooltip />
          <el-table-column :label="t('project.name')" min-width="160">
            <template #default="{ row }">
              <el-link type="primary" :underline="false" @click="router.push(`/projects/${row.id}`)">
                {{ row.name || row.id }}
              </el-link>
            </template>
          </el-table-column>
          <el-table-column v-if="!isMobile" prop="product" :label="t('project.product')" min-width="140" show-overflow-tooltip />
          <el-table-column v-if="!isMobile" prop="version" :label="t('project.version')" width="120" />
          <el-table-column v-if="!isMobile" :label="t('project.createdAt')" min-width="180">
            <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
          </el-table-column>
          <el-table-column :label="t('common.actions')" :width="isMobile ? 90 : 150" fixed="right">
            <template #default="{ row }">
              <el-button type="primary" link @click="openEdit(row)">{{ t('common.edit') }}</el-button>
              <el-dropdown trigger="click" @command="(cmd: string) => onRowCommand(cmd, row)">
                <el-button link type="info" class="row-more">
                  <el-icon><MoreFilled /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="view" :icon="ViewIcon">
                      {{ t('project.detail') }}
                    </el-dropdown-item>
                    <el-dropdown-item command="delete" :icon="DeleteIcon" divided style="color: var(--el-color-danger)">
                      {{ t('common.delete') }}
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty :description="t('project.emptyTitle')" :image-size="80">
              <el-button type="primary" :icon="AddIcon" @click="openCreate">{{ t('project.create') }}</el-button>
            </el-empty>
          </template>
        </el-table>

        <el-pagination
          v-if="filtered.length > pageSize"
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50]"
          :total="filtered.length"
          :layout="isMobile ? 'prev, pager, next' : 'total, sizes, prev, pager, next'"
          class="pagination"
        />
      </template>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? t('project.edit') : t('project.create')"
      width="480px"
      :close-on-click-modal="false"
      top="8vh"
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="90px"
        label-position="top"
        scroll-to-error
      >
        <el-form-item :label="t('project.id')" prop="id">
          <el-input
            v-model="form.id"
            :disabled="isEdit"
            :placeholder="t('project.idPlaceholder')"
            @input="onIdInput"
          />
        </el-form-item>
        <el-form-item :label="t('project.name')" prop="name">
          <el-input v-model="form.name" :placeholder="t('project.namePlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('project.product')" prop="product">
          <el-input v-model="form.product" placeholder="Semiconductor-MES" />
        </el-form-item>
        <el-form-item :label="t('project.version')" prop="version">
          <el-input v-model="form.version" placeholder="V2.26.3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">{{ t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import {
  Search as SearchIcon,
  Refresh as RefreshIcon,
  Plus as AddIcon,
  MoreFilled,
  Delete as DeleteIcon,
  View as ViewIcon,
} from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { listProjects, getProject, upsertProject, deleteProject } from '@/api/projects'
import type { ProjectSummary, ProjectConfig } from '@/api/types'

const router = useRouter()
const { t, locale } = useI18n()
const { isMobile } = useBreakpoint()

const loading = ref(false)
const projects = ref<ProjectSummary[]>([])
const searchQuery = ref('')

const page = ref(1)
const pageSize = ref(10)

const dialogVisible = ref(false)
const isEdit = ref(false)
const saving = ref(false)
const formRef = ref<FormInstance>()
const editingFull = ref<ProjectConfig | null>(null)

const form = ref({ id: '', name: '', product: '', version: '' })

const rules = computed<FormRules>(() => ({
  id: [
    { required: true, message: t('project.idRequired'), trigger: 'blur' },
    { pattern: /^[a-z0-9-]+$/, message: t('project.idPattern'), trigger: ['blur', 'change'] },
  ],
}))

const filtered = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return projects.value
  return projects.value.filter(
    (p) => p.id.toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q),
  )
})

const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

watch(searchQuery, () => (page.value = 1))

function onIdInput(value: string) {
  // 实时清洗为大写敏感场景之外的合法 ID 字符，避免提交时才报格式错
  const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (cleaned !== value) form.value.id = cleaned
}

function onRowCommand(cmd: string, row: ProjectSummary) {
  if (cmd === 'view') router.push(`/projects/${row.id}`)
  else if (cmd === 'delete') confirmDelete(row)
}

function formatDate(s: string) {
  if (!s) return '-'
  return new Date(s).toLocaleString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US')
}

async function load() {
  loading.value = true
  try {
    projects.value = await listProjects()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || t('common.error'))
  } finally {
    loading.value = false
  }
}

function openCreate() {
  isEdit.value = false
  editingFull.value = null
  form.value = { id: '', name: '', product: 'Semiconductor-MES', version: '' }
  dialogVisible.value = true
  formRef.value?.clearValidate()
}

async function openEdit(row: ProjectSummary) {
  isEdit.value = true
  form.value = { id: row.id, name: row.name, product: row.product, version: row.version }
  dialogVisible.value = true
  formRef.value?.clearValidate()
  try {
    editingFull.value = await getProject(row.id)
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || t('common.error'))
  }
}

async function handleSave() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    const base: ProjectConfig =
      editingFull.value ||
      ({
        docs: [],
        repos: [],
        modules: [],
        wiki_nodes: { doc: [], code: [] },
        sync_state: {
          last_doc_sync: '',
          last_code_sync: '',
          pending_changes: [],
          last_error: '',
        },
      } as unknown as ProjectConfig)

    const payload: ProjectConfig = {
      ...base,
      id: form.value.id,
      name: form.value.name,
      product: form.value.product,
      version: form.value.version,
    }
    await upsertProject(payload)
    ElMessage.success(t('project.saved'))
    dialogVisible.value = false
    await load()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || t('common.error'))
  } finally {
    saving.value = false
  }
}

function confirmDelete(row: ProjectSummary) {
  ElMessageBox.confirm(
    t('project.confirmDeleteMsg', { name: row.name || row.id }),
    t('project.confirmDeleteTitle'),
    {
      type: 'warning',
      confirmButtonText: t('common.confirm'),
      cancelButtonText: t('common.cancel'),
      confirmButtonClass: 'el-button--danger',
    },
  )
    .then(async () => {
      try {
        await deleteProject(row.id)
        ElMessage.success(t('project.deleted'))
        await load()
      } catch (e: any) {
        ElMessage.error(e.response?.data?.error || t('common.error'))
      }
    })
    .catch(() => {})
}

onMounted(load)
</script>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--cim-space-md);
  flex-wrap: wrap;
  margin-bottom: var(--cim-space-lg);
}

.search-input {
  max-width: 320px;
  flex: 1;
}

.row-more {
  margin-left: var(--cim-space-sm);
  vertical-align: middle;
}

.pagination {
  margin-top: var(--cim-space-lg);
  justify-content: flex-end;
}

@media (max-width: 767px) {
  .pagination {
    justify-content: center;
  }
}
</style>
