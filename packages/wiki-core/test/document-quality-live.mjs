import { createDefaultsStore,builtinDefaults } from '../document-defaults.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createHash,randomUUID } from 'node:crypto'
import { createKnowledgeServer } from '../../wiki-service/server.mjs'

test('live Node/Go/PostgreSQL document provenance, review, export and inherited policy invalidation',async t=>{
 const root=mkdtempSync(join(tmpdir(),'quality-live-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 const projectRoot=join(root,'state'),wikiRoot=join(projectRoot,'data/wiki'),shared=join(root,'shared'),organizedRoot=join(root,'organized')
 const save=(path,value)=>{mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,typeof value==='string'?value:JSON.stringify(value))}
 save(join(wikiRoot,'demo/document-contract.json'),{schema_version:'1.0',project:'demo',documents:[{id:'req',type:'requirement',scope:'project',min:1}]})
 save(join(shared,'original.docx'),'source fixture');save(join(shared,'info.xml'),'<info><entry revision="42"><repository><uuid>repo</uuid></repository></entry></info>')
 const defaults=createDefaultsStore(projectRoot),definition=builtinDefaults()
 definition.delivery=[{id:'req',type:'requirement',scope:'project',min:1}]
 defaults.save(definition,0,'Test Administrator');defaults.publish(1,'Test Administrator');defaults.bind('demo',['docs'])
 const artifactDoc=definition.templates[0].example.replace('待指定','Reviewer').replaceAll('URD 用户需求定义','Source requirement')
 const ledgerURL=process.env.QUALITY_TEST_LEDGER_URL,ledgerToken=process.env.QUALITY_TEST_LEDGER_TOKEN,human=process.env.QUALITY_TEST_REVIEW_TOKEN
 const server=createKnowledgeServer({projectRoot,wikiRoot,roots:{team:shared},token:'automation',reviewerTokens:{Reviewer:human},ledgerURL,ledgerToken,organizedRoot,parser:async()=>({md:'# Source\n\nSource-backed text.\n',images:[]})})
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}))
 const origin=`http://127.0.0.1:${server.address().port}`
 async function api(path,body,token='automation',key=randomUUID()){
  const response=await fetch(origin+'/api/v2/knowledge/'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':key},body:body?JSON.stringify(body):undefined})
  return {status:response.status,value:await response.json()}
 }
 async function ok(path,body,token,key){const response=await api(path,body,token,key);assert.equal(response.status,200,JSON.stringify(response.value));return response.value.data||response.value}
 const setup=async(op,body)=>{const r=await fetch(ledgerURL+'/setup/projects/demo/'+op,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify(body)});const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value.data}
 await setup('document-directories',{path:'doc/50-designs/empty',display_name:'空目录'})
 const folderResponse=await fetch(ledgerURL+'/internal/v1/projects/demo/document-quality/document-directories',{headers:{Authorization:'Bearer '+ledgerToken}})
 assert.equal(folderResponse.status,200)
 assert.ok((await folderResponse.json()).data.items.some(item=>item.path==='doc/50-designs/empty'))
 const maintained=await setup('document-directories',{path:'doc/workspace',display_name:'工作区'})
 await setup('document-directories',{action:'update',id:maintained.id,expected_revision:1,path:'doc/workspace',display_name:'已维护名称'})
 const catalogResponse=await fetch(ledgerURL+'/internal/v1/projects/demo/document-quality/directory-catalog?parent=doc&limit=200',{headers:{Authorization:'Bearer '+ledgerToken}})
 assert.equal(catalogResponse.status,200)
 const catalogPage=(await catalogResponse.json()).data
 assert.ok(catalogPage.items.some(row=>row.display_name==='已维护名称'))
 assert.ok(catalogPage.items.every(row=>row.parent_path==='doc'))
 const paged=await fetch(ledgerURL+'/internal/v1/projects/demo/document-quality/directory-catalog?parent=doc&limit=1',{headers:{Authorization:'Bearer '+ledgerToken}})
 const firstCatalogPage=(await paged.json()).data;assert.equal(firstCatalogPage.items.length,1);assert.ok(firstCatalogPage.next_cursor)
 const nextPage=await fetch(ledgerURL+'/internal/v1/projects/demo/document-quality/directory-catalog?parent=doc&limit=1&cursor='+encodeURIComponent(firstCatalogPage.next_cursor),{headers:{Authorization:'Bearer '+ledgerToken}})
 assert.notEqual((await nextPage.json()).data.items[0].path,firstCatalogPage.items[0].path)

 const eventResponse=await fetch(ledgerURL+'/internal/v1/projects/demo/document-quality/directory-events',{headers:{Authorization:'Bearer '+ledgerToken}})
 assert.ok((await eventResponse.json()).data.items.some(row=>row.directory_id===maintained.id&&row.action==='update'))
 await setup('document-directories',{action:'delete',id:maintained.id,expected_revision:2})
 const previewImpact=await setup('quality-policy-preview',{path:'doc/50-designs',expected_revision:0,patch:{review_threshold:85}})
 assert.ok(previewImpact.changed_paths.includes('doc/50-designs'))
 await setup('data-sources',{name:'SVN docs',type:'svn',url:'https://example.test/repo',revision_selector:'HEAD'})
 const context=await ok('context?project=demo');assert.ok(context.document_directories.some(item=>item.path==='doc/50-designs/empty'));assert.equal(context.data_sources[0].url,'https://example.test/repo');assert.equal(context.data_sources[0].auth,'svn_cache')
 assert.equal(context.document_quality.requires_human,false)
 assert.equal(context.document_quality.approval_policy,'directory-quality-policy')
 const source=context.data_sources[0]
 const run=await ok('ingest-runs',{project:'demo',source_id:source.id,source_config_id:source.config_id,operative_revision:'42',repository_uuid:'repo',recipe_version:'test-v1'})
 const sha=value=>createHash('sha256').update(value).digest('hex')
 const original=await ok('source-observations',{project:'demo',run_id:run.id,repository_path:'original.docx',original_uri:'shared://team/original.docx',original_sha256:sha('source fixture'),svn_info_uri:'shared://team/info.xml'})
 const registration={project:'demo',system:'CIM',version:'v1',category:'design',source:'shared://team/original.docx',parsed:'shared://team/parsed.md'}
 await ok('convert',registration);await ok('state',{source:registration.parsed,action:'freeze',by:'skill'})
 save(join(shared,'classified.md'),artifactDoc)
 assert.equal((await ok('ingest-source-links?project=demo')).items.length,1)
 const artifact=await ok('artifacts',{project:'demo',run_id:run.id,logical_key:'design',template_id:'urd',target_path:'doc/50-designs/design.md',content_uri:'shared://team/classified.md',parsed_uri:registration.parsed,recipe_version:'test-v1',source_links:[{source_version_id:original.id,location:{section:'1'}}]})
 assert.equal((await ok('ingest-artifact-links?project=demo')).items.length,1)
 let policy=await ok('quality-policy-effective?project=demo&path=doc%2F50-designs')
 const dimensions=Object.fromEntries(['fidelity','completeness','traceability','consistency','structure','usability','validity'].map(k=>[k,{score:75,reason:'Source compared',evidence:[{section:'1'}]}]))
 const evaluation=await ok('document-evaluations',{project:'demo',artifact_id:artifact.id,artifact_sha256:artifact.content_sha256,policy_digest:policy.digest,dimensions,issues:[],evaluator_version:'test-v1'})
 assert.equal(evaluation.needs_review,true)
 assert.equal((await api('publish-document',{project:'demo',artifact_id:artifact.id,evaluation_id:evaluation.id})).status,409)
 const decision={project:'demo',task_id:evaluation.review_task_id,expected_revision:1,decision:'approve',note:'Compared the source'}
 assert.equal((await api('document-review-decisions',decision)).status,403)
 const review=await ok('document-review-decisions',decision,human);assert.equal(review.actor_id,'Reviewer')
 const published=await ok('publish-document',{project:'demo',artifact_id:artifact.id,evaluation_id:evaluation.id})
 assert.equal(readFileSync(published.path,'utf8'),artifactDoc)
 const history=await ok('document-review-events?project=demo');assert.equal(history.items.length,1)
 const node = {schema_version:'1.0',id:'REQ-SOURCE-001',type:'requirement',plane:'doc',product:'CIM',version:'v1',domain:'cim',module:'docs',source:registration.parsed,source_location:{section:'1'},title:'Source requirement',content:artifactDoc.replace(/^# [^\n]+\n/,''),status:'published',confidence:.99,review_level:'L0_auto',reviewer:'auto',created_at:'2026-11-12T00:00:00Z',updated_at:'2026-11-12T00:00:00Z',qscore:{auth:1,comp:1,rel:1,fresh:1,struct:1,reuse:1,risk:.1,total:.99}}
 save(join(shared,'nodes.json'),{schema_version:'1.0',bundle_id:'CR-QUALITY-001',project:'demo',nodes:[node]})
 assert.equal((await api('bundles',{uri:'shared://team/nodes.json'})).status,409,'configured projects require document quality bindings')
 await ok('bundles',{uri:'shared://team/nodes.json',artifact_ids:[artifact.id]})
 await ok('review',{bundle_id:'CR-QUALITY-001',decision:'approve',note:'Reviewed node and source'},human)
 await ok('compile',{bundle_id:'CR-QUALITY-001',preview:true})
 await ok('compile',{bundle_id:'CR-QUALITY-001'})
 assert.match(readFileSync(join(wikiRoot,'demo/doc/requirements/req-source-001.md'),'utf8'),/Source requirement/)
 assert.equal((await api('document-result-preview?project=demo&id='+artifact.id,undefined,human)).status,200)
 const download=await ok('document-result-original?project=demo&id='+artifact.id,undefined,human)
 assert.equal(Buffer.from(download.base64,'base64').toString(),'source fixture')
 save(join(shared,'unsafe.md'),'# Unsafe\n\n<script>bad()</script>')
 assert.equal((await api('artifacts',{project:'demo',run_id:run.id,logical_key:'unsafe',target_path:'doc/50-designs/unsafe.md',content_uri:'shared://team/unsafe.md',parsed_uri:registration.parsed,recipe_version:'v1',source_links:[{source_version_id:original.id}]})).status,422)


 // A second real artifact with complete, above-threshold scores is approved by policy.
 const autoDoc=artifactDoc.replace('Reviewer','待指定')
 save(join(shared,'automatic.md'),autoDoc)
 const autoArtifact=await ok('artifacts',{project:'demo',run_id:run.id,logical_key:'automatic',template_id:'urd',target_path:'doc/50-designs/automatic.md',content_uri:'shared://team/automatic.md',parsed_uri:registration.parsed,recipe_version:'auto-v1',source_links:[{source_version_id:original.id,location:{section:'1'}}]})
 const autoDimensions=Object.fromEntries(Object.entries(dimensions).map(([k,v])=>[k,{...v,score:85}]))
 const autoInput={project:'demo',artifact_id:autoArtifact.id,artifact_sha256:autoArtifact.content_sha256,policy_digest:policy.digest,dimensions:autoDimensions,issues:[],evaluator_version:'auto-test-v1'}
 const autoKey=randomUUID()
 const autoEvaluation=await ok('document-evaluations',autoInput,undefined,autoKey)
 assert.equal((await ok('document-evaluations',autoInput,undefined,autoKey)).id,autoEvaluation.id)
 assert.equal(autoEvaluation.needs_review,false)
 const autoTask=(await ok('document-review-tasks?project=demo')).items.find(t=>t.evaluation_id===autoEvaluation.id)
 assert.equal(autoTask.status,'approved');assert.equal(autoTask.approval_mode,'auto')
 const autoEvent=(await ok('document-review-events?project=demo')).items.find(e=>e.task_id===autoTask.id)
 assert.equal(autoEvent.actor_id,'system:quality-policy');assert.equal(autoEvent.policy_digest,policy.digest)
 const autoPublished=await ok('publish-document',{project:'demo',artifact_id:autoArtifact.id,evaluation_id:autoEvaluation.id})
 assert.ok(autoPublished.publications.every(p=>p.status==='published'))
 assert.equal(readFileSync(autoPublished.path,'utf8'),autoDoc)
 const autoRetry=await ok('publish-document',{project:'demo',artifact_id:autoArtifact.id,evaluation_id:autoEvaluation.id})
 assert.equal(autoRetry.sha256,autoArtifact.content_sha256);assert.deepEqual(autoRetry.publications,autoPublished.publications)
 await setup('quality-policies',{path:'doc',expected_revision:0,patch:{review_threshold:90}})
 policy=await ok('quality-policy-effective?project=demo&path=doc%2F50-designs');assert.equal(policy.review_threshold,90);assert.equal(policy.origins.review_threshold,'doc@1')
 assert.equal((await api('publish-document',{project:'demo',artifact_id:artifact.id,evaluation_id:evaluation.id})).status,409)
 assert.equal((await ok('document-review-events?project=demo')).items.length,2)
 assert.equal((await api('publish-document',{project:'demo',artifact_id:autoArtifact.id,evaluation_id:autoEvaluation.id})).status,409,'automatic approval expires on policy changes')

 const gitConfig=await setup('data-sources',{name:'Git docs',type:'git',url:'git@example.test:team/docs.git',subpath:'docs',revision_selector:'main'})
 const gitContext=await ok('context?project=demo'),gitSource=gitContext.data_sources.find(s=>s.id===gitConfig.id)
 const commit='a'.repeat(40),gitBytes=Buffer.from('Git source fixture'),blob=createHash('sha1').update(Buffer.from(`blob ${gitBytes.length}\0`)).update(gitBytes).digest('hex')
 save(join(shared,'git-original.docx'),gitBytes.toString())
 save(join(shared,'git-info.json'),{source_type:'git',repository_url:gitSource.url,commit_sha:commit,files:[{repository_path:'docs/design.docx',blob_oid:blob,sha256:sha(gitBytes)}]})
 const gitRun=await ok('ingest-runs',{project:'demo',source_id:gitSource.id,source_config_id:gitSource.config_id,commit_sha:commit,repository_url:gitSource.url,recipe_version:'git-skill-v1'})
 const gitOriginal=await ok('source-observations',{project:'demo',run_id:gitRun.id,repository_path:'docs/design.docx',original_uri:'shared://team/git-original.docx',original_sha256:sha(gitBytes),git_info_uri:'shared://team/git-info.json',git_blob_oid:blob})
 assert.equal(gitOriginal.source_type,'git');assert.equal(gitOriginal.commit_sha,commit)
 const gitRegistration={...registration,source:'shared://team/git-original.docx',parsed:'shared://team/git-parsed.md'}
 await ok('convert',gitRegistration);await ok('state',{source:gitRegistration.parsed,action:'freeze',by:'skill'})
 save(join(shared,'git-classified.md'),artifactDoc.replace('## 1. 背景与目标','## 1. 背景与目标\n\nGit-backed content.'))
 const gitArtifact=await ok('artifacts',{project:'demo',run_id:gitRun.id,logical_key:'git-design',template_id:'urd',target_path:'doc/50-designs/git-design.md',content_uri:'shared://team/git-classified.md',parsed_uri:gitRegistration.parsed,recipe_version:'git-skill-v1',source_links:[{source_version_id:gitOriginal.id,location:{section:'1'}}]})
 const gitPolicy=await ok('quality-policy-effective?project=demo&path=doc%2F50-designs')
 const gitEvaluation=await ok('document-evaluations',{project:'demo',artifact_id:gitArtifact.id,artifact_sha256:gitArtifact.content_sha256,policy_digest:gitPolicy.digest,dimensions,issues:[],evaluator_version:'git-test-v1'})
 await ok('document-review-decisions',{project:'demo',task_id:gitEvaluation.review_task_id,expected_revision:1,decision:'approve',note:'Git original checked'},human)
 const gitPublished=await ok('publish-document',{project:'demo',artifact_id:gitArtifact.id,evaluation_id:gitEvaluation.id});assert.match(readFileSync(gitPublished.path,'utf8'),/Git-backed/)
 save(join(shared,'git-info.json'),{commit_sha:'changed'})
 assert.equal((await api('document-result-preview?project=demo&id='+gitArtifact.id,undefined,human)).status,409)
 // Source mutation invalidates even a subsequent assessment.
 save(join(shared,'original.docx'),'tampered original')
 assert.equal((await api('document-evaluations',{project:'demo',artifact_id:artifact.id,artifact_sha256:artifact.content_sha256,policy_digest:policy.digest,dimensions,issues:[],evaluator_version:'v2'})).status,409)
})
