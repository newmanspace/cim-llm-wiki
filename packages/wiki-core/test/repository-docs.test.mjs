import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import MarkdownIt from 'markdown-it'
import { repositoryCommit, repositoryKind, repositoryNavigation, repositoryMarkdown } from '../repository-docs.mjs'
import { captureSnapshot, snapshotContext } from '../build-snapshot.mjs'
import { createProjectWiki } from '../../wiki-service/project-wiki.mjs'
import { createBuildRuntime } from '../../wiki-service/build-runtime.mjs'

function fixture(t) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'repository-docs-'))
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }))
  const projects = createProjectWiki({ projectRoot }), source = join(projectRoot, 'data/projects/demo/wiki')
  projects.configure('demo', { sourceDirectory: source, contentKind: repositoryKind })
  projects.initialize('demo')
  mkdirSync(join(source, 'doc'), { recursive: true })
  writeFileSync(join(source, 'README.md'), '# Repository home\n\n[Design](doc/design.md)\n')
  writeFileSync(join(source, 'doc/design.md'), '# Design\n\n{{ literal }} and <img src=x onerror=alert(1)>\n')
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim()
  git(['add', '.']); git(['commit', '-m', 'Documentation baseline'])
  return { projectRoot, projects, source, git }
}
test('repository snapshots publish only committed Markdown while preserving dirty and untracked work', t => {
  const f = fixture(t), commit = repositoryCommit(f.source)
  writeFileSync(join(f.source, 'README.md'), '# Uncommitted replacement\n')
  writeFileSync(join(f.source, 'untracked.md'), '# Private draft\n')
  const job = captureSnapshot({ projectRoot: f.projectRoot, wikiRoot: f.source, gitRoot: f.source, contentKind: repositoryKind, project: 'demo', roots: {}, buildsRoot: join(f.projectRoot, 'snapshots') })
  assert.equal(job.gitCommit, commit)
  const context = snapshotContext(join(f.projectRoot, 'snapshots'), job.snapshot, job.digest)
  assert.equal(context.contentKind, repositoryKind)
  assert.match(readFileSync(join(context.wikiRoot, 'demo/README.md'), 'utf8'), /Repository home/)
  assert.equal(existsSync(join(context.wikiRoot, 'demo/untracked.md')), false)
  assert.equal(f.projects.status('demo').gitStatus, 'dirty')
  assert.equal(readFileSync(join(f.source, 'README.md'), 'utf8'), '# Uncommitted replacement\n')
  const navigation = repositoryNavigation(join(context.wikiRoot, 'demo'))
  assert.ok(JSON.stringify(navigation.sidebar).includes('/doc/design'))
})
test('repository mode refuses Bundle publication, cannot be changed after initialization, and rejects Git symlinks', t => {
  const f = fixture(t), runtime = createBuildRuntime({ projectRoot: f.projectRoot, wikiRoot: join(f.projectRoot, 'data/wiki'), roots: {}, projectWikis: f.projects })
  t.after(() => runtime.close())
  assert.throws(() => runtime.begin({ bundle: { project: 'demo' } }), /do not accept/)
  assert.throws(() => runtime.preview('demo', 'bundle', f.source), /do not accept/)
  assert.throws(() => f.projects.configure('demo', { sourceDirectory: f.source, contentKind: 'strict_nodes' }), /cannot be changed/)
  assert.equal(runtime.buildCurrent('demo').state, 'queued')
  symlinkSync('/etc/passwd', join(f.source, 'doc/unsafe.md'))
  f.git(['add', '.']); f.git(['commit', '-m', 'Invalid symlink'])
  assert.equal(runtime.buildCurrent('demo').state, 'blocked')
})
test('ordinary Markdown is escaped as data, wiki references work, external source citations are not broken Wiki links', () => {
  const markdown = new MarkdownIt(); repositoryMarkdown(markdown)
  const html = markdown.render('{{ literal }} <script>alert(1)</script>\n\n[[code/apis/api-test.md|API]]\n\n[Code](../../source.go)\n\n[Page](other.md)', { relativePath: 'doc/design.md' })
  assert.match(html, /&#123;&#123; literal }}/)
  assert.match(html, /&lt;script&gt;/)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /href="\/code\/apis\/api-test.md"/)
  assert.match(html, /<span title="外部源码引用：\.\.\/\.\.\/source.go">Code<\/span>/)
  assert.match(html, /href="other.md"/)
})

test('template wiki placeholders stay literal while real local Markdown links remain checked', t => {
  const f = fixture(t), markdown = new MarkdownIt()
  repositoryMarkdown(markdown, { root: f.source })
  const html = markdown.render('[[doc/design.md|Design]] [[code/rules/br-example]]\n\n[Missing](missing.md)\n\nhttp://localhost:5174/**example', { relativePath: 'README.md' })
  assert.match(html, /href="\/doc\/design.md"/)
  assert.match(html, /\[\[code\/rules\/br-example\]\]/)
  assert.doesNotMatch(html, /href="\/code\/rules\/br-example"/)
  assert.match(html, /href="missing.md"/)
  assert.doesNotMatch(html, /href="http:\/\/localhost/)
})
test('fresh strict-node repositories require document initialization before building', t => {
  const f = fixture(t)
  f.projects.initialize('empty')
  const runtime = createBuildRuntime({ projectRoot: f.projectRoot, wikiRoot: join(f.projectRoot, 'data/wiki'), roots: {}, projectWikis: f.projects })
  t.after(() => runtime.close())
  const result = runtime.buildCurrent('empty')
  assert.equal(result.state, 'blocked')
  assert.ok(result.diagnostics.some(item => item.issues?.some(issue => issue.code === 'document_contract_error')))
})
