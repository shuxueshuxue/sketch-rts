import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {CardMipUploader,createCardArray,type CardMipPage,type CardTextureRenderer} from './card-mip-uploader';
function renderer(){const target=new THREE.WebGLRenderTarget(2,2);return{initTexture:vi.fn<CardTextureRenderer['initTexture']>(),copyTextureToTexture:vi.fn<CardTextureRenderer['copyTextureToTexture']>(),getRenderTarget:()=>target,getActiveCubeFace:()=>2,getActiveMipmapLevel:()=>3,setRenderTarget:vi.fn()} satisfies CardTextureRenderer;}
function page(size=16):CardMipPage{return{texture:createCardArray(size,size,16,8),uploaded:false};}
function pixels(size=16,layer=0){return new Uint8Array(size*size*4).fill(layer);}
describe('streamed card mip transfers',()=>{
 it('allocates complete NPOT storage without CPU base pixels or whole-array mip generation',()=>{
  const p=page(640);expect(p.texture.image.data).toBeNull();expect(p.texture.source.dataReady).toBe(false);expect(p.texture.generateMipmaps).toBe(false);expect(p.texture.mipmaps.map(m=>[m.width,m.height])).toEqual([640,320,160,80,40,20,10,5,2,1].map(x=>[x,x]));
  expect(p.texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);expect(p.texture.colorSpace).toBe(THREE.SRGBColorSpace);expect(p.texture.anisotropy).toBe(8);
 });
 it('initializes once, uploads only supplied layers, and restores the framebuffer',()=>{
  const upload=new CardMipUploader(8),p=page(),r=renderer(),copied:number[]=[];
  r.copyTextureToTexture.mockImplementation((source,_dest,box,dest,sourceLevel,destLevel)=>{
   if(box instanceof THREE.Box2)return;
   expect(sourceLevel).toBe(destLevel);expect(box).toBeInstanceOf(THREE.Box3);expect((dest as THREE.Vector3).z).toBe((source as THREE.DataTexture).image.data![0]);copied.push((dest as THREE.Vector3).z);
  });
  for(const layer of [0,2])upload.uploadLayer(p,layer,pixels(16,layer),r);
  expect(r.initTexture).toHaveBeenCalledTimes(2);expect(copied).toEqual([...Array(5).fill(0),...Array(5).fill(2)]);expect(r.setRenderTarget).toHaveBeenLastCalledWith(r.getRenderTarget(),2,3);
  const version=p.texture.version;upload.uploadLayer(p,7,pixels(16,7),r);expect(r.initTexture).toHaveBeenCalledTimes(2);expect(p.texture.version).toBe(version);expect(p.texture.image.data).toBeNull();expect(upload.stats()).toMatchObject({mipInitializedPages:1,mipLayerUpdates:3,mipCopyCalls:15,scratchTextures:1,arrayBaseUploadBytes:0});upload.dispose();
 });
 it('uploads a single dirty rectangle from an uninitialized CPU source and clears old paint',()=>{
  const upload=new CardMipUploader(8),p=page(),r=renderer(),initialized=new Set<THREE.Texture>(),gpu=new Map<THREE.Texture,Uint8Array>(),rectangles:THREE.Box2[]=[],layers:Uint8Array[]=[];
  r.initTexture.mockImplementation(texture=>{initialized.add(texture);if(texture instanceof THREE.DataTexture)gpu.set(texture,new Uint8Array(texture.image.data as Uint8Array));});
  r.copyTextureToTexture.mockImplementation((source,destination,region,position,srcLevel,dstLevel)=>{
   if(region instanceof THREE.Box2){
    expect(source).toBeInstanceOf(THREE.DataTexture);expect(initialized.has(source)).toBe(false);expect(source).not.toBe(destination);expect((source as THREE.DataTexture).image.data).toBe((destination as THREE.DataTexture).image.data);
    expect(destination.generateMipmaps).toBe(true);expect(destination.colorSpace).toBe(THREE.SRGBColorSpace);expect(destination.flipY).toBe(false);expect(destination.premultiplyAlpha).toBe(false);
    expect(position).toEqual(region.min);rectangles.push(region.clone());
    const cpu=(source as THREE.DataTexture).image.data as Uint8Array,stored=gpu.get(destination)!;
    for(let y=region.min.y;y<region.max.y;y++){const start=(y*16+region.min.x)*4,end=(y*16+region.max.x)*4;stored.set(cpu.subarray(start,end),start);}
   }else{
    expect(initialized.has(source)).toBe(true);expect(region).toBeInstanceOf(THREE.Box3);expect(srcLevel).toBe(dstLevel);
    if(srcLevel===0)layers.push(gpu.get(source)!.slice());
   }
  });
  const before=pixels(),after=pixels();before.set([20,30,40,255],(3*16+2)*4);after.set([90,70,50,0],(6*16+8)*4);
  upload.uploadLayer(p,0,before,r);upload.uploadLayer(p,1,after,r);upload.uploadLayer(p,2,after.slice(),r);
  expect(rectangles).toEqual([new THREE.Box2(new THREE.Vector2(2,3),new THREE.Vector2(9,7))]);expect(layers).toEqual([before,after,after]);expect(r.initTexture).toHaveBeenCalledTimes(2);
  expect(upload.stats()).toMatchObject({scratchUploadBytes:1024+112,scratchInitialUploadBytes:1024,scratchFullUploadBytes:1024,scratchPartialUploadBytes:112,scratchPartialUploadPixels:28,scratchPartialUploads:1,scratchUnchangedUploads:1,scratchFullUploadFallbacks:0,mipCopyCalls:15});
  expect(r.setRenderTarget).toHaveBeenLastCalledWith(r.getRenderTarget(),2,3);upload.dispose();
 });
 it('keeps full NPOT mip copies after a partial base upload',()=>{
  const upload=new CardMipUploader(8),p=page(640),r=renderer();upload.uploadLayer(p,0,pixels(640),r);r.copyTextureToTexture.mockClear();
  const changed=pixels(640);changed.set([1,2,3,0],(639*640+639)*4);upload.uploadLayer(p,1,changed,r);
  expect(r.copyTextureToTexture.mock.calls[0]![2]).toEqual(new THREE.Box2(new THREE.Vector2(639,639),new THREE.Vector2(640,640)));
  expect(r.copyTextureToTexture.mock.calls.slice(1).map(call=>(call[2] as THREE.Box3).max.x)).toEqual([640,320,160,80,40,20,10,5,2,1]);
  expect(upload.stats()).toMatchObject({scratchInitialUploadBytes:1638400,scratchPartialUploadBytes:4,mipCopyCalls:20});upload.dispose();
 });
 it('replaces the entire base after a failed partial upload rather than trusting changed CPU pixels',()=>{
  const upload=new CardMipUploader(1),p=page(),r=renderer();upload.uploadLayer(p,0,pixels(),r);const changed=pixels();changed.set([1,2,3,0],4);
  r.copyTextureToTexture.mockImplementation((_a,_b,region)=>{if(region instanceof THREE.Box2)throw new Error('partial upload failed');});
  expect(()=>upload.uploadLayer(p,1,changed,r)).toThrow('partial upload failed');expect(r.setRenderTarget).toHaveBeenLastCalledWith(r.getRenderTarget(),2,3);
  r.copyTextureToTexture.mockReset();upload.uploadLayer(p,1,changed,r);
  expect(r.initTexture).toHaveBeenCalledTimes(3);expect(r.copyTextureToTexture).toHaveBeenCalledTimes(5);expect(r.copyTextureToTexture.mock.calls.every(call=>call[2] instanceof THREE.Box3)).toBe(true);
  expect(upload.stats()).toMatchObject({scratchFullUploadBytes:2048,scratchInitialUploadBytes:1024,scratchPartialUploadBytes:0,scratchFullUploadFallbacks:1,mipLayerUpdates:2});upload.dispose();
 });
 it('allows an explicit failed-layer retry and restores the framebuffer on failure',()=>{
  const upload=new CardMipUploader(1),p=page(),r=renderer();r.copyTextureToTexture.mockImplementation(()=>{throw new Error('copy failed');});
  expect(()=>upload.uploadLayer(p,2,pixels(),r)).toThrow('copy failed');expect(r.setRenderTarget).toHaveBeenLastCalledWith(r.getRenderTarget(),2,3);
  r.copyTextureToTexture.mockReset();upload.uploadLayer(p,2,pixels(),r);expect(r.copyTextureToTexture).toHaveBeenCalledTimes(5);upload.dispose();
 });
 it('copies every mip from a nonzero source layer without reuploading pixels',()=>{
  const upload=new CardMipUploader(1),source=page(320),destination=page(320),r=renderer();upload.uploadLayer(source,7,pixels(320),r);r.initTexture.mockClear();r.copyTextureToTexture.mockClear();
  const calls:{source:number;destination:number;level:number;size:number}[]=[];
  r.copyTextureToTexture.mockImplementation((texture,_dst,box,pos,level,dstLevel)=>{expect(texture).toBe(source.texture);expect(level).toBe(dstLevel);calls.push({source:(box as THREE.Box3).min.z,destination:(pos as THREE.Vector3).z,level:level!,size:box!.max.x});});
  upload.copyLayers([{source,sourceLayer:7,destination,destinationLayer:3}],r);
  expect(r.initTexture).toHaveBeenCalledTimes(1);expect(calls.map(c=>c.size)).toEqual([320,160,80,40,20,10,5,2,1]);expect(calls.every(c=>c.source===7&&c.destination===3)).toBe(true);expect(upload.stats()).toMatchObject({gpuCompactionLayers:1,gpuCompactionCopyCalls:9});upload.dispose();
 });
 it('rejects uninitialized or mismatched sources before any transfer',()=>{
  const upload=new CardMipUploader(1),r=renderer();expect(()=>upload.copyLayers([{source:page(),sourceLayer:0,destination:page(),destinationLayer:0}],r)).toThrow('uninitialized');expect(r.initTexture).not.toHaveBeenCalled();expect(r.copyTextureToTexture).not.toHaveBeenCalled();
 });
 it('bounds scratches and releases renderer ownership only on invalidation',()=>{
  const upload=new CardMipUploader(1),r=renderer(),disposed=vi.fn();r.initTexture.mockImplementation(texture=>{if(texture instanceof THREE.DataTexture)texture.addEventListener('dispose',disposed);});
  for(const size of [2,4,8,16,32,64])upload.uploadLayer(page(size),0,pixels(size),r);
  expect(upload.stats().scratchTextures).toBe(5);expect(disposed).toHaveBeenCalledTimes(1);expect(()=>upload.uploadLayer(page(),0,pixels(),renderer())).toThrow('one renderer');upload.releaseSize(4,4);expect(upload.stats().scratchTextures).toBe(4);
  upload.dispose();expect(disposed).toHaveBeenCalledTimes(6);expect(upload.stats().scratchCpuBytes).toBe(0);upload.uploadLayer(page(),0,pixels(),renderer());upload.dispose();
 });
});
