// Replace only the UI library: keep view state, events, i18n and Vue reactivity real.
import { defineComponent, h } from 'vue'
import { vi } from 'vitest'

export const validateForm = vi.fn(async () => true)
function container(name: string, tag = 'div') {
  return defineComponent({
    name,
    inheritAttrs: false,
    setup(_, { attrs, slots }) {
      return () =>
        h(
          tag,
          attrs,
          Object.values(slots).flatMap((slot) => slot?.() || []),
        )
    },
  })
}
const names = [
  'TCard',
  'TSpace',
  'TDropdown',
  'TDropdownMenu',
  'TDropdownItem',
  'TFormItem',
  'TEmpty',
  'TTag',
  'TLoading',
  'TTabs',
  'TTabPanel',
  'TDescriptions',
  'TDescriptionsItem',
  'TAlert',
  'TCheckboxGroup',
  'TCheckbox',
  'TInputNumber',
  'TPagination',
  'TBreadcrumb',
  'TBreadcrumbItem',
  'TTooltip',
  'TOption',
  'TSelect',
  'TSkeleton',
  'TConfigProvider',
]
export const components: Record<string, any> = Object.fromEntries(
  names.map((name) => [name, container(name)]),
)
components.TDropdownItem = container('TDropdownItem', 'button')
components.TButton = container('TButton', 'button')
components.TLink = container('TLink', 'a')
components.RouterLink = container('RouterLink', 'a')
components.RouterView = container('RouterView')
components.TTable = defineComponent({
  name: 'TTable',
  props: ['data', 'columns'],
  setup(props, { slots }) {
    return () =>
      h('section', { role: 'table' }, [
        h(
          'header',
          (props.columns || []).map((column: any) =>
            h(
              'span',
              typeof column.title === 'function'
                ? column.title()
                : column.title,
            ),
          ),
        ),
        ...(props.data || []).map((row: any) =>
          h(
            'div',
            { role: 'row' },
            (props.columns || []).map((column: any) => {
              const slot = slots[column.cell || column.colKey]
              const value = slot
                ? slot({ row })
                : typeof column.cell === 'function'
                  ? column.cell(h, { row })
                  : String(row[column.colKey] ?? '')
              return h('span', { role: 'cell' }, value)
            }),
          ),
        ),
        !(props.data || []).length && slots.empty?.(),
      ])
  },
})
components.TDialog = defineComponent({
  name: 'TDialog',
  props: ['visible', 'title', 'header'],
  setup(props, { slots }) {
    return () =>
      props.visible ? h('section', { role: 'dialog' }, slots.default?.()) : null
  },
})
components.TForm = defineComponent({
  name: 'TForm',
  setup(_, { slots, expose }) {
    expose({ validate: validateForm, clearValidate: vi.fn() })
    return () => h('form', slots.default?.())
  },
})
for (const name of ['TInput', 'TTextarea'])
  components[name] = defineComponent({
    name,
    props: ['modelValue', 'value'],
    emits: ['update:modelValue', 'change', 'clear'],
    setup(props, { attrs, emit }) {
      return () =>
        h(name === 'TInput' ? 'input' : 'textarea', {
          ...attrs,
          value: props.modelValue ?? props.value,
          onInput: (event: Event) => {
            const value = (event.target as HTMLInputElement).value
            emit('update:modelValue', value)
            emit('change', value)
          },
        })
    },
  })
