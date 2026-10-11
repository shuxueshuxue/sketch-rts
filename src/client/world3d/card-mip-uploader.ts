import * as THREE from 'three';

/** Public renderer operations only. CPU-only scene tests do not call upload;
 * renderer integration mocks must explicitly implement this transfer contract. */
export type CardTextureRenderer=Pick<THREE.WebGLRenderer,'initTexture'|'copyTextureToTexture'|'getRenderTarget'|'getActiveCubeFace'|'getActiveMipmapLevel'|'setRenderTarget'>;
export type CardMipPage={texture:THREE.DataArrayTexture;dirty:Set<number>;uploaded:boolean};
type Scratch={texture:THREE.DataTexture;data:Uint8Array;regions:THREE.Box3[];gpuBytes:number};
const MAX_SCRATCH_SIZES=5,EMPTY_MIP_DATA=new Uint8Array(0);
function levels(width:number,height:number){
 return Array.from({length:Math.floor(Math.log2(Math.max(width,height)))+1},(_,level)=>({width:Math.max(1,Math.floor(width/2**level)),height:Math.max(1,Math.floor(height/2**level))}));
}
function configure(texture:THREE.Texture,anisotropy:number){
 texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.anisotropy=anisotropy;
 texture.flipY=false;texture.premultiplyAlpha=false;texture.unpackAlignment=1;
}
export function createCardArray(data:Uint8Array,width:number,height:number,depth:number,anisotropy:number){
 const texture=new THREE.DataArrayTexture(data,width,height,depth);configure(texture,anisotropy);
 texture.generateMipmaps=false;
 // DataArrayTexture uses the public mip count to allocate complete storage;
 // base pixels remain in image.data. Every occupied layer is filled below.
 texture.mipmaps=levels(width,height).map(size=>({...size,data:EMPTY_MIP_DATA}));
 return texture;
}

/** Generate exactly the GPU's normal sRGB/alpha mip chain for each changed
 * layer, without regenerating fifteen unrelated poses in the same array. */
export class CardMipUploader {
 private scratches=new Map<string,Scratch>();
 private destination=new THREE.Vector3();
 private renderer:CardTextureRenderer|undefined;
 private initializedPages=0;
 private layerUpdates=0;
 private copyCalls=0;
 private arrayBaseBytes=0;
 private scratchUploadBytes=0;
 constructor(private anisotropy:number){}
 private scratch(width:number,height:number){
  const key=`${width}:${height}`,existing=this.scratches.get(key);
  if(existing){this.scratches.delete(key);this.scratches.set(key,existing);return existing;}
  if(this.scratches.size>=MAX_SCRATCH_SIZES){const oldest=this.scratches.keys().next().value!;this.scratches.get(oldest)!.texture.dispose();this.scratches.delete(oldest);}
  const data=new Uint8Array(width*height*4),texture=new THREE.DataTexture(data,width,height);configure(texture,this.anisotropy);texture.generateMipmaps=true;
  const sizes=levels(width,height),scratch={texture,data,regions:sizes.map(size=>new THREE.Box3(new THREE.Vector3(),new THREE.Vector3(size.width,size.height,1))),gpuBytes:sizes.reduce((sum,size)=>sum+size.width*size.height*4,0)};
  this.scratches.set(key,scratch);return scratch;
 }
 upload(pages:readonly CardMipPage[],renderer:CardTextureRenderer){
  if(this.renderer&&this.renderer!==renderer)throw new Error('Card textures belong to one renderer; invalidate GPU resources before changing renderer.');
  this.renderer=renderer;
  if(!pages.some(page=>page.dirty.size))return;
  const target=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel();
  try{
   for(const page of pages){
    if(!page.dirty.size)continue;
    const {width,height,data}=page.texture.image,bytes=width*height*4;
    if(!page.uploaded){
     // Keep the ordinary public base upload on first allocation. Its duplicate
     // base copy is measured, not replaced by an unverified allocation trick.
     page.texture.needsUpdate=true;renderer.initTexture(page.texture);page.uploaded=true;
     this.initializedPages++;this.arrayBaseBytes+=data!.byteLength;
    }
    const scratch=this.scratch(width,height);
    for(const layer of page.dirty){
     scratch.data.set((data as Uint8Array).subarray(layer*bytes,(layer+1)*bytes));
     scratch.texture.needsUpdate=true;renderer.initTexture(scratch.texture);this.scratchUploadBytes+=bytes;
     this.destination.set(0,0,layer);
     for(let level=0;level<scratch.regions.length;level++){
      renderer.copyTextureToTexture(scratch.texture,page.texture,scratch.regions[level]!,this.destination,level,level);this.copyCalls++;
     }
     this.layerUpdates++;
    }
    page.dirty.clear();
   }
  }finally{
   // copyTextureToTexture unbinds framebuffers. Restore through public API,
   // including multisampled render targets and nonzero cube/mip selections.
   renderer.setRenderTarget(target,face,mip);
  }
 }
 releaseSize(width:number,height:number){const key=`${width}:${height}`;this.scratches.get(key)?.texture.dispose();this.scratches.delete(key);}
 stats(){return{scratchTextures:this.scratches.size,scratchCpuBytes:[...this.scratches.values()].reduce((sum,s)=>sum+s.data.byteLength,0),scratchGpuBytes:[...this.scratches.values()].reduce((sum,s)=>sum+s.gpuBytes,0),mipInitializedPages:this.initializedPages,mipLayerUpdates:this.layerUpdates,mipCopyCalls:this.copyCalls,arrayBaseUploadBytes:this.arrayBaseBytes,scratchUploadBytes:this.scratchUploadBytes};}
 dispose(){for(const scratch of this.scratches.values())scratch.texture.dispose();this.scratches.clear();this.renderer=undefined;}
}
