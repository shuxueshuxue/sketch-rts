import * as THREE from 'three';

/** Scene tests explicitly provide this public transfer contract. */
export type CardTextureRenderer=Pick<THREE.WebGLRenderer,'initTexture'|'copyTextureToTexture'|'getRenderTarget'|'getActiveCubeFace'|'getActiveMipmapLevel'|'setRenderTarget'>;
export type CardMipPage={texture:THREE.DataArrayTexture;uploaded:boolean};
export type CardMipMove={source:CardMipPage;sourceLayer:number;destination:CardMipPage;destinationLayer:number};
type Scratch={texture:THREE.DataTexture;data:Uint8Array;regions:THREE.Box3[];gpuBytes:number};
const MAX_SCRATCH_SIZES=5,EMPTY_MIP_DATA=new Uint8Array(0);
function levels(width:number,height:number){return Array.from({length:Math.floor(Math.log2(Math.max(width,height)))+1},(_,level)=>({width:Math.max(1,Math.floor(width/2**level)),height:Math.max(1,Math.floor(height/2**level))}));}
export function cardTextureBytes(width:number,height:number,depth=1){return levels(width,height).reduce((sum,size)=>sum+size.width*size.height*4*depth,0);}
function configure(texture:THREE.Texture,anisotropy:number){
 texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.anisotropy=anisotropy;
 texture.flipY=false;texture.premultiplyAlpha=false;texture.unpackAlignment=1;
}
export function createCardArray(width:number,height:number,depth:number,anisotropy:number){
 const texture=new THREE.DataArrayTexture(null,width,height,depth);configure(texture,anisotropy);
 texture.generateMipmaps=false;texture.source.dataReady=false;
 // Allocate every mip without retaining or uploading an entire CPU base page.
 texture.mipmaps=levels(width,height).map(size=>({...size,data:EMPTY_MIP_DATA}));return texture;
}

/** One temporary raster layer feeds the normal GPU-generated sRGB mip chain.
 * Warm compaction transfers completed GPU layers without CPU readback. */
export class CardMipUploader {
 private scratches=new Map<string,Scratch>();
 private destination=new THREE.Vector3();
 private sourceRegion=new THREE.Box3();
 private renderer:CardTextureRenderer|undefined;
 private initializedPages=0;
 private layerUpdates=0;
 private copyCalls=0;
 private compactionLayers=0;
 private compactionCopyCalls=0;
 private scratchUploadBytes=0;
 private transferWallMs=0;
 constructor(private anisotropy:number){}
 private scratch(width:number,height:number){
  const key=`${width}:${height}`,existing=this.scratches.get(key);
  if(existing){this.scratches.delete(key);this.scratches.set(key,existing);return existing;}
  if(this.scratches.size>=MAX_SCRATCH_SIZES){const oldest=this.scratches.keys().next().value!;this.scratches.get(oldest)!.texture.dispose();this.scratches.delete(oldest);}
  const data=new Uint8Array(width*height*4),texture=new THREE.DataTexture(data,width,height);configure(texture,this.anisotropy);texture.generateMipmaps=true;
  const scratch={texture,data,regions:levels(width,height).map(size=>new THREE.Box3(new THREE.Vector3(),new THREE.Vector3(size.width,size.height,1))),gpuBytes:cardTextureBytes(width,height)};
  this.scratches.set(key,scratch);return scratch;
 }
 private transfer(renderer:CardTextureRenderer,work:()=>void){
  if(this.renderer&&this.renderer!==renderer)throw new Error('Card textures belong to one renderer; invalidate GPU resources before changing renderer.');
  this.renderer=renderer;const target=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel();
  const start=performance.now();try{work();}finally{renderer.setRenderTarget(target,face,mip);this.transferWallMs+=performance.now()-start;}
 }
 private initialize(page:CardMipPage,renderer:CardTextureRenderer){
  if(page.uploaded)return;
  page.texture.needsUpdate=true;renderer.initTexture(page.texture);page.uploaded=true;this.initializedPages++;
 }
 uploadLayer(page:CardMipPage,layer:number,rgba:Uint8Array|Uint8ClampedArray,renderer:CardTextureRenderer){
  const {width,height,depth}=page.texture.image;
  if(rgba.byteLength!==width*height*4||layer<0||layer>=depth)throw new Error('Invalid card layer transfer dimensions.');
  this.transfer(renderer,()=>{
   this.initialize(page,renderer);const scratch=this.scratch(width,height);scratch.data.set(rgba);
   scratch.texture.needsUpdate=true;renderer.initTexture(scratch.texture);this.scratchUploadBytes+=rgba.byteLength;
   this.destination.set(0,0,layer);
   for(let level=0;level<scratch.regions.length;level++){renderer.copyTextureToTexture(scratch.texture,page.texture,scratch.regions[level]!,this.destination,level,level);this.copyCalls++;}
   this.layerUpdates++;
  });
 }
 copyLayers(moves:readonly CardMipMove[],renderer:CardTextureRenderer){
  if(!moves.length)return;
  // Validate the complete plan before allocating destinations or publishing any
  // copy. Sources must already have completed their upload submissions.
  for(const move of moves){
   const a=move.source.texture.image,b=move.destination.texture.image;
   if(!move.source.uploaded||a.width!==b.width||a.height!==b.height||move.sourceLayer<0||move.sourceLayer>=a.depth||move.destinationLayer<0||move.destinationLayer>=b.depth)throw new Error('Invalid or uninitialized card compaction source.');
  }
  this.transfer(renderer,()=>{
   for(const move of moves){
    this.initialize(move.destination,renderer);const {width,height}=move.source.texture.image;
    this.destination.set(0,0,move.destinationLayer);
    for(const [level,size] of levels(width,height).entries()){
     this.sourceRegion.min.set(0,0,move.sourceLayer);this.sourceRegion.max.set(size.width,size.height,move.sourceLayer+1);
     renderer.copyTextureToTexture(move.source.texture,move.destination.texture,this.sourceRegion,this.destination,level,level);this.compactionCopyCalls++;
    }
    this.compactionLayers++;
   }
  });
 }
 releaseSize(width:number,height:number){const key=`${width}:${height}`;this.scratches.get(key)?.texture.dispose();this.scratches.delete(key);}
 stats(){return{scratchTextures:this.scratches.size,scratchCpuBytes:[...this.scratches.values()].reduce((sum,s)=>sum+s.data.byteLength,0),scratchGpuBytes:[...this.scratches.values()].reduce((sum,s)=>sum+s.gpuBytes,0),mipInitializedPages:this.initializedPages,mipLayerUpdates:this.layerUpdates,mipCopyCalls:this.copyCalls,gpuCompactionLayers:this.compactionLayers,gpuCompactionCopyCalls:this.compactionCopyCalls,arrayBaseUploadBytes:0,scratchUploadBytes:this.scratchUploadBytes,gpuTransferSubmissionWallMs:this.transferWallMs};}
 dispose(){for(const scratch of this.scratches.values())scratch.texture.dispose();this.scratches.clear();this.renderer=undefined;}
}
