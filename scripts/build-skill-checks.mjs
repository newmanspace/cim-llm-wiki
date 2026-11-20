// Rebuild the standalone Skill checker after changing authoring rules.
import { rolldown } from '../admin/node_modules/rolldown/dist/index.mjs'
const build = await rolldown({ input: 'packages/wiki-core/local-ingest.mjs', platform: 'node' })
await build.write({ file: '.agents/skills/cim-wiki/scripts/dist/local-ingest.mjs', format: 'esm', minify: true })
await build.close()
