<template>
  <section
    class="workspace"
    @click="context = null"
    @keydown.esc="context = null"
  >
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <div class="browser">
      <nav class="tree-panel" aria-label="文档目录">
        <header>
          <strong>文档目录</strong
          ><button
            aria-label="新建目录"
            title="新建目录"
            @click="openCreate(selected || 'doc')"
          >
            ＋
          </button>
        </header>
        <input
          v-model="treeSearch"
          placeholder="搜索目录名称或路径"
          aria-label="搜索目录"
        />
        <div role="tree" class="tree">
          <button
            v-for="row in treeRows"
            :key="row.path"
            role="treeitem"
            :title="row.path"
            :aria-selected="selected === row.path"
            :aria-level="row.path.split('/').length"
            :style="{
              paddingLeft: 12 + (row.path.split('/').length - 1) * 14 + 'px',
            }"
            @click="navigate(row.path)"
            @contextmenu.prevent="showContext($event, row)"
            @keydown.shift.f10.prevent="showContext($event, row)"
          >
            <span
              v-if="row.child_count"
              role="button"
              tabindex="0"
              :aria-label="row.display_name + '展开收起'"
              :aria-expanded="!collapsed.has(row.path)"
              @click.stop="toggleDirectory(row.path)"
              @keydown.enter.stop.prevent="toggleDirectory(row.path)"
              >{{ collapsed.has(row.path) ? '▸' : '▾' }}</span><span
              v-else
              class="folder-icon"
              >▱</span
            ><span class="node-label">{{ row.display_name }}</span
            ><span
              class="node-actions"
              role="button"
              tabindex="0"
              :aria-label="row.display_name + '操作'"
              @click.stop="showContext($event, row)"
              @keydown.enter.stop.prevent="showContext($event, row)"
              >⋯</span
            >
          </button>
        </div>
        <button class="default-policy" @click="openProperties(null, 'scoring')">
          项目默认评分
        </button>
      </nav>
      <main>
        <div class="breadcrumbs">
          <button @click="navigate('')">项目目录</button
          ><template v-for="part in breadcrumbs" :key="part.path"
            ><span>/</span
            ><button @click="navigate(part.path)">
              {{ part.name }}
            </button></template
          >
        </div>
        <header class="content-heading">
          <div>
            <h3>{{ current?.display_name || '项目目录' }}</h3>
            <p>
              {{ selected || '选择目录，管理其直接子目录' }}
              <button v-if="selected" class="link" @click="copyPath(selected)">
                复制路径
              </button>
            </p>
          </div>
          <div class="actions">
            <button :disabled="busy" @click="load">刷新</button
            ><button v-if="current" @click="viewDocuments(current.path)">
              查看文档</button
            ><button v-if="current" @click="openProperties(current)">
              目录属性</button
            ><button class="primary" @click="openCreate(selected || 'doc')">
              新建子目录
            </button>
          </div>
        </header>
        <div class="list-heading">
          <strong
            >直接子目录 <small>{{ children.length }}</small></strong
          ><input
            v-model="childSearch"
            aria-label="检索子目录"
            placeholder="搜索当前层级子目录"
          />
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>显示名称</th>
                <th>路径名称</th>
                <th>子目录</th>
                <th>文档（含下级）</th>
                <th>评分方式</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in pagedChildren"
                :key="row.path"
                :class="{ highlight: highlight === row.path }"
                @click="highlight = row.path"
                @dblclick="navigate(row.path)"
                @contextmenu.prevent="showContext($event, row)"
                @keydown.shift.f10.prevent="showContext($event, row)"
                tabindex="0"
              >
                <td>
                  <button class="link name" @click.stop="navigate(row.path)">
                    ▱ {{ row.display_name }}
                  </button>
                </td>
                <td :title="row.path">{{ row.path.split('/').at(-1) }}</td>
                <td>{{ row.child_count }}</td>
                <td>{{ row.document_count }}</td>
                <td>
                  <span class="badge">{{
                    scoringLabel(row.scoring_mode)
                  }}</span>
                </td>
                <td>
                  <button class="link" @click.stop="openProperties(row)">
                    属性</button
                  ><button
                    :aria-label="row.display_name + '更多操作'"
                    @click.stop="showContext($event, row)"
                  >
                    ⋯
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="children.length > pageSize" class="pagination">
          <button :disabled="page === 1" @click="page--">上一页</button
          ><span
            >{{ page }} / {{ pageCount }} · 共
            {{ children.length }} 个子目录</span
          ><button :disabled="page === pageCount" @click="page++">
            下一页
          </button>
        </div>
        <div v-if="!children.length && !busy" class="empty">
          <h4>{{ childSearch ? '没有匹配的子目录' : '暂无子目录' }}</h4>
          <p>当前仅展示直接子目录。文档内容请在“文档结果”中查看。</p>
          <button v-if="!childSearch" @click="openCreate(selected || 'doc')">
            新建子目录
          </button>
        </div>
        <p v-if="busy" role="status">正在加载目录…</p>
        <p v-if="message" role="status" class="success">{{ message }}</p>
      </main>
    </div>
    <div
      v-if="context"
      class="context-menu"
      role="menu"
      :style="{ left: context.x + 'px', top: context.y + 'px' }"
      @click.stop
      @keydown="menuKey"
    >
      <strong>{{ context.row.display_name }}</strong><button
        role="menuitem"
        @click="menuAction('create')"
      >
        新建子目录</button
      ><button role="menuitem" @click="menuAction('properties')">
        目录属性 / 编辑名称</button
      ><button role="menuitem" @click="menuAction('scoring')">评分设置</button
      ><button role="menuitem" @click="menuAction('documents')">查看文档</button
      ><button role="menuitem" @click="menuAction('copy')">复制完整路径</button
      ><button
        role="menuitem"
        :disabled="!context.row.can_delete"
        :title="
          context.row.can_delete
            ? '删除空目录'
            : '存在子目录、评分历史或文档引用，无法删除'
        "
        @click="menuAction('delete')"
      >
        删除空目录
      </button>
    </div>
    <t-dialog
      :visible="creating"
      header="新建文档目录"
      placement="center"
      destroy-on-close
      :footer="false"
      :close-on-overlay-click="false"
      width="520px"
      :on-close="closeCreate"
      @opened="nameInput?.focus()"
    >
      <form class="directory-form" @submit.prevent="saveCreate">
        <p v-if="dialogError" role="alert" class="error">{{ dialogError }}</p>
        <label
          >显示名称<input
            ref="nameInput"
            v-model="createForm.display_name"
            required
            maxlength="100"
            autofocus
            placeholder="例如：接口设计"
        /></label>
        <label
          >输入方式<select v-model="createForm.inputMode">
            <option value="parts">选择上级目录＋路径名称</option>
            <option value="full">直接输入完整路径</option>
          </select></label
        >
        <template v-if="createForm.inputMode === 'parts'"
          ><label
            >上级目录<input
              v-model="parentSearch"
              type="search"
              placeholder="查找上级目录"
              aria-label="查找上级目录"
            /><select v-model="createForm.parent">
              <option
                v-for="row in parentOptions"
                :key="row.path"
                :value="row.path"
              >
                {{ row.display_name }} · {{ row.path }}
              </option>
            </select></label
          ><label
            >路径名称<input
              v-model="createForm.segment"
              required
              placeholder="interfaces" /></label
        ></template>
        <label v-else
          >完整路径<input
            v-model="createForm.fullPath"
            required
            placeholder="doc/50-designs/interfaces"
        /></label>
        <p class="path-preview">
          完整路径：<code>{{ createPath || '尚未填写' }}</code>
        </p>
        <div v-if="missingParents.length" class="notice">
          <p>缺少以下上级目录：</p>
          <ul>
            <li v-for="path in missingParents" :key="path">{{ path }}</li>
          </ul>
          <label class="checkbox"
            ><input
              v-model="createForm.create_parents"
              type="checkbox"
            />确认同时创建以上目录</label
          >
        </div>
        <p class="hint">新目录默认继承父级评分，可在保存后通过“属性”调整。</p>
        <footer>
          <button type="button" @click="closeCreate">取消</button
          ><button class="primary" type="submit" :disabled="busy">
            新增目录
          </button>
        </footer>
      </form>
    </t-dialog>
    <t-dialog
      v-model:visible="deleting"
      header="删除空目录"
      placement="center"
      :footer="false"
      :close-on-overlay-click="false"
      width="440px"
      ><p>确定删除“{{ deleteTarget?.display_name }}”？</p>
      <p class="hint">
        {{ deleteTarget?.path }}。服务端将再次检查所有引用，操作历史保留。
      </p>
      <p v-if="dialogError" class="error" role="alert">{{ dialogError }}</p>
      <footer>
        <button @click="deleting = false">取消</button
        ><button class="danger" :disabled="busy" @click="deleteDirectory">
          确认删除
        </button>
      </footer></t-dialog
    >
    <t-drawer
      :visible="Boolean(propertyTarget)"
      :close-btn="true"
      :header="propertyTarget?.display_name + ' · 目录属性'"
      :footer="false"
      :size="drawerSize"
      :close-on-overlay-click="false"
      :on-close="closeProperties"
      destroy-on-close
    >
      <template v-if="propertyTarget"
        ><div class="tabs">
          <button
            :class="{ active: propertyTab === 'basic' }"
            @click="switchTab('basic')"
          >
            基本信息</button
          ><button
            :class="{ active: propertyTab === 'scoring' }"
            @click="switchTab('scoring')"
          >
            评分与继承
          </button>
        </div>
        <form
          v-if="propertyTab === 'basic'"
          class="directory-form"
          @submit.prevent="saveProperties"
        >
          <p v-if="dialogError" role="alert" class="error">{{ dialogError }}</p>
          <label
            >显示名称<input
              v-model="editForm.display_name"
              required
              maxlength="100"
              @input="basicDirty = true"
          /></label>
          <label
            >上级目录<input
              :value="propertyTarget.parent_path || '项目根'"
              readonly
          /></label>
          <label
            >路径名称<input
              v-model="editForm.segment"
              :readonly="propertyTarget.path_locked || propertyTarget.virtual"
              required
              @input="basicDirty = true"
          /></label>
          <p class="path-preview">完整路径：{{ editPath }}</p>
          <p v-if="propertyTarget.path_locked" class="notice">
            存在子目录、评分历史、文档引用或属于平面根；只能修改显示名称。
          </p>
          <p>
            直接子目录：{{ propertyTarget.child_count }} · 文档（含下级）：{{
              propertyTarget.document_count
            }}
          </p>
          <p class="hint">
            创建时间：{{ (propertyTarget as any).created_at || '未登记' }} ·
            记录版本：{{ propertyTarget.revision || '未登记' }}
          </p>
          <h4>目录操作历史</h4>
          <ul class="history">
            <li v-for="event in propertyEvents" :key="event.id">
              {{ event.created_at }} · {{ event.created_by }} ·
              {{ event.action }}
            </li>
            <li v-if="!propertyEvents.length">暂无人工维护记录</li>
          </ul>
          <footer>
            <button type="button" @click="closeProperties">取消</button
            ><button class="primary" type="submit" :disabled="busy">
              保存基本信息
            </button>
          </footer>
        </form>
        <DirectoryScoring
          v-else
          :key="propertyTarget.path"
          :project-id="projectId"
          :path="propertyTarget.path"
          @dirty="scoringDirty = $event"
          @saved="savedScoring"
          @close="closeProperties"
        />
      </template>
    </t-drawer>
  </section>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import { Dialog as TDialog, Drawer as TDrawer } from 'tdesign-vue-next'
import DirectoryScoring from './DirectoryScoring.vue'
import {
  directoryCommand,
  directoryList,
  scoringLabel,
  type DirectoryRow,
} from '@/api/directories'
const props = defineProps<{ projectId: string }>(),
  router = useRouter()
const rows = ref<DirectoryRow[]>([]),
  events = ref<any[]>([]),
  selected = ref('doc'),
  highlight = ref(''),
  treeSearch = ref(''),
  childSearch = ref(''),
  busy = ref(false),
  error = ref(''),
  dialogError = ref(''),
  message = ref('')
const creating = ref(false),
  deleting = ref(false),
  deleteTarget = ref<DirectoryRow | null>(null),
  propertyTarget = ref<DirectoryRow | null>(null),
  propertyTab = ref('basic'),
  basicDirty = ref(false),
  scoringDirty = ref(false),
  nameInput = ref<HTMLInputElement | null>(null)
const width = ref(window.innerWidth),
  drawerSize = computed(() => (width.value < 600 ? '100%' : '560px'))
const createForm = ref({
    display_name: '',
    inputMode: 'parts',
    parent: 'doc',
    segment: '',
    fullPath: '',
    create_parents: false,
  }),
  editForm = ref({ display_name: '', segment: '' })
const parentSearch = ref('')
const parentOptions = computed(() =>
  rows.value.filter(
    (row) =>
      row.path === createForm.value.parent ||
      (row.display_name + ' ' + row.path)
        .toLocaleLowerCase()
        .includes(parentSearch.value.toLocaleLowerCase()),
  ),
)
const page = ref(1),
  pageSize = 20
const pageCount = computed(() =>
  Math.max(1, Math.ceil(children.value.length / pageSize)),
)
const pagedChildren = computed(() =>
  children.value.slice((page.value - 1) * pageSize, page.value * pageSize),
)
watch(childSearch, () => {
  page.value = 1
})
const collapsed = ref(new Set<string>())
const context = ref<{
  row: DirectoryRow
  x: number
  y: number
  trigger: HTMLElement | null
} | null>(null)
const current = computed(() =>
  rows.value.find((row) => row.path === selected.value),
)
const treeRows = computed(() => {
  const query = treeSearch.value.trim().toLocaleLowerCase()
  if (!query)
    return rows.value.filter(
      (row) =>
        ![...collapsed.value].some((path) => row.path.startsWith(path + '/')),
    )
  const matches = new Set<string>()
  for (const row of rows.value)
    if (
      (row.path + ' ' + row.display_name).toLocaleLowerCase().includes(query)
    ) {
      const parts = row.path.split('/')
      for (let i = 1; i <= parts.length; i++)
        matches.add(parts.slice(0, i).join('/'))
    }
  return rows.value.filter((row) => matches.has(row.path))
})
function toggleDirectory(path: string) {
  const next = new Set(collapsed.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  collapsed.value = next
}
const children = computed(() =>
  rows.value.filter(
    (row) =>
      row.parent_path === selected.value &&
      (row.path + ' ' + row.display_name)
        .toLocaleLowerCase()
        .includes(childSearch.value.toLocaleLowerCase()),
  ),
)
const breadcrumbs = computed(() =>
  selected.value
    .split('/')
    .filter(Boolean)
    .map((_, i, parts) => {
      const path = parts.slice(0, i + 1).join('/')
      return {
        path,
        name:
          rows.value.find((row) => row.path === path)?.display_name || parts[i],
      }
    }),
)
const createPath = computed(() =>
  createForm.value.inputMode === 'full'
    ? createForm.value.fullPath
    : [createForm.value.parent, createForm.value.segment]
        .filter(Boolean)
        .join('/'),
)
const missingParents = computed(() => {
  const parts = createPath.value.split('/')
  return parts
    .slice(0, -1)
    .map((_, i) => parts.slice(0, i + 1).join('/'))
    .filter((path) => !rows.value.some((row) => row.path === path))
})
const editPath = computed(() =>
  [propertyTarget.value?.parent_path, editForm.value.segment]
    .filter(Boolean)
    .join('/'),
)
const propertyEvents = computed(() =>
  events.value.filter(
    (event) => event.directory_id === propertyTarget.value?.id,
  ),
)
async function attempt(action: () => Promise<void>, dialog = false) {
  busy.value = true
  if (dialog) dialogError.value = ''
  else error.value = ''
  try {
    await action()
  } catch (e: any) {
    const text = e.response?.data?.error || e.message || '目录操作失败'
    if (dialog) dialogError.value = text
    else error.value = text
  } finally {
    busy.value = false
  }
}
async function load() {
  await attempt(async () => {
    rows.value = await directoryList(props.projectId, 'directory-catalog')
  })
}
function savedScoring() {
  scoringDirty.value = false
  void load()
}
function hasDraft() {
  return (
    basicDirty.value ||
    scoringDirty.value ||
    (creating.value &&
      Boolean(
        createForm.value.display_name ||
        createForm.value.segment ||
        (createForm.value.inputMode === 'full' &&
          createForm.value.fullPath !== createForm.value.parent + '/'),
      ))
  )
}
function canLeave() {
  return !hasDraft() || window.confirm('有未保存的修改，确定放弃吗？')
}
defineExpose({ canLeave })
function navigate(path: string) {
  if (!canLeave()) return
  propertyTarget.value = null
  basicDirty.value = false
  scoringDirty.value = false
  selected.value = path
  page.value = 1
  collapsed.value = new Set(
    [...collapsed.value].filter((parent) => !path.startsWith(parent + '/')),
  )
  childSearch.value = ''
  context.value = null
}
function openCreate(parent: string) {
  if (!canLeave()) return
  context.value = null
  parentSearch.value = ''
  createForm.value = {
    display_name: '',
    inputMode: 'parts',
    parent,
    segment: '',
    fullPath: parent + '/',
    create_parents: false,
  }
  dialogError.value = ''
  creating.value = true
}
function closeCreate() {
  if (!canLeave()) return
  creating.value = false
}
async function saveCreate() {
  await attempt(async () => {
    const row = await directoryCommand(
      props.projectId,
      'document-directories',
      {
        action: 'create',
        path: createPath.value,
        display_name: createForm.value.display_name,
        create_parents: createForm.value.create_parents,
      },
    )
    creating.value = false
    selected.value = row.path.split('/').slice(0, -1).join('/')
    highlight.value = row.path
    message.value = '目录已创建'
    await load()
  }, true)
}
async function openProperties(row: DirectoryRow | null, tab = 'basic') {
  if (!canLeave()) return
  propertyTarget.value = row || {
    path: '',
    parent_path: '',
    display_name: '项目默认',
    child_count: 0,
    document_count: 0,
    scoring_mode: 'independent',
    path_locked: true,
    can_delete: false,
  }
  propertyTab.value = row ? tab : 'scoring'
  editForm.value = {
    display_name: row?.display_name || '',
    segment: row?.path.split('/').at(-1) || '',
  }
  basicDirty.value = false
  scoringDirty.value = false
  dialogError.value = ''
  await attempt(async () => {
    events.value = await directoryList(props.projectId, 'directory-events')
  }, true)
}
function closeProperties() {
  if (!canLeave()) return
  propertyTarget.value = null
  basicDirty.value = false
  scoringDirty.value = false
}
function switchTab(tab: string) {
  if (propertyTarget.value?.path === '' && tab === 'basic') return
  if (!canLeave()) return
  basicDirty.value = false
  scoringDirty.value = false
  if (propertyTarget.value)
    editForm.value = {
      display_name: propertyTarget.value.display_name,
      segment: propertyTarget.value.path.split('/').at(-1) || '',
    }
  propertyTab.value = tab
}
async function saveProperties() {
  await attempt(async () => {
    const row = propertyTarget.value!
    await directoryCommand(props.projectId, 'document-directories', {
      action: row.virtual ? 'create' : 'update',
      id: row.id,
      expected_revision: row.revision,
      path: editPath.value,
      display_name: editForm.value.display_name,
      create_parents: true,
    })
    basicDirty.value = false
    propertyTarget.value = null
    await load()
    message.value = '目录属性已保存'
  }, true)
}
function requestDelete(row: DirectoryRow) {
  deleteTarget.value = row
  dialogError.value = ''
  deleting.value = true
}
async function deleteDirectory() {
  await attempt(async () => {
    const row = deleteTarget.value!
    await directoryCommand(props.projectId, 'document-directories', {
      action: 'delete',
      id: row.id,
      expected_revision: row.revision,
    })
    deleting.value = false
    selected.value = row.parent_path
    await load()
    message.value = '空目录已删除，操作历史保留'
  }, true)
}
function viewDocuments(path: string) {
  if (!canLeave()) return
  basicDirty.value = false
  scoringDirty.value = false
  creating.value = false
  void router.push({
    path: '/document-results',
    query: { project: props.projectId, folder: path },
  })
}
async function copyPath(path: string) {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(path)
    } else {
      const field = document.createElement('textarea')
      field.value = path
      field.style.position = 'fixed'
      field.style.opacity = '0'
      document.body.append(field)
      field.select()
      const copied = document.execCommand('copy')
      field.remove()
      if (!copied) throw new Error('Clipboard unavailable')
    }
    message.value = '路径已复制'
  } catch {
    error.value = '无法访问剪贴板，请从目录标题复制完整路径'
  }
}
async function showContext(
  event: MouseEvent | KeyboardEvent,
  row: DirectoryRow,
) {
  event.stopPropagation()
  if (!canLeave()) return
  selected.value = row.path
  const trigger = event.currentTarget as HTMLElement
  const rect = trigger.getBoundingClientRect()
  const x = 'clientX' in event && event.clientX ? event.clientX : rect.left,
    y = 'clientY' in event && event.clientY ? event.clientY : rect.bottom
  context.value = {
    row,
    x: Math.min(x, window.innerWidth - 240),
    y: Math.max(8, Math.min(y, window.innerHeight - 320)),
    trigger,
  }
  await nextTick()
  document.querySelector<HTMLElement>('.context-menu [role=menuitem]')?.focus()
}
function menuAction(action: string) {
  const row = context.value!.row
  context.value = null
  const actions: Record<string, () => unknown> = {
    create: () => openCreate(row.path),
    properties: () => openProperties(row),
    scoring: () => openProperties(row, 'scoring'),
    documents: () => viewDocuments(row.path),
    copy: () => copyPath(row.path),
    delete: () => requestDelete(row),
  }
  actions[action]?.()
}
function menuKey(event: KeyboardEvent) {
  const buttons = Array.from(
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(
      'button:not(:disabled)',
    ),
  )
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (event.key === 'Escape') {
    context.value?.trigger?.focus()
    context.value = null
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    buttons[
      (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) %
        buttons.length
    ]?.focus()
  }
}
function outsideMenu(event: Event) {
  if (!(event.target as HTMLElement).closest('.context-menu'))
    context.value = null
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (hasDraft()) {
    event.preventDefault()
    event.returnValue = ''
  }
}
function resize() {
  width.value = window.innerWidth
  context.value = null
}
onBeforeRouteLeave(canLeave)
onMounted(() => {
  void load()
  window.addEventListener('beforeunload', beforeUnload)
  window.addEventListener('resize', resize)
  window.addEventListener('pointerdown', outsideMenu)
})
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload)
  window.removeEventListener('resize', resize)
  window.removeEventListener('pointerdown', outsideMenu)
})
</script>
<style scoped>
.workspace, .workspace * {box-sizing:border-box}
.workspace {
  font: 13px/1.6 var(--app-font-family);
  color: var(--td-text-color-primary);
}
.browser {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-stroke);
  border-radius: 10px;
  min-height: 640px;
  overflow: hidden;
}
.tree-panel {
  padding: 16px 12px;
  border-right: 1px solid var(--td-component-stroke);
  min-width: 0;
}
.tree-panel header {
  padding: 0 8px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.tree-panel > input {
  width: 100%;
  margin-bottom: 12px;
}
.tree {
  max-height: 640px;
  overflow: auto;
}
.tree button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 0;
  background: none;
  text-align: left;
  padding: 8px 12px;
  margin: 2px 0;
}
.tree [aria-selected='true'],
tr.highlight {
  background: var(--td-brand-color-light);
  color: var(--td-brand-color);
}
.node-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.node-actions {
  font-size: 18px;
  padding: 0 4px;
  cursor: pointer;
}
.folder-icon {
  font-size: 18px;
  color: var(--td-text-color-secondary);
}
.default-policy {
  margin-top: 16px;
  width: 100%;
  color: var(--td-brand-color);
}
main {
  padding: 24px;
  min-width: 0;
}
.breadcrumbs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  color: var(--td-text-color-secondary);
}
.breadcrumbs button {
  border: 0;
  background: none;
  padding: 0;
  color: inherit;
}
.content-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--td-component-stroke);
}
h3 {
  font-size: 18px;
  margin: 0;
}
p {
  margin: 8px 0;
}
.content-heading p {
  font-size: 12px;
  color: var(--td-text-color-secondary);
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.list-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin: 20px 0;
}
.list-heading small {
  color: var(--td-text-color-secondary);
  margin-left: 8px;
}
.list-heading input {
  width: 240px;
}
.pagination {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  align-items: center;
  margin-top: 16px;
  font-size: 12px;
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
  white-space: nowrap;
}
th {
  background: var(--td-bg-color-page);
  font-size: 12px;
  color: var(--td-text-color-secondary);
  font-weight: 500;
}
.name {
  font-size: 13px;
}
.badge {
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--td-bg-color-page);
  font-size: 12px;
}
.empty {
  text-align: center;
  padding: 64px 12px;
  color: var(--td-text-color-secondary);
}
.empty h4 {
  color: var(--td-text-color-primary);
}
button {
  font: inherit;
  padding: 6px 12px;
  border: 1px solid var(--td-component-stroke);
  border-radius: 5px;
  background: var(--td-bg-color-container);
  color: inherit;
  cursor: pointer;
}
button:hover {
  color: var(--td-brand-color);
  border-color: var(--td-brand-color);
}
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: 2px solid var(--td-brand-color);
  outline-offset: 2px;
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.primary {
  background: var(--td-brand-color);
  color: white;
}
.danger {
  background: var(--td-error-color);
  color: white;
}
.link {
  color: var(--td-brand-color);
  border: 0;
  background: none;
  padding: 2px 4px;
}
input,
select {
  font: inherit;
  padding: 8px 10px;
  border: 1px solid var(--td-component-stroke);
  border-radius: 5px;
  background: var(--td-bg-color-container);
  color: inherit;
  min-width: 0;
}
input[readonly] {
  background: var(--td-bg-color-page);
}
.context-menu {
  position: fixed;
  z-index: 2000;
  width: 232px;
  padding: 8px;
  background: var(--td-bg-color-container);
  box-shadow: 0 8px 30px #0003;
  border: 1px solid var(--td-component-stroke);
  border-radius: 8px;
}
.context-menu strong {
  display: block;
  padding: 6px 10px;
  color: var(--td-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.context-menu button {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
}
.context-menu button:hover {
  background: var(--td-bg-color-container-hover);
}
.directory-form {max-height:calc(100dvh - 180px);overflow-y:auto;

  font: 13px/1.6 var(--app-font-family);
  color: var(--td-text-color-primary);
}
.directory-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 14px 0;
}
.directory-form input,
.directory-form select {
  width: 100%;
  box-sizing: border-box;
}
.directory-form .checkbox {
  flex-direction: row;
  align-items: center;
}
.checkbox input {
  width: auto;
}
.path-preview {
  padding: 12px;
  background: var(--td-bg-color-page);
  overflow-wrap: anywhere;
  border-radius: 5px;
}
.hint {
  color: var(--td-text-color-secondary);
  font-size: 12px;
}
.notice {
  padding: 12px;
  background: var(--td-warning-color-light);
  border-radius: 5px;
}
.error {
  padding: 12px;
  background: var(--td-error-color-light);
  color: var(--td-error-color);
  border-radius: 6px;
}
.success {
  color: var(--td-success-color);
}
footer {
  position: sticky;
  bottom: 0;
  background: var(--td-bg-color-container);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  border-top: 1px solid var(--td-component-stroke);
  padding: 16px 0;
  margin-top: 20px;
}
.tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
}
.tabs .active {
  color: var(--td-brand-color);
  border-color: var(--td-brand-color);
}
.history {
  font-size: 12px;
  max-height: 180px;
  overflow: auto;
  padding-left: 20px;
}
@media (max-width: 1000px) {
  .browser {
    grid-template-columns: 210px minmax(0, 1fr);
  }
  main {
    padding: 18px;
  }
  .actions {
    gap: 6px;
  }
}
@media (max-width: 767px) {
  .browser {
    display: block;
  }
  .tree-panel {
    border-right: 0;
    border-bottom: 1px solid var(--td-component-stroke);
  }
  .tree {
    max-height: 220px;
  }
  main {
    padding: 16px;
  }
  .list-heading {
    align-items: stretch;
    flex-direction: column;
  }
  .list-heading input {
    width: auto;
  }
  .content-heading {
    gap: 8px;
  }
}
</style>
