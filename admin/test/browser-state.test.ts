import { beforeEach, expect, test, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useAuthStore } from '../src/stores/auth'
import { useBreakpoint } from '../src/composables/useBreakpoint'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.restoreAllMocks()
})

test('project token and locale persist, clear, and tolerate unavailable storage', () => {
  const store = useAuthStore()
  store.init()
  expect(store.locale).toBe('zh-CN')
  expect(store.hasToken).toBe(false)
  store.setToken('test-project-token')
  store.setLocale('en-US')
  setActivePinia(createPinia())
  const reopened = useAuthStore()
  reopened.init()
  expect(reopened.token).toBe('test-project-token')
  expect(reopened.locale).toBe('en-US')
  reopened.setToken('')
  expect(localStorage.getItem('cim_wiki_admin_token')).toBeNull()
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('storage disabled')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('storage disabled')
  })
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('storage disabled')
  })
  expect(() => {
    reopened.init()
    reopened.setToken('ephemeral')
    reopened.setToken('')
    reopened.setLocale('zh-CN')
  }).not.toThrow()
})

test('breakpoint responds to resize and removes its listener when unmounted', async () => {
  const removed = vi.spyOn(window, 'removeEventListener')
  Object.defineProperty(window, 'innerWidth', {
    value: 1200,
    configurable: true,
    writable: true,
  })
  const view = mount(
    defineComponent({
      setup() {
        const state = useBreakpoint()
        return () => h('p', `${state.width.value}:${state.isMobile.value}`)
      },
    }),
  )
  expect(view.text()).toBe('1200:false')
  window.innerWidth = 500
  window.dispatchEvent(new Event('resize'))
  await view.vm.$nextTick()
  expect(view.text()).toBe('500:true')
  view.unmount()
  expect(removed).toHaveBeenCalledWith('resize', expect.any(Function))
})
