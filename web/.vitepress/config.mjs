import { defineConfig } from 'vitepress'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sidebar, nav } from './sidebar-data.mjs'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const srcDir = process.env.WIKI_ROOT || (existsSync(join(__dirname, '../../data/wiki')) ? '../data/wiki' : existsSync('/data/wiki') ? '/data/wiki' : 'data/wiki')

export default defineConfig({
  lang: 'zh-CN',
  title: 'CIM 知识库',
  description: '泛半导体 CIM/MES 全生命周期原子化 Wiki',
  srcDir,
  // 站点挂在 /wiki/ 前缀下，页面按项目分树：/<project>/<plane>/...
  // 完整 URL 形如 /wiki/xinshun-mes/doc/business/br-wip-001
  base: '/wiki/',
  cleanUrls: true,
  ignoreDeadLinks: true,
  lastUpdated: false,
  vite: {
    resolve: {
      alias: [
        { find: /^vue$/, replacement: require.resolve('vue') },
        { find: /^vue\/server-renderer$/, replacement: require.resolve('vue/server-renderer') }
      ]
    },
    server: {
      fs: {
        allow: ['..', '/app']
      }
    }
  },
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
