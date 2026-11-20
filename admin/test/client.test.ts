import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import client from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import { MessagePlugin } from 'tdesign-vue-next'

vi.mock('tdesign-vue-next', async (original) => ({
  ...(await original<typeof import('tdesign-vue-next')>()),
  MessagePlugin: {
    error: vi.fn(),
  },
}))

describe('api client interceptors', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('attaches Authorization header when authStore has token', async () => {
    const auth = useAuthStore()
    auth.token = 'test-token-123'

    const handlers = (client.interceptors.request as any).handlers
    const requestInterceptor = handlers[0].fulfilled
    const config = await requestInterceptor({ headers: {} })
    expect(config.headers.Authorization).toBe('Bearer test-token-123')
  })

  it('leaves Authorization header unset when authStore has no token', async () => {
    const auth = useAuthStore()
    auth.token = ''

    const handlers = (client.interceptors.request as any).handlers
    const requestInterceptor = handlers[0].fulfilled
    const config = await requestInterceptor({ headers: {} })
    expect(config.headers.Authorization).toBeUndefined()
  })

  it('passes through successful response', async () => {
    const handlers = (client.interceptors.response as any).handlers
    const responseInterceptor = handlers[0].fulfilled
    const mockRes = { data: 'ok', status: 200 }
    expect(responseInterceptor(mockRes)).toBe(mockRes)
  })

  it('handles 401 response error with message and postMessage', async () => {
    const handlers = (client.interceptors.response as any).handlers
    const errorInterceptor = handlers[0].rejected
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {})

    const err = { response: { status: 401 } }
    await expect(errorInterceptor(err)).rejects.toEqual(err)
    expect(MessagePlugin.error).toHaveBeenCalledWith('Unauthorized: invalid or expired token')
    expect(postMessageSpy).not.toHaveBeenCalled()
    postMessageSpy.mockRestore()
  })
})
