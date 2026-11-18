import { effectScope, ref } from 'vue'
import { expect, it } from 'vitest'
import { usePagination } from '../usePagination'

it('returns matches on the first page after filtering and clamps after deletion', () => {
  const scope = effectScope()
  scope.run(() => {
    const items = ref(Array.from({ length: 101 }, (_, id) => id))
    const query = ref('')
    const state = usePagination(items, [query])
    state.page.value = 3
    expect(state.paged.value[0]).toBe(40)
    items.value = [100]
    query.value = '100'
    expect(state.page.value).toBe(1)
    expect(state.paged.value).toEqual([100])
    items.value = []
    expect(state.page.value).toBe(1)
    expect(state.total.value).toBe(0)
    expect(state.paged.value).toEqual([])
  })
  scope.stop()
})
it('preserves polling pages and resets when page size changes', () => {
  const scope = effectScope()
  scope.run(() => {
    const items = ref(Array.from({ length: 101 }, (_, id) => id))
    const state = usePagination(items)
    state.page.value = 3
    items.value = [...items.value]
    expect(state.page.value).toBe(3)
    state.pageSize.value = 50
    expect(state.page.value).toBe(1)
    expect(state.paged.value).toHaveLength(50)
    state.page.value = 3
    items.value = items.value.slice(0, 50)
    expect(state.page.value).toBe(1)
  })
  scope.stop()
})
