import { join } from 'node:path'
import {
  mkdirSync,
  writeFileSync,
  renameSync,
  cpSync,
  rmSync,
  existsSync,
  mkdtempSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  createDefaultsStore,
  checkDefinition,
  checkDocument,
  renderTemplate,
} from '../wiki-core/document-defaults.mjs'
import {
  initializeDirectory,
  readDirectory,
  updateDirectory,
} from '../wiki-core/product-directory.mjs'

export function createDocumentDefaults(projectRoot, wikiRoot) {
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
      false,
      data.actor || 'automation',
    )
    const definition = binding.definition
    const directories = definition.directories.map(({ node_types, ...d }) => ({
      ...d,
      ...(node_types.length ? { match: { types: node_types } } : {}),
    }))
    const contract = {
      schema_version: '1.0',
      project: data.project,
      modules: binding.modules,
      allow_unlisted: true,
      documents: definition.delivery,
    }
    const paths = ['directory.json', 'catalog', 'document-contract.json'].map(
      (p) => join(wikiRoot, data.project, p),
    )
    paths.push(join(projectRoot, 'data/document-defaults/state.json'))
    withRollback(projectRoot, paths, () => {
      const directory = readDirectory(data.project, { wikiRoot })
      if (upgrade && before.current && directory) {
        const prior = new Set(before.current.directories.map((d) => d.path)),
          next = new Set(directories.map((d) => d.path))
        directories.push(
          ...directory.directories.filter(
            (d) => !prior.has(d.path) && !next.has(d.path),
          ),
        )
      }
      if (!directory) {
        // Initialize directly from the one versioned directory definition.
        initializeDirectory(
          {
            project: data.project,
            name: data.name,
            version: data.product_version,
            modules: data.modules,
            delivery_contract: contract,
            directories,
          },
          { wikiRoot },
        )
      } else if (upgrade)
        updateDirectory(
          {
            project: data.project,
            expected_revision: directory.revision,
            directories,
          },
          { wikiRoot },
        )
      const base = join(wikiRoot, data.project)
      mkdirSync(base, { recursive: true })
      const file = join(base, 'document-contract.json'),
        temporary = file + '.' + randomUUID()
      writeFileSync(temporary, JSON.stringify(contract, null, 2) + '\n')
      renameSync(temporary, file)
      store.bind(
        data.project,
        data.modules,
        data.overrides || {},
        binding.version,
        upgrade,
        true,
        data.actor || 'automation',
      )
    })
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
        errors: checkDocument(template, data.document, {
          ...options,
          terms: definition.terms,
        }),
        template_id: template.id,
      }
    },
  }
}

function withRollback(projectRoot, paths, work) {
  mkdirSync(join(projectRoot, 'data'), { recursive: true })
  const backup = mkdtempSync(join(projectRoot, 'data/.document-defaults-'))
  const existing = paths.map((p) => existsSync(p))
  try {
    paths.forEach((p, i) => {
      if (existing[i]) cpSync(p, join(backup, String(i)), { recursive: true })
    })
    try {
      return work()
    } catch (error) {
      paths.forEach((p, i) => {
        rmSync(p, { recursive: true, force: true })
        if (existing[i]) cpSync(join(backup, String(i)), p, { recursive: true })
      })
      throw error
    }
  } finally {
    rmSync(backup, { recursive: true, force: true })
  }
}
