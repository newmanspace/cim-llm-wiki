import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { builtinDefaults, checkDefinition, checkDocument, createDefaultsStore } from '../document-defaults.mjs'

const sdd = () => builtinDefaults().templates.find((t) => t.id === 'sdd')
const errors = (text) => checkDocument(sdd(), text).filter((d) => d.severity === 'error')

test('SDD uses the confirmed structure with continuous numbering and omits removed sections', () => {
  const template = sdd()
  assert.deepEqual(errors(template.example), [])
  assert.match(template.body, /^### 4\.8 监控与告警设计$/m)
  assert.match(template.body, /^#### 3\.1\.10 内部接口与外部集成$/m)
  assert.doesNotMatch(template.body, /相关方列表|操作资料与培训|容量与扩展设计|可维护性设计|可测试性设计|IT 解决方案/)
  const changed = template.example.replace('### 1.3 集成范围', '### 集成范围')
  assert.ok(errors(changed).some((d) => d.rule_id === 'section_required'))
  assert.ok(errors(template.example.replace('### 4.1 兼容性设计', '### 兼容性'))
    .some((d) => d.rule_id === 'section_required'))
  const moved = template.example.replace('### 1.2 功能范围', '### TEMP')
    .replace('### 1.3 集成范围', '### 1.2 功能范围').replace('### TEMP', '### 1.3 集成范围')
  assert.ok(errors(moved).some((d) => d.rule_id === 'section_order'))
})

test('every SDD function requires its own ordered subsections within its parent', () => {
  const document = sdd().example
  const start = document.indexOf('### 3.1 示例功能')
  const end = document.indexOf('## 4. 非功能性设计')
  const first = document.slice(start, end)
  const second = first.replaceAll('3.1', '3.2').replaceAll('FUN-001', 'FUN-002')
  const two = document.slice(0, end) + second + document.slice(end)
  assert.deepEqual(errors(two), [])
  assert.ok(errors(two.replace('#### 3.2.4 检查逻辑', '#### 已移除检查逻辑'))
    .some((d) => d.rule_id === 'section_required' && d.expected === '3.2.4 检查逻辑'))
  assert.ok(errors(two.replace('### 3.2 示例功能', '### 3.3 示例功能'))
    .some((d) => d.rule_id === 'section_group_number'))
  const noFunctions = document.slice(0, start) + document.slice(end)
  assert.ok(errors(noFunctions).some((d) => d.rule_id === 'section_group_required'))
  const fenced = document.slice(0, start) + '```markdown\n' + first + '```\n\n' + document.slice(end)
  assert.ok(errors(fenced).some((d) => d.rule_id === 'section_group_required'))
})

test('SDD mapping cannot reference an absent function and unknown group contracts are rejected', () => {
  const template = sdd()
  assert.ok(errors(template.example.replace('| REQ-001 | FUN-001 | 3.1 |', '| REQ-001 | FUN-404 | 3.1 |'))
    .some((d) => d.rule_id === 'identifier_reference'))
  const definition = builtinDefaults()
  definition.templates.find((t) => t.id === 'sdd').contract.section_groups[0].parent = '9. 未声明章节'
  assert.ok(checkDefinition(definition).some((d) => d.rule_id === 'section_group_contract'))
})

test('project overrides cannot remove or weaken the confirmed per-function structure', () => {
  const root = mkdtempSync(join(tmpdir(), 'sdd-contract-'))
  try {
    const store = createDefaultsStore(root)
    store.publish(0, 'Administrator')
    const template = sdd()
    template.contract.section_groups[0].sections.pop()
    assert.throws(() => store.bind('demo', ['module'], { templates: [template] }), /weaken/)
    template.contract.section_groups = sdd().contract.section_groups
    template.contract.section_groups[0].sections.reverse()
    assert.throws(() => store.bind('demo', ['module'], { templates: [template] }), /weaken/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
