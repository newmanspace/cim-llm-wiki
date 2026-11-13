import { afterEach, expect, test, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ProjectDocuments from '../src/views/admin/ProjectDocuments.vue'
const mocks=vi.hoisted(()=>({projects:vi.fn(),replace:vi.fn()}))
vi.mock('../src/api/projects',()=>({listProjects:mocks.projects}))
vi.mock('vue-router',()=>({useRoute:()=>({query:{project:'second'}}),useRouter:()=>({replace:mocks.replace})}))
afterEach(()=>vi.clearAllMocks())
test('selected project controls the right panel and switching unmounts the prior project',async()=>{
 mocks.projects.mockResolvedValue([{id:'first',name:'First'},{id:'second',name:'Second'}])
 const wrapper=mount(ProjectDocuments,{props:{mode:'results'},global:{stubs:{DocumentQualityPanel:{props:['projectId','mode'],template:'<p>{{projectId}}:{{mode}}</p>'}}}})
 await flushPromises()
 expect(wrapper.text()).toContain('second:results')
 await wrapper.find('select[aria-label="选择项目"]').setValue('first')
 expect(wrapper.text()).toContain('first:results')
 expect(mocks.replace).toHaveBeenCalledWith({query:{project:'first'}})
 wrapper.unmount()
})
test('project load errors and empty project lists are visible',async()=>{
 mocks.projects.mockRejectedValueOnce(new Error('offline'))
 const options={props:{mode:'directories' as const},global:{stubs:{DocumentQualityPanel:true}}}
 const failed=mount(ProjectDocuments,options);await flushPromises();expect(failed.text()).toContain('项目加载失败');failed.unmount()
 mocks.projects.mockResolvedValue([])
 const empty=mount(ProjectDocuments,options);await flushPromises();expect(empty.text()).toContain('暂无项目');empty.unmount()
})
