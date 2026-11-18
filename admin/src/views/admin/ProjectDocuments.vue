<template>
  <section class="documents-page">
    <PageHeader
      :title="mode === 'directories' ? '文档目录与评分' : '文档结果'"
      :subtitle="
        mode === 'directories'
          ? '维护项目目录，按目录设置并继承文档质量标准。'
          : '按目录浏览归类文档，检索来源并跟踪审核进度。'
      "
    >
      <template #actions>
        <label class="project-picker"
          >当前项目
          <select
            :value="projectId"
            :disabled="!loaded || !projects.length"
            aria-label="选择项目"
            @change="selectProject(($event.target as HTMLSelectElement).value)"
          >
            <option v-if="!projects.length" value="">
              {{ loaded ? '暂无项目' : '加载项目中…' }}
            </option>
            <option
              v-for="project in projects"
              :key="project.id"
              :value="project.id"
            >
              {{ project.name }}
            </option>
          </select>
        </label>
      </template>
    </PageHeader>
    <p v-if="error" role="alert" class="project-error">{{ error }}</p>
    <DirectoryWorkspace
      v-if="projectId && mode === 'directories'"
      ref="workspaceRef"
      :key="projectId"
      :project-id="projectId"
    />
    <DocumentQualityPanel
      v-else-if="projectId"
      :key="projectId + mode"
      :project-id="projectId"
      :mode="mode"
    />
    <div v-else class="project-empty">
      <h3>{{ loaded ? '暂无可用项目' : '正在加载项目' }}</h3>
      <p v-if="loaded">暂无项目，请先在项目管理中创建项目。</p>
      <router-link v-if="loaded" to="/projects">前往项目管理</router-link>
    </div>
  </section>
</template>
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { listProjects } from '@/api/projects'
import type { ProjectSummary } from '@/api/types'
import DocumentQualityPanel from '@/components/DocumentQualityPanel.vue'
import DirectoryWorkspace from '@/components/DirectoryWorkspace.vue'
import PageHeader from '@/components/PageHeader.vue'
defineProps<{ mode: 'directories' | 'results' }>()
const route = useRoute(),
  router = useRouter()
const projects = ref<ProjectSummary[]>([]),
  projectId = ref(''),
  error = ref(''),
  loaded = ref(false)
const workspaceRef = ref<InstanceType<typeof DirectoryWorkspace> | null>(null)
function selectProject(id: string) {
  if (workspaceRef.value && !workspaceRef.value.canLeave()) {
    const select = document.querySelector<HTMLSelectElement>(
      '[aria-label="选择项目"]',
    )
    if (select) select.value = projectId.value
    return
  }
  projectId.value = id
  void router.replace({ query: { project: id } })
}
watch(
  () => route.query.project,
  (value) => {
    const id = String(value || '')
    if (id === projectId.value) return
    if (workspaceRef.value && !workspaceRef.value.canLeave()) {
      void router.replace({ query: { project: projectId.value } })
      return
    }
    if (projects.value.some((project) => project.id === id))
      projectId.value = id
  },
)
onMounted(async () => {
  try {
    projects.value = await listProjects()
    const requested = String(route.query.project || '')
    if (projects.value.some((project) => project.id === requested))
      projectId.value = requested
    else if (projects.value[0]) selectProject(projects.value[0].id)
  } catch {
    error.value = '项目加载失败，请刷新重试。'
  } finally {
    loaded.value = true
  }
})
</script>
<style scoped>
.documents-page {
  color: var(--td-text-color-primary);
  font: 14px/1.6 var(--app-font-family);
}
.project-picker {
  display: flex;
  gap: 10px;
  align-items: center;
  color: var(--td-text-color-secondary);
  font-size: 13px;
}
.project-picker select {
  width: 280px;
  height: 36px;
  padding: 0 32px 0 12px;
  border: 1px solid var(--td-component-stroke);
  border-radius: 6px;
  background: var(--td-bg-color-container);
  color: var(--td-text-color-primary);
  font: inherit;
}
.project-picker select:focus-visible {
  outline: 2px solid var(--td-brand-color);
  outline-offset: 2px;
}
.project-empty {
  text-align: center;
  padding: 72px 20px;
  border-radius: 8px;
  background: var(--td-bg-color-container);
  color: var(--td-text-color-secondary);
}
.project-empty h3 {
  font-size: 16px;
  color: var(--td-text-color-primary);
}
.project-error {
  padding: 12px 16px;
  background: var(--td-error-color-light);
  color: var(--td-error-color);
  border-radius: 6px;
}
@media (max-width: 767px) {
  .project-picker {
    width: 100%;
  }
  .project-picker select {
    flex: 1;
    min-width: 0;
    width: auto;
  }
}
</style>
