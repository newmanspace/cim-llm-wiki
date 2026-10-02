import axios from 'axios'
import { ElMessage } from 'element-plus'
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
    const msg = error.response?.data?.error || error.message || 'request failed'
    if (error.response?.status === 401) {
      ElMessage.error('Unauthorized: invalid or expired token')
    }
    return Promise.reject(error)
  },
)

export default client
