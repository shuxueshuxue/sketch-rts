import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {resources} from '../resources';
import {ModelLibrary} from './model-library';

afterEach(()=>{resources.dispose();vi.restoreAllMocks();vi.unstubAllGlobals();});
function parsed(scene:THREE.Group):GLTF{return{scene,scenes:[scene],animations:[],cameras:[],asset:{version:'2.0'},parser:{} as GLTF['parser'],userData:{}};}
function testModel(){
  const bitmap={close:vi.fn()},texture=new THREE.Texture(bitmap as unknown as TexImageSource),geometry=new THREE.BoxGeometry(3,4,5),material=new THREE.MeshStandardMaterial({map:texture,normalMap:texture});
  const scene=new THREE.Group(),hull=new THREE.Mesh(geometry,material);hull.name='Hull';scene.add(hull);scene.add(hull.clone());
  return{scene,bitmap,texture,geometry,material};
}
describe('shared in-flight model preparation',()=>{
  it('records both phases while sharing one parse of the actual GLB',async()=>{
    let release!:(bytes:ArrayBuffer)=>void;
    const data=new Promise<ArrayBuffer>(resolve=>{release=resolve;});
    const request=vi.spyOn(resources,'bytes').mockReturnValue(data),reuse=vi.spyOn(resources,'recordUse'),library=new ModelLibrary();
    const home=library.prepare(['ships/warship'],'home'),match=library.prepare(['ships/warship'],'match');
    expect(request.mock.calls.map(call=>call[2])).toEqual(['home']);expect(reuse).toHaveBeenCalledWith(resources.url('art/world3d/ships/warship.glb'),'match');
    const bytes=readFileSync('public/art/world3d/ships/warship.glb');
    release(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer);
    await Promise.all([home,match]);expect(library.component('ships/warship','Hull')).toBeTruthy();expect(library.cacheStats()).toEqual({models:1,pending:0});
    await library.prepare(['ships/warship'],'match');expect(request).toHaveBeenCalledTimes(1);library.dispose();
  });
  it('shares actual bytes across libraries, releases buffers after parsing, and reuses decoded assets without fetching',async()=>{
    const bytes=readFileSync('public/art/world3d/ships/warship.glb'),fetcher=vi.fn(async()=>new Response(bytes));vi.stubGlobal('fetch',fetcher);
    const first=new ModelLibrary(),second=new ModelLibrary();
    await Promise.all([first.prepare(['ships/warship'],'home'),second.prepare(['ships/warship'],'match')]);
    expect(fetcher).toHaveBeenCalledTimes(1);expect(resources.cacheStats()).toMatchObject({requests:0,retainedBytes:0});
    expect(resources.summary('match')).toMatchObject({ready:1,loaded:bytes.byteLength,reused:bytes.byteLength});
    const source=second.portraitModel('ships/warship');first.dispose();
    await second.prepare(['ships/warship'],'home');expect(second.portraitModel('ships/warship')).toBe(source);expect(fetcher).toHaveBeenCalledTimes(1);
    second.dispose();
  });
  it('disposes shared GPU resources and decoded bitmaps exactly once across repeated teardown',async()=>{
    const model=testModel(),events={geometry:vi.spyOn(model.geometry,'dispose'),material:vi.spyOn(model.material,'dispose'),texture:vi.spyOn(model.texture,'dispose')};
    vi.spyOn(resources,'bytes').mockResolvedValue(new ArrayBuffer(0));const library=new ModelLibrary({parseAsync:vi.fn(async()=>parsed(model.scene))});
    await library.prepare(['ships/test'],'home');library.dispose();library.dispose();
    for(const dispose of Object.values(events))expect(dispose).toHaveBeenCalledTimes(1);expect(model.bitmap.close).toHaveBeenCalledTimes(1);
    expect(library.cacheStats()).toEqual({models:0,pending:0});expect(library.component('ships/test','Hull')).toBeUndefined();
  });
  it('discards a pending fetch after disposal without parsing and shares a new generation request',async()=>{
    let finish!:(buffer:ArrayBuffer)=>void;
    const first=new Promise<ArrayBuffer>(resolve=>{finish=resolve;}),request=vi.spyOn(resources,'bytes').mockReturnValue(first),model=testModel(),parse=vi.fn(async()=>parsed(model.scene)),library=new ModelLibrary({parseAsync:parse});
    const old=library.prepare(['ships/test'],'home');library.dispose();
    const fresh=library.prepare(['ships/test'],'match'),another=library.prepare(['ships/test'],'home');finish(new ArrayBuffer(0));
    await Promise.all([old,fresh,another]);expect(request).toHaveBeenCalledTimes(2);expect(parse).toHaveBeenCalledTimes(1);
    expect(library.portraitModel('ships/test')).toBe(model.scene);expect(library.cacheStats()).toEqual({models:1,pending:0});library.dispose();
  });
  it('disposes a stale parsed model without repopulating caches or removing a newer pending parse',async()=>{
    const stale=testModel(),fresh=testModel();let finishOld!:(result:GLTF)=>void,finishFresh!:(result:GLTF)=>void;
    const parse=vi.fn().mockImplementationOnce(()=>new Promise<GLTF>(resolve=>{finishOld=resolve;})).mockImplementationOnce(()=>new Promise<GLTF>(resolve=>{finishFresh=resolve;}));
    const request=vi.spyOn(resources,'bytes').mockResolvedValue(new ArrayBuffer(0)),library=new ModelLibrary({parseAsync:parse});
    const old=library.prepare(['ships/test'],'home');await vi.waitFor(()=>expect(parse).toHaveBeenCalledTimes(1));library.dispose();
    const current=library.prepare(['ships/test'],'match');await vi.waitFor(()=>expect(parse).toHaveBeenCalledTimes(2));finishOld(parsed(stale.scene));await old;
    expect(stale.bitmap.close).toHaveBeenCalledTimes(1);expect(library.portraitModel('ships/test')).toBeUndefined();expect(library.cacheStats()).toEqual({models:0,pending:1});
    const another=library.prepare(['ships/test'],'home');expect(request).toHaveBeenCalledTimes(2);expect(parse).toHaveBeenCalledTimes(2);
    finishFresh(parsed(fresh.scene));await Promise.all([current,another]);expect(library.portraitModel('ships/test')).toBe(fresh.scene);expect(fresh.bitmap.close).not.toHaveBeenCalled();library.dispose();
  });
  it('removes failed parses so retry completes instead of returning a permanently rejected promise',async()=>{
    const model=testModel(),parse=vi.fn().mockRejectedValueOnce(new Error('invalid GLB')).mockResolvedValueOnce(parsed(model.scene)),library=new ModelLibrary({parseAsync:parse});
    vi.spyOn(resources,'bytes').mockResolvedValue(new ArrayBuffer(0));await expect(library.prepare(['ships/test'],'home')).rejects.toThrow('invalid GLB');
    expect(library.cacheStats()).toEqual({models:0,pending:0});await library.prepare(['ships/test'],'match');expect(parse).toHaveBeenCalledTimes(2);expect(library.component('ships/test','Hull')).toBeTruthy();library.dispose();
  });
});
