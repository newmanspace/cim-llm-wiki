import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import AdminLayout from '@/views/admin/AdminLayout.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: AdminLayout,
    redirect: '/dashboard',
    children: [
      { path: 'settings/document-templates', name: 'documentTemplates', component: () => import('@/views/admin/DocumentTemplates.vue'), meta: { title: '全局项目文档模板定义' } },
      { path: 'document-directories', name: 'adminDocumentDirectories', component: () => import('@/views/admin/ProjectDocuments.vue'), props: { mode: 'directories' }, meta: { title: '文档目录与评分' } },
      { path: 'document-results', name: 'adminDocumentResults', component: () => import('@/views/admin/ProjectDocuments.vue'), props: { mode: 'results' }, meta: { title: '文档结果' } },
      {
        path: 'dashboard',
        name: 'adminDashboard',
        component: () => import('@/views/admin/Dashboard.vue'),
        meta: { title: 'Dashboard' },
      },
      {
        path: 'projects',
        name: 'adminProjects',
        component: () => import('@/views/admin/ProjectManagement.vue'),
        meta: { title: 'Projects' },
      },
      {
        path: 'projects/:id',
        name: 'adminProjectDetail',
        component: () => import('@/views/admin/ProjectDetail.vue'),
        meta: { title: 'Project Detail' },
      },
    ],
  },
]

const router = createRouter({
  history: createWebHistory('/admin/'),
  routes,
})

export default router
