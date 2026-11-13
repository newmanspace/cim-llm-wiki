import { test } from 'node:test'
import assert from 'node:assert/strict'
import { builtinDefaults, checkDocument, checkDefinition } from '../document-defaults.mjs'
import { formatTemplate, FORMAT_TABLES } from '../document-format.mjs'

const template = () => builtinDefaults().templates.find((t) => t.id === 'glossary')
const rules = (text) => checkDocument(template(), text).map((d) => d.rule_id)

test('all builtins explicitly declare the common format, tables and a numbered body', () => {
  const definition = builtinDefaults()
  assert.deepEqual(checkDefinition(definition), [])
  for (const t of definition.templates) {
    assert.equal(t.contract.format, 'markdown-v1')
    for (const rule of FORMAT_TABLES)
      assert.deepEqual(t.contract.tables.find((r) => r.section === rule.section), rule)
    assert.match(t.body, /^## 1\. \S/m)
    assert.deepEqual(formatTemplate(t), t)
  }
})

test('title, common field order, reference table and document layout are enforced', () => {
  const text = template().example
  assert.ok(rules(text.replace('# Glossary 术语表', '# Another title')).includes('document_name'))
  const swapped = text.replace('| 文档 ID | DOC-001 |\n| 文档名称 | Glossary 术语表 |',
    '| 文档名称 | Glossary 术语表 |\n| 文档 ID | DOC-001 |')
  assert.ok(rules(swapped).includes('document_field_order'))
  assert.ok(rules(text.replace('| 文档名称或链接 | 参考用途 |\n| --- | --- |', '')).includes('table_required'))
  assert.ok(rules(text + '\n\n## 2. 附加正文\n\n实际内容。').includes('document_layout'))
  const noBody = text.slice(0, text.indexOf('## 1. 术语定义')) + text.slice(text.indexOf('## 参考文档'))
  assert.ok(rules(noBody).includes('document_body'))
})

test('numbering ignores fenced examples, rejects skipped numbers and requires applicability reasons', () => {
  const text = template().example
  assert.ok(rules(text.replace('## 1. 术语定义', '## 2. 术语定义')).includes('heading_number'))
  const fenced = text.replace('## 参考文档', '```markdown\n## 99. Example only\n```\n\n## 参考文档')
  assert.ok(!rules(fenced).includes('heading_number'))
  const noReason = text.replace('## 参考文档', '### 1.1 补充说明\n\n不涉及\n\n## 参考文档')
  assert.ok(rules(noReason).includes('not_applicable_reason'))
  assert.ok(!rules(noReason.replace('不涉及\n', '不涉及：本术语表没有附加术语。\n')).includes('not_applicable_reason'))
})

test('revision times require UTC timestamps and format declarations cannot be removed or weakened', () => {
  const t = template()
  assert.ok(rules(t.example.replace('| v1.0 | 2026-11-13T00:00:00Z |', '| v1.0 | 2026-11-13 |')).includes('revision_datetime'))
  delete t.contract.format
  assert.throws(() => checkDocument(t, t.example), /common document format/)
  const definition = builtinDefaults()
  definition.templates[0].contract.tables = definition.templates[0].contract.tables.filter((r) => r.section !== '参考文档')
  assert.ok(checkDefinition(definition).some((d) => d.rule_id === 'document_format_contract'))
})
