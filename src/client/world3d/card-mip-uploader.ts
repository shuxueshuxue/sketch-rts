import * as THREE from 'three';
import {updateCardPixels} from './card-upload-region';

/** Scene tests explicitly provide this public transfer contract. */
export type CardTextureRenderer=Pick<THREE.WebGLRenderer,'initTexture'|'copyTextureToTexture'|'getRenderTarget'|'getActiveCubeFace'|'getActiveMipmapLevel'|'setRenderTarget'>;
export type CardMipPage={texture:THREE.DataArrayTexture;uploaded:boolean};
export type CardMipMove={source:CardMipPage;sourceLayer:number;destination:CardMipPage;destinationLayer:number};
/** The raster always retains its authored domain. A page may retain a complete
 * native mip tail beginning at an already generated source mip. */
export type CardMipUploadOptions={sourceWidth:number;sourceHeight:number;baseMip:number};
type Scratch={texture:THREE.DataTexture;cpuSource:THREE.DataTexture;data:Uint8Array;uploaded:boolean;retryFull:boolean;regions:THREE.Box3[];gpuBytes:number};
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
 private canvasScratches=new Map<HTMLCanvasElement|OffscreenCanvas,{texture:THREE.CanvasTexture;regions:THREE.Box3[];gpuBytes:number}>();
 private canvasUploads=0;
 private destination=new THREE.Vector3();
 private sourceRegion=new THREE.Box3();
 private uploadRegion=new THREE.Box2();
 private uploadDestination=new THREE.Vector2();
 private renderer:CardTextureRenderer|undefined;
 private initializedPages=0;
 private layerUpdates=0;
 private copyCalls=0;
 private mipCopyBytes=0;
 private compactionLayers=0;
 private compactionCopyCalls=0;
 private scratchUploadBytes=0;
 private scratchFullUploadBytes=0;
 private scratchInitialUploadBytes=0;
 private scratchPartialUploadBytes=0;
 private scratchPartialUploads=0;
 private scratchUnchangedUploads=0;
 private scratchFullUploadFallbacks=0;
 private transferWallMs=0;
 constructor(private anisotropy:number){}
 private scratch(width:number,height:number){
  const key=`${width}:${height}`,existing=this.scratches.get(key);
  if(existing){this.scratches.delete(key);this.scratches.set(key,existing);return existing;}
  if(this.scratches.size>=MAX_SCRATCH_SIZES){const oldest=this.scratches.keys().next().value!;this.releaseScratch(this.scratches.get(oldest)!);this.scratches.delete(oldest);}
  const data=new Uint8Array(width*height*4),texture=new THREE.DataTexture(data,width,height);configure(texture,this.anisotropy);texture.generateMipmaps=true;
  // This source is a CPU view only, sharing the existing raster. It must never
  // be initialized: copyTextureToTexture then uploads the requested rectangle
  // through its public DataTexture path instead of copying an old GPU image.
  const cpuSource=new THREE.DataTexture(data,width,height);configure(cpuSource,this.anisotropy);
  const scratch={texture,cpuSource,data,uploaded:false,retryFull:false,regions:levels(width,height).map(size=>new THREE.Box3(new THREE.Vector3(),new THREE.Vector3(size.width,size.height,1))),gpuBytes:cardTextureBytes(width,height)};
  this.scratches.set(key,scratch);return scratch;
 }
 private releaseScratch(scratch:Scratch){scratch.texture.dispose();scratch.cpuSource.dispose();}
 private transfer(renderer:CardTextureRenderer,work:()=>void){
  if(this.renderer&&this.renderer!==renderer)throw new Error('Card textures belong to one renderer; invalidate GPU resources before changing renderer.');
  this.renderer=renderer;const target=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel();
  const start=performance.now();try{work();}finally{renderer.setRenderTarget(target,face,mip);this.transferWallMs+=performance.now()-start;}
 }
 private initialize(page:CardMipPage,renderer:CardTextureRenderer){
  if(page.uploaded)return;
  page.texture.needsUpdate=true;renderer.initTexture(page.texture);page.uploaded=true;this.initializedPages++;
 }
 private plan(page:CardMipPage,layer:number,bytes:number|undefined,options?:CardMipUploadOptions){
  const {width,height,depth}=page.texture.image;
  const sourceWidth=options===undefined?width:options.sourceWidth,sourceHeight=options===undefined?height:options.sourceHeight,baseMip=options===undefined?0:options.baseMip;
  const sourceLevels=Math.floor(Math.log2(Math.max(sourceWidth,sourceHeight)))+1,nativeLevels=Math.floor(Math.log2(Math.max(width,height)))+1;
  if(!Number.isInteger(sourceWidth)||sourceWidth<1||!Number.isInteger(sourceHeight)||sourceHeight<1||!Number.isInteger(width)||width<1||!Number.isInteger(height)||height<1||!Number.isInteger(depth)||depth<1||!Number.isInteger(layer)||layer<0||layer>=depth||!Number.isInteger(baseMip)||baseMip<0||baseMip>=sourceLevels||(bytes!==undefined&&bytes!==sourceWidth*sourceHeight*4))throw new Error('Invalid card layer transfer dimensions.');
  const divisor=2**baseMip;
  if(sourceWidth%divisor||sourceHeight%divisor||width!==sourceWidth/divisor||height!==sourceHeight/divisor||nativeLevels!==sourceLevels-baseMip||page.texture.mipmaps.length!==nativeLevels)throw new Error('Invalid card mip tail dimensions.');
  for(let level=0;level<nativeLevels;level++){
   const mip=page.texture.mipmaps[level]!;
   if(mip.width!==Math.max(1,Math.floor(sourceWidth/2**(baseMip+level)))||mip.height!==Math.max(1,Math.floor(sourceHeight/2**(baseMip+level))))throw new Error('Invalid card mip tail storage.');
  }
  return{sourceWidth,sourceHeight,baseMip,nativeLevels};
 }
 private copyMips(source:THREE.Texture,regions:THREE.Box3[],page:CardMipPage,layer:number,baseMip:number,nativeLevels:number,renderer:CardTextureRenderer){
  this.destination.set(0,0,layer);
  for(let level=0;level<nativeLevels;level++){
   const sourceLevel=baseMip+level,region=regions[sourceLevel]!;
   renderer.copyTextureToTexture(source,page.texture,region,this.destination,sourceLevel,level);this.copyCalls++;this.mipCopyBytes+=region.max.x*region.max.y*4;
  }
  this.layerUpdates++;
 }
 // @@@canvas-upload - A freshly painted card goes from its canvas to the GPU without a CPU readback: the browser
 // uploads the (GPU-backed) canvas into a scratch texture, which generates its mips there, then each retained mip is
 // copied into the page layer as for an RGBA raster. The canvas's top row is the picture's top; flipY puts it last,
 // the same row order a flipped RGBA raster has. A software canvas still reads back inside the browser's upload.
 uploadCanvasLayer(page:CardMipPage,layer:number,canvas:HTMLCanvasElement|OffscreenCanvas,renderer:CardTextureRenderer,options:CardMipUploadOptions){
  if(canvas.width!==options.sourceWidth||canvas.height!==options.sourceHeight)throw new Error('Invalid card canvas dimensions.');
  const {baseMip,nativeLevels}=this.plan(page,layer,undefined,options);
  this.transfer(renderer,()=>{
   this.initialize(page,renderer);
   let scratch=this.canvasScratches.get(canvas);
   if(!scratch){
    const texture=new THREE.CanvasTexture(canvas as HTMLCanvasElement);configure(texture,this.anisotropy);texture.flipY=true;texture.generateMipmaps=true;
    scratch={texture,regions:levels(canvas.width,canvas.height).map(size=>new THREE.Box3(new THREE.Vector3(),new THREE.Vector3(size.width,size.height,1))),gpuBytes:cardTextureBytes(canvas.width,canvas.height)};
    this.canvasScratches.set(canvas,scratch);
   }
   scratch.texture.needsUpdate=true;renderer.initTexture(scratch.texture);this.canvasUploads++;
   this.copyMips(scratch.texture,scratch.regions,page,layer,baseMip,nativeLevels,renderer);
  });
 }
 uploadLayer(page:CardMipPage,layer:number,rgba:Uint8Array|Uint8ClampedArray,renderer:CardTextureRenderer,options?:CardMipUploadOptions){
  const {sourceWidth,sourceHeight,baseMip,nativeLevels}=this.plan(page,layer,rgba.byteLength,options);
  this.transfer(renderer,()=>{
   this.initialize(page,renderer);const scratch=this.scratch(sourceWidth,sourceHeight);
   try{
    if(!scratch.uploaded){
     // First use and recovery after a failed transfer initialize every RGBA
     // component, including zero padding, before generating the original mips.
     scratch.data.set(rgba);scratch.texture.needsUpdate=true;renderer.initTexture(scratch.texture);
     if(scratch.retryFull)this.scratchFullUploadFallbacks++;else this.scratchInitialUploadBytes+=rgba.byteLength;
     this.scratchFullUploadBytes+=rgba.byteLength;this.scratchUploadBytes+=rgba.byteLength;scratch.uploaded=true;scratch.retryFull=false;
    }else{
     const region=updateCardPixels(scratch.data,rgba,sourceWidth,sourceHeight);
     if(region){
      this.uploadRegion.min.set(region.left,region.top);this.uploadRegion.max.set(region.right,region.bottom);this.uploadDestination.set(region.left,region.top);
      // The destination keeps its full domain and generateMipmaps=true. Three
      // generates the same complete GPU chain after this level-zero upload and
      // manages all unpack state; no renderer internals or raw GL are involved.
      renderer.copyTextureToTexture(scratch.cpuSource,scratch.texture,this.uploadRegion,this.uploadDestination);
      const bytes=(region.right-region.left)*(region.bottom-region.top)*4;
      this.scratchPartialUploadBytes+=bytes;this.scratchUploadBytes+=bytes;this.scratchPartialUploads++;
     }else this.scratchUnchangedUploads++;
    }
    this.copyMips(scratch.texture,scratch.regions,page,layer,baseMip,nativeLevels,renderer);
   }catch(error){
    // The CPU raster may already have changed while the GPU copy only partly
    // completed. A retry must replace the entire base rather than compare with
    // this potentially uncommitted CPU image and skip necessary clearing.
    scratch.uploaded=false;scratch.retryFull=true;throw error;
   }
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
 releaseSize(width:number,height:number){const key=`${width}:${height}`,scratch=this.scratches.get(key);if(scratch)this.releaseScratch(scratch);this.scratches.delete(key);}
 stats(){return{scratchTextures:this.scratches.size+this.canvasScratches.size,canvasUploads:this.canvasUploads,scratchCpuBytes:[...this.scratches.values()].reduce((sum,s)=>sum+s.data.byteLength,0),scratchGpuBytes:[...this.scratches.values(),...this.canvasScratches.values()].reduce((sum,s)=>sum+s.gpuBytes,0),mipInitializedPages:this.initializedPages,mipLayerUpdates:this.layerUpdates,mipCopyCalls:this.copyCalls,mipCopyBytes:this.mipCopyBytes,gpuCompactionLayers:this.compactionLayers,gpuCompactionCopyCalls:this.compactionCopyCalls,arrayBaseUploadBytes:0,scratchUploadBytes:this.scratchUploadBytes,scratchInitialUploadBytes:this.scratchInitialUploadBytes,scratchFullUploadBytes:this.scratchFullUploadBytes,scratchPartialUploadBytes:this.scratchPartialUploadBytes,scratchPartialUploadPixels:this.scratchPartialUploadBytes/4,scratchPartialUploads:this.scratchPartialUploads,scratchUnchangedUploads:this.scratchUnchangedUploads,scratchFullUploadFallbacks:this.scratchFullUploadFallbacks,gpuTransferSubmissionWallMs:this.transferWallMs};}
 releaseCanvas(canvas:HTMLCanvasElement|OffscreenCanvas){this.canvasScratches.get(canvas)?.texture.dispose();this.canvasScratches.delete(canvas);}
 dispose(){for(const scratch of this.scratches.values())this.releaseScratch(scratch);this.scratches.clear();for(const scratch of this.canvasScratches.values())scratch.texture.dispose();this.canvasScratches.clear();this.renderer=undefined;}
}
