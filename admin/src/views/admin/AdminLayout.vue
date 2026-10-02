<template>
  <el-container class="admin-layout">
    <!-- 桌面侧栏 -->
    <el-aside v-if="!isMobile" :width="collapsed ? '64px' : '220px'" class="admin-aside">
      <div class="logo_row">
        <span v-if="!collapsed" class="logo-text" @click="router.push('/dashboard')">{{ t('common.appName') }}</span>
        <el-icon class="collapse-btn" @click="collapsed = !collapsed">
          <ExpandIcon v-if="collapsed" />
          <FoldIcon v-else />
        </el-icon>
      </div>
      <el-menu
        :default-active="activeMenu"
        :collapse="collapsed"
        :collapse-transition="false"
        router
        class="side-menu"
      >
        <el-menu-item index="/dashboard">
          <el-icon><Odometer /></el-icon>
          <template #title>{{ t('menu.dashboard') }}</template>
        </el-menu-item>
        <el-menu-item index="/projects">
          <el-icon><Folder /></el-icon>
          <template #title>{{ t('menu.projects') }}</template>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <!-- 顶栏 -->
      <el-header class="admin-header">
        <div class="header-left">
          <el-icon v-if="isMobile" class="hamburger" @click="drawerVisible = true"><MenuIcon /></el-icon>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/dashboard' }">{{ t('common.appName') }}</el-breadcrumb-item>
            <el-breadcrumb-item v-if="currentTitle">{{ currentTitle }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <el-button circle text @click="toggleTheme">
            <el-icon><MoonIcon v-if="!isDark" /><SunnyIcon v-else /></el-icon>
          </el-button>
          <el-select v-model="localeValue" size="small" class="lang-select" @change="onLocaleChange">
            <el-option value="zh-CN" label="简体中文" />
            <el-option value="en-US" label="English" />
          </el-select>
        </div>
      </el-header>

      <el-main class="admin-main">
        <router-view />
      </el-main>
    </el-container>

    <!-- 移动端抽屉导航 -->
    <el-drawer v-model="drawerVisible" direction="ltr" size="240px" :with-header="false">
      <div class="logo_row"><span class="logo-text">{{ t('common.appName') }}</span></div>
      <el-menu :default-active="activeMenu" router @select="drawerVisible = false">
        <el-menu-item index="/dashboard">
          <el-icon><Odometer /></el-icon>
          <template #title>{{ t('menu.dashboard') }}</template>
        </el-menu-item>
        <el-menu-item index="/projects">
          <el-icon><Folder /></el-icon>
          <template #title>{{ t('menu.projects') }}</template>
        </el-menu-item>
      </el-menu>
    </el-drawer>
  </el-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  Odometer,
  Folder,
  Expand as ExpandIcon,
  Fold as FoldIcon,
  Menu as MenuIcon,
  Moon as MoonIcon,
  Sunny as SunnyIcon,
} from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { useBreakpoint } from '@/composables/useBreakpoint'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const authStore = useAuthStore()

const collapsed = ref(false)
const drawerVisible = ref(false)

const { isMobile } = useBreakpoint()

const activeMenu = computed(() => {
  if (route.path.startsWith('/projects')) return '/projects'
  return route.path
})

const currentTitle = computed(() => {
  if (route.path.startsWith('/projects/')) return t('menu.projects')
  if (route.path === '/projects') return t('menu.projects')
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

// 深色模式（Element Plus 用 html.dark 类）
const isDark = ref(false)
function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark)
  isDark.value = dark
}
function toggleTheme() {
  applyTheme(!isDark.value)
}
onMounted(() => applyTheme(window.matchMedia('(prefers-color-scheme: dark)').matches))
</script>

<style scoped>
.admin-layout {
  height: 100vh;
}

.admin-aside {
  background: var(--el-bg-color);
  border-right: 1px solid var(--el-border-color-light);
  transition: width 0.2s ease;
  overflow: hidden;
}

.logo_row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.logo-text {
  font-size: 15px;
  font-weight: 700;
  color: var(--el-text-color-primary);
  white-space: nowrap;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
}

.collapse-btn {
  cursor: pointer;
  font-size: 18px;
  color: var(--el-text-color-secondary);
}

.side-menu {
  border-right: none;
}

.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color-light);
  height: 56px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.hamburger {
  font-size: 20px;
  cursor: pointer;
  color: var(--el-text-color-primary);
}

.lang-select {
  width: 120px;
}

.admin-main {
  background: var(--el-bg-color-page);
  padding: var(--cim-space-xl);
  overflow: auto;
}

@media (max-width: 767px) {
  .admin-main {
    padding: var(--cim-space-md);
  }
}
</style>
