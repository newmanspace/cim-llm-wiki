import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createDefaultsStore } from '../document-defaults.mjs'
import { documentTargetErrors } from '../document-routing.mjs'
import { createDocumentQuality } from '../../wiki-service/document-quality.mjs'
import { createHash } from 'node:crypto'

test('submit validates actual template content and directory semantics before persisting', async t => {
 const root=mkdtempSync(join(tmpdir(),'routing-service-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 const store=createDefaultsStore(root);store.publish(0,'Administrator');store.bind('demo',[])
 const path='doc/90-guides/example.md'
 assert.ok(documentTargetErrors(store.effective('demo').definition,'sdd',path).some(e=>e.rule_id==='document_directory_mismatch'))
 writeFileSync(join(root,'parsed.md'),'# Source');writeFileSync(join(root,'candidate.md'),'# Incomplete template')
 const hash=createHash('sha256').update('# Source').digest('hex'),requests=[]
 const ledger=createServer(async(req,res)=>{
  requests.push(req.method)
  let body='';for await (const chunk of req)body+=chunk
  res.setHeader('Content-Type','application/json')
  res.end(JSON.stringify({data:req.method==='POST'?JSON.parse(body):{items:[{id:'source',original_uri:'shared://team/parsed.md',original_sha256:hash}],next_cursor:null}}))
 });ledger.listen(0,'127.0.0.1');await once(ledger,'listening');t.after(()=>{ledger.closeAllConnections();ledger.close()})
 const quality=createDocumentQuality({projectRoot:root,roots:{team:root},ledgerURL:`http://127.0.0.1:${ledger.address().port}`,ledgerToken:'test',
  registeredDocument:()=>({project:'demo',state:'draft',original_uri:'shared://team/parsed.md',original_sha256:hash})})
 const input={project:'demo',template_id:'sdd',target_path:path,content_uri:'shared://team/candidate.md',parsed_uri:'shared://team/parsed.md',source_links:[{source_version_id:'source'}]}
 await assert.rejects(quality.mutate('document-submit',{...input,target_path:'doc/../escape.md'},'unsafe'),/Invalid classified Markdown path/)
 assert.deepEqual(requests,[])
 await assert.rejects(quality.mutate('document-submit',input,'invalid-content'), error => {
  assert.equal(error.status,422)
  assert.ok(error.diagnostics.some(d=>d.rule_id==='section_required'))
  assert.ok(error.diagnostics.some(d=>d.rule_id==='document_directory_mismatch'))
  return true
 })
 await assert.rejects(quality.mutate('document-submit',{...input,local_report:{errors:[]}},'forged-report'), error => error.code==='DOCUMENT_SUBMISSION_INVALID')
 await assert.rejects(quality.mutate('document-submit',{...input,template_id:'unknown-template'},'unknown-template'), error => error.status===422)
 assert.deepEqual(requests,[], 'Invalid submissions never reach the ledger')
 const template=store.effective('demo').definition.templates.find(t=>t.id==='sdd')
 writeFileSync(join(root,'candidate.md'),template.example)
 const result=await quality.mutate('document-submit',{...input,target_path:'doc/50-designs/example.md'},'valid-boundary')
 assert.equal(result.target_path,'doc/50-designs/example.md')
 assert.equal(requests.filter(method=>method==='POST').length,1)
 writeFileSync(join(root,'candidate.md'),'# Incomplete template')
 const draft=await quality.mutate('document-drafts',input,'draft-boundary')
 assert.equal(draft.target_path,path,'Drafts remain available for authoring incomplete content')
})
