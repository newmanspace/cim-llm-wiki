import { ref, computed, onMounted, onUnmounted, type ComputedRef } from 'vue'

/**
 * 单一断点来源，替代散落各视图的 window.resize 监听。
 * Element Plus 栅格 xs<768 sm≥768 md≥992 lg≥1200，这里对齐同一刻度。
 */
export function useBreakpoint(): {
  width: ComputedRef<number>
  isMobile: ComputedRef<boolean>
} {
  const winWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1200)
  const onResize = () => (winWidth.value = window.innerWidth)
  onMounted(() => window.addEventListener('resize', onResize))
  onUnmounted(() => window.removeEventListener('resize', onResize))

  return {
    width: computed(() => winWidth.value),
    isMobile: computed(() => winWidth.value < 768),
  }
}
