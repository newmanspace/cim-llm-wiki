import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { Pagination } from 'tdesign-vue-next'
import ListPagination from '../ListPagination.vue'

it('renders pagination and emits page update on page change', async () => {
  const wrapper = mount(ListPagination, {
    props: {
      page: 2,
      pageSize: 20,
      total: 100,
    },
  })

  const pagination = wrapper.findComponent(Pagination)
  expect(pagination.exists()).toBe(true)
  expect(pagination.props('current')).toBe(2)
  expect(pagination.props('pageSize')).toBe(20)
  expect(pagination.props('total')).toBe(100)

  pagination.vm.$emit('current-change', 3)
  expect(wrapper.emitted('update:page')?.[0]).toEqual([3])
})

it('emits page size change and resets page to 1 on resize', async () => {
  const wrapper = mount(ListPagination, {
    props: {
      page: 4,
      pageSize: 20,
      total: 100,
    },
  })

  const pagination = wrapper.findComponent(Pagination)
  pagination.vm.$emit('page-size-change', 50)
  expect(wrapper.emitted('update:pageSize')?.[0]).toEqual([50])
  expect(wrapper.emitted('update:page')?.[0]).toEqual([1])
})
