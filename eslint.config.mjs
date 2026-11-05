import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'

export default tseslint.config(
  { ignores: ['**/node_modules/**', 'data/**', 'reports/**', 'coverage/**', '**/dist/**', '**/.vitepress/cache/**', 'wiki/.vitepress/sidebar-data.mjs', '**/.vitepress/dist/**'] },
  { files: ['**/*.{js,mjs,cjs}'], extends: [js.configs.recommended], languageOptions: { globals: globals.node }, rules: { 'no-unused-vars': ['error', { ignoreRestSiblings: true }] } },
  { files: ['admin/**/*.{ts,vue}'], extends: [...tseslint.configs.recommended], languageOptions: { globals: globals.browser }, rules: { '@typescript-eslint/no-explicit-any': 'off' } },
  ...vue.configs['flat/essential'],
  { files: ['**/*.{js,mjs,cjs,ts,vue}'], ignores: ['**/test/**', '**/*.test.*'], rules: { complexity: ['error', 15], 'max-depth': ['error', 4], 'no-eval': 'error', 'no-implied-eval': 'error', 'no-new-func': 'error', 'no-promise-executor-return': 'error' } },
  // Existing Vue declaration scaffolding and route names are supported conventions.
  { files: ['admin/env.d.ts'], rules: { '@typescript-eslint/no-empty-object-type': 'off' } },
  { files: ['admin/**/*.vue'], rules: { 'vue/multi-word-component-names': ['error', { ignores: ['Dashboard'] }] } },
  { files: ['admin/**/*.vue'], languageOptions: { parserOptions: { parser: tseslint.parser }, globals: globals.browser } },
)
