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

test('submission uses retained original metadata without reopening original bytes', async t => {
 const { createDocumentUploads } = await import('../../wiki-service/document-uploads.mjs')
 const { unlinkSync } = await import('node:fs')
 const root=mkdtempSync(join(tmpdir(),'retained-original-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 const store=createDefaultsStore(root);store.publish(0,'Administrator');store.bind('demo',[]);store.bind('other',[])
 const uploads=createDocumentUploads({projectRoot:root,roots:{team:root}})
 const original=uploads.put('demo','original.md',Buffer.from('# Original'))
 const originalPack=uploads.seal('demo',{entry:'original.md',files:[{path:'original.md',uri:original.uri,sha256:original.sha256}]})
 const template=store.effective('demo').definition.templates.find(item=>item.id==='sdd')
 writeFileSync(join(root,'candidate.md'),template.example)
 writeFileSync(join(root,'parsed.md'),'# Parsed')
 const observations=[{id:'wrong',original_uri:original.uri,original_sha256:'0'.repeat(64)},{id:'single',original_uri:original.uri,original_sha256:original.sha256},
  {id:'package',original_uri:originalPack.uri,original_sha256:original.sha256}]
 const persisted=[]
 const ledger=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk
  res.setHeader('Content-Type','application/json')
  const matchesProject=req.url.startsWith('/internal/v1/projects/demo/')
  if(req.method==='POST')persisted.push(JSON.parse(body))
  res.end(JSON.stringify({data:req.method==='POST'?JSON.parse(body):{items:matchesProject?observations:[],next_cursor:null}}))
 });ledger.listen(0,'127.0.0.1');await once(ledger,'listening');t.after(()=>{ledger.closeAllConnections();ledger.close()})
 const record={project:'demo',original_uri:original.uri,original_sha256:original.sha256}
 const quality=createDocumentQuality({projectRoot:root,roots:{team:root},uploads,ledgerURL:`http://127.0.0.1:${ledger.address().port}`,ledgerToken:'test',registeredDocument:()=>record})
 const input={project:'demo',template_id:'sdd',target_path:'doc/50-designs/example.md',content_uri:'shared://team/candidate.md',parsed_uri:'shared://team/parsed.md',source_links:[{source_version_id:'single'}]}
 // Any content read of this retained original now fails. Metadata must suffice.
 unlinkSync(uploads.file('demo',original.uri).path)
 assert.equal((await quality.mutate('document-submit',input,'single')).source_links[0].source_version_id,'single')
 record.original_uri=originalPack.uri
 assert.equal((await quality.mutate('document-submit',{...input,source_links:[{source_version_id:'package'}]},'package')).source_links[0].source_version_id,'package')
 await assert.rejects(quality.mutate('document-submit',{...input,source_links:[{source_version_id:'missing'}]},'missing'),/not found/)
 await assert.rejects(quality.mutate('document-submit',{...input,source_links:[{source_version_id:'wrong'}]},'mismatched'),/registered original/)
 await assert.rejects(quality.mutate('document-submit',{...input,project:'other'},'cross'),/another project/)
 assert.equal(persisted.length,2)
})
