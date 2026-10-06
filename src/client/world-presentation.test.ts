import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {GameSnapshot} from '../shared/types';
import type {WorldFrame} from './world-renderer';

const mocks=vi.hoisted(()=>({
  warm:vi.fn(async(_key:string,_phase:string)=>{}),image:vi.fn(async(_key:string,_phase:string)=>{}),draw:vi.fn(),
  panel:{renderer:'',preparing:vi.fn()},
  layer:{prepare:vi.fn(async()=>{}),reset:vi.fn(),draw:vi.fn(),pick:vi.fn(),positions:new Map()},
  create:vi.fn(),
}));
vi.mock('./resources',()=>({resources:{warm:mocks.warm},resourceText:(_zh:string,en:string)=>en}));
vi.mock('./art/baked-assets',()=>({loadBakedImage:mocks.image}));
vi.mock('./resource-panel',()=>({resourcePanel:()=>mocks.panel}));
vi.mock('./world-renderer',()=>({drawWorld:mocks.draw}));
vi.mock('./world3d/world-layer',()=>({World3DLayer:{create:mocks.create},PHYSICAL_EFFECTS:new Set()}));
import {WorldPresentation} from './world-presentation';

const context2d={setTransform(){},clearRect(){},save(){},restore(){}};
class Element extends EventTarget {
  className='';hidden=false;width=800;height=600;children:Element[]=[];
  context:WebGL2RenderingContext|null={} as WebGL2RenderingContext;
  append(...children:Element[]){this.children.push(...children);}
  before(){}
  getContext(kind:string){return kind==='2d'?context2d:this.context;}
}
let elements:Element[];
beforeEach(()=>{
  vi.clearAllMocks();mocks.panel.renderer='';
  mocks.warm.mockImplementation(async()=>{});mocks.image.mockImplementation(async()=>{});
  mocks.layer.prepare.mockImplementation(async()=>{});mocks.layer.draw.mockImplementation(()=>{});
  mocks.create.mockImplementation(()=>mocks.layer);
  elements=[];
  vi.stubGlobal('document',{createElement:()=>{const element=new Element();elements.push(element);return element;}});
  vi.stubGlobal('devicePixelRatio',1);
});
afterEach(()=>vi.unstubAllGlobals());
function snapshot(kind:'farm'|'barracks'='farm'){
  return{tick:0,units:[],buildings:[{id:kind,kind}],shops:[],mercenaryCamps:[]} as unknown as GameSnapshot;
}
function frame(scene:GameSnapshot):WorldFrame{
  return{snapshot:scene,view:{x:0,y:0,width:800,height:600},ctx:context2d,now:0} as unknown as WorldFrame;
}
function actors(){return elements.find(element=>element.className==='world-actors')!;}
function lose(){const event=new Event('webglcontextlost',{cancelable:true});actors().dispatchEvent(event);expect(event.defaultPrevented).toBe(true);}

describe('current scene graphics recovery (GPU mocked)',()=>{
  it('warms only current home scenery after context loss, then restores the latest scene instead of the initial scene',async()=>{
    const presentation=new WorldPresentation(new Element() as unknown as HTMLCanvasElement);
    await presentation.prepare(snapshot(),'home');
    const current=snapshot('barracks');presentation.draw(frame(current),'home');
    mocks.image.mockClear();lose();
    await vi.waitFor(()=>expect(mocks.image).toHaveBeenCalledWith('buildings/barracks','home'));
    expect(mocks.image).not.toHaveBeenCalledWith('buildings/farm','home');
    expect(mocks.image.mock.calls.every(call=>call[1]==='home')).toBe(true);
    expect(presentation.is3D).toBe(false);
    actors().dispatchEvent(new Event('webglcontextrestored'));
    await vi.waitFor(()=>expect(presentation.is3D).toBe(true));
    expect(mocks.layer.prepare).toHaveBeenLastCalledWith(current,'home',[]);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it('tracks the home phase when returning from a match and prepares current architecture overrides for Canvas',async()=>{
    const presentation=new WorldPresentation(new Element() as unknown as HTMLCanvasElement);
    await presentation.prepare(snapshot(),'match');
    const home:WorldFrame={...frame(snapshot('barracks')),buildingModels:{barracks:'citadel'}};
    presentation.draw(home,'home');mocks.image.mockClear();lose();
    await vi.waitFor(()=>expect(mocks.image).toHaveBeenCalledWith('buildings/citadel','home'));
    expect(mocks.image.mock.calls.every(call=>call[1]==='home')).toBe(true);
    expect(mocks.image).not.toHaveBeenCalledWith('portraits/warship','match');
  });
  it('keeps a failed draw on Canvas across scene preparation until the graphics context is restored',async()=>{
    const presentation=new WorldPresentation(new Element() as unknown as HTMLCanvasElement);
    await presentation.prepare(snapshot(),'home');
    const error=vi.spyOn(console,'error').mockImplementation(()=>{});
    mocks.layer.draw.mockImplementationOnce(()=>{throw new Error('GPU lost');});
    presentation.draw(frame(snapshot('barracks')),'home');
    await presentation.prepare(snapshot(),'home');
    expect(presentation.is3D).toBe(false);expect(mocks.layer.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.draw).toHaveBeenCalled();
    expect(mocks.image.mock.calls.every(call=>call[1]==='home')).toBe(true);error.mockRestore();
  });
  it('shares asynchronous GPU initialization and never activates an obsolete preparation',async()=>{
    let release!:()=>void;
    mocks.warm.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
    const presentation=new WorldPresentation(new Element() as unknown as HTMLCanvasElement);
    const old=presentation.prepare(snapshot(),'home'),current=snapshot('barracks');
    const latest=presentation.prepare(current,'home');release();await Promise.all([old,latest]);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.layer.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.layer.prepare).toHaveBeenCalledWith(current,'home',[]);
    expect(presentation.is3D).toBe(true);
  });
  it('does not let in-flight model preparation reactivate a lost context',async()=>{
    let release!:()=>void;
    mocks.layer.prepare.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
    const presentation=new WorldPresentation(new Element() as unknown as HTMLCanvasElement);
    const work=presentation.prepare(snapshot(),'home');
    await vi.waitFor(()=>expect(mocks.layer.prepare).toHaveBeenCalledTimes(1));
    lose();release();await work;
    expect(presentation.is3D).toBe(false);expect(mocks.layer.reset).not.toHaveBeenCalled();
    expect(mocks.image.mock.calls.every(call=>call[1]==='home')).toBe(true);
  });
  it('does not reset or replace the active scene when older model preparation finishes later',async()=>{
    let release!:()=>void;
    mocks.layer.prepare.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
    const presentation=new WorldPresentation(new Element() as unknown as HTMLCanvasElement);
    const old=presentation.prepare(snapshot(),'home');
    await vi.waitFor(()=>expect(mocks.layer.prepare).toHaveBeenCalledTimes(1));
    await presentation.prepare(snapshot('barracks'),'home');
    expect(presentation.is3D).toBe(true);expect(mocks.layer.reset).toHaveBeenCalledTimes(1);
    release();await old;expect(presentation.is3D).toBe(true);expect(mocks.layer.reset).toHaveBeenCalledTimes(1);
  });
});
