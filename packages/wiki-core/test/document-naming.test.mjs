import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { documentFilename, identityErrors, validateNamedTree } from '../document-naming.mjs'
import { createDefaultsStore, builtinDefaults } from '../document-defaults.mjs'
import { captureSnapshot, snapshotContext } from '../build-snapshot.mjs'
import { execFileSync } from 'node:child_process'

test('document names follow five segments, reject guessing and preserve four-digit sequences',()=>{
 const values={short_code:'mycim-spc',doc_type:'sdd',module:'chart',topic:'control-chart',sequence:2}
 assert.equal(documentFilename(values),'mycim-spc-sdd-chart-control-chart-002.md')
 assert.equal(documentFilename({...values,sequence:1000}),'mycim-spc-sdd-chart-control-chart-1000.md')
 for(const module of ['Chart','a_b','../chart','chart--x','']) assert.throws(()=>documentFilename({...values,module}))
 const filename=documentFilename(values),identity={...values,filename,node_id:filename.slice(0,-3).toUpperCase()}
 const policy={types:[{code:'sdd',template_ids:['sdd']}]}
 assert.deepEqual(identityErrors(identity,{node_id:identity.node_id,target_path:'doc/50-designs/'+filename,template_id:'sdd'},policy),[])
 assert.equal(identityErrors(identity,{template_id:'idd'},policy).length,1)
})

test('frozen registry validates document content and refuses unregistered business pages',t=>{
 const root=mkdtempSync(join(tmpdir(),'named-tree-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 mkdirSync(join(root,'doc/50-designs'),{recursive:true})
 const identity={short_code:'mycim-spc',doc_type:'sdd',module:'chart',topic:'query',sequence:1,policy_digest:'digest'}
 identity.filename=documentFilename(identity);identity.node_id=identity.filename.slice(0,-3).toUpperCase()
 const manifest={policy:{digest:'digest',types:[{code:'sdd',template_ids:['sdd']}]},identities:[identity]}
 writeFileSync(join(root,'doc/50-designs',identity.filename),'# Query\n\n| 文档 ID | '+identity.node_id+' |\n')
 validateNamedTree(root,manifest)
 writeFileSync(join(root,'doc/50-designs/other.md'),'# Other')
 assert.throws(()=>validateNamedTree(root,manifest),/DOCUMENT_IDENTITY_REQUIRED/)
})

test('repository builds depend on committed documents without a naming registry',t=>{
 const root=mkdtempSync(join(tmpdir(),'naming-snapshot-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
 const source=join(root,'repo'),buildsRoot=join(root,'snapshots'),definition=builtinDefaults()
 definition.naming={format:'project-type-module-topic-sequence-v1',types:[{code:'sdd',template_ids:['sdd']}]}
 const store=createDefaultsStore(root);store.save(definition,0,'Administrator');store.publish(1,'Administrator');store.bind('demo',['chart'])
 mkdirSync(join(source,'doc/50-designs'),{recursive:true})
 const identity={short_code:'mycim-spc',doc_type:'sdd',module:'chart',topic:'query',sequence:1,policy_digest:'digest'}
 identity.filename=documentFilename(identity);identity.node_id=identity.filename.slice(0,-3).toUpperCase()
 writeFileSync(join(source,'doc/50-designs',identity.filename),'# Query\n\n| 文档 ID | '+identity.node_id+' |\n')
 const git=args=>execFileSync('git',['-C',source,...args],{stdio:'pipe'})
 git(['init']);git(['config','user.name','Test']);git(['config','user.email','test@example.test']);git(['add','.']);git(['commit','-m','fixture'])
 const options={projectRoot:root,wikiRoot:source,gitRoot:source,roots:{},buildsRoot,project:'demo',contentKind:'repository_docs'}
 const snapshot=captureSnapshot(options)
 store.bind('demo',['different-module'],{},undefined,true)
 assert.equal(snapshotContext(buildsRoot,snapshot.snapshot,snapshot.digest).contentKind,'repository_docs')
})
