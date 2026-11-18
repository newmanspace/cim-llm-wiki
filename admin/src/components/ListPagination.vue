<script setup lang="ts">
import { Pagination } from 'tdesign-vue-next'
import { useBreakpoint } from '@/composables/useBreakpoint'
const { isMobile } = useBreakpoint()
defineProps<{ page: number; pageSize: number; total: number; disabled?: boolean }>()
const emit = defineEmits<{ 'update:page': [value: number]; 'update:pageSize': [value: number] }>()
function resize(value: number) {
  emit('update:pageSize', value)
  emit('update:page', 1)
}
</script>
<template>
  <div class="list-pagination" aria-label="列表分页">
    <Pagination :current="page" :page-size="pageSize" :total="total" :disabled="disabled"
      :page-size-options="[10, 20, 50, 100]" size="small" :theme="isMobile ? 'simple' : 'default'" :show-jumper="!isMobile"
      @current-change="emit('update:page', $event)" @page-size-change="resize" />
  </div>
</template>
<style scoped>
.list-pagination { padding: 8px 0; background: var(--td-bg-color-container); position: sticky; bottom: 0; z-index: 1; }
:deep(.t-pagination) { flex-wrap: wrap; gap: 8px; }
</style>
