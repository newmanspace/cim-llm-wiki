import { computed, ref, watch, type Ref, type WatchSource } from 'vue'

/** Keep filtering, refreshes and deletions on a valid page without resetting polls. */
export function usePagination<T>(items: Ref<T[]>, resetOn: WatchSource[] = []) {
  const page = ref(1)
  const pageSize = ref(20)
  const total = computed(() => items.value.length)
  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
  watch(pageCount, count => { page.value = Math.min(page.value, count) }, { flush: 'sync' })
  watch([pageSize, ...resetOn], () => { page.value = 1 }, { flush: 'sync' })
  const paged = computed(() => items.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
  return { page, pageSize, total, paged }
}
