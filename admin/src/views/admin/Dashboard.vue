<template>
  <div class="dashboard">
    <PageHeader :title="t('dashboard.title')" :subtitle="t('dashboard.subtitle')" />

    <el-row :gutter="16" class="stat-row">
      <el-col v-for="s in stats" :key="s.key" :xs="12" :sm="8" :md="8" :lg="4">
        <el-card shadow="hover" class="stat-card">
          <el-skeleton :loading="loading" animated :rows="0">
            <template #default>
              <div class="stat-body">
                <el-icon class="stat-icon" :style="{ color: s.color }"><component :is="s.icon" /></el-icon>
                <div class="stat-text">
                  <div class="stat-value">{{ s.value }}</div>
                  <div class="stat-label">{{ s.label }}</div>
                </div>
              </div>
            </template>
          </el-skeleton>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="section">
      <template #header>
        <div class="section-head">
          <span>{{ t('dashboard.recentProjects') }}</span>
          <el-button type="primary" link @click="router.push('/projects')">
            {{ t('dashboard.goProjects') }}
          </el-button>
        </div>
      </template>
      <el-skeleton v-if="loading" :rows="4" animated />
      <el-table v-else :data="recentProjects" style="width: 100%">
        <el-table-column prop="id" :label="t('project.id')" min-width="160" show-overflow-tooltip />
        <el-table-column :label="t('project.name')" min-width="160">
          <template #default="{ row }">
            <el-link type="primary" :underline="false" @click="router.push(`/projects/${row.id}`)">
              {{ row.name || row.id }}
            </el-link>
          </template>
        </el-table-column>
        <el-table-column prop="product" :label="t('project.product')" min-width="140" show-overflow-tooltip />
        <el-table-column prop="version" :label="t('project.version')" width="120" />
        <el-table-column :label="t('project.updatedAt')" min-width="180">
          <template #default="{ row }">{{ formatDate(row.updated_at) }}</template>
        </el-table-column>
        <template #empty>
          <el-empty :description="t('project.emptyTitle')" :image-size="80" />
        </template>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { Folder, Document, Files, Grid, Reading, Cpu } from '@element-plus/icons-vue'
import PageHeader from '@/components/PageHeader.vue'
import { listProjects, getProject } from '@/api/projects'
import type { ProjectSummary } from '@/api/types'

const router = useRouter()
const { t, locale } = useI18n()

const loading = ref(false)
const projects = ref<ProjectSummary[]>([])
const totals = ref({ docs: 0, repos: 0, modules: 0, wikiDoc: 0, wikiCode: 0 })

const stats = computed(() => [
  { key: 'projects', label: t('dashboard.projectCount'), value: projects.value.length, icon: Folder, color: 'var(--el-color-primary)' },
  { key: 'docs', label: t('dashboard.docCount'), value: totals.value.docs, icon: Document, color: 'var(--el-color-success)' },
  { key: 'repos', label: t('dashboard.repoCount'), value: totals.value.repos, icon: Files, color: 'var(--el-color-warning)' },
  { key: 'modules', label: t('dashboard.moduleCount'), value: totals.value.modules, icon: Grid, color: 'var(--el-color-primary)' },
  { key: 'wikiDoc', label: t('dashboard.wikiDocNodes'), value: totals.value.wikiDoc, icon: Reading, color: 'var(--el-color-info)' },
  { key: 'wikiCode', label: t('dashboard.wikiCodeNodes'), value: totals.value.wikiCode, icon: Cpu, color: 'var(--el-color-info)' },
])

const recentProjects = computed(() => projects.value.slice(0, 8))

function formatDate(s: string) {
  if (!s) return '-'
  return new Date(s).toLocaleString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US')
}

async function load() {
  loading.value = true
  try {
    projects.value = await listProjects()
    const details = await Promise.all(
      projects.value.map((p) => getProject(p.id).catch(() => null)),
    )
    const agg = { docs: 0, repos: 0, modules: 0, wikiDoc: 0, wikiCode: 0 }
    for (const d of details) {
      if (!d) continue
      agg.docs += d.docs?.length || 0
      agg.repos += d.repos?.length || 0
      agg.modules += d.modules?.length || 0
      agg.wikiDoc += d.wiki_nodes?.doc?.length || 0
      agg.wikiCode += d.wiki_nodes?.code?.length || 0
    }
    totals.value = agg
  } catch (e: any) {
    ElMessage.error(e.response?.data?.error || t('dashboard.loadError'))
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.stat-row {
  margin-bottom: var(--cim-space-lg);
}

.stat-card {
  margin-bottom: var(--cim-space-lg);
}

.stat-body {
  display: flex;
  align-items: center;
  gap: var(--cim-space-md);
}

.stat-icon {
  font-size: 28px;
  flex-shrink: 0;
}

.stat-text {
  min-width: 0;
}

.stat-value {
  font-size: 26px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  line-height: 1.1;
}

.stat-label {
  margin-top: var(--cim-space-xs);
  font-size: 13px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
