import axios from 'axios'
import { MessagePlugin } from 'tdesign-vue-next'
import { useAuthStore } from '@/stores/auth'

const client = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Attach the stored project-token when present (only needed for the
// token-protected config / sync-status endpoints).
client.interceptors.request.use((config) => {
  try {
    const authStore = useAuthStore()
    if (authStore.token) {
      config.headers.Authorization = `Bearer ${authStore.token}`
    }
  } catch {
    // store not ready yet
  }
  return config
})

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      MessagePlugin.error('Unauthorized: invalid or expired token')
      // 供后续与 weknora 主应用整合时通知父窗口重新鉴权
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'admin-auth-expired' }, '*')
      }
    }
    return Promise.reject(error)
  },
)

export default client
