import { documentTargetErrors } from '../wiki-core/document-routing.mjs'
import {
  createDefaultsStore,
  checkDefinition,
  checkDocument,
  renderTemplate,
} from '../wiki-core/document-defaults.mjs'

export function createDocumentDefaults(projectRoot) {
  const store = createDefaultsStore(projectRoot)
  function initialize(data, upgrade = false) {
    const before = store.preview(data.project)
    if (!before.to_version)
      throw Object.assign(new Error('Publish global document defaults first'), {
        status: 409,
      })
    if (!upgrade && before.from_version) {
      const current = store.effective(data.project)
      if (JSON.stringify(current.modules) !== JSON.stringify(data.modules)) {
        if (!data.actor)
          throw Object.assign(
            new Error(
              'Module inventory changed; administrator rebinding is required',
            ),
            { status: 409 },
          )
        data = {
          ...data,
          version: current.version,
          overrides: current.overrides,
        }
        data.expected_digest = current.digest
        upgrade = true
      }
    }
    if (
      upgrade &&
      before.from_digest &&
      data.expected_digest !== before.from_digest
    )
      throw Object.assign(new Error('Project binding changed; preview again'), {
        status: 409,
      })
    const binding = store.bind(
      data.project,
      data.modules,
      data.overrides || {},
      data.version,
      upgrade,
      true,
      data.actor || 'automation',
    )
    const definition = binding.definition
    return { ...binding, directories: definition.directories }
  }
  return {
    store,
    initialize,
    render(data) {
      const definition =
        data.definition || store.effective(data.project).definition
      const template = definition.templates.find(
        (t) => t.id === data.template_id,
      )
      if (!template)
        throw Object.assign(new Error('Unknown template'), { status: 422 })
      const document = renderTemplate(template, data.values)
      return {
        document,
        template_id: template.id,
        errors: checkDocument(template, document, { terms: definition.terms }),
      }
    },
    check(data) {
      const definition =
        data.definition ||
        (data.project
          ? store.effective(data.project).definition
          : store.state().draft)
      if (data.document === undefined)
        return { errors: checkDefinition(definition) }
      const template = definition.templates.find(
        (t) => t.id === data.template_id,
      )
      if (!template)
        throw Object.assign(new Error('Unknown template'), { status: 422 })
      const { root, ...options } = data
      void root
      return {
        errors: [
          ...(Object.hasOwn(data, 'target_path') ? documentTargetErrors(definition, data.template_id, data.target_path) : []),
          ...checkDocument(template, data.document, {
            ...options,
            documentPath: data.target_path ?? options.documentPath,
            terms: definition.terms,
          }),
        ],
        template_id: template.id,
      }
    },
  }
}
