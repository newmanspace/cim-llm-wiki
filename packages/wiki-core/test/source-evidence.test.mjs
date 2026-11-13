import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {verifyGitEvidence} from '../../wiki-service/source-evidence.mjs'
test('Git evidence binds source bytes and blob identity to the pinned repository and commit',()=>{
 const run={source_type:'git',repository_url:'ssh://git@example.test/docs.git',commit_sha:'a'.repeat(40)}
 const bytes=Buffer.from('source');const blob=createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
 const source={repository_path:'docs/design.md',original_sha256:createHash('sha256').update(bytes).digest('hex'),git_blob_oid:blob}
 const evidence={...run,files:[{repository_path:source.repository_path,sha256:source.original_sha256,blob_oid:source.git_blob_oid}]}
 assert.doesNotThrow(()=>verifyGitEvidence(JSON.stringify(evidence),source,run,bytes))
 assert.throws(()=>verifyGitEvidence(JSON.stringify({...evidence,commit_sha:'d'.repeat(40)}),source,run,bytes),/commit/)
 assert.throws(()=>verifyGitEvidence(JSON.stringify(evidence),{...source,original_sha256:'e'.repeat(64)},run,bytes),/file evidence/)
 assert.throws(()=>verifyGitEvidence('invalid',source,run,bytes),/JSON/)
 assert.throws(()=>verifyGitEvidence(JSON.stringify(evidence),source,run,Buffer.from('changed')),/blob object/)
})
