<template>
  <div class="dashboard">
    <PageHeader
      :title="t('dashboard.title')"
      :subtitle="t('dashboard.subtitle')"
    />

    <div class="stats-grid">
      <template v-if="loading">
        <div class="stat-card" v-for="n in 6" :key="'sk-' + n">
          <t-skeleton
            theme="avatar"
            :row-col="[[{ type: 'avatar' }, { width: '70%' }]]"
            animation="gradient"
          />
        </div>
      </template>
      <template v-else>
        <div class="stat-card" v-for="s in stats" :key="s.key">
          <div class="stat-icon" :class="s.tone">
            <component :is="s.icon" />
          </div>
          <div class="stat-info">
            <div class="stat-value">{{ s.value }}</div>
            <div class="stat-label">{{ s.label }}</div>
          </div>
        </div>
      </template>
    </div>

    <t-card
      :title="t('dashboard.recentProjects')"
      :header-bordered="false"
      class="section-card"
    >
      <template #actions>
        <t-link theme="primary" hover="color" @click="router.push('/projects')">
          {{ t('dashboard.goProjects') }}
        </t-link>
      </template>
      <t-table
        :data="recentProjects"
        :columns="columns"
        :loading="loading"
        row-key="id"
        stripe
        hover
        size="medium"
      >
        <template #name="{ row }">
          <t-link
            theme="primary"
            hover="color"
            @click="router.push(`/projects/${row.id}`)"
          >
            {{ row.name || row.id }}
          </t-link>
        </template>
        <template #updated_at="{ row }">{{
          formatDate(row.updated_at)
        }}</template>
        <template #empty>
          <t-empty :description="t('project.emptyTitle')" />
        </template>
      </t-table>
    </t-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import {
  FolderIcon,
  FileIcon,
  ServerIcon,
  ViewListIcon,
  BrowseIcon,
  CodeIcon,
} from 'tdesign-icons-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import { listProjects, getProject } from '@/api/projects'
import type { ProjectSummary } from '@/api/types'

const router = useRouter()
const { t, locale } = useI18n()

const loading = ref(false)
const projects = ref<ProjectSummary[]>([])
const totals = ref({ docs: 0, repos: 0, modules: 0, wikiDoc: 0, wikiCode: 0 })

const stats = computed(() => [
  {
    key: 'projects',
    label: t('dashboard.projectCount'),
    value: projects.value.length,
    icon: FolderIcon,
    tone: 'tone-brand',
  },
  {
    key: 'docs',
    label: t('dashboard.docCount'),
    value: totals.value.docs,
    icon: FileIcon,
    tone: 'tone-success',
  },
  {
    key: 'repos',
    label: t('dashboard.repoCount'),
    value: totals.value.repos,
    icon: ServerIcon,
    tone: 'tone-warning',
  },
  {
    key: 'modules',
    label: t('dashboard.moduleCount'),
    value: totals.value.modules,
    icon: ViewListIcon,
    tone: 'tone-brand',
  },
  {
    key: 'wikiDoc',
    label: t('dashboard.wikiDocNodes'),
    value: totals.value.wikiDoc,
    icon: BrowseIcon,
    tone: 'tone-info',
  },
  {
    key: 'wikiCode',
    label: t('dashboard.wikiCodeNodes'),
    value: totals.value.wikiCode,
    icon: CodeIcon,
    tone: 'tone-info',
  },
])

const recentProjects = computed(() => projects.value.slice(0, 8))

const columns = computed(() => [
  { colKey: 'id', title: () => t('project.id'), width: 180, ellipsis: true },
  { colKey: 'name', title: () => t('project.name'), width: 180, cell: 'name' },
  {
    colKey: 'product',
    title: () => t('project.product'),
    width: 160,
    ellipsis: true,
  },
  { colKey: 'version', title: () => t('project.version'), width: 120 },
  {
    colKey: 'updated_at',
    title: () => t('project.updatedAt'),
    width: 180,
    cell: 'updated_at',
  },
])

function formatDate(s: string) {
  if (!s) return '-'
  return new Date(s).toLocaleString(
    locale.value === 'zh-CN' ? 'zh-CN' : 'en-US',
  )
}

function aggregateProjects(
  details: Array<Awaited<ReturnType<typeof getProject>> | null>,
) {
  const agg = { docs: 0, repos: 0, modules: 0, wikiDoc: 0, wikiCode: 0 }
  for (const d of details) {
    if (!d) continue
    agg.docs += d.docs?.length || 0
    agg.repos += d.repos?.length || 0
    agg.modules += d.modules?.length || 0
    agg.wikiDoc += d.wiki_nodes?.doc?.length || 0
    agg.wikiCode += d.wiki_nodes?.code?.length || 0
  }
  return agg
}

async function load() {
  loading.value = true
  try {
    projects.value = await listProjects()
    const details = await Promise.all(
      projects.value.map((p) => getProject(p.id).catch(() => null)),
    )
    const agg = aggregateProjects(details)
    totals.value = agg
  } catch (e: any) {
    MessagePlugin.error(e.response?.data?.error || t('dashboard.loadError'))
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: var(--cim-space-lg);
  max-width: 1200px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 16px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: var(--cim-space-md);
  padding: 18px;
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
}

.stat-icon {
  width: 44px;
  height: 44px;
  border-radius: var(--td-radius-medium);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  flex-shrink: 0;
}

.tone-brand {
  background: var(--td-brand-color-light);
  color: var(--td-brand-color);
}
.tone-success {
  background: var(--td-success-color-light);
  color: var(--td-success-color);
}
.tone-warning {
  background: var(--td-warning-color-light);
  color: var(--td-warning-color);
}
.tone-info {
  background: var(--td-bg-color-secondarycontainer);
  color: var(--td-text-color-secondary);
}

.stat-info {
  min-width: 0;
}

.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--td-text-color-primary);
  line-height: 1.1;
}

.stat-label {
  margin-top: var(--cim-space-xs);
  font-size: 13px;
  color: var(--td-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 1200px) {
  .stats-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (max-width: 767px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
