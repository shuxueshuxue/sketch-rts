import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {CardMipUploader,createCardArray,type CardMipPage,type CardTextureRenderer} from './card-mip-uploader';
function renderer(){
 const target=new THREE.WebGLRenderTarget(2,2);
 return {initTexture:vi.fn<CardTextureRenderer['initTexture']>(),copyTextureToTexture:vi.fn<CardTextureRenderer['copyTextureToTexture']>(),getRenderTarget:()=>target,getActiveCubeFace:()=>2,getActiveMipmapLevel:()=>3,setRenderTarget:vi.fn()} satisfies CardTextureRenderer;
}
function page(size=16,layers=[0,2]):CardMipPage{
 const data=new Uint8Array(size*size*4*16);for(let layer=0;layer<16;layer++)data.fill(layer,layer*size*size*4,(layer+1)*size*size*4);
 return{texture:createCardArray(data,size,size,16,8),dirty:new Set(layers),uploaded:false};
}
describe('dirty card mip transfer protocol',()=>{
 it('allocates the complete NPOT chain without generating whole-array mips',()=>{
  const p=page(640);expect(p.texture.generateMipmaps).toBe(false);expect(p.texture.mipmaps.map(m=>[m.width,m.height])).toEqual([640,320,160,80,40,20,10,5,2,1].map(x=>[x,x]));
  expect(p.texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);expect(p.texture.colorSpace).toBe(THREE.SRGBColorSpace);expect(p.texture.anisotropy).toBe(8);
 });
 it('initializes once, copies all mips only for dirty layers, and restores the framebuffer',()=>{
  const upload=new CardMipUploader(8),p=page(),r=renderer(),copied:number[]=[];
  r.copyTextureToTexture.mockImplementation((source,_dest,box,dest,sourceLevel,destLevel)=>{
   expect(sourceLevel).toBe(destLevel);expect(box).toBeInstanceOf(THREE.Box3);expect((dest as THREE.Vector3).z).toBe((source as THREE.DataTexture).image.data![0]);copied.push((dest as THREE.Vector3).z);
  });
  upload.upload([p],r);expect(r.initTexture).toHaveBeenCalledTimes(3);expect(copied).toEqual([...Array(5).fill(0),...Array(5).fill(2)]);expect(p.dirty.size).toBe(0);
  expect(r.setRenderTarget).toHaveBeenLastCalledWith(r.getRenderTarget(),2,3);
  const version=p.texture.version;upload.upload([p],r);expect(r.initTexture).toHaveBeenCalledTimes(3);
  p.dirty.add(7);upload.upload([p],r);expect(r.initTexture).toHaveBeenCalledTimes(4);expect(p.texture.version).toBe(version);expect(upload.stats()).toMatchObject({mipInitializedPages:1,mipLayerUpdates:3,mipCopyCalls:15,scratchTextures:1});upload.dispose();
 });
 it('preserves dirty work for retry and framebuffer state when a copy fails',()=>{
  const upload=new CardMipUploader(1),p=page(),r=renderer();r.copyTextureToTexture.mockImplementation(()=>{throw new Error('copy failed');});
  expect(()=>upload.upload([p],r)).toThrow('copy failed');expect([...p.dirty]).toEqual([0,2]);expect(r.setRenderTarget).toHaveBeenLastCalledWith(r.getRenderTarget(),2,3);
  r.copyTextureToTexture.mockReset();upload.upload([p],r);expect(p.dirty.size).toBe(0);upload.dispose();
 });
 it('bounds scratch resources and disposes them before renderer ownership changes',()=>{
  const upload=new CardMipUploader(1),r=renderer(),disposed=vi.fn();r.initTexture.mockImplementation(texture=>{if(texture instanceof THREE.DataTexture)texture.addEventListener('dispose',disposed);});
  for(const size of [2,4,8,16,32,64])upload.upload([page(size,[0])],r);
  expect(upload.stats().scratchTextures).toBe(5);expect(disposed).toHaveBeenCalledTimes(1);
  expect(()=>upload.upload([],renderer())).toThrow('one renderer');upload.releaseSize(4,4);expect(upload.stats().scratchTextures).toBe(4);
  upload.dispose();expect(disposed).toHaveBeenCalledTimes(6);expect(upload.stats().scratchCpuBytes).toBe(0);upload.upload([],renderer());
 });
});
