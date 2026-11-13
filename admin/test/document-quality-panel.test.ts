import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import DocumentQualityPanel from '../src/components/DocumentQualityPanel.vue'
import { components } from './ui-stubs'
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('../src/api/client', () => ({ default: api }))
let wrapper: VueWrapper
const dimensionIds = ['fidelity','completeness','traceability','consistency','structure','usability','validity']
const dataset: Record<string, any[]> = {
 'document-directories':[{id:'20',path:'doc/50-designs/empty'}],
 'data-sources':[{id:'1',type:'svn',name:'Documents',config_id:'2',enabled:true,revision:2}],
 'source-revisions':[{id:'2',url:'https://example.test/svn',subpath:'design',revision_selector:'HEAD'}],
 'quality-policies':[{path:'doc/50-designs',policy_revision:2}],
 'document-results':[{id:'3',version:1,target_path:'doc/50-designs/design.md',content_sha256:'hash',parsed_uri:'shared://team/parsed.md',source_links:[{source_version_id:'4'}]}],
 'document-evaluations':[{id:'5',artifact_id:'3',total:75,needs_review:true,dimensions:Object.fromEntries(dimensionIds.map(id=>[id,{score:75,reason:'Source compared'}]))}],
 'document-review-tasks':[{id:'6',artifact_id:'3',evaluation_id:'5',status:'pending',revision:1}],
 'document-review-events':[{id:'7',task_id:'6',actor_id:'Earlier Reviewer',decision:'changes_requested',note:'Previous revision'}],
 'source-observations':[{id:'4',source_id:'1',original_uri:'shared://team/source.docx',repository_path:'source.docx',operative_revision:'42'}],
 'quality-issues':[],
}
beforeEach(()=>{
 api.get.mockImplementation(async(url: string)=>({data:{data:url.endsWith('quality-policy-effective')?{review_threshold:85,origins:{review_threshold:'doc@1'},dimensions:Object.fromEntries(dimensionIds.map(id=>[id,{weight:.1,rubric:'Source comparison'}]))}:{items:dataset[url.split('/').at(-1)!]||[],next_cursor:''}}}))
 api.post.mockResolvedValue({data:{data:{}}})
 wrapper=mount(DocumentQualityPanel,{props:{projectId:'demo'},global:{components}})
})
afterEach(()=>{wrapper.unmount();vi.restoreAllMocks();vi.unstubAllGlobals()})
async function click(label: string){const button=wrapper.findAll('button').find(b=>b.text()===label);expect(button).toBeTruthy();await button!.trigger('click');await flushPromises()}

test('configuration uses explicit project, cached SVN authentication and expected revisions',async()=>{
 await flushPromises();expect(wrapper.text()).toContain('design.md')
 await click('编辑');expect((wrapper.find('input[type=url]').element as HTMLInputElement).value).toBe('https://example.test/svn')
 await click('保存数据源')
 expect(api.post).toHaveBeenCalledWith(expect.stringContaining('/projects/demo/'),expect.objectContaining({id:'1',expected_revision:2,type:'svn'}),expect.anything())
 const policyInput=wrapper.find('input[placeholder^="doc/50-designs，"]');await policyInput.setValue('doc/50-designs')
 await click('查看生效规则');expect(wrapper.text()).toContain('doc@1')
 await click('仅覆盖分数线（其余继承）')
 expect(api.post).toHaveBeenCalledWith(expect.stringContaining('quality-policies'),expect.objectContaining({path:'doc/50-designs',expected_revision:2,patch:{review_threshold:85}}),expect.anything())
 await click('恢复全部继承');expect(api.post).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({patch:{}}),expect.anything())
})

test('review history is visible and decisions require an independent credential and note',async()=>{
 await flushPromises();await click('查看');expect(wrapper.text()).toContain('Earlier Reviewer')
 await click('通过');expect(wrapper.text()).toContain('请填写意见')
 const textareas=wrapper.findAll('textarea');await textareas.at(-1)!.setValue('Source checked')
 await click('通过');expect(wrapper.text()).toContain('请填写独立审核凭据')
 await wrapper.find('input[type=password]').setValue('human-only-secret')
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({data:{}})});vi.stubGlobal('fetch',fetcher)
 await click('通过')
 expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('document-review-decisions'),expect.objectContaining({headers:expect.objectContaining({Authorization:'Bearer human-only-secret'}),body:expect.stringContaining('Source checked')}))
 expect(localStorage.getItem('human-only-secret')).toBeNull()
})

test('configuration failures remain visible instead of being cleared by a refresh',async()=>{
 await flushPromises();api.post.mockRejectedValueOnce({response:{data:{error:'Policy revision changed'}}})
 await click('保存数据源');expect(wrapper.text()).toContain('Policy revision changed')
})

test('preview and original download use the independent reviewer credential without executing Markdown',async()=>{
 await flushPromises();await click('查看');await wrapper.find('input[type=password]').setValue('human-only-secret')
 const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({data:{markdown:'# Candidate',parsed:'# Original'}})}).mockResolvedValueOnce({ok:true,json:async()=>({data:{name:'source.docx',base64:btoa('original bytes')}})})
 vi.stubGlobal('fetch',fetcher);vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=> 'blob:test'),revokeObjectURL:vi.fn()}));vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
 await click('查看候选正文与原文转换稿');expect(wrapper.text()).toContain('# Candidate');expect(wrapper.text()).toContain('# Original')
 await click('下载原件核对');expect(fetcher).toHaveBeenLastCalledWith(expect.stringContaining('document-result-original'),expect.anything())
 await wrapper.setProps({projectId:'other'});await flushPromises();expect(wrapper.find('input[type=password]').exists()).toBe(false)
})

test('full directory policy writes all seven dimensions and changing path clears the displayed inherited policy',async()=>{
 await flushPromises();const path=wrapper.find('input[placeholder^="doc/50-designs，"]');await path.setValue('doc/50-designs');await click('查看生效规则');await click('设置分数线及全部维度')
 expect(api.post).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({patch:expect.objectContaining({dimensions:expect.objectContaining({fidelity:expect.objectContaining({rubric:'Source comparison'})})})}),expect.anything())
 await path.setValue('doc/40-requirements');expect(wrapper.text()).not.toContain('当前阈值来源')
})


test('new Git data sources preserve selected transport and reference',async()=>{
 await flushPromises();await click('新增数据源')
 await wrapper.find('[data-testid="source-type"]').setValue('git')
 await wrapper.find('input[type=url]').setValue('ssh://git@example.test/team/docs.git')
 await click('保存数据源')
 expect(api.post).toHaveBeenLastCalledWith(expect.stringContaining('data-sources'),expect.objectContaining({type:'git',url:'ssh://git@example.test/team/docs.git'}),expect.anything())
})

test('directory scoring and document results are independent views, including empty folders',async()=>{
 await flushPromises()
 await wrapper.setProps({mode:'directories'})
 expect(wrapper.text()).toContain('目录评分规则')
 expect(wrapper.text()).not.toContain('审核状态')
 expect(wrapper.text()).not.toContain('保存数据源')
 await wrapper.find('[aria-label="新建目录"]').trigger('click')
 await wrapper.find('[data-testid="new-directory"]').setValue('doc/50-designs/empty')
 await wrapper.find('form.create-directory').trigger('submit');await flushPromises()
 expect(api.post).toHaveBeenLastCalledWith(expect.stringContaining('/projects/demo/document-quality/document-directories'),{path:'doc/50-designs/empty'},expect.anything())
 await wrapper.setProps({mode:'results'})
 expect(wrapper.text()).not.toContain('目录评分规则')
 expect(wrapper.text()).toContain('design.md')
 const emptyFolder=wrapper.findAll('[role="treeitem"]').find(item=>item.attributes('title')==='doc/50-designs/empty')!
 await emptyFolder.trigger('click');await flushPromises()
 expect(wrapper.text()).not.toContain('design.md')
 const folder=wrapper.findAll('[role="treeitem"]').find(item=>item.attributes('title')==='doc/50-designs')!
 await folder.trigger('click');await flushPromises()
 expect(wrapper.text()).toContain('design.md')
 await wrapper.find('[data-testid="document-search"]').setValue('SOURCE.DOCX')
 expect(wrapper.text()).toContain('design.md')
 await wrapper.find('[data-testid="document-search"]').setValue('missing document')
 expect(wrapper.text()).not.toContain('design.md')
 expect(wrapper.text()).toContain('没有匹配的文档')
 await wrapper.setProps({projectId:'other'})
 await flushPromises()
 expect((wrapper.find('[data-testid="document-search"]').element as HTMLInputElement).value).toBe('')
})

test('new directory form opens before the tree with focus and the selected parent path',async()=>{
 await flushPromises();await wrapper.setProps({mode:'directories'});await flushPromises()
 await wrapper.find('[title="doc/50-designs"]').trigger('click');await flushPromises()
 const plus=wrapper.find('[aria-label="新建目录"]')
 await plus.trigger('click');await flushPromises()
 expect(plus.attributes('aria-expanded')).toBe('true')
 const input=wrapper.find('[data-testid="new-directory"]')
 expect((input.element as HTMLInputElement).value).toBe('doc/50-designs/')
 const form=wrapper.find('form.create-directory').element
 const tree=wrapper.find('[role="tree"]').element
 expect(form.compareDocumentPosition(tree)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
 await plus.trigger('click');expect(wrapper.find('form.create-directory').exists()).toBe(false)
})

test('automatic approvals are labelled separately and retain the approved filter status',async()=>{
 const pending=dataset['document-review-tasks']
 dataset['document-review-tasks']=[{...pending[0],status:'approved',approval_mode:'auto'}]
 wrapper.unmount()
 wrapper=mount(DocumentQualityPanel,{props:{projectId:'demo',mode:'results'},global:{components}})
 try {
  await flushPromises()
  expect(wrapper.find('[data-status="approved"]').text()).toBe('自动批准')
  await click('查看')
  expect(wrapper.findAll('button').find(b=>b.text()==='通过')!.attributes('disabled')).toBeDefined()
 } finally {dataset['document-review-tasks']=pending}
})
