import {afterEach,beforeEach,expect,test,vi} from 'vitest'
import {mount,flushPromises,type VueWrapper} from '@vue/test-utils'
import CodeSourceSettings from '../src/components/CodeSourceSettings.vue'
const api=vi.hoisted(()=>({post:vi.fn()}))
vi.mock('../src/api/client',()=>({default:api}))
let wrapper:VueWrapper
const overlay={props:['visible'],template:'<div v-if="visible"><slot/></div>'}
async function click(text:string){const button=wrapper.findAll('button').find(item=>item.text()===text);expect(button).toBeTruthy();await button!.trigger('click');await flushPromises()}
beforeEach(()=>{api.post.mockResolvedValue({data:{status:'ok'}});wrapper=mount(CodeSourceSettings,{props:{projectId:'demo',repos:[]},global:{stubs:{TDialog:overlay,TButton:{template:'<button><slot/></button>'}}}});vi.spyOn(window,'confirm').mockReturnValue(true)})
afterEach(()=>{wrapper.unmount();vi.restoreAllMocks();vi.clearAllMocks()})
test('code sources support new SVN and Git configuration independently of document sources',async()=>{
 await click('新增代码数据源');const form=wrapper.find('form');const inputs=form.findAll('input');await inputs[0]!.setValue('SVN Core');await form.find('select').setValue('svn');await inputs[1]!.setValue('https://example.test/svn');await inputs[2]!.setValue('trunk/src');await inputs[3]!.setValue('42');await form.trigger('submit');await flushPromises();expect(api.post).toHaveBeenLastCalledWith('/admin/projects/demo/code-sources',expect.objectContaining({name:'SVN Core',type:'svn',subpath:'trunk/src',revision_selector:'42',expected_revision:0}));expect(wrapper.emitted('saved')).toHaveLength(1)
 await click('新增代码数据源');await wrapper.findAll('form input')[0]!.setValue('Git Core');await wrapper.findAll('form input')[1]!.setValue('ssh://git@example.test/repo.git');await wrapper.find('form').trigger('submit');await flushPromises();expect(api.post).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({type:'git',url:'ssh://git@example.test/repo.git'}))
})
test('editing preserves identity, mappings entry and config version, failure keeps the draft',async()=>{
 const repo={name:'Core',type:'svn' as const,url:'https://example.test/svn',subpath:'trunk',revision_selector:'HEAD',config_revision:3,enabled:true,branch:'HEAD',submodule:'',module_mapping:{src:'wip'},last_sync_sha:'',synced_at:''};await wrapper.setProps({repos:[repo]});await click('模块映射');expect(wrapper.emitted('mappings')![0]).toEqual([repo]);await click('编辑');expect(wrapper.find('form select').attributes('disabled')).toBeDefined();expect(wrapper.find('form input').attributes('readonly')).toBeDefined();await wrapper.find('input[type=checkbox]').setValue(false);api.post.mockRejectedValueOnce({response:{data:{error:'Code source changed'}}});await wrapper.find('form').trigger('submit');await flushPromises();expect(wrapper.text()).toContain('Code source changed');expect(api.post).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({expected_revision:3,enabled:false}));vi.mocked(window.confirm).mockReturnValue(false);await click('取消');expect(wrapper.find('form').exists()).toBe(true)
})
