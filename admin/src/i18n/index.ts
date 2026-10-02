import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'

const stored = (() => {
  try {
    return localStorage.getItem('cim_wiki_admin_locale') || 'zh-CN'
  } catch {
    return 'zh-CN'
  }
})()

const i18n = createI18n({
  legacy: false,
  locale: stored,
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
})

export default i18n
