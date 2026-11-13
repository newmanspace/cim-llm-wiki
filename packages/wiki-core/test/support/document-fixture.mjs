import {
  builtinDefaults,
  createDefaultsStore,
} from '../../document-defaults.mjs'
import { formatTemplate } from '../../document-format.mjs'

export function bindFixture(projectRoot, project) {
  const store = createDefaultsStore(projectRoot)
  if (!store.state().published_version) {
    const definition = builtinDefaults()
    definition.delivery = [
      { id: 'test-documents', type: 'requirement', scope: 'project', min: 0 },
    ]
    // These fixtures isolate the existing node-type contracts. New template
    // contract behavior is exercised by document-defaults tests separately.
    for (const t of definition.templates) {
      // Domain sections keep the state table bound in its original order.
      if (t.id !== 'business-object')
        t.contract.sections = ['文档信息', '参考文档', '修订记录']
      t.contract.tables = t.contract.tables.filter(
        (x) => ['文档信息', '参考文档', '修订记录'].includes(x.section) ||
          // Preserve the confirmed domain contract's empty state-machine case.
          (t.id === 'business-object' && x.section === '3. State Machine'),
      )
      delete t.contract.identifiers
      delete t.contract.references
      delete t.contract.section_groups
    }
    store.save(definition, 0, 'Test Administrator')
    store.publish(1, 'Test Administrator')
  }
  store.bind(project, ['test'])
}

export function managedBody(body, reviewer = 'auto') {
  if (/^# [^\n]+$/.test(body.trim())) return body
  const template = builtinDefaults().templates[0].example.replace(
    '待指定',
    reviewer,
  )
  let info = template.match(/## 文档信息\n[\s\S]*?(?=\n## )/)[0].trim()
  const footer = '## 参考文档\n\n无参考文档：本测试隔离节点类型检查。\n\n' +
    template.slice(template.indexOf('## 修订记录'))
  const match = body.match(/^# ([^\n]+)\n*/)
  info = info.replace(/\| 文档名称 \| [^\n]+/, '| 文档名称 | ' + (match?.[1] || 'Test Document') + ' |')
  const text = `${match ? match[0] : '# Test Document\n\n'}${info}\n\n${match ? body.slice(match[0].length) : body}\n\n${footer}`
  return formatTemplate({ ...builtinDefaults().templates[0], body: text, example: text }).example
}
