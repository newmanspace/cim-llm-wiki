import {beforeEach,afterEach,test,expect,vi} from 'vitest'
import {mount,flushPromises,type VueWrapper} from '@vue/test-utils'
import DirectoryWorkspace from '../src/components/DirectoryWorkspace.vue'
import DirectoryScoring from '../src/components/DirectoryScoring.vue'
const api=vi.hoisted(()=>({get:vi.fn(),post:vi.fn(),push:vi.fn()}))
vi.mock('../src/api/client',()=>({default:api}))
vi.mock('vue-router',()=>({useRouter:()=>({push:api.push}),onBeforeRouteLeave:vi.fn()}))
const ids=['fidelity','completeness','traceability','consistency','structure','usability','validity']
const effective={review_threshold:80,dimensions:Object.fromEntries(ids.map(id=>[id,{weight:id==='fidelity'||id==='completeness'?.2:id==='traceability'||id==='consistency'?.15:.1,rubric:'Source comparison'}])),origins:{review_threshold:'default@1'},digest:'before'}
let rows:any[],policies:any[],wrapper:VueWrapper
const baseRows=[{id:'1',path:'doc',parent_path:'',display_name:'产品文档',revision:1,child_count:2,document_count:0,scoring_mode:'inherit',path_locked:true,can_delete:false},{id:'2',path:'doc/50-designs',parent_path:'doc',display_name:'设计方案',revision:1,child_count:1,document_count:0,scoring_mode:'inherit',path_locked:true,can_delete:false},{id:'3',path:'doc/50-designs/api',parent_path:'doc/50-designs',display_name:'接口设计',revision:1,child_count:0,document_count:0,scoring_mode:'inherit',path_locked:false,can_delete:true},{id:'4',path:'doc/empty',parent_path:'doc',display_name:'空目录',revision:1,child_count:0,document_count:0,scoring_mode:'inherit',path_locked:false,can_delete:true}]
const overlay={props:['visible'],template:'<div v-if="visible"><slot/></div>'}
function setup(){wrapper=mount(DirectoryWorkspace,{props:{projectId:'demo'},global:{stubs:{TDialog:overlay,TDrawer:overlay}}})}
async function button(text:string){const target=wrapper.findAll('button').find(b=>b.text()===text);expect(target,`button ${text}`).toBeTruthy();await target!.trigger('click');await flushPromises()}
async function node(path:string){await wrapper.find(`[role=treeitem][title="${path}"]`).trigger('click');await flushPromises()}
beforeEach(()=>{rows=structuredClone(baseRows);policies=[];api.get.mockImplementation(async(url:string)=>({data:{data:url.endsWith('quality-policy-effective')?structuredClone(effective):{items:url.endsWith('directory-catalog')?rows:url.endsWith('quality-policies')?policies:[],next_cursor:''}}}));api.post.mockImplementation(async(url:string,body:any)=>({data:{data:url.endsWith('quality-policy-preview')?{changed_paths:[body.path],expected_digest:'before',effective}:body}}));vi.spyOn(window,'confirm').mockReturnValue(true)})
afterEach(()=>{wrapper?.unmount();vi.restoreAllMocks();vi.clearAllMocks()})
test('right panel lists only direct children and navigation, search and context menu share a target',async()=>{
 setup();await flushPromises();const table=()=>wrapper.find('tbody').text();expect(table()).toContain('设计方案');expect(table()).not.toContain('接口设计')
 await node('doc/50-designs');expect(table()).toContain('接口设计');expect(table()).not.toContain('空目录')
 await wrapper.find('[aria-label="检索子目录"]').setValue('missing');expect(wrapper.text()).toContain('没有匹配');await wrapper.find('[aria-label="检索子目录"]').setValue('')
 await wrapper.find('[role=treeitem][title="doc/empty"]').trigger('contextmenu',{clientX:100,clientY:100});await flushPromises();expect(wrapper.find('[role=menu]').text()).toContain('空目录');expect(wrapper.text()).toContain('暂无子目录')
 await wrapper.find('[role=menu]').trigger('keydown',{key:'ArrowDown'});await wrapper.find('[role=menu]').trigger('keydown',{key:'ArrowUp'});await wrapper.find('[role=menu]').trigger('keydown',{key:'Escape'});expect(wrapper.find('[role=menu]').exists()).toBe(false)
 await wrapper.find('[aria-label="搜索目录"]').setValue('接口');expect(wrapper.findAll('[role=treeitem]')).toHaveLength(3)
})
test('new directory supports parent selection, direct paths and explicit missing-parent consent',async()=>{
 setup();await flushPromises();await button('新建子目录')
 const form=wrapper.find('form.directory-form');let inputs=form.findAll('input');await inputs[0]!.setValue('方案归档');await form.find('input[placeholder=interfaces]').setValue('archive');await form.trigger('submit');await flushPromises()
 expect(api.post).toHaveBeenLastCalledWith(expect.stringContaining('document-directories'),expect.objectContaining({path:'doc/archive',display_name:'方案归档',action:'create'}),expect.anything())
 await button('新建子目录');await wrapper.find('form select').setValue('full');const newForm=wrapper.find('form');inputs=newForm.findAll('input');await inputs[0]!.setValue('详细设计');await inputs[1]!.setValue('doc/missing/detail');expect(wrapper.text()).toContain('doc/missing');await newForm.find('input[type=checkbox]').setValue(true);await newForm.trigger('submit');await flushPromises();expect(api.post).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({create_parents:true,path:'doc/missing/detail'}),expect.anything())
})
test('properties persist names, guard drafts and allow empty directory path edits',async()=>{
 setup();await flushPromises();await node('doc/empty');await button('目录属性');const form=wrapper.find('form');await form.findAll('input')[0]!.setValue('新名称');expect(wrapper.vm.canLeave()).toBe(true);vi.mocked(window.confirm).mockReturnValue(false);expect(wrapper.vm.canLeave()).toBe(false);await button('取消');expect(wrapper.find('form').exists()).toBe(true);vi.mocked(window.confirm).mockReturnValue(true)
 await form.findAll('input')[2]!.setValue('renamed');await form.trigger('submit');await flushPromises();expect(api.post).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({action:'update',id:'4',expected_revision:1,path:'doc/renamed',display_name:'新名称'}),expect.anything())
})
test('right click supports scoring, clipboard, document navigation and empty deletion',async()=>{
 setup();await flushPromises();Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:vi.fn().mockResolvedValue(undefined)}})
 const context=async()=>{await wrapper.find('[role=treeitem][title="doc/empty"]').trigger('contextmenu',{clientX:100,clientY:100});await flushPromises()}
 await context();await button('复制完整路径');expect(navigator.clipboard.writeText).toHaveBeenCalledWith('doc/empty')
 await context();await button('查看文档');expect(api.push).toHaveBeenCalledWith(expect.objectContaining({query:{project:'demo',folder:'doc/empty'}}))
 await context();await button('评分设置');expect(wrapper.findComponent(DirectoryScoring).exists()).toBe(true);await button('基本信息');await button('取消')
 await context();await button('删除空目录');await button('确认删除');expect(api.post).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({action:'delete',id:'4',expected_revision:1}),expect.anything())
})
test('request errors preserve creation input, and draft cancellation can be refused',async()=>{
 setup();await flushPromises();await button('新建子目录');await wrapper.find('form input').setValue('保留草稿');vi.mocked(window.confirm).mockReturnValue(false);await button('取消');expect(wrapper.find('form').exists()).toBe(true);api.post.mockRejectedValueOnce({response:{data:{error:'Directory changed'}}});await wrapper.find('form').trigger('submit');await flushPromises();expect(wrapper.text()).toContain('Directory changed');expect((wrapper.find('form input').element as HTMLInputElement).value).toBe('保留草稿')
})
test('scoring supports partial overrides, full independent settings, preview and save',async()=>{
 wrapper=mount(DirectoryScoring,{props:{projectId:'demo',path:'doc/empty'}});await flushPromises();await wrapper.find('select').setValue('partial');await wrapper.find('input[type=checkbox]').setValue(true);await wrapper.find('input[type=number]').setValue(85);await button('预览影响');expect(api.post).toHaveBeenLastCalledWith(expect.stringContaining('preview'),expect.objectContaining({patch:{review_threshold:85}}),expect.anything());await button('确认保存评分');expect(api.post).toHaveBeenCalledWith(expect.stringContaining('quality-policies'),expect.objectContaining({expected_digest:'before',patch:{review_threshold:85}}),expect.anything())
 await wrapper.find('select').setValue('independent');await button('预览影响');expect(api.post).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({patch:expect.objectContaining({dimensions:expect.objectContaining({fidelity:expect.objectContaining({weight:.2})})})}),expect.anything())
 await wrapper.find('select').setValue('inherit');await button('预览影响');expect(api.post).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({patch:{}}),expect.anything())
})
test('project default and server conflicts retain the scoring editor',async()=>{
 wrapper=mount(DirectoryScoring,{props:{projectId:'demo',path:''}});await flushPromises();expect(wrapper.text()).toContain('项目默认');expect(wrapper.find('select').attributes('disabled')).toBeDefined();api.post.mockRejectedValueOnce({response:{data:{error:'Inherited policy changed'}}});await button('预览影响');expect(wrapper.text()).toContain('Inherited policy changed');expect(wrapper.findAll('textarea')).toHaveLength(7)
})
