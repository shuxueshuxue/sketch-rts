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
   expect(sourceLevel).toBe(destLevel);expect(box).toBeInstanceOf(THREE.Box3);expect((dest as THREE.Vector3).z).toBe((source as THREE.DataTexture).image.data![0]);copied.push((dest as THREE.Vector3).z);
  });
  for(const layer of [0,2])upload.uploadLayer(p,layer,pixels(16,layer),r);
  expect(r.initTexture).toHaveBeenCalledTimes(3);expect(copied).toEqual([...Array(5).fill(0),...Array(5).fill(2)]);expect(r.setRenderTarget).toHaveBeenLastCalledWith(r.getRenderTarget(),2,3);
  const version=p.texture.version;upload.uploadLayer(p,7,pixels(16,7),r);expect(r.initTexture).toHaveBeenCalledTimes(4);expect(p.texture.version).toBe(version);expect(p.texture.image.data).toBeNull();expect(upload.stats()).toMatchObject({mipInitializedPages:1,mipLayerUpdates:3,mipCopyCalls:15,scratchTextures:1,arrayBaseUploadBytes:0});upload.dispose();
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
