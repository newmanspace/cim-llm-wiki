import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setImmediate } from 'node:timers/promises'
import AdmZip from 'adm-zip'

const response = (body, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
  })
function inputs(t) {
  const root = mkdtempSync(join(tmpdir(), 'parser-protocol-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const ext of ['md', 'pdf', 'xlsx', 'exe'])
    writeFileSync(join(root, 'source.' + ext), 'original-document-bytes')
  return root
}
async function moduleFor(t, settings = {}) {
  for (const [key, value] of Object.entries({
    DOCLING_ENDPOINT: 'http://docling.test',
    MARKITDOWN_ENDPOINT: 'http://markitdown.test',
    MINERU_ENDPOINT: 'http://mineru.test',
    MINERU_API_KEY: 'unit-key',
    ...settings,
  })) {
    const previous = process.env[key]
    process.env[key] = value
    t.after(() => {
      if (previous === undefined) delete process.env[key]
      else process.env[key] = previous
    })
  }
  return import(`../../wiki-service/parsers.mjs?case=${Math.random()}`)
}
async function polled(t, operation) {
  const result = operation.then(
    (value) => ({ value }),
    (error) => ({ error }),
  )
  await setImmediate()
  t.mock.timers.tick(5000)
  await setImmediate()
  const settled = await result
  if (settled.error) throw settled.error
  return settled.value
}

test('native inputs stay local while Office conversions honor server contracts and failures', async (t) => {
  const root = inputs(t),
    parser = await moduleFor(t)
  let body = {
      document: {
        md_content: '# Converted',
        images: [{ ext: 'png', data: 'aQ==' }],
      },
    },
    status = 200
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(url)
    assert.equal(
      await options.body.get('file').text(),
      'original-document-bytes',
    )
    return response(body, status)
  })
  assert.equal(
    (await parser.convertInput(join(root, 'source.md'))).engine,
    'simple',
  )
  assert.equal(requests.length, 0)
  assert.equal(
    (await parser.convertInput(join(root, 'source.xlsx'))).images.length,
    1,
  )
  body = { document: { markdown: '# Alternate' } }
  assert.equal(
    (await parser.convertInput(join(root, 'source.xlsx'))).md,
    '# Alternate',
  )
  body = { markdown: '# MarkItDown' }
  assert.equal(
    (await parser.convertInput(join(root, 'source.xlsx'), 'markitdown')).engine,
    'markitdown',
  )
  body = {}
  await assert.rejects(
    parser.convertInput(join(root, 'source.xlsx')),
    /markdown/,
  )
  status = 503
  await assert.rejects(parser.convertInput(join(root, 'source.xlsx')), /503/)
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('offline')
  })
  await assert.rejects(
    parser.convertInput(join(root, 'source.xlsx')),
    /offline/,
  )
  await assert.rejects(
    parser.convertInput(join(root, 'source.exe')),
    /Unsupported/,
  )
  await assert.rejects(
    parser.convertInput(join(root, 'source.md'), 'unknown'),
    /Unknown/,
  )
  const offline = await moduleFor(t, { DOCLING_ENDPOINT: '' })
  await assert.rejects(
    offline.convertInput(join(root, 'source.xlsx')),
    /ENDPOINT/,
  )
  const embedded = parser.embedImages(
    '<!-- image -->\n<!-- image -->',
    [
      { ext: 'invalid', data: 'aQ==' },
      { ext: 'jpg', data: 'ag==' },
    ],
    root,
    'document',
  )
  assert.equal(embedded.written, 2)
  assert.equal(
    readFileSync(join(root, 'document_assets/img-001.png'), 'utf8'),
    'i',
  )
  assert.equal(parser.embedImages('# No images', [], root, 'empty').written, 0)
})

test('MinerU selects compatible protocols and never falls back to local PDF parsing', async (t) => {
  const root = inputs(t),
    parser = await moduleFor(t),
    src = join(root, 'source.pdf')
  let version = 'v3'
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer unit-key')
    if (version === 'offline') throw new Error('offline')
    if (url.endsWith('/file_parse'))
      return version === 'v3'
        ? response({ results: { file: { md_content: '# V3' } } })
        : response('not found', 404)
    if (url.endsWith('/v1/file-urls/batch'))
      return version === 'v1'
        ? response({
            code: 0,
            data: { content_list: [{ content: 'Part' }, {}] },
          })
        : response('not found', 404)
    if (url.endsWith('/tasks')) return response({ task_id: 'task-1' })
    if (url.endsWith('/tasks/task-1'))
      return response({ status: version === 'failed' ? 'failed' : 'completed' })
    return response({ markdown: '# Async' })
  })
  assert.equal((await parser.convertInput(src)).md, '# V3')
  version = 'v1'
  assert.equal((await parser.convertInput(src)).md, 'Part')
  t.mock.timers.enable({ apis: ['setTimeout'] })
  version = 'async'
  assert.equal((await polled(t, parser.convertInput(src))).md, '# Async')
  version = 'failed'
  await assert.rejects(polled(t, parser.convertInput(src)), /解析失败/)
  version = 'offline'
  await assert.rejects(parser.convertInput(src), /offline/)
  const offline = await moduleFor(t, { MINERU_ENDPOINT: '' })
  await assert.rejects(offline.convertInput(src), /MINERU_ENDPOINT/)
})

test('MinerU V4 downloads Markdown from its result archive and rejects incomplete tasks', async (t) => {
  const root = inputs(t),
    parser = await moduleFor(t),
    src = join(root, 'source.pdf')
  const zip = new AdmZip()
  zip.addFile('document.md', Buffer.from('# V4'))
  let state = 'done',
    submit = { data: { batch_id: 'batch-1' } }
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.endsWith('/extract/file')) return response(submit)
    if (url.includes('/extract-results/'))
      return response({
        data: {
          extract_result: [
            { state, full_zip_url: 'http://mineru.test/archive.zip' },
          ],
        },
      })
    return new Response(zip.toBuffer())
  })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  assert.equal(
    await polled(t, parser.mineruV4Async('http://mineru.test', '', src)),
    '# V4',
  )
  state = 'failed'
  await assert.rejects(
    polled(t, parser.mineruV4Async('http://mineru.test', 'key', src)),
    /解析失败/,
  )
  submit = {}
  await assert.rejects(
    parser.mineruV4Async('http://mineru.test', '', src),
    /batch_id/,
  )
})
