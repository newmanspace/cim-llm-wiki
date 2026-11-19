// Run during maintenance; committed packages and evidence are conservatively pinned.
import { resolve } from 'node:path'
import { createDocumentUploads } from '../packages/wiki-service/document-uploads.mjs'
const root = process.env.CIM_WIKI_WORKSPACE
if (!root) throw new Error('Explicit CIM_WIKI_WORKSPACE is required')
console.log(JSON.stringify(createDocumentUploads({ projectRoot: resolve(root), roots: {} }).cleanup()))
