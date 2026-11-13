<template>
  <section class="scoring-editor">
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="!effective">正在加载评分配置…</p>
    <template v-else>
      <label
        >评分方式<select v-model="mode" :disabled="!path" @change="changed">
          <option v-if="path" value="inherit">继承父级</option>
          <option v-if="path" value="partial">部分自定义</option>
          <option value="independent">独立设置</option>
        </select></label
      >
      <p class="hint">
        {{
          !path
            ? '项目默认是所有目录的最终评分来源。'
            : mode === 'inherit'
              ? '全部评分随父级变化。'
              : mode === 'partial'
                ? '只编辑覆盖项，其余继续继承父级。'
                : '以当前生效配置为初值，保存后不受父级评分变化影响。'
        }}
      </p>
      <div v-if="preview" class="impact" role="status">
        <strong
          >将影响 {{ preview.changed_paths.length }} 个目录的生效评分</strong
        >
        <ul>
          <li v-for="item in preview.changed_paths" :key="item">
            {{ item || '项目默认' }}
          </li>
        </ul>
        <p>相关文档的已有评分与审核历史保留，发布资格需按新规则复核。</p>
      </div>
      <div class="score-field">
        <label v-if="mode === 'partial'"
          ><input
            v-model="overrides.review_threshold"
            type="checkbox"
            @change="changed"
          />覆盖分数线</label
        ><label
          >人工审核分数线<input
            v-model.number="values.review_threshold"
            type="number"
            min="0"
            max="100"
            :disabled="!editable('review_threshold')"
            @input="changed" /></label
        ><small
          >生效值 {{ effective.review_threshold }} ·
          {{ effective.origins.review_threshold }}</small
        >
      </div>
      <div
        v-for="dimension in dimensions"
        :key="dimension.id"
        class="score-dimension"
      >
        <h4>{{ dimension.label }}</h4>
        <div
          v-for="field in ['weight', 'rubric']"
          :key="field"
          class="score-field"
        >
          <label v-if="mode === 'partial'"
            ><input
              v-model="overrides['dimensions.' + dimension.id + '.' + field]"
              type="checkbox"
              @change="changed"
            />覆盖{{ field === 'weight' ? '权重' : '量表' }}</label
          >
          <label
            >{{ field === 'weight' ? '权重' : '评分说明'
            }}<input
              v-if="field === 'weight'"
              v-model.number="values.dimensions[dimension.id].weight"
              type="number"
              min="0"
              max="1"
              step="0.05"
              :disabled="!editable('dimensions.' + dimension.id + '.' + field)"
              @input="changed"
            /><textarea
              v-else
              v-model="values.dimensions[dimension.id].rubric"
              :disabled="!editable('dimensions.' + dimension.id + '.' + field)"
              @input="changed"
            />
          </label>
          <small
            >当前来源：{{
              effective.origins['dimensions.' + dimension.id + '.' + field]
            }}</small
          >
        </div>
      </div>

      <footer><button @click="emit('close')">取消</button>
        <button :disabled="busy" @click="previewChanges">预览影响</button
        ><button class="primary" :disabled="busy || !preview" @click="save">
          确认保存评分
        </button>
      </footer>
    </template>
  </section>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import client from '@/api/client'
import {
  dimensions,
  directoryBase,
  directoryCommand,
  directoryList,
  policyMode,
} from '@/api/directories'
const props = defineProps<{ projectId: string; path: string }>()
const emit = defineEmits<{ dirty: [value: boolean]; saved: [];close: [] }>()
const effective = ref<any>(null),
  values = ref<any>(null),
  overrides = ref<Record<string, boolean>>({}),
  mode = ref('inherit'),
  preview = ref<any>(null),
  error = ref(''),
  busy = ref(false),
  revision = ref(0),
  originalHuman = ref<any>(undefined)
async function attempt(action: () => Promise<void>) {
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (e: any) {
    error.value = e.response?.data?.error || e.message || '评分操作失败'
  } finally {
    busy.value = false
  }
}
async function load() {
  await attempt(async () => {
    const [response, policies] = await Promise.all([
      client.get(directoryBase(props.projectId) + 'quality-policy-effective', {
        params: { path: props.path },
      }),
      directoryList(props.projectId, 'quality-policies'),
    ])
    effective.value = response.data.data
    values.value = JSON.parse(JSON.stringify(effective.value))
    const latest = policies.filter((row: any) => row.path === props.path).at(-1)
    revision.value = latest?.policy_revision || 0
    const patch = latest?.patch || {}
    originalHuman.value = patch.require_human
    mode.value = props.path ? policyMode(patch) : 'independent'
    overrides.value = { review_threshold: patch.review_threshold !== undefined }
    for (const dimension of dimensions)
      for (const field of ['weight', 'rubric'])
        overrides.value['dimensions.' + dimension.id + '.' + field] =
          patch.dimensions?.[dimension.id]?.[field] !== undefined
    preview.value = null
    emit('dirty', false)
  })
}
function changed() {
  preview.value = null
  emit('dirty', true)
}
function editable(key: string) {
  return (
    mode.value === 'independent' ||
    (mode.value === 'partial' && overrides.value[key])
  )
}
function patch() {
  const result: Record<string, any> = {}
  if (originalHuman.value !== undefined)
    result.require_human = originalHuman.value
  if (mode.value === 'inherit') return {}
  if (editable('review_threshold'))
    result.review_threshold = values.value.review_threshold
  for (const dimension of dimensions) {
    const fields: Record<string, any> = {}
    for (const field of ['weight', 'rubric'])
      if (editable('dimensions.' + dimension.id + '.' + field))
        fields[field] = values.value.dimensions[dimension.id][field]
    if (Object.keys(fields).length) {
      result.dimensions ||= {}
      result.dimensions[dimension.id] = fields
    }
  }
  return result
}
async function previewChanges() {
  await attempt(async () => {
    preview.value = await directoryCommand(
      props.projectId,
      'quality-policy-preview',
      { path: props.path, expected_revision: revision.value, patch: patch() },
    )
  })
}
async function save() {
  await attempt(async () => {
    await directoryCommand(props.projectId, 'quality-policies', {
      path: props.path,
      expected_revision: revision.value,
      expected_digest: preview.value.expected_digest,
      patch: patch(),
    })
    emit('dirty', false)
    emit('saved')
  })
  if (!error.value) await load()
}
onMounted(load)
</script>
<style scoped>
.scoring-editor {
  font-size: 13px;
  color: var(--td-text-color-primary);
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}
label:has([type='checkbox']) {
  flex-direction: row;
  align-items: center;
}
input,
select,
textarea {
  font: inherit;
  padding: 8px;
  border: 1px solid var(--td-component-stroke);
  border-radius: 5px;
  background: var(--td-bg-color-container);
  color: inherit;
  min-width: 0;
}
input[type='number'] {
  width: 110px;
}
textarea {
  min-height: 72px;
  resize: vertical;
}
input:disabled,
textarea:disabled {
  background: var(--td-bg-color-page);
  color: var(--td-text-color-secondary);
}
.hint,
small {
  color: var(--td-text-color-secondary);
}
.score-field {
  margin: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.score-dimension {
  border-top: 1px solid var(--td-component-stroke);
  padding: 8px 0;
}
h4 {
  margin: 12px 0;
  font-size: 14px;
}
.impact {
  padding: 12px;
  background: var(--td-bg-color-page);
  border-radius: 6px;
}
.impact ul {
  max-height: 150px;
  overflow: auto;
}
footer {
  position: sticky;
  bottom: 0;
  background: var(--td-bg-color-container);
  padding: 16px 0;
  display: flex;
  gap: 8px;
  border-top: 1px solid var(--td-component-stroke);
}
button {
  padding: 8px 12px;
  border: 1px solid var(--td-component-stroke);
  border-radius: 5px;
  background: var(--td-bg-color-container);
  color: inherit;
  cursor: pointer;
}
.primary {
  background: var(--td-brand-color);
  color: white;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.error {
  color: var(--td-error-color);
  padding: 12px;
  background: var(--td-error-color-light);
}
</style>
