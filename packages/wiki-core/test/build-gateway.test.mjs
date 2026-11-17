import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../../', import.meta.url))
test('real nginx protects preview pages and search resources and hides serving internals', async t => {
  if (spawnSync('nginx', ['-v']).error) { t.skip('nginx executable not installed'); return }
  const root = mkdtempSync(join(tmpdir(), 'wiki-nginx-'))
  const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  let allowed = true, original = ''
  const upstream = createServer((req, res) => {
    original = req.headers['x-original-uri']
    const loggedIn = req.headers.cookie === 'session=valid'
    res.writeHead(loggedIn && allowed ? 200 : 403); res.end()
  })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const apiPort = upstream.address().port, sitePort = 30000 + Math.floor(Math.random() * 10000), gatewayPort = sitePort + 10001
  mkdirSync(join(root, 'wiki-site/html'), { recursive: true })
  mkdirSync(join(root, 'wiki-previews', id, 'assets'), { recursive: true })
  writeFileSync(join(root, 'wiki-site/html/index.html'), 'formal')
  writeFileSync(join(root, 'wiki-previews', id, 'index.html'), 'candidate')
  writeFileSync(join(root, 'wiki-previews', id, 'assets/search.js'), 'preview search')
  let site = readFileSync(join(repo, 'deploy/wiki/nginx.conf'), 'utf8').replace('listen 5174', `listen 127.0.0.1:${sitePort}`).replaceAll('/data/wiki-', root + '/wiki-')
  const gateway = readFileSync(join(repo, 'deploy/gateway/nginx.conf'), 'utf8').replace('listen 80', `listen 127.0.0.1:${gatewayPort}`).replaceAll('http://server:8080', `http://127.0.0.1:${apiPort}`).replaceAll('http://knowledge:8090', `http://127.0.0.1:${apiPort}`).replaceAll('http://admin:80', `http://127.0.0.1:${apiPort}`).replaceAll('http://cim-wiki-runtime:5174', `http://127.0.0.1:${sitePort}`)
  site = site.replace('server_name _;', 'server_name wiki-test;')
  const config = join(root, 'nginx.conf')
  writeFileSync(config, `${process.getuid() === 0 ? 'user root;' : ''}\npid ${root}/nginx.pid;\nerror_log ${root}/error.log;\nevents {}\nhttp { access_log off; ${site}\n${gateway}\n}`)
  const processHandle = spawn('nginx', ['-p', root, '-c', config, '-g', 'daemon off;'], { stdio: 'pipe' })
  try {
    const origin = `http://127.0.0.1:${gatewayPort}`
    let ready = false
    for (let n = 0; n < 100; n++) {
      try { await fetch(origin + '/', { redirect: 'manual' }); ready = true; break } catch { await delay(30) }
    }
    assert.ok(ready, readFileSync(join(root, 'error.log'), 'utf8'))
    const path = `/wiki-preview/${id}/`
    assert.equal((await fetch(origin + path)).status, 403)
    const headers = { cookie: 'session=valid' }
    const page = await fetch(origin + path, { headers })
    assert.equal(page.status, 200); assert.equal(await page.text(), 'candidate')
    assert.equal(original, path)
    const resource = await fetch(origin + path + 'assets/search.js', { headers })
    assert.equal(resource.status, 200)
    assert.match(resource.headers.get('cache-control'), /no-store/)
    allowed = false
    assert.equal((await fetch(origin + path + 'assets/search.js', { headers })).status, 403)
    allowed = true
    writeFileSync(join(root, 'wiki-site/.maintenance'), 'updating')
    assert.equal((await fetch(origin + '/wiki/', { headers })).status, 503)
    rmSync(join(root, 'wiki-site/.maintenance'))
    assert.equal(await (await fetch(origin + '/wiki/', { headers })).text(), 'formal')
    assert.equal((await fetch(origin + '/wiki/.publish-backup/index.html', { headers })).status, 403)
  } finally {
    processHandle.kill('SIGTERM')
    await new Promise(resolve => { if (processHandle.exitCode !== null) resolve(); else processHandle.once('exit', resolve) })
    await new Promise(resolve => upstream.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
})
