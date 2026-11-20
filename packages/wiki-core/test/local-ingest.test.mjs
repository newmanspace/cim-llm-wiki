import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { builtinDefaults } from '../document-defaults.mjs'
import { checkCandidate } from '../local-ingest.mjs'
import { validateOptionalScore } from '../quality-score.mjs'

function rules() {
 const definition=builtinDefaults()
 return {project:'demo',binding:{version:'v1',digest:'rules'},...definition}
}
test('local ingest checks template and directory without an identity or scoring',()=>{
 const r=rules(), template=r.templates.find(t=>t.id==='sdd')
 const input={project:'demo',template_id:'sdd',target_path:'doc/50-designs/design.md',document:template.example}
 const valid=checkCandidate(r,input)
 assert.deepEqual(valid.errors,[]);assert.ok(valid.warnings.some(w=>w.rule_id==='document_identity_pending'))
 assert.equal(valid.fidelity,'not_checked')
 assert.ok(checkCandidate(r,{...input,document:'# Missing'}).errors.some(e=>e.rule_id==='section_required'))
 assert.ok(checkCandidate(r,{...input,target_path:'doc/90-guides/design.md'}).errors.some(e=>e.rule_id==='document_directory_mismatch'))
 assert.throws(()=>checkCandidate(r,{...input,project:'other'}),/target project/)
 assert.throws(()=>checkCandidate(r,{...input,template_id:'unknown'}),/not found/)
 assert.equal(checkCandidate(r,{...input,template_id:undefined}).errors.length,0)
 assert.ok(checkCandidate({...r,naming:{types:[]}},{...input,document_id:'identity'}).errors.some(e=>e.rule_id==='document_identity_mismatch'))
 assert.ok(checkCandidate(r,{...input,target_path:undefined}).errors.some(e=>e.rule_id==='document_target_invalid'))
})
test('copied skill checks candidates without dependencies or project code access',t=>{
 const root=mkdtempSync(join(tmpdir(),'standalone-ingest-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 cpSync(resolve('.agents/skills/cim-wiki'),join(root,'skill'),{recursive:true})
 const r=rules(),template=r.templates.find(t=>t.id==='sdd')
 writeFileSync(join(root,'rules.json'),JSON.stringify(r))
 const candidate=join(root,'candidate.json'),report=join(root,'report.json')
 writeFileSync(candidate,JSON.stringify({project:'demo',template_id:'sdd',target_path:'doc/50-designs/design.md',document:template.example}))
 const args=[join(root,'skill/scripts/ingest.mjs'),'--rules',join(root,'rules.json'),'--json-file',candidate,'--output',report]
 const result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8'})
 assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(readFileSync(report)).errors,[])
 writeFileSync(candidate,JSON.stringify({project:'demo',template_id:'sdd',document:'# Missing'}))
 const invalid=spawnSync(process.execPath,args.slice(0,-2),{cwd:root,encoding:'utf8'})
 assert.equal(invalid.status,1,invalid.stderr);assert.ok(JSON.parse(invalid.stdout).errors.length)
})
test('optional scores stay absent and malformed scores cannot masquerade as unscored',()=>{
 assert.equal(validateOptionalScore(undefined),undefined)
 for(const score of [null,{total:1},{auth:NaN},{auth:1,comp:1,rel:1,fresh:1,struct:1,reuse:1,risk:0,total:.9}])assert.throws(()=>validateOptionalScore(score))
 assert.equal(validateOptionalScore({auth:1,comp:1,rel:1,fresh:1,struct:1,reuse:1,risk:0,total:1}),undefined)
})

test('standalone ingest reads local Markdown and attachments and invalidates changed packages', t => {
 const root=mkdtempSync(join(tmpdir(),'local-file-ingest-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 cpSync(resolve('.agents/skills/cim-wiki'),join(root,'skill'),{recursive:true})
 const r=rules(),text=r.templates.find(t=>t.id==='sdd').example+'\n\n[附件](附件.txt)\n'
 mkdirSync(join(root,'candidate'))
 writeFileSync(join(root,'candidate/document.md'),text)
 writeFileSync(join(root,'candidate/附件.txt'),'v1')
 writeFileSync(join(root,'rules.json'),JSON.stringify(r))
 writeFileSync(join(root,'metadata.json'),JSON.stringify({project:'demo',template_id:'sdd',target_path:'doc/50-designs/local.md'}))
 const args=[join(root,'skill/scripts/ingest.mjs'),'--rules',join(root,'rules.json'),'--json-file',join(root,'metadata.json'),'--root',join(root,'candidate'),'--document','document.md']
 const run=()=>spawnSync(process.execPath,args,{cwd:root,encoding:'utf8'})
 const first=run();assert.equal(first.status,0,first.stderr)
 const initial=JSON.parse(first.stdout);assert.equal(initial.package_manifest.files.length,2)
 writeFileSync(join(root,'candidate/附件.txt'),'v2')
 const changed=JSON.parse(run().stdout);assert.notEqual(changed.package_sha256,initial.package_sha256);assert.equal(changed.content_sha256,initial.content_sha256)
 rmSync(join(root,'candidate/附件.txt'))
 const missing=run();assert.equal(missing.status,1);assert.ok(JSON.parse(missing.stdout).errors.some(error=>error.rule_id==='document_package_invalid'))
})
