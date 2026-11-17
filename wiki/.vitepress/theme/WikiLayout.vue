<script setup>
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
const { theme } = useData()
</script>

<template>
  <DefaultTheme.Layout>
    <template #layout-top>
      <aside v-if="theme.previewId" class="wiki-preview-banner" role="status">
        预览，未发布 · 基线 Git {{ theme.gitCommit }} · 失效时间 {{ theme.previewExpires }}
        <a href="/admin/wiki-builds">返回审核与构建任务</a>
      </aside>
    </template>
    <template #doc-before>
      <p v-if="theme.gitCommit" class="wiki-source">来源 Git commit：{{ theme.gitCommit }}</p>
    </template>
  </DefaultTheme.Layout>
</template>

<style>
.wiki-preview-banner { position: relative; z-index: 100; padding: 10px 20px; background: #fff3cd; color: #473400; font-size: 13px; overflow-wrap: anywhere; }
.wiki-preview-banner a { margin-left: 16px; text-decoration: underline; }
.wiki-source { color: var(--vp-c-text-2); font-size: 12px; overflow-wrap: anywhere; }
</style>
