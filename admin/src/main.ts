import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import '@/assets/theme/theme.css'

import App from './App.vue'
import router from './router'
import i18n from './i18n'

const app = createApp(App)

// 全局注册 Element Plus 图标组件
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, component)
}

app.use(createPinia())
app.use(router)
app.use(i18n)
app.use(ElementPlus)

router.isReady().finally(() => {
  app.mount('#app')
})
