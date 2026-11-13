import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { collectGitSource } from '../../../.agents/skills/cim-wiki/scripts/git-source.mjs'
import { resolveShared } from '../sources.mjs'

function fixture(t,format='sha1') {
 const root=mkdtempSync(join(tmpdir(),'git-document-source-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 const repo=join(root,'repo'),shared=join(root,'shared');mkdirSync(repo);mkdirSync(shared)
 const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8'}).trim()
 git('init','--object-format='+format,'-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid')
 mkdirSync(join(repo,'docs'));writeFileSync(join(repo,'docs','设计 file.md'),'# First revision\n');git('add','.');git('commit','-m','Initial docs')
 const first=git('rev-parse','HEAD');git('tag','-a','v1','-m','Version one')
 writeFileSync(join(repo,'docs','设计 file.md'),'# Second revision\n');git('commit','-am','Update docs')
 return {root,repo,shared,git,first,options:{source:{url:pathToFileURL(repo).href,subpath:'docs',revision_selector:'v1'},project:'demo',sharedRoot:shared,mount:'team',allowFile:true}}
}
test('Git branch, annotated tag and full commit produce pinned source snapshots with usable shared URIs',async t=>{
 const f=fixture(t)
 const tag=await collectGitSource(f.options)
 assert.equal(tag.commit_sha,f.first);assert.equal(tag.files.length,1)
 assert.equal(readFileSync(tag.files[0].local_path,'utf8'),'# First revision\n')
 assert.equal(resolveShared(tag.files[0].source_uri,{team:f.shared}),tag.files[0].local_path)
 const evidence=JSON.parse(readFileSync(resolveShared(tag.git_info_uri,{team:f.shared}),'utf8'))
 assert.equal(evidence.commit_sha,f.first);assert.equal(evidence.files[0].sha256,tag.files[0].sha256)
 const branch=await collectGitSource({...f.options,source:{...f.options.source,revision_selector:'main'}})
 assert.equal(branch.commit_sha,f.git('rev-parse','HEAD'))
 const commit=await collectGitSource({...f.options,source:{...f.options.source,revision_selector:f.first}})
 assert.equal(commit.commit_sha,f.first)
 await assert.rejects(()=>collectGitSource({...f.options,allowFile:false}),/HTTPS|SSH/)
 await assert.rejects(()=>collectGitSource({...f.options,source:{...f.options.source,revision_selector:'--upload-pack=evil'}}),/revision/)
})
test('Git collection rejects symbolic links, LFS placeholders and invalid selection limits',async t=>{
 const f=fixture(t);symlinkSync('../outside.md',join(f.repo,'docs','link.md'));f.git('add','.');f.git('commit','-m','Add unsafe link')
 const options={...f.options,source:{...f.options.source,revision_selector:'main'}}
 await assert.rejects(()=>collectGitSource(options),/symbolic|regular/i)
 f.git('rm','docs/link.md');writeFileSync(join(f.repo,'docs','missing.pdf'),'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 999\n');f.git('add','.');f.git('commit','-m','Add LFS pointer')
 await assert.rejects(()=>collectGitSource(options),/LFS/)
 await assert.rejects(()=>collectGitSource({...f.options,maxFiles:0}),/limit/)
})

test('Git SHA-256 repositories preserve full commit and blob object identities',async t=>{const f=fixture(t,'sha256');const result=await collectGitSource(f.options);assert.equal(result.commit_sha.length,64);assert.equal(result.files[0].blob_oid.length,64)})
