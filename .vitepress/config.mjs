import { defineConfig } from 'vitepress'
import { sidebar, nav } from '../sidebar-data.mjs'

export default defineConfig({
  lang: 'zh-CN',
  title: 'CIM 知识库',
  description: '泛半导体 CIM/MES 全生命周期原子化 Wiki',
  srcDir: 'data/wiki',
  cleanUrls: true,
  ignoreDeadLinks: true,
  lastUpdated: true,
  search: {
    provider: 'local',
    options: {
      translations: {
        button: { buttonText: '搜索知识', buttonAriaLabel: '搜索知识' },
        modal: {
          noResultsText: '无法找到相关结果',
          resetButtonTitle: '清除查询条件',
          footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' }
        }
      }
    }
  },
  themeConfig: {
    nav,
    sidebar,
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一页', next: '下一页' },
    lastUpdatedText: '最后更新',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '返回顶部'
  }
})
