<template>
  <div class="project-management">
    <PageHeader :title="t('project.title')">
      <template #actions>
        <t-button variant="outline" @click="load">
          <template #icon><RefreshIcon /></template>{{ t('common.refresh') }}
        </t-button>
        <t-button theme="primary" @click="openCreate">
          <template #icon><AddIcon /></template>{{ t('project.create') }}
        </t-button>
      </template>
    </PageHeader>

    <t-card :bordered="false">
      <div class="toolbar">
        <t-input
          v-model="searchQuery"
          :placeholder="t('project.search')"
          clearable
          class="search-input"
          @clear="page = 1"
        >
          <template #prefix-icon><SearchIcon /></template>
        </t-input>
      </div>

      <t-table
        :data="paged"
        :columns="columns"
        :loading="loading"
        row-key="id"
        stripe
        hover
        size="medium"
      >
        <template #name="{ row }">
          <t-link theme="primary" hover="color" @click="router.push(`/projects/${row.id}`)">
            {{ row.name || row.id }}
          </t-link>
        </template>
        <template #created_at="{ row }">{{ formatDate(row.created_at) }}</template>
        <template #operation="{ row }">
          <t-space break-line size="small">
            <t-link theme="primary" hover="color" @click="openEdit(row)">{{ t('common.edit') }}</t-link>
            <t-dropdown trigger="click">
              <t-link theme="default" hover="color">
                {{ t('common.actions') }}<ChevronDownIcon class="dd-caret" />
              </t-link>
              <template #dropdown>
                <t-dropdown-menu>
                  <t-dropdown-item @click="router.push(`/projects/${row.id}`)">{{ t('project.detail') }}</t-dropdown-item>
                  <t-dropdown-item divider @click="confirmDelete(row)">
                    <span class="danger-text">{{ t('common.delete') }}</span>
                  </t-dropdown-item>
                </t-dropdown-menu>
              </template>
            </t-dropdown>
          </t-space>
        </template>
        <template #empty>
          <t-empty :description="t('project.emptyTitle')">
            <t-button theme="primary" variant="base" @click="openCreate">{{ t('project.create') }}</t-button>
          </t-empty>
        </template>
      </t-table>

      <div v-if="filtered.length > pageSize" class="pagination">
        <t-pagination
          v-model="page"
          :total="filtered.length"
          :page-size="pageSize"
          :page-size-options="[10, 20, 50]"
          :show-page-size="!isMobile"
          @page-size-change="(v: number) => { pageSize = v; page = 1 }"
        />
      </div>
    </t-card>

    <t-dialog
      v-model:visible="dialogVisible"
      :header="isEdit ? t('project.edit') : t('project.create')"
      width="480px"
      :close-on-overlay-click="false"
      :confirm-btn="{ content: t('common.save'), loading: saving }"
      @confirm="handleSave"
    >
      <t-form ref="formRef" :data="form" :rules="rules" label-align="top">
        <t-form-item :label="t('project.id')" name="id">
          <t-input v-model="form.id" :disabled="isEdit" :placeholder="t('project.idPlaceholder')" @change="onIdInput" />
        </t-form-item>
        <t-form-item :label="t('project.name')" name="name">
          <t-input v-model="form.name" :placeholder="t('project.namePlaceholder')" />
        </t-form-item>
        <t-form-item :label="t('project.product')" name="product">
          <t-input v-model="form.product" placeholder="Semiconductor-MES" />
        </t-form-item>
        <t-form-item :label="t('project.version')" name="version">
          <t-input v-model="form.version" placeholder="V2.26.3" />
        </t-form-item>
      </t-form>
    </t-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MessagePlugin, DialogPlugin } from 'tdesign-vue-next'
import type { FormInstanceFunctions, FormRules } from 'tdesign-vue-next'
import {
  SearchIcon,
  RefreshIcon,
  AddIcon,
  ChevronDownIcon,
} from 'tdesign-icons-vue-next'
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
const formRef = ref<FormInstanceFunctions>()
const editingFull = ref<ProjectConfig | null>(null)

const form = ref({ id: '', name: '', product: '', version: '' })

const rules = computed<FormRules>(() => ({
  id: [
    { required: true, message: t('project.idRequired'), trigger: 'blur' },
    { pattern: /^[a-z0-9-]+$/, message: t('project.idPattern'), trigger: 'blur' },
  ],
}))

const columns = computed(() => {
  const base: any[] = [
    { colKey: 'id', title: () => t('project.id'), width: 180, ellipsis: true },
    { colKey: 'name', title: () => t('project.name'), width: 180, cell: 'name' },
    { colKey: 'product', title: () => t('project.product'), width: 150, ellipsis: true },
    { colKey: 'version', title: () => t('project.version'), width: 120 },
    { colKey: 'created_at', title: () => t('project.createdAt'), width: 180, cell: 'created_at' },
    { colKey: 'operation', title: () => t('common.actions'), width: isMobile.value ? 150 : 160, fixed: 'right', cell: 'operation' },
  ]
  if (isMobile.value) return base.filter((c) => !['product', 'version', 'created_at'].includes(c.colKey))
  return base
})

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

function onIdInput(value: string) {
  const cleaned = (value || '').toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (cleaned !== value) form.value.id = cleaned
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
    MessagePlugin.error(e.response?.data?.error || t('common.error'))
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
    MessagePlugin.error(e.response?.data?.error || t('common.error'))
  }
}

async function handleSave() {
  const valid = await formRef.value?.validate()
  if (valid !== true) return

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
    MessagePlugin.success(t('project.saved'))
    dialogVisible.value = false
    await load()
  } catch (e: any) {
    MessagePlugin.error(e.response?.data?.error || t('common.error'))
  } finally {
    saving.value = false
  }
}

function confirmDelete(row: ProjectSummary) {
  const dialog = DialogPlugin.confirm({
    header: t('project.confirmDeleteTitle'),
    body: t('project.confirmDeleteMsg', { name: row.name || row.id }),
    theme: 'danger',
    confirmBtn: t('common.confirm'),
    cancelBtn: t('common.cancel'),
    onConfirm: async () => {
      try {
        await deleteProject(row.id)
        MessagePlugin.success(t('project.deleted'))
        dialog.destroy()
        await load()
      } catch (e: any) {
        MessagePlugin.error(e.response?.data?.error || t('common.error'))
        dialog.destroy()
      }
    },
  })
}

onMounted(load)
</script>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--cim-space-lg);
}

.search-input {
  max-width: 320px;
  width: 100%;
}

.dd-caret {
  margin-left: 2px;
  font-size: 14px;
}

.danger-text {
  color: var(--td-error-color);
}

.pagination {
  margin-top: var(--cim-space-lg);
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 767px) {
  .pagination {
    justify-content: center;
  }
}
</style>
