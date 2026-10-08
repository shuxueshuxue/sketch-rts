import {afterAll,afterEach,beforeAll,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCanvas} from '@napi-rs/canvas';
import * as THREE from 'three';
import {worldModels,matchModelKeys} from './model-library';
import {currentModelPortrait} from './model-portraits';
import * as sailRig from './sail-rig';
import {setScratchCanvasFactory} from '../art/scratch-canvas';
const fetcher=vi.fn(async(url:string)=>new Response(readFileSync(`public/art/world3d/${url.split('/art/world3d/')[1]!.split('?')[0]}`)));
beforeAll(async()=>{vi.stubGlobal('fetch',fetcher);setScratchCanvasFactory((w,h)=>createCanvas(w,h) as unknown as HTMLCanvasElement);await worldModels.prepare(matchModelKeys,'match');});
afterEach(()=>vi.restoreAllMocks());
afterAll(()=>{worldModels.dispose();setScratchCanvasFactory(undefined);vi.unstubAllGlobals();});
it('fits every current ship and building in UI without a second resource request or a stale sprite',()=>{
  expect(fetcher).toHaveBeenCalledTimes(31);
  for(const key of matchModelKeys){const image=currentModelPortrait(key,'#65908c')!;expect(image,key).toBeTruthy();const data=image.getContext('2d')!.getImageData(0,0,256,256).data;
    let left=256,top=256,right=0,bottom=0,ink=0;
    for(let y=0;y<256;y++)for(let x=0;x<256;x++)if(data[(y*256+x)*4+3]!>8){ink++;left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
    expect(ink,key).toBeGreaterThan(1500);expect(Math.max(right-left,bottom-top),key).toBeGreaterThan(232);expect(Math.min(left,top,255-right,255-bottom),key).toBeGreaterThan(3);
    expect(currentModelPortrait(key,'#65908c')).toBe(image);
  }
  expect(fetcher).toHaveBeenCalledTimes(31);
});

function pixels(image:HTMLCanvasElement){return image.getContext('2d')!.getImageData(0,0,256,256).data;}
function changedPixels(a:HTMLCanvasElement,b:HTMLCanvasElement){
  const left=pixels(a),right=pixels(b);let changed=0;
  for(let i=0;i<left.length;i+=4)if([0,1,2,3].some(channel=>Math.abs(left[i+channel]!-right[i+channel]!)>8))changed++;
  return changed;
}
function sourceState(model:THREE.Object3D){
  const state:unknown[]=[];
  model.traverse(object=>state.push({
    uuid:object.uuid,children:object.children.map(child=>child.uuid),
    matrix:[...object.matrix.elements],world:[...object.matrixWorld.elements],
    ...(object instanceof THREE.Mesh?{
      geometry:object.geometry.uuid,morphs:object.morphTargetInfluences?.slice(),
      positions:Array.from(object.geometry.getAttribute('position').array),
      targets:object.geometry.morphAttributes.position?.map((attribute:THREE.BufferAttribute|THREE.InterleavedBufferAttribute)=>Array.from(attribute.array)),
    }:{}),
  }));
  return state;
}

it('renders real GLB cloth morphs and default running ropes without changing or disposing the shared asset',()=>{
  const source=worldModels.portraitModel('ships/warship')!,before=sourceState(source),requestsBefore=fetcher.mock.calls.length;
  const sharedGeometry=new Set<THREE.BufferGeometry>(),sharedMaterials=new Set<THREE.Material>();
  source.traverse(object=>{if(object instanceof THREE.Mesh){sharedGeometry.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])sharedMaterials.add(material);}});
  const sharedDisposed=vi.fn();
  for(const resource of [...sharedGeometry,...sharedMaterials])resource.addEventListener('dispose',sharedDisposed);
  const prepare=sailRig.defaultRigPortrait;
  const temporaryGeometry=new Set<THREE.BufferGeometry>(),temporaryMaterials=new Set<THREE.Material>();
  const disposedGeometry=new Set<THREE.BufferGeometry>(),disposedMaterials=new Set<THREE.Material>();
  const dispose=vi.fn();
  const helper=vi.spyOn(sailRig,'defaultRigPortrait').mockImplementation(model=>{
    const portrait=prepare(model);
    expect(portrait.model).not.toBe(model);
    portrait.model.traverse(object=>{if(object instanceof THREE.Mesh){
      if(!sharedGeometry.has(object.geometry)){temporaryGeometry.add(object.geometry);object.geometry.addEventListener('dispose',()=>disposedGeometry.add(object.geometry));}
      for(const material of Array.isArray(object.material)?object.material:[object.material])if(!sharedMaterials.has(material)){temporaryMaterials.add(material);material.addEventListener('dispose',()=>disposedMaterials.add(material));}
    }});
    return{model:portrait.model,dispose:()=>{dispose();portrait.dispose();}};
  });
  vi.spyOn(worldModels,'portraitModel').mockReturnValue(source);
  let reference:ReturnType<typeof prepare>|undefined;
  try{
    const image=currentModelPortrait('test/default-warship','#65908c')!;
    expect(currentModelPortrait('test/default-warship','#65908c')).toBe(image);
    const otherColor=currentModelPortrait('test/default-warship','#dd4422')!;
    expect(otherColor).not.toBe(image);expect(currentModelPortrait('test/default-warship','#dd4422')).toBe(otherColor);
    expect(helper).toHaveBeenCalledTimes(1);expect(dispose).toHaveBeenCalledTimes(1);
    expect(temporaryGeometry.size).toBeGreaterThan(0);expect(temporaryMaterials.size).toBeGreaterThan(0);
    expect(disposedGeometry).toEqual(temporaryGeometry);expect(disposedMaterials).toEqual(temporaryMaterials);

    reference=prepare(source);
    const flat=reference.model.clone(true),withoutRopes=reference.model.clone(true);
    let clothMeshes=0,displacement=0;const point=new THREE.Vector3(),base=new THREE.Vector3();
    reference.model.traverse(object=>{if(object instanceof THREE.Mesh&&object.geometry.morphAttributes.position?.length){
      clothMeshes++;
      const position=object.geometry.getAttribute('position');
      for(let i=0;i<position.count;i++)displacement=Math.max(displacement,object.getVertexPosition(i,point).distanceTo(base.fromBufferAttribute(position,i)));
    }});
    expect(clothMeshes).toBeGreaterThan(0);expect(displacement).toBeGreaterThan(.5);
    flat.traverse(object=>{if(object instanceof THREE.Mesh)object.morphTargetInfluences?.fill(0);});
    const ropes:THREE.Mesh[]=[];
    withoutRopes.traverse(object=>{if(object instanceof THREE.Mesh&&!sharedGeometry.has(object.geometry))ropes.push(object);});
    expect(ropes.length).toBeGreaterThan(0);for(const rope of ropes)rope.removeFromParent();
    // Render independently modified poses through the same projection. A raw
    // position-buffer renderer makes the flat reference match the default.
    helper.mockImplementation(model=>({model,dispose:()=>{}}));
    vi.mocked(worldModels.portraitModel).mockReturnValue(flat);
    expect(changedPixels(image,currentModelPortrait('test/flat-warship','#65908c')!)).toBeGreaterThan(100);
    vi.mocked(worldModels.portraitModel).mockReturnValue(withoutRopes);
    expect(changedPixels(image,currentModelPortrait('test/ropeless-warship','#65908c')!)).toBeGreaterThan(30);
    expect(sourceState(source)).toEqual(before);expect(sharedDisposed).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(requestsBefore);
  }finally{
    reference?.dispose();
    for(const resource of [...sharedGeometry,...sharedMaterials])resource.removeEventListener('dispose',sharedDisposed);
  }
});
