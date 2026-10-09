import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({
  listeners:new Set<()=>void>(),unsubscribe:vi.fn(),summary:vi.fn(),
}));
vi.mock('./resources',()=>({
  resources:{phase:'startup',subscribe(listener:()=>void){mocks.listeners.add(listener);return()=>{mocks.listeners.delete(listener);mocks.unsubscribe();};},summary:mocks.summary},
  resourceText:(_zh:string,en:string)=>en,resourceSize:(bytes:number)=>`${bytes} B`,
}));
import {ResourcePanel} from './resource-panel';

class Element {
  className='';textContent='';hidden=false;open=false;max=0;value=0;title='';
  dataset:Record<string,string>={};attributes=new Map<string,string>();
  children:Element[]=[];parent:Element|undefined;onclick:(()=>void)|undefined;ontoggle:(()=>void)|undefined;
  constructor(readonly tag:string){}
  append(...children:Element[]){for(const child of children){child.remove();child.parent=this;this.children.push(child);}}
  remove(){if(this.parent){this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=undefined;}}
  replaceChildren(...children:Element[]){for(const child of [...this.children])child.remove();this.append(...children);}
  setAttribute(key:string,value:string){this.attributes.set(key,value);}
  removeAttribute(key:string){this.attributes.delete(key);}
  querySelectorAll(tag:string):Element[]{return this.children.flatMap(child=>[...(child.tag===tag?[child]:[]),...child.querySelectorAll(tag)]);}
  click(){this.onclick?.();}
}
let body:Element,panels:ResourcePanel[],frames:Map<number,FrameRequestCallback>;
let request:ReturnType<typeof vi.fn>,cancel:ReturnType<typeof vi.fn>;
beforeEach(()=>{
  vi.clearAllMocks();mocks.listeners.clear();mocks.summary.mockReturnValue({entries:[],loaded:0,total:0,unknown:false,reused:0,ready:0,failed:0});
  body=new Element('body');panels=[];frames=new Map();let next=0;
  request=vi.fn((callback:FrameRequestCallback)=>{frames.set(++next,callback);return next;});cancel=vi.fn((id:number)=>{frames.delete(id);});
  vi.stubGlobal('document',{body,createElement:(tag:string)=>new Element(tag),createDocumentFragment:()=>new Element('fragment')});
  vi.stubGlobal('requestAnimationFrame',request);vi.stubGlobal('cancelAnimationFrame',cancel);
});
afterEach(()=>{for(const panel of panels)panel.dispose();vi.unstubAllGlobals();});
function panel(){const panel=new ResourcePanel();panels.push(panel);return panel;}
function notify(){for(const listener of mocks.listeners)listener();}
function retry(){return body.querySelectorAll('button').find(button=>button.textContent==='Retry')!;}

describe('resource dialog lifetime',()=>{
  it('unsubscribes, cancels its pending frame and ignores even a stale delivered frame after disposal',()=>{
    const view=panel();view.open();notify();notify();expect(request).toHaveBeenCalledOnce();
    const [id,frame]=[...frames.entries()][0]!;view.dispose();view.dispose();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();expect(cancel).toHaveBeenCalledWith(id);
    expect(frames.size).toBe(0);expect(body.children).toHaveLength(0);expect(mocks.listeners.size).toBe(0);
    const reads=mocks.summary.mock.calls.length;frame(0);notify();expect(mocks.summary).toHaveBeenCalledTimes(reads);
  });
  it('rejects an in-flight preparation on disposal and never resumes success after the task finishes',async()=>{
    let finish!:()=>void;const task=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;})),continued=vi.fn(),view=panel();
    const work=view.run('match','Prepare match',task).then(continued,error=>error);view.dispose();
    expect(await work).toMatchObject({name:'AbortError'});expect(continued).not.toHaveBeenCalled();
    finish();await Promise.resolve();await Promise.resolve();
    expect(continued).not.toHaveBeenCalled();expect(body.children).toHaveLength(0);
    const next=vi.fn(async()=>{});await expect(view.run('home','Home',next)).rejects.toMatchObject({name:'AbortError'});expect(next).not.toHaveBeenCalled();
  });
  it('does not restore a retry handler when a disposed task rejects late',async()=>{
    let fail!:(error:Error)=>void;const task=vi.fn(()=>new Promise<void>((_,reject)=>{fail=reject;})),view=panel();
    const work=view.run('match','Prepare match',task).catch(error=>error),button=retry();expect(button.hidden).toBe(true);
    view.dispose();expect(await work).toMatchObject({name:'AbortError'});fail(new Error('late load failure'));
    await Promise.resolve();await Promise.resolve();button.click();
    expect(button.hidden).toBe(true);expect(task).toHaveBeenCalledOnce();expect(body.children).toHaveLength(0);
  });
  it('keeps the caller suspended after failure and through retry until the actual preparation succeeds',async()=>{
    let finish!:()=>void;const task=vi.fn().mockRejectedValueOnce(new Error('network unavailable')).mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
    const continued=vi.fn(),view=panel(),work=view.run('match','Prepare match',task).then(continued);
    await Promise.resolve();await Promise.resolve();const button=retry();expect(button.hidden).toBe(false);
    expect(continued).not.toHaveBeenCalled();expect(body.children[0]!.hidden).toBe(false);
    button.click();expect(task).toHaveBeenCalledTimes(2);expect(button.hidden).toBe(true);expect(continued).not.toHaveBeenCalled();
    finish();await work;expect(continued).toHaveBeenCalledOnce();expect(body.children[0]!.hidden).toBe(true);
  });
});
