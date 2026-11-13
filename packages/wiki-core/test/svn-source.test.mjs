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
