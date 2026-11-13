<template>
  <section class="template-settings">
    <h1>全局项目文档模板定义</h1>
    <p>
      维护系统文档模板、契约、默认目录与术语。保存草稿后检查并发布，新项目采用已发布版本。
    </p>
    <t-alert v-if="error" theme="error" :message="error" />
    <div class="toolbar">
      <span
        >当前版本：{{ state?.published_version || '尚未发布' }} · 修订
        {{ state?.revision ?? 0 }}</span
      >
      <t-button variant="outline" :loading="busy" @click="load">刷新</t-button>
      <t-button variant="outline" :loading="busy" @click="save"
        >保存草稿</t-button
      >
      <t-button variant="outline" :loading="busy" @click="checkDefinition"
        >检查模板契约</t-button
      >
      <t-button :loading="busy" @click="publish">发布规则版本</t-button>
    </div>
    <t-tabs v-if="definition" v-model="tab">
      <t-tab-panel value="templates" label="文档模板与契约">
        <label>文档类型</label>
        <t-select v-model="selected" class="template-select">
          <t-option
            v-for="item in definition.templates"
            :key="item.id"
            :value="item.id"
            :label="item.name + (item.usage === 'supplementary' ? '（可选补充）' : '')"
          />
        </t-select>
        <p v-if="template?.usage === 'supplementary'" class="supplementary-note">
          <template v-if="template.id === 'idd'">
            可选补充文档：按需描述最上层后端 API／Tx 入口的处理顺序；已有 Rule Spec 和接口契约通过链接引用。
          </template>
          <template v-else>
            可选补充文档：按实际需要使用，已有需求、设计及代码契约通过链接引用；是否交付以项目交付契约为准。
          </template>
        </p>
        <div class="toolbar">
          <t-input
            v-model="newTemplateId"
            placeholder="新模板标识，如 module-guide"
          />
          <t-input v-model="newTemplateName" placeholder="新模板名称" />
          <t-button variant="outline" @click="duplicateTemplate"
            >复制当前模板</t-button
          >
          <t-button variant="text" @click="removeTemplate"
            >移除当前模板</t-button
          >
        </div>
        <label v-if="template"
          >模板名称<t-input v-model="template.name"
        /></label>
        <div v-if="template" class="editor-grid">
          <label
            >正文骨架<textarea v-model="template.body" spellcheck="false" />
          </label>
          <label
            >契约定义（JSON）<textarea
              v-model="contractText"
              spellcheck="false"
            />
          </label>
          <label
            >合格验证样例<textarea
              v-model="template.example"
              spellcheck="false"
            />
          </label>
          <label
            >违规验证样例<textarea
              v-model="template.invalid_example"
              spellcheck="false"
            />
          </label>
        </div>
      </t-tab-panel>
      <t-tab-panel value="directories" label="默认文档目录">
        <p>路径从 doc/ 与 code/ 开始。创建目录不会覆盖目录评分规则。</p>
        <div
          v-for="(item, index) in definition.directories"
          :key="index"
          class="directory-row"
        >
          <t-input v-model="item.path" placeholder="目录路径" /><t-input
            v-model="item.title"
            placeholder="显示名称"
          /><t-input v-model="item.description" placeholder="用途" /><t-select
            v-model="item.node_types"
            multiple
            :options="nodeTypes"
            placeholder="匹配文档类型"
          />
          <t-button
            variant="text"
            @click="definition!.directories.splice(index, 1)"
            >移除</t-button
          >
        </div>
        <t-button
          variant="outline"
          @click="
            definition.directories.push({
              path: '',
              title: '',
              description: '',
              node_types: [],
            })
          "
          >添加目录</t-button
        >
      </t-tab-panel>
      <t-tab-panel value="terms" label="术语规范">
        <p>术语表固定为英文名称、中文名称、描述、备注四列，按主题分组。</p>
        <div
          v-for="(item, index) in definition.terms"
          :key="index"
          class="directory-row"
        >
          <t-input v-model="item.abbreviation" placeholder="缩写" /><t-input
            v-model="item.english"
            placeholder="英文全称"
          /><t-input v-model="item.chinese" placeholder="中文名称" />
          <t-button variant="text" @click="definition!.terms.splice(index, 1)"
            >移除</t-button
          >
        </div>
        <t-button
          variant="outline"
          @click="
            definition.terms.push({
              abbreviation: '',
              english: '',
              chinese: '',
            })
          "
          >添加术语</t-button
        >
      </t-tab-panel>
      <t-tab-panel value="delivery" label="文档集交付契约">
        <p>按项目或模块定义最低交付数量；新项目初始化时绑定实际项目与模块。</p>
        <div
          v-for="(item, index) in definition.delivery"
          :key="index"
          class="directory-row"
        >
          <t-input v-model="item.id" placeholder="规则标识" /><t-input
            v-model="item.type"
            placeholder="节点类型"
          />
          <t-select v-model="item.scope"
            ><t-option value="project" label="项目" /><t-option
              value="module"
              label="每个模块"
          /></t-select>
          <t-input-number v-model="item.min" :min="0" />
        </div>
      </t-tab-panel>
      <t-tab-panel value="check" label="检查文档">
        <p>
          检查使用上方正在编辑的模板与契约；只有已发布的规则才能用于正式项目。
        </p>
        <t-select v-model="selected"
          ><t-option
            v-for="item in definition.templates"
            :key="item.id"
            :value="item.id"
            :label="item.name"
        /></t-select>
        <textarea
          v-model="documentText"
          placeholder="粘贴待检查的 Markdown 文档"
        />
        <t-button :loading="busy" @click="checkDocument">检查文档</t-button>
      </t-tab-panel>
      <t-tab-panel value="projects" label="项目规则绑定">
        <t-select v-model="projectId" @change="previewProject"
          ><t-option
            v-for="p in projects"
            :key="p.id"
            :value="p.id"
            :label="p.name"
        /></t-select>
        <p>
          已绑定版本：{{ projectPreview?.from_version || '未绑定' }} →
          系统版本：{{ projectPreview?.to_version || '尚未发布' }}
        </p>
        <t-button variant="outline" @click="previewProject">预览差异</t-button>
        <t-button :loading="busy" @click="bindProject"
          >采用系统已发布版本</t-button
        >
        <label
          >项目覆盖（JSON，仅 templates /
          directories；空对象表示继承系统规则）<textarea
            v-model="overrideText"
          />
        </label>
        <ul v-if="projectPreview">
          <li
            v-for="change in projectPreview.changes"
            :key="change.section + change.id"
          >
            {{ change.section }} · {{ change.id }} · {{ change.action }}
          </li>
        </ul>
      </t-tab-panel>
    </t-tabs>
    <div v-if="result">
      <h2>检查结果</h2>
      <p v-if="!result.errors.length">检查通过。</p>
      <ul v-else>
        <li v-for="(item, index) in result.errors" :key="index">
          {{ item.severity }} · {{ item.rule_id }} · {{ item.section || '' }}
          {{ item.line ? `第 ${item.line} 行` : '' }} · {{ item.message }}
        </li>
      </ul>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, ref, toRaw } from 'vue'
import client from '@/api/client'
import { getProject, listProjects } from '@/api/projects'
import type { ProjectSummary } from '@/api/types'

type Contract = {
  format: 'markdown-v1'
  section_groups?: { parent: string; min_groups: number; sections: string[] }[]
  identifiers?: { section: string; column: string }[]
  references?: { section: string; column: string; target_section: string; target_column: string }[]
  fields: string[]
  sections: string[]
  tables: {
    section: string
    columns: string[]
    min_rows: number
    repeat: boolean
    optional_columns?: string[]
  }[]
}
type Template = {
  usage?: 'standard' | 'supplementary'
  id: string
  name: string
  node_type: string
  body: string
  example: string
  invalid_example: string
  contract: Contract
}
type Definition = {
  name: string
  templates: Template[]
  directories: {
    path: string
    title: string
    description: string
    node_types: string[]
  }[]
  terms: { abbreviation: string; english: string; chinese: string }[]
  delivery: { id: string; type: string; scope: string; min: number }[]
}
type Diagnostic = {
  severity: string
  rule_id: string
  message: string
  section?: string
  line?: number
}
type State = {
  revision: number
  published_version: string | null
  draft: Definition
}
const endpoint = '/admin/system/document-templates'
const state = ref<State>(),
  definition = ref<Definition>(),
  selected = ref('glossary'),
  tab = ref('templates'),
  busy = ref(false),
  error = ref(''),
  documentText = ref(''),
  result = ref<{ errors: Diagnostic[] }>(),
  projectId = ref(''),
  overrideText = ref('{}')
const projects = ref<ProjectSummary[]>([])
const projectPreview = ref<{
  changes: { section: string; id: string; action: string }[]
  from_digest: string | null
  from_version: string | null
  to_version: string | null
  current: Definition | null
  target: Definition | null
}>()
const nodeTypes = computed(() =>
  [...new Set(definition.value?.templates.map((t) => t.node_type) || [])].map(
    (value) => ({ label: value, value }),
  ),
)
const template = computed(() =>
  definition.value?.templates.find((t) => t.id === selected.value),
)
const newTemplateId = ref(''),
  newTemplateName = ref('')
const contractDrafts = ref<Record<string, string>>({})
const contractText = computed({
  get: () =>
    contractDrafts.value[selected.value] ??
    JSON.stringify(template.value?.contract, null, 2),
  set: (value) => {
    contractDrafts.value[selected.value] = value
  },
})
function applyContract() {
  for (const t of definition.value?.templates || []) {
    const text = contractDrafts.value[t.id]
    if (text !== undefined) t.contract = JSON.parse(text)
  }
}
async function run(work: () => Promise<void>) {
  busy.value = true
  error.value = ''
  try {
    await work()
  } catch (e: unknown) {
    const v = e as {
      response?: { data?: { error?: string } }
      message?: string
    }
    error.value = v.response?.data?.error || v.message || '操作失败'
  } finally {
    busy.value = false
  }
}
async function duplicateTemplate() {
  await run(async () => {
    applyContract()
    if (!template.value || !definition.value) return
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(newTemplateId.value) ||
      definition.value.templates.some((t) => t.id === newTemplateId.value)
    )
      throw new Error('请输入唯一的英文小写模板标识，单词用连字符分隔')
    if (!newTemplateName.value.trim()) throw new Error('请输入模板名称')
    const copy = structuredClone(toRaw(template.value))
    copy.id = newTemplateId.value
    copy.name = newTemplateName.value
    definition.value.templates.push(copy)
    selected.value = copy.id
    newTemplateId.value = ''
    newTemplateName.value = ''
  })
}
async function removeTemplate() {
  await run(async () => {
    if (!definition.value || definition.value.templates.length <= 1)
      throw new Error('至少保留一个文档模板')
    definition.value.templates = definition.value.templates.filter(
      (t) => t.id !== selected.value,
    )
    delete contractDrafts.value[selected.value]
    selected.value = definition.value.templates[0]!.id
  })
}
async function load() {
  await run(async () => {
    state.value = (await client.get<State>(endpoint)).data
    definition.value = structuredClone(toRaw(state.value.draft))
    if (!definition.value.templates.some((t) => t.id === selected.value))
      selected.value = definition.value.templates[0]!.id
    contractDrafts.value = {}
    projects.value = await listProjects()
  })
}
async function save() {
  await run(async () => {
    applyContract()
    state.value = (
      await client.post<State>(endpoint + '/save', {
        definition: definition.value,
        expected_revision: state.value?.revision,
      })
    ).data
  })
}
async function checkDefinition() {
  await run(async () => {
    applyContract()
    result.value = (
      await client.post(endpoint + '/check', { definition: definition.value })
    ).data
  })
}
async function publish() {
  await run(async () => {
    applyContract()
    state.value = (
      await client.post<State>(endpoint + '/save', {
        definition: definition.value,
        expected_revision: state.value?.revision,
      })
    ).data
    state.value = (
      await client.post<State>(endpoint + '/publish', {
        expected_revision: state.value.revision,
      })
    ).data
  })
}
async function checkDocument() {
  await run(async () => {
    applyContract()
    result.value = (
      await client.post(endpoint + '/check', {
        definition: definition.value,
        template_id: selected.value,
        document: documentText.value,
      })
    ).data
  })
}
async function previewProject() {
  await run(async () => {
    if (!projectId.value) return
    projectPreview.value = (
      await client.post(endpoint + '/preview', {
        project: projectId.value,
        overrides: JSON.parse(overrideText.value),
      })
    ).data
  })
}
async function bindProject() {
  await run(async () => {
    const project = await getProject(projectId.value)
    await client.post(endpoint + '/bind', {
      project: project.id,
      name: project.name,
      product_version: project.version,
      modules: project.modules,
      overrides: JSON.parse(overrideText.value),
      upgrade: true,
      expected_digest: projectPreview.value?.from_digest,
      version: projectPreview.value?.to_version,
    })
    projectPreview.value = (
      await client.get(endpoint + '/project', {
        params: { project: project.id },
      })
    ).data
  })
}
onMounted(load)
</script>
<style scoped>
.template-settings {
  max-width: 1400px;
  margin: auto;
}
.toolbar {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
  margin: 20px 0;
}
.editor-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.template-select {
  max-width: 460px;
  margin: 12px 0;
}
label {
  display: block;
  margin-top: 12px;
}
textarea {
  display: block;
  box-sizing: border-box;
  width: 100%;
  min-height: 280px;
  padding: 12px;
  font-family: monospace;
  font-size: 13px;
  background: var(--td-bg-color-container);
  color: var(--td-text-color-primary);
  border: 1px solid var(--td-component-stroke);
  border-radius: 6px;
}
.directory-row {
  display: flex;
  gap: 8px;
  margin: 10px 0;
}
pre {
  overflow: auto;
  max-height: 420px;
}
@media (max-width: 767px) {
  .editor-grid {
    grid-template-columns: 1fr;
  }
  .directory-row {
    flex-wrap: wrap;
  }
}
</style>
