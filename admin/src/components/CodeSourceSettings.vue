<template>
  <section class="code-sources">
    <div class="source-heading">
      <div>
        <h3>代码数据源</h3>
        <p>配置项目的 Git / SVN 代码仓库，文档数据源在独立页签维护。</p>
      </div>
      <t-button @click="open()">新增代码数据源</t-button>
    </div>
    <div v-if="!repos.length" class="empty">
      尚未配置代码数据源，点击“新增代码数据源”开始配置。
    </div>
    <div v-else class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>名称</th>
            <th>类型</th>
            <th>仓库地址 / 子路径</th>
            <th>分支 / 标签 / 修订</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="repo in repos" :key="repo.name">
            <td>{{ repo.name }}</td>
            <td>{{ (repo.type || 'git').toUpperCase() }}</td>
            <td>
              {{ repo.url }}<small>{{ repo.subpath || '仓库根目录' }}</small>
            </td>
            <td>{{ repo.revision_selector || repo.branch || 'HEAD' }}</td>
            <td>{{ repo.enabled === false ? '已停用' : '启用' }}</td>
            <td>
              <button @click="open(repo)">编辑</button
              ><button @click="emit('mappings', repo)">模块映射</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <t-dialog
      :visible="visible"
      :header="editing ? '编辑代码数据源' : '新增代码数据源'"
      placement="center"
      width="560px"
      :footer="false"
      :close-on-overlay-click="false"
      destroy-on-close
      :on-close="close"
    >
      <form class="source-form" @submit.prevent="save">
        <p v-if="error" role="alert" class="error">{{ error }}</p>
        <label
          >名称<input
            v-model="form.name"
            autofocus
            required
            maxlength="100"
            :readonly="editing"
            placeholder="例如：mes-service"
        /></label>
        <label
          >类型<select v-model="form.type" :disabled="editing">
            <option value="git">Git</option>
            <option value="svn">SVN</option>
          </select></label
        >
        <label
          >仓库地址<input
            v-model="form.url"
            required
            :placeholder="
              form.type === 'git'
                ? 'https:// 或 ssh://git@host/repo.git'
                : 'https://host/svn/repository'
            "
        /></label>
        <label
          >代码子路径<input
            v-model="form.subpath"
            placeholder="留空读取仓库根目录，例如 trunk/src"
        /></label>
        <label
          >{{ form.type === 'git' ? '分支 / 标签 / 完整 Commit' : 'SVN 修订号'
          }}<input v-model="form.revision_selector" required placeholder="HEAD"
        /></label>
        <label class="enabled"
          ><input
            v-model="form.enabled"
            type="checkbox"
          />启用此代码数据源</label
        >
        <p class="hint">
          {{
            form.type === 'git'
              ? 'Git 使用本机 HTTPS 凭据助手或 SSH key/agent。'
              : 'SVN 使用本机已有凭据缓存。'
          }}系统不保存密码、Token 或私钥。
        </p>
        <p v-if="editing" class="hint">
          名称和类型不能修改；修改仓库、子路径或版本选择后会清除旧同步基线。现有模块映射保留。
        </p>
        <footer>
          <button type="button" @click="close">取消</button
          ><button class="primary" :disabled="busy" type="submit">
            {{ busy ? '保存中…' : '保存代码数据源' }}
          </button>
        </footer>
      </form>
    </t-dialog>
  </section>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { Dialog as TDialog } from 'tdesign-vue-next'
import client from '@/api/client'
import type { RepoBinding } from '@/api/types'
const props = defineProps<{ projectId: string; repos: RepoBinding[] }>()
const emit = defineEmits<{ saved: []; mappings: [repo: RepoBinding] }>()
const visible = ref(false),
  editing = ref(false),
  busy = ref(false),
  error = ref('')
const blank = () => ({
  name: '',
  type: 'git',
  url: '',
  subpath: '',
  revision_selector: 'HEAD',
  enabled: true,
  expected_revision: 0,
})
const form = ref(blank()),
  original = ref('')
function open(repo?: RepoBinding) {
  editing.value = Boolean(repo)
  form.value = repo
    ? {
        name: repo.name,
        type: repo.type || 'git',
        url: repo.url,
        subpath: repo.subpath || '',
        revision_selector: repo.revision_selector || repo.branch || 'HEAD',
        enabled: repo.enabled !== false,
        expected_revision: repo.config_revision || 1,
      }
    : blank()
  original.value = JSON.stringify(form.value)
  error.value = ''
  visible.value = true
}
function close() {
  if (busy.value) return
  if (
    JSON.stringify(form.value) !== original.value &&
    !window.confirm('有未保存的代码数据源配置，确定放弃吗？')
  )
    return
  visible.value = false
}
async function save() {
  busy.value = true
  error.value = ''
  try {
    await client.post(
      `/admin/projects/${encodeURIComponent(props.projectId)}/code-sources`,
      form.value,
    )
    visible.value = false
    emit('saved')
  } catch (e: any) {
    error.value = e.response?.data?.error || '保存失败，请重试'
  } finally {
    busy.value = false
  }
}
</script>
<style scoped>
.code-sources {
  font: 13px/1.6 var(--app-font-family);
  color: var(--td-text-color-primary);
}
.source-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}
.source-heading h3 {
  margin: 0;
  font-size: 16px;
}
.source-heading p,
.hint {
  font-size: 12px;
  color: var(--td-text-color-secondary);
}
.table-wrap {
  overflow: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  padding: 12px;
  text-align: left;
  border-bottom: 1px solid var(--td-component-stroke);
}
th {
  font-weight: 500;
  font-size: 12px;
  background: var(--td-bg-color-page);
}
td {
  overflow-wrap: anywhere;
}
small {
  display: block;
  color: var(--td-text-color-secondary);
}
.empty {
  text-align: center;
  padding: 64px 12px;
  color: var(--td-text-color-secondary);
}
button {
  padding: 7px 12px;
  border: 1px solid var(--td-component-stroke);
  border-radius: 5px;
  background: var(--td-bg-color-container);
  color: inherit;
  cursor: pointer;
  margin-right: 6px;
}
.source-form {
  font: 13px/1.6 var(--app-font-family);
  color: var(--td-text-color-primary);
  max-height: calc(100dvh - 180px);
  overflow: auto;
}
.source-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 0;
}
.source-form input,
.source-form select {
  font: inherit;
  border: 1px solid var(--td-component-stroke);
  padding: 8px 10px;
  border-radius: 5px;
  background: var(--td-bg-color-container);
  color: inherit;
  width: 100%;
  box-sizing: border-box;
}
.source-form .enabled {
  flex-direction: row;
  align-items: center;
}
.enabled input {
  width: auto;
}
.source-form input[readonly],
select:disabled {
  background: var(--td-bg-color-page);
}
.error {
  color: var(--td-error-color);
  background: var(--td-error-color-light);
  padding: 12px;
  border-radius: 6px;
}
footer {
  position: sticky;
  bottom: 0;
  background: var(--td-bg-color-container);
  padding: 16px 0;
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid var(--td-component-stroke);
}
button.primary {
  background: var(--td-brand-color);
  color: white;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
input:focus-visible,
select:focus-visible,
button:focus-visible {
  outline: 2px solid var(--td-brand-color);
  outline-offset: 2px;
}
</style>
