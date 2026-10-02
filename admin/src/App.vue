<template>
  <el-config-provider :locale="epLocale">
    <router-view />
  </el-config-provider>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import enUs from 'element-plus/es/locale/lang/en'
import { useAuthStore } from '@/stores/auth'

const { locale } = useI18n()
const authStore = useAuthStore()

const localeMap: Record<string, any> = {
  'zh-CN': zhCn,
  'en-US': enUs,
}
const epLocale = computed(() => localeMap[locale.value] || zhCn)

onMounted(() => {
  authStore.init()
})
</script>

<style>
html,
body,
#app {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue',
    Arial, 'Noto Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
</style>
