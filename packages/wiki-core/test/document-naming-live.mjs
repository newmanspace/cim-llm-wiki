import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createKnowledgeServer } from '../../wiki-service/server.mjs'
import { createDefaultsStore, builtinDefaults } from '../document-defaults.mjs'
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'

test('real PostgreSQL numbering, uniqueness, retries, module registry, and Node identity enforcement', async t => {
  const root=mkdtempSync(join(tmpdir(),'naming-live-'))
  t.after(()=>rmSync(root,{recursive:true,force:true}))
  const store=createDefaultsStore(root), definition=builtinDefaults()
  definition.naming={format:'project-type-module-topic-sequence-v1',types:definition.templates.map(template=>({code:template.id,template_ids:[template.id]}))}
  store.save(definition,0,'Administrator');store.publish(1,'Administrator');store.bind('demo',['chart','common'])
  mkdirSync(join(root,'data/wiki/demo'),{recursive:true})
  const ledgerURL=process.env.NAMING_TEST_LEDGER_URL,ledgerToken=process.env.NAMING_TEST_LEDGER_TOKEN
  const fixtureLedger=new URL(ledgerURL);assert.equal(fixtureLedger.protocol,'http:');assert.equal(fixtureLedger.hostname,'127.0.0.1')
  async function setup(body,key=randomUUID()) {
    const r=await fetch(ledgerURL+'/setup/projects/demo/naming-settings',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)})
    const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value.data
  }
  await setup({short_code:'mycim-spc',modules:['chart','common'],expected_revision:0})
  const server=createKnowledgeServer({projectWikis:null,projectRoot:root,wikiRoot:join(root,'data/wiki'),roots:{team:root},token:'agent',ledgerURL,ledgerToken})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(()=>{server.closeAllConnections();server.close()})
  const base=`http://127.0.0.1:${server.address().port}/api/v2/knowledge/`
  async function api(path,data,key=randomUUID()) {
    const response=await fetch(base+path,{method:data?'POST':'GET',headers:{Authorization:'Bearer agent','Content-Type':'application/json','Idempotency-Key':key},body:data?JSON.stringify(data):undefined})
    return {status:response.status,value:await response.json()}
  }
  const input={project:'demo',doc_type:'sdd',module:'chart',topic:'control-chart'},key=randomUUID()
  const first=await api('document-identities/reserve',input,key)
  assert.equal(first.status,200,JSON.stringify(first.value));assert.equal(first.value.data.filename,'mycim-spc-sdd-chart-control-chart-001.md')
  const retry=await api('document-identities/reserve',input,key);assert.deepEqual(retry.value,first.value)
  const duplicate=await api('document-identities/reserve',input)
  assert.equal(duplicate.status,409);assert.equal(duplicate.value.code,'DOCUMENT_IDENTITY_EXISTS');assert.equal(duplicate.value.existing.id,first.value.data.id)
  const concurrent=await Promise.all(Array.from({length:8},(_,i)=>api('document-identities/reserve',{...input,doc_type:i%2?'urd':'idd',topic:'topic-'+i})))
  assert.ok(concurrent.every(r=>r.status===200),JSON.stringify(concurrent))
  assert.deepEqual(concurrent.map(r=>r.value.data.sequence).sort((a,b)=>a-b),[2,3,4,5,6,7,8,9])
  const common=await api('document-identities/reserve',{...input,doc_type:'glossary',module:'common',topic:'terminology'})
  assert.equal(common.value.data.sequence,1)
  assert.equal((await api('document-identities/reserve',{...input,module:'unknown'})).status,422)
  assert.equal((await api('document-identities/reserve',{...input,topic:'Other'})).status,422)
  assert.equal((await api('document-identities/reserve',{...input,sequence:20})).status,422)
  const filtered=await api('document-identities?project=demo&module=chart&doc_type=sdd&topic=control-chart')
  assert.equal(filtered.value.data.items.length,1)
  const template=definition.templates.find(t=>t.id==='sdd'),identity=first.value.data
  const document=template.example.replace(/^(\|\s*文档 ID\s*\|)[^|]+\|/m,`$1 ${identity.node_id} |`)
  const valid=await api('check-document',{project:'demo',document_id:identity.id,template_id:'sdd',document,phase:'draft',target_path:'doc/50-designs/'+identity.filename})
  assert.equal(valid.status,200);assert.deepEqual(valid.value.errors,[])
  const invalid=await api('check-document',{project:'demo',document_id:identity.id,template_id:'sdd',document,phase:'draft',target_path:'doc/50-designs/wrong.md'})
  assert.ok(invalid.value.errors.some(error=>error.rule_id==='document_identity_mismatch'))
  assert.equal((await api('check-document',{project:'demo',template_id:'sdd',document,phase:'draft'})).status,422)
  const context=await api('context?project=demo');assert.equal(context.value.document_naming.ready,true)
  assert.equal(context.value.configuration_status.delivery_contract,'ready')
  const adminDenied=await fetch(ledgerURL+'/internal/v1/projects/demo/document-quality/naming-settings',{method:'POST',headers:{Authorization:'Bearer '+ledgerToken,'Content-Type':'application/json'},body:JSON.stringify({short_code:'hijack'})})
  assert.equal(adminDenied.status,403)
  const settings=(await api('naming-settings?project=demo')).value.data.items[0]
  const aliasChange=await fetch(ledgerURL+'/setup/projects/demo/naming-settings',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify({short_code:'other',expected_revision:settings.revision})})
  assert.equal(aliasChange.status,409)
  await setup({short_code:'mycim-spc',modules:['chart','common','a','a-b'],expected_revision:settings.revision})
  assert.deepEqual((await api('document-identities/reserve',input,key)).value,first.value)
  const a=await api('document-identities/reserve',{...input,module:'a-b',topic:'c'})
  assert.equal(a.status,200)
  const ambiguous=await api('document-identities/reserve',{...input,module:'a',topic:'b-c'})
  assert.equal(ambiguous.status,409)
  const rollback=await api('document-identities/reserve',{...input,module:'a',topic:'another'})
  assert.equal(rollback.value.data.sequence,1)
  async function bindNaming(version,digest) {
    const response=await fetch(base.replace('/api/v2/knowledge/','/internal/document-defaults/bind-naming'),{method:'POST',headers:{Authorization:'Bearer '+ledgerToken,'X-Settings-Actor':'Administrator','Content-Type':'application/json'},body:JSON.stringify({project:'demo',version,expected_digest:digest})})
    return {status:response.status,value:await response.json()}
  }
  let state=store.state();store.save(definition,state.revision,'Administrator');state=store.state();store.publish(state.revision,'Administrator')
  const rebound=await bindNaming('v2',store.binding('demo').digest)
  assert.equal(rebound.status,200,JSON.stringify(rebound.value))
  assert.deepEqual(rebound.value.modules,['a','a-b','chart','common'])
  assert.equal(existsSync(join(root,'data/wiki/demo/document-contract.json')),false)
  const unrelated=structuredClone(definition);unrelated.name+=' unrelated change'
  state=store.state();store.save(unrelated,state.revision,'Administrator');state=store.state();store.publish(state.revision,'Administrator')
  assert.equal((await bindNaming('v3',store.binding('demo').digest)).status,409)
  assert.equal(store.binding('demo').version,'v2')
})
