import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { resolveShared } from '../sources.mjs'
import { collectSvnSource } from '../../../.agents/skills/cim-wiki/scripts/svn-source.mjs'

test('SVN collection pins revision and creates immutable source evidence without credentials', async t => {
 const root=mkdtempSync(join(tmpdir(),'svn-quality-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 const repository=join(root,'repo'), input=join(root,'input'), shared=join(root,'shared')
 mkdirSync(input);mkdirSync(shared);writeFileSync(join(input,'设计 file.md'),'# Original\n')
 execFileSync('svnadmin',['create',repository]);const url=pathToFileURL(repository).href
 execFileSync('svn',['import',input,url,'-m','Initial source','--non-interactive'])
 const source={url,subpath:'',revision_selector:'1',auth:'svn_cache'}
 const collected=await collectSvnSource({source,project:'demo',sharedRoot:shared,mount:'team',allowFile:true})
 assert.equal(collected.revision,'1');assert.equal(collected.files.length,1)
 assert.match(collected.files[0].source_uri,/^shared:\/\/team\/demo\/svn\//)
 assert.equal(readFileSync(collected.files[0].local_path,'utf8'),'# Original\n')
 assert.equal(collected.files[0].sha256.length,64)
 assert.equal(resolveShared(collected.files[0].source_uri,{team:shared}),collected.files[0].local_path)
 assert.ok(!JSON.stringify(collected).includes('password'))
 await assert.rejects(()=>collectSvnSource({source,project:'../escape',sharedRoot:shared,mount:'team',allowFile:true}),/project/)
 await assert.rejects(()=>collectSvnSource({source,project:'demo',sharedRoot:shared,mount:'team'}),/HTTPS/)
})

test('SVN HTTP and HTTPS collection preserve pinned revision and export evidence', async t => {
 const root=mkdtempSync(join(tmpdir(),'svn-http-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 const bin=join(root,'bin'),shared=join(root,'shared'),log=join(root,'commands.jsonl')
 mkdirSync(bin);mkdirSync(shared)
 writeFileSync(join(bin,'svn'),`#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args)+'\\n')
const target = args.find(a => /^https?:/.test(a)).replace(/@[^@]+$/, '')
if (args[0] === 'info') console.log('<info><entry revision="5032"><url>'+target+'</url><repository><root>'+new URL(target).origin+'/svnRepos</root><uuid>test-uuid</uuid></repository></entry></info>')
else if (args[0] === 'list') console.log('<lists><list><entry kind="file"><name>设计 file.md</name><size>11</size></entry></list></lists>')
else if (args[0] === 'export') fs.writeFileSync(args[args.indexOf('--non-interactive')-1], '# Original\\n')
else process.exit(1)
`,{mode:0o700})
 const previousPath=process.env.PATH
 process.env.PATH=bin+':'+previousPath
 t.after(()=>{process.env.PATH=previousPath})
 for (const protocol of ['http','https']) {
  const url=protocol+'://10.10.50.171/svnRepos/myCIM4.0%E4%BA%A7%E5%93%81%E6%96%87%E6%A1%A3'
  const collected=await collectSvnSource({source:{url,revision_selector:'HEAD'},project:'demo',sharedRoot:shared,mount:'team'})
  assert.equal(collected.revision,'5032')
  assert.equal(collected.files[0].repository_path,'myCIM4.0产品文档/设计 file.md')
  assert.equal(readFileSync(collected.files[0].local_path,'utf8'),'# Original\n')
  assert.equal(collected.files[0].sha256.length,64)
 }
 const commands=readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line))
 assert.equal(commands.length,6)
 for(const args of commands) {
  assert.ok(args.includes('--non-interactive'))
  assert.ok(args.includes('--no-auth-cache'))
  if(args[0]!=='info') {
   assert.equal(args[args.indexOf('--revision')+1],'5032')
   assert.ok(args.some(a=>a.startsWith('http')&&a.endsWith('@5032')))
  }
 }
 for(const url of ['http://user:pass@example.test/repo','http://user@example.test/repo','http://example.test/repo?q=x','http://example.test/repo#x','ftp://example.test/repo','svn://example.test/repo']) {
  await assert.rejects(()=>collectSvnSource({source:{url,revision_selector:'HEAD'},project:'demo',sharedRoot:shared,mount:'team'}),/URL/)
 }
 assert.equal(readFileSync(log,'utf8').trim().split('\n').length,6)
})
