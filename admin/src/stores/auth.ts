import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const TOKEN_KEY = 'cim_wiki_admin_token'
const LOCALE_KEY = 'cim_wiki_admin_locale'

/**
 * The admin console manages projects, tokens and sync logs through the
 * open /api/v1/admin/* endpoints (gated by ADMIN_ENABLED + network policy),
 * so no interactive login is required. The store only persists an optional
 * project-token used to exercise the token-protected config/sync-status
 * endpoints from the console, plus the UI locale preference.
 */
export const useAuthStore = defineStore('adminAuth', () => {
  const token = ref<string>('')
  const locale = ref<string>('zh-CN')

  const hasToken = computed(() => !!token.value)

  function init() {
    try {
      token.value = localStorage.getItem(TOKEN_KEY) || ''
      const storedLocale = localStorage.getItem(LOCALE_KEY)
      if (storedLocale) locale.value = storedLocale
    } catch {
      // localStorage unavailable
    }
  }

  function setToken(value: string) {
    token.value = value
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value)
      else localStorage.removeItem(TOKEN_KEY)
    } catch {
      // ignore
    }
  }

  function setLocale(value: string) {
    locale.value = value
    try {
      localStorage.setItem(LOCALE_KEY, value)
    } catch {
      // ignore
    }
  }

  return { token, locale, hasToken, init, setToken, setLocale }
})
