<template>
  <div class="settings-menu">
    <t-tooltip content="系统设置" placement="right" :disabled="!collapsed">
      <button
        type="button"
        class="settings-toggle"
        :class="{ 'settings-toggle-active': active }"
        :aria-expanded="expanded && !collapsed"
        aria-label="系统设置"
        @click="toggle"
      >
        <SettingIcon class="settings-icon" />
        <span v-if="!collapsed" class="settings-label">系统设置</span>
        <ChevronDownIcon
          v-if="!collapsed"
          class="settings-chevron"
          :class="{ 'settings-chevron-open': expanded }"
        />
      </button>
    </t-tooltip>
    <div v-if="expanded && !collapsed" class="settings-children">
      <router-link
        :to="{ path: '/settings/document-templates', query: projectQuery }"
        class="settings-child"
        :class="{ 'settings-child-active': active }"
        :aria-current="active ? 'page' : undefined"
        @click="emit('navigate')"
      >
        文档模板
      </router-link>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ChevronDownIcon, SettingIcon } from 'tdesign-icons-vue-next'

const props = defineProps<{ collapsed?: boolean }>()
const emit = defineEmits<{ expand: []; navigate: [] }>()
const route = useRoute()
const active = computed(() => route.path.startsWith('/settings/'))
const expanded = ref(active.value)
const projectQuery = computed(() => {
  const project = route.query.project || route.params.id
  return project ? { project: String(project) } : {}
})

watch(active, (value) => {
  if (value) expanded.value = true
})

function toggle() {
  if (props.collapsed) {
    expanded.value = true
    emit('expand')
  } else {
    expanded.value = !expanded.value
  }
}
</script>

<style scoped>
.settings-toggle {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--td-radius-default);
  background: transparent;
  color: var(--td-text-color-secondary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.settings-toggle:hover,
.settings-child:hover {
  background: var(--td-bg-color-container-hover);
  color: var(--td-text-color-primary);
}

.settings-icon {
  flex-shrink: 0;
  font-size: 18px;
}

.settings-label,
.settings-child {
  font-size: 14px;
}

.settings-chevron {
  margin-left: auto;
  transition: transform 0.2s;
}

.settings-chevron-open {
  transform: rotate(180deg);
}

.settings-child {
  display: flex;
  align-items: center;
  min-height: 40px;
  padding-left: 40px;
  border-radius: var(--td-radius-default);
  color: var(--td-text-color-secondary);
  text-decoration: none;
}

.settings-toggle-active,
.settings-child-active {
  color: var(--td-brand-color);
}

.settings-child-active {
  background: var(--td-brand-color-light);
}
</style>
