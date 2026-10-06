import {describe,it,expect,vi,afterEach} from 'vitest';
import {ResourcePanel} from './resource-panel';
class Element{
  children:Element[]=[];hidden=false;open=false;dataset:Record<string,string>={};textContent='';className='';max=1;value=0;title='';onclick:(()=>void)|undefined;
  constructor(readonly tag:string){}
  append(...children:Element[]){this.children.push(...children);}
  replaceChildren(...children:Element[]){this.children=children;}
  setAttribute(){}removeAttribute(){}
  querySelectorAll(tag:string):Element[]{return this.children.flatMap(child=>[...(child.tag===tag?[child]:[]),...child.querySelectorAll(tag)]);}
}
afterEach(()=>vi.unstubAllGlobals());
describe('loading screen retry',()=>{
  it('resumes the original startup/match caller only after a retry succeeds',async()=>{
    const body=new Element('body');vi.stubGlobal('document',{body,createElement:(tag:string)=>new Element(tag),createDocumentFragment:()=>new Element('fragment')});
    const panel=new ResourcePanel();let attempts=0,continued=false;
    const work=panel.run('home','Prepare',async()=>{if(++attempts===1)throw new Error('Temporary failure');}).then(()=>{continued=true;});
    const retry=body.querySelectorAll('button').find(button=>button.textContent==='Retry')!;
    await vi.waitFor(()=>expect(retry.hidden).toBe(false));expect(continued).toBe(false);
    retry.onclick!();await work;expect(continued).toBe(true);expect(attempts).toBe(2);expect(body.children[0]!.hidden).toBe(true);
  });
});
