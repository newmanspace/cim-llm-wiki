<template>
  <div class="admin-layout">
    <!-- 桌面侧栏（对齐 weknora 自定义侧栏写法） -->
    <div v-if="!isMobile" class="admin-sidebar" :class="{ 'admin-sidebar--collapsed': collapsed }">
      <div class="logo_row">
        <span v-if="!collapsed" class="logo-text" @click="router.push('/dashboard')">
          {{ t('common.appName') }}
        </span>
        <t-tooltip :content="collapsed ? t('menu.expandSidebar') : t('menu.collapseSidebar')" placement="right">
          <button type="button" class="sidebar-toggle" :aria-label="collapsed ? t('menu.expandSidebar') : t('menu.collapseSidebar')" :aria-expanded="!collapsed" @click="collapsed = !collapsed">
            <ChevronRightIcon v-if="collapsed" class="icon" />
            <ChevronLeftIcon v-else class="icon" />
          </button>
        </t-tooltip>
      </div>

      <div class="menu_top">
        <div class="menu_box" v-for="item in menuItems" :key="item.path">
          <t-tooltip :content="item.label" placement="right" :disabled="!collapsed">
            <router-link :to="{ path: item.path, query: route.query.project || route.params.id ? { project: String(route.query.project || route.params.id) } : {} }" class="menu_item" :class="{ menu_item_active: isActive(item.path) }" :aria-current="isActive(item.path) ? 'page' : undefined">
              <div class="menu_item-box">
                <div class="menu_icon"><component :is="item.icon" class="icon" /></div>
                <span v-if="!collapsed" class="menu_title" :title="item.label">{{ item.label }}</span>
              </div>
            </router-link>
          </t-tooltip>
        </div>
        <SystemSettingsMenu :collapsed="collapsed" @expand="collapsed = false" />
      </div>
    </div>

    <div class="admin-body" :inert="drawerOpen || undefined">
      <!-- 顶栏：面包屑 + 语言 + 主题 -->
      <div class="admin-topbar">
        <div class="topbar-left">
          <button v-if="isMobile" ref="menuTrigger" type="button" class="hamburger" aria-label="打开导航" :aria-expanded="drawerOpen" aria-controls="mobile-navigation" @click="drawerOpen = true"><MenuIcon class="icon" /></button>
          <t-breadcrumb max-item-width="160">
            <t-breadcrumb-item :to="{ path: '/dashboard' }">{{ t('common.appName') }}</t-breadcrumb-item>
            <t-breadcrumb-item v-if="route.path.startsWith('/settings/')">系统设置</t-breadcrumb-item>
            <t-breadcrumb-item v-if="currentTitle">{{ currentTitle }}</t-breadcrumb-item>
          </t-breadcrumb>
        </div>
        <div class="topbar-right">
          <t-tooltip :content="isDark ? t('menu.lightMode') : t('menu.darkMode')" placement="bottom">
            <button type="button" class="icon-btn" :aria-label="isDark ? t('menu.lightMode') : t('menu.darkMode')" @click="toggleTheme">
              <SunnyIcon v-if="isDark" class="icon" />
              <MoonIcon v-else class="icon" />
            </button>
          </t-tooltip>
          <t-select v-model="localeValue" size="small" class="lang-select" @change="onLocaleChange">
            <t-option value="zh-CN" label="简体中文" />
            <t-option value="en-US" label="English" />
          </t-select>
        </div>
      </div>

      <div class="admin-content">
        <router-view />
      </div>
    </div>

    <!-- 移动端抽屉导航 -->
    <div v-if="isMobile && drawerOpen" class="drawer-mask" @click="drawerOpen = false" @keydown="drawerKeydown">
      <div id="mobile-navigation" ref="drawerPanel" class="admin-sidebar admin-drawer" role="dialog" aria-modal="true" aria-label="导航菜单" @click.stop>
        <div class="logo_row">
          <span class="logo-text">{{ t('common.appName') }}</span>
          <button type="button" class="sidebar-toggle" aria-label="关闭导航" @click="drawerOpen = false"><CloseIcon class="icon" /></button>
        </div>
        <div class="menu_top">
          <div class="menu_box" v-for="item in menuItems" :key="item.path">
            <router-link :to="{ path: item.path, query: route.query.project || route.params.id ? { project: String(route.query.project || route.params.id) } : {} }" class="menu_item" :class="{ menu_item_active: isActive(item.path) }" :aria-current="isActive(item.path) ? 'page' : undefined" @click="drawerOpen = false">
              <div class="menu_item-box">
                <div class="menu_icon"><component :is="item.icon" class="icon" /></div>
                <span class="menu_title">{{ item.label }}</span>
              </div>
            </router-link>
          </div>
          <SystemSettingsMenu @navigate="drawerOpen = false" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  DashboardIcon,
  FolderIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MenuIcon,
  CloseIcon,
  MoonIcon,
  SunnyIcon,
} from 'tdesign-icons-vue-next'
import { useAuthStore } from '@/stores/auth'
import { useBreakpoint } from '@/composables/useBreakpoint'
import SystemSettingsMenu from '@/components/SystemSettingsMenu.vue'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const authStore = useAuthStore()
const { isMobile } = useBreakpoint()

const collapsed = ref(false)
const drawerOpen = ref(false)
const menuTrigger = ref<HTMLButtonElement>()
const drawerPanel = ref<HTMLElement>()
watch(drawerOpen, async open => {
  await nextTick()
  if (open) drawerPanel.value?.querySelector<HTMLButtonElement>('button')?.focus()
  else menuTrigger.value?.focus()
})
watch(isMobile, mobile => { if (!mobile) drawerOpen.value = false })
function drawerKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); drawerOpen.value = false; return }
  if (event.key !== 'Tab') return
  const controls = Array.from(drawerPanel.value?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]') || [])
  const first = controls[0], last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}

const menuItems = computed(() => [
  { path: '/dashboard', label: t('menu.dashboard'), icon: DashboardIcon },
  { path: '/projects', label: t('menu.projects'), icon: FolderIcon },
  { path: '/document-directories', label: '文档目录与评分', icon: FolderIcon },
  { path: '/document-results', label: '文档结果', icon: FolderIcon },
  { path: '/wiki-builds', label: 'Wiki 构建与预览', icon: FolderIcon },
])

function isActive(path: string) {
  return route.path === path || route.path.startsWith(path + '/')
}

const currentTitle = computed(() => {
  if (route.path === '/document-directories') return '文档目录与评分'
  if (route.path === '/document-results') return '文档结果'
  if (route.path === '/wiki-builds') return 'Wiki 构建与预览'
  if (route.path === '/settings/document-templates') return '全局项目文档模板定义'
  if (route.path.startsWith('/projects')) return t('menu.projects')
  if (route.path === '/dashboard') return t('menu.dashboard')
  return ''
})

// 语言
const localeValue = ref(locale.value)
watch(
  () => locale.value,
  (v) => (localeValue.value = v),
)
function onLocaleChange(value: string) {
  locale.value = value
  authStore.setLocale(value)
}

// 深色模式：weknora 约定用 :root[theme-mode="dark"] 切换
const isDark = ref(false)
function applyTheme(dark: boolean) {
  isDark.value = dark
  document.documentElement.setAttribute('theme-mode', dark ? 'dark' : 'light')
}
function toggleTheme() {
  applyTheme(!isDark.value)
  localStorage.setItem('cim_admin_theme', isDark.value ? 'dark' : 'light')
}
onMounted(() => {
  const saved = localStorage.getItem('cim_admin_theme')
  applyTheme(saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches)
})
</script>

<style scoped>
.admin-layout {
  display: flex;
  height: 100vh;
  background: var(--td-bg-color-page);
}

/* ── 侧栏 ── */
.admin-sidebar {
  width: 220px;
  flex-shrink: 0;
  padding: 8px 6px;
  background: var(--td-bg-color-sidebar);
  border-right: 1px solid var(--td-component-stroke);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  transition: width 0.25s ease;
}

.admin-sidebar--collapsed {
  width: 60px;
}

.logo_row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 8px;
  flex-shrink: 0;
}

.logo-text {
  font-size: 15px;
  font-weight: 700;
  color: var(--td-text-color-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}

.sidebar-toggle,
.icon-btn,
.hamburger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 0;
  background: transparent;
  padding: 0;
  border-radius: var(--td-radius-default);
  color: var(--td-text-color-secondary);
  cursor: pointer;
}

.sidebar-toggle:hover,
.icon-btn:hover,
.hamburger:hover {
  background: var(--td-bg-color-container-hover);
  color: var(--td-text-color-primary);
}

.menu_top {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.menu_item {
  display: block;
  text-decoration: none;
  color: var(--td-text-color-secondary);
  border-radius: var(--td-radius-default);
}

.menu_item-box {
  display: flex;
  align-items: center;
  height: 40px;
  padding: 0 12px;
  gap: 10px;
}

.admin-sidebar--collapsed .menu_item-box {
  justify-content: center;
  padding: 0;
}

.menu_item:hover {
  background: var(--td-bg-color-container-hover);
  color: var(--td-text-color-primary);
}

.menu_item_active {
  color: var(--td-brand-color);
}

.menu_item_active .menu_item-box {
  background: var(--td-brand-color-light);
}

.menu_icon .icon {
  font-size: 18px;
}

.menu_title {
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── 主区 ── */
.admin-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.admin-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding: 0 20px;
  background: var(--td-bg-color-container);
  border-bottom: 1px solid var(--td-component-stroke);
  flex-shrink: 0;
}

.topbar-left,
.topbar-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.lang-select {
  width: 120px;
}

.admin-content {
  flex: 1;
  overflow: auto;
  padding: 16px;
}

@media (max-width: 767px) {
  .admin-topbar { padding: 0 12px; gap: 8px; }
  .topbar-left { flex: 1; min-width: 0; overflow: hidden; gap: 8px; }
  .topbar-left .hamburger { flex-shrink: 0; }
  .topbar-left :deep(.t-breadcrumb) { min-width: 0; overflow: hidden; white-space: nowrap; }
  .topbar-right { flex-shrink: 0; gap: 8px; }
  .lang-select { width: 100px; }
  .admin-content {
    padding: 12px;
  }
}

/* ── 移动端抽屉 ── */
.drawer-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 2500;
  display: flex;
}

.admin-drawer {
  width: 240px;
  box-shadow: var(--td-shadow-2);
}
</style>
