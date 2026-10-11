import {CardRasterCache} from './card-raster-cache';
import {packCardPickMask,cardMaskHit} from './card-pick-mask';
import {CardMipUploader,createCardArray,cardTextureBytes,type CardMipMove,type CardTextureRenderer} from './card-mip-uploader';
import { ART_TILE_SIZE } from '../art/raster-cache';
import * as THREE from 'three';
import {SHIP_CAMERA} from '../../shared/ship-geometry';

const LAYERS=16,PIXEL_BUDGET=12*1024*1024,TILT=Math.tan(SHIP_CAMERA.tilt);
type Request={key:string;density:number;paint:(ctx:CanvasRenderingContext2D)=>void;matrix:THREE.Matrix4;id:string;foot:number;tileSize:number;opacity:number};
type Card={key:string;page:Page;layer:number;used:number;tileSize:number;mask:Uint8Array};
type Page={texture:THREE.DataArrayTexture;uploaded:boolean;cards:(Card|undefined)[];geometry:THREE.PlaneGeometry;material:THREE.MeshBasicMaterial;depth:THREE.MeshDepthMaterial;distance:THREE.MeshDistanceMaterial;mesh?:THREE.InstancedMesh;capacity:number;ids:string[];entries:Card[];matrices:THREE.Matrix4[];feet:number[];opacities:number[];used:number};

/** Each layer has its own full-resolution mip chain: unlike a packed atlas,
 * filtering cannot borrow another pose's pixels. Stock cutout materials retain
 * Three's color handling, depth and shadow passes. */
export function patchCardShader(shader:{vertexShader:string;fragmentShader:string}){
  shader.vertexShader='attribute float cardLayer;\nattribute vec4 cardRect;\nvarying float vCardLayer;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvCardLayer = cardLayer;\ntransformed.xy = mix(cardRect.xy, cardRect.zw, uv);');
  shader.fragmentShader='precision highp sampler2DArray;\nvarying float vCardLayer;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_pars_fragment>','uniform highp sampler2DArray map;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','diffuseColor *= texture(map, vec3(vMapUv, vCardLayer));');
}
function configure(material:THREE.Material,opacity=false){
 material.onBeforeCompile=shader=>{patchCardShader(shader);if(opacity){
  shader.vertexShader='attribute float cardOpacity;\nvarying float vCardOpacity;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('vCardLayer = cardLayer;','vCardLayer = cardLayer;\nvCardOpacity = cardOpacity;');
  shader.fragmentShader='varying float vCardOpacity;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>','diffuseColor.a *= vCardOpacity;\n#include <alphatest_fragment>');
 }};material.customProgramCacheKey=()=>`painted-card-array-v3:${opacity}`;
}
export type PaintedCardPolicy={transparent?:boolean;depthWrite?:boolean;alphaTest?:number;castShadow?:boolean;pickable?:boolean;renderOrder?:number};

/** Renderer-owned card cache and batches. Animation/color/facing vary per
 * instance, not per draw call. No canvas, GPU texture or material per soldier. */
export class PaintedCardBatches {
  private pages:Page[]=[];
  private cards=new Map<string,Card>();
  private frame=0;
  private pending:Request[]=[];
  private rasterizations=0;
  private copiedLayers=0;
  private matrix=new THREE.Matrix4();
  private offset=new THREE.Matrix4();
  private rayProbe=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  private raySphere=new THREE.Sphere();
  private rayHits:THREE.Intersection[]=[];
  private canvases=new Map<number,HTMLCanvasElement>();
  private mipUploader:CardMipUploader;
  private rowScratch=new Uint8Array(0);
  private emptyRgba=new Uint8Array(0);
  private maskBytes=0;
  private pendingRgbaBytes=0;
  private pendingMaskBytes=0;
  private peakPendingRgbaBytes=0;
  private peakOwnedCpuBytes=0;
  private peakOwnedGpuBytes=0;
  private peakRetiredGpuBytes=0;
  private retiring=new Set<Page>();
  private rasterWorkWallMs=0;
  private rasterCache=new CardRasterCache();
  private rasterStages={paintMs:0,readbackMs:0,cacheMs:0,pickMaskMs:0,rowFlipMs:0,slotMs:0};
  constructor(private scene:THREE.Scene,private anisotropy:number,private policy:PaintedCardPolicy={}){this.mipUploader=new CardMipUploader(anisotropy);}
  begin(){this.frame++;this.pending.length=0;for(const page of this.pages){page.ids.length=page.entries.length=page.matrices.length=page.feet.length=page.opacities.length=0;}}
  private createPage(width:number,height:number){
    const texture=createCardArray(width,height,LAYERS,this.anisotropy);
    const material=new THREE.MeshBasicMaterial({map:texture,alphaTest:this.policy.alphaTest??.4,side:THREE.DoubleSide,toneMapped:false,transparent:this.policy.transparent??false,depthWrite:this.policy.depthWrite??true,depthTest:true});
    const depth=new THREE.MeshDepthMaterial({map:texture,alphaTest:.4,side:THREE.DoubleSide,depthPacking:THREE.RGBADepthPacking});
    const distance=new THREE.MeshDistanceMaterial({map:texture,alphaTest:.4,side:THREE.DoubleSide});
    for(const item of [material,depth,distance])configure(item,this.policy.transparent??false);
    const page:Page={texture,uploaded:false,cards:new Array(LAYERS),geometry:new THREE.PlaneGeometry(1,1),material,depth,distance,capacity:0,ids:[],entries:[],matrices:[],feet:[],opacities:[],used:this.frame};
    this.pages.push(page);return page;
  }
  private slot(width:number,height:number){
    let oldest:Card|undefined;
    for(const page of this.pages){
      if(page.texture.image.width!==width||page.texture.image.height!==height)continue;
      for(let layer=0;layer<LAYERS;layer++){
        const card=page.cards[layer];if(!card)return{page,layer};
        if(card.used!==this.frame&&(!oldest||card.used<oldest.used))oldest=card;
      }
    }
    // Keep a bounded warm cache, but never evict a card referenced by this
    // frame. Large visible armies may legitimately exceed the soft budget.
    if(oldest&&this.stats().pixels>=PIXEL_BUDGET){this.cards.delete(oldest.key);this.maskBytes-=oldest.mask.byteLength;oldest.page.cards[oldest.layer]=undefined;return{page:oldest.page,layer:oldest.layer};}
    return{page:this.createPage(width,height),layer:0};
  }
  add(key:string,density:number,paint:(ctx:CanvasRenderingContext2D)=>void,matrix:THREE.Matrix4,id:string,foot:number,tileSize:number=ART_TILE_SIZE,opacity=1){
    key=`${key}:${density}:${tileSize}`;
    const card=this.cards.get(key);
    // Protect every warm pose used this frame before allocating any new one.
    // Otherwise one early cache miss can evict a later visible pose, cascading
    // into a full rerasterization of an army larger than the soft budget.
    if(card){this.instance(card,matrix,id,foot,opacity);return;}
    this.pending.push({key,density,paint,matrix,id,foot,tileSize,opacity});
  }
  private instance(card:Card,matrix:THREE.Matrix4,id:string,foot:number,opacity:number){
    card.used=card.page.used=this.frame;
    const page=card.page;page.ids.push(id);page.entries.push(card);page.matrices.push(matrix);page.feet.push(foot);page.opacities.push(Math.max(0,Math.min(1,opacity)));
  }
  private raster({key,density,paint,matrix,id,foot,tileSize,opacity}:Request,renderer:CardTextureRenderer){
    let card=this.cards.get(key);
    if(!card){
      const start=performance.now(),size=tileSize*density;
      const cacheStart=performance.now();let rgba=this.rasterCache.get(key);
      this.rasterStages.cacheMs+=performance.now()-cacheStart;const fromCache=!!rgba;let paintMs=0;
      if(!rgba){
        const paintStart=performance.now();
        let canvas=this.canvases.get(size);if(!canvas){canvas=document.createElement('canvas');canvas.width=canvas.height=size;this.canvases.set(size,canvas);}
        const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.resetTransform();ctx.clearRect(0,0,size,size);ctx.save();ctx.scale(density,density);ctx.translate(tileSize/2,tileSize/2);
        try{paint(ctx);}finally{ctx.restore();}
        const paintedAt=performance.now();this.rasterStages.paintMs+=paintedAt-paintStart;
        rgba=ctx.getImageData(0,0,size,size).data;const readAt=performance.now();this.rasterStages.readbackMs+=readAt-paintedAt;paintMs=readAt-paintStart;

      }
      this.pendingRgbaBytes=rgba.byteLength;this.recordPeaks();
      try{
        const maskStart=performance.now(),painted=hasPaint(rgba),retainedSize=painted?size:16;
        const mask=this.policy.pickable===false?new Uint8Array(0):painted?packCardPickMask(rgba,size,size,!fromCache):new Uint8Array(16*16/8);
        this.pendingMaskBytes=mask.byteLength;
        const flipStart=performance.now();this.rasterStages.pickMaskMs+=flipStart-maskStart;
        // Reverse rows in place. A single reusable row replaces a second full
        // RGBA allocation; the source readback is released after this upload.
        if(painted&&!fromCache){
          const row=size*4;if(this.rowScratch.length<row)this.rowScratch=new Uint8Array(row);
          for(let y=0;y<Math.floor(size/2);y++){
            const top=y*row,bottom=(size-1-y)*row;this.rowScratch.set(rgba.subarray(top,top+row));
            rgba.copyWithin(top,bottom,bottom+row);rgba.set(this.rowScratch.subarray(0,row),bottom);
          }
        }
        const flippedAt=performance.now();this.rasterStages.rowFlipMs+=flippedAt-flipStart;
        // Cached bytes already have GPU row orientation. Rehydration never
        // rewrites transparent rows just to flip them a second time.
        if(!fromCache)this.rasterCache.put(key,rgba,size,size,paintMs);
        const slotStart=performance.now();this.rasterStages.cacheMs+=slotStart-flippedAt;
        const {page,layer}=this.slot(retainedSize,retainedSize);this.recordPeaks();
        this.rasterStages.slotMs+=performance.now()-slotStart;
        this.rasterWorkWallMs+=performance.now()-start;
        if(!painted&&this.emptyRgba.length===0)this.emptyRgba=new Uint8Array(16*16*4);
        this.mipUploader.uploadLayer(page,layer,painted?rgba:this.emptyRgba,renderer);this.recordPeaks();
        card={key,page,layer,used:this.frame,tileSize,mask};page.cards[layer]=card;this.cards.set(key,card);this.maskBytes+=mask.byteLength;this.rasterizations++;
      }finally{this.pendingRgbaBytes=this.pendingMaskBytes=0;}
    }
    this.instance(card,matrix,id,foot,opacity);
  }
  private compact(renderer:CardTextureRenderer){
    if(this.stats().pixels<=PIXEL_BUDGET)return;
    const sizes=new Set(this.pages.map(page=>`${page.texture.image.width}:${page.texture.image.height}`));
    for(const size of sizes){
      const [width,height]=size.split(':').map(Number) as [number,number];
      const pages=this.pages.filter(page=>page.texture.image.width===width&&page.texture.image.height===height);
      const active=pages.flatMap(page=>page.cards.filter((card):card is Card=>Boolean(card&&card.used===this.frame)));
      const needed=Math.ceil(active.length/LAYERS);
      // Only repair severe fragmentation, e.g. a large army leaving ten
      // survivors spread across ten old pages. Do not repack normal animation
      // churn or briefly exceed the working set's necessary page count.
      if(!needed||needed*2>pages.length)continue;
      const moved=new Map<Card,Card>(),destinations:Page[]=[],moves:CardMipMove[]=[];let destination:Page|undefined;
      for(const source of pages)this.retiring.add(source);
      try{
        for(let i=0;i<active.length;i++){
          const old=active[i]!,layer=i%LAYERS;
          if(layer===0){destination=this.createPage(width,height);destinations.push(destination);}
          const page=destination!,card={...old,page,layer,used:this.frame};page.cards[layer]=card;moved.set(old,card);
          moves.push({source:old.page,sourceLayer:old.layer,destination:page,destinationLayer:layer});
        }
        // All misses were streamed before compaction. Old sources remain alive
        // and maps untouched until every destination mip copy is submitted.
        this.mipUploader.copyLayers(moves,renderer);this.recordPeaks();
      }catch(error){
        this.recordPeaks();for(const destination of destinations)this.remove(destination);throw error;
      }finally{this.retiring.clear();}
      for(const [old,card] of moved)this.cards.set(old.key,card);
      for(const old of pages){
        for(let i=0;i<old.entries.length;i++){
          const card=moved.get(old.entries[i]!)!;const page=card.page;
          page.ids.push(old.ids[i]!);page.entries.push(card);page.matrices.push(old.matrices[i]!);page.feet.push(old.feet[i]!);page.opacities.push(old.opacities[i]!);
        }
        this.remove(old);
      }
      this.copiedLayers+=moves.length;

    }
  }
  /** Complete the frame in one streaming pass. Callers provide the public GPU
   * transfer contract, including CPU-only tests. No render may precede finish. */
  finish(renderer:CardTextureRenderer){
    try{for(const request of this.pending)this.raster(request,renderer);}finally{this.pending.length=0;}
    this.compact(renderer);
    for(const page of [...this.pages]){
      const count=page.ids.length;
      if(!count){if(page.mesh){page.mesh.count=0;page.mesh.visible=false;}if(this.frame-page.used>120||this.stats().pixels>PIXEL_BUDGET)this.remove(page);continue;}
      if(count>page.capacity){
        if(page.mesh){this.scene.remove(page.mesh);page.mesh.dispose();page.geometry.dispose();}
        page.capacity=2**Math.ceil(Math.log2(count));
        if(this.policy.transparent)page.geometry.setAttribute('cardOpacity',new THREE.InstancedBufferAttribute(new Float32Array(page.capacity),1).setUsage(THREE.DynamicDrawUsage));
        page.geometry.setAttribute('cardRect',new THREE.InstancedBufferAttribute(new Float32Array(page.capacity*4),4).setUsage(THREE.DynamicDrawUsage));
        page.geometry.setAttribute('cardLayer',new THREE.InstancedBufferAttribute(new Float32Array(page.capacity),1).setUsage(THREE.DynamicDrawUsage));
        const mesh=page.mesh=new THREE.InstancedMesh(page.geometry,page.material,page.capacity);
        mesh.name='PaintedCards';mesh.castShadow=this.policy.castShadow??true;mesh.renderOrder=this.policy.renderOrder??0;mesh.receiveShadow=true;mesh.customDepthMaterial=page.depth;mesh.customDistanceMaterial=page.distance;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.raycast=(raycaster,intersections)=>this.raycast(page,raycaster,intersections);
        mesh.userData.ids=page.ids;mesh.userData.paintedHit=(index:number,uv?:{x:number;y:number})=>this.hit(page,index,uv);
        this.scene.add(mesh);
      }
      const mesh=page.mesh!,layers=page.geometry.getAttribute('cardLayer'),rects=page.geometry.getAttribute('cardRect');let radius=0;mesh.count=count;mesh.visible=true;
      for(let i=0;i<count;i++){
        const card=page.entries[i]!;
        // Match the original PlaneGeometry(...).translate(...), including its
        // float32 vertex rounding. Cropping vertices changes rasterizer sample
        // interpolation at alpha-cutout edges even with identical source RGBA.
        const half=card.tileSize/2,foot=page.feet[i]!;
        const low=Math.fround(Math.fround(-half/TILT)+foot/TILT),high=Math.fround(Math.fround(half/TILT)+foot/TILT);
        rects.setXYZW(i,-half,low,half,high);
        radius=Math.max(radius,Math.hypot(half,low),Math.hypot(half,high));
        mesh.setMatrixAt(i,page.matrices[i]!);
        layers.setX(i,page.entries[i]!.layer);if(this.policy.transparent)page.geometry.getAttribute('cardOpacity').setX(i,page.opacities[i]!);
      }
      if(this.policy.transparent)page.geometry.getAttribute('cardOpacity').needsUpdate=true;
      rects.needsUpdate=layers.needsUpdate=mesh.instanceMatrix.needsUpdate=true;
      page.geometry.boundingSphere??=new THREE.Sphere();page.geometry.boundingSphere.center.set(0,0,0);page.geometry.boundingSphere.radius=radius;mesh.computeBoundingSphere();
    }
  }
  /** With no retained pixels or painter closures, restoration deliberately
   * rebuilds visible cards from the next ordinary frame's current state. */
  invalidateGPU(){this.dispose();}
  private raycast(page:Page,raycaster:THREE.Raycaster,intersections:THREE.Intersection[]){
    if(this.policy.pickable===false)return;
    const mesh=page.mesh!;if(!mesh.boundingSphere)mesh.computeBoundingSphere();
    if(!raycaster.ray.intersectsSphere(this.raySphere.copy(mesh.boundingSphere!).applyMatrix4(mesh.matrixWorld)))return;
    // GPU cardRect expands the canonical unit quad. Raycast the same authored
    // plane, then let paintedHit sample the identical source alpha texel.
    for(let i=0;i<mesh.count;i++){
      const card=page.entries[i]!,half=card.tileSize/2,foot=page.feet[i]!;
      const low=Math.fround(Math.fround(-half/TILT)+foot/TILT),high=Math.fround(Math.fround(half/TILT)+foot/TILT);
      this.offset.makeScale(card.tileSize,high-low,1).setPosition(0,(high+low)/2,0);
      mesh.getMatrixAt(i,this.matrix);this.rayProbe.matrixWorld.copy(mesh.matrixWorld).multiply(this.matrix).multiply(this.offset);
      this.rayHits.length=0;this.rayProbe.raycast(raycaster,this.rayHits);
      for(const hit of this.rayHits){hit.instanceId=i;hit.object=mesh;intersections.push(hit);}
    }
  }
  private hit(page:Page,index:number,uv?:{x:number;y:number}){
    const card=page.entries[index];if(this.policy.pickable===false||!card||!uv)return false;
    const {width,height}=page.texture.image;
    return cardMaskHit(card.mask,width,height,uv);
  }
  objects(){return this.pages.flatMap(page=>page.mesh?.visible?[page.mesh]:[]);}
  // Owned typed-array and texture storage estimates, not total process RSS or
  // Canvas backing stores. cpuBytes excludes scratch for existing consumers.
  stats(){
    const pixels=this.pages.reduce((n,page)=>n+page.texture.image.width*page.texture.image.height*LAYERS,0),transfer=this.mipUploader.stats();
    const bytes=(page:Page)=>cardTextureBytes(page.texture.image.width,page.texture.image.height,LAYERS);
    const gpuBytes=Math.ceil(pixels*4*4/3),allocatedMipBytes=this.pages.reduce((sum,page)=>sum+bytes(page),0),retiredGpuBytes=[...this.retiring].reduce((sum,page)=>sum+(page.uploaded?bytes(page):0),0);
    const cpuBytes=this.maskBytes+this.pendingMaskBytes+this.pendingRgbaBytes+this.rowScratch.byteLength+this.emptyRgba.byteLength;
    return{pages:this.pages.length,cards:this.cards.size,pixels,arrayCpuBytes:0,cpuBytes,gpuBytes,allocatedMipBytes,canvasBackingBytes:[...this.canvases.values()].reduce((sum,canvas)=>sum+canvas.width*canvas.height*4,0),maskBytes:this.maskBytes,pendingMaskBytes:this.pendingMaskBytes,pendingRgbaBytes:this.pendingRgbaBytes,rowScratchBytes:this.rowScratch.byteLength,retiredGpuBytes,rasterCache:this.rasterCache.stats(),ownedCpuBytes:cpuBytes+transfer.scratchCpuBytes+this.rasterCache.stats().ownedBytes,ownedGpuBytes:this.pages.reduce((sum,page)=>sum+(page.uploaded?bytes(page):0),0)+transfer.scratchGpuBytes,peakPendingRgbaBytes:this.peakPendingRgbaBytes,peakOwnedCpuBytes:this.peakOwnedCpuBytes,peakOwnedGpuBytes:this.peakOwnedGpuBytes,peakRetiredGpuBytes:this.peakRetiredGpuBytes,rasterizations:this.rasterizations,copiedLayers:this.copiedLayers,rasterStages:{...this.rasterStages},rasterWorkWallMs:this.rasterWorkWallMs,...transfer};
  }
  private recordPeaks(){const s=this.stats();this.peakPendingRgbaBytes=Math.max(this.peakPendingRgbaBytes,s.pendingRgbaBytes);this.peakOwnedCpuBytes=Math.max(this.peakOwnedCpuBytes,s.ownedCpuBytes);this.peakOwnedGpuBytes=Math.max(this.peakOwnedGpuBytes,s.ownedGpuBytes);this.peakRetiredGpuBytes=Math.max(this.peakRetiredGpuBytes,s.retiredGpuBytes);}
  private remove(page:Page){
    for(const card of page.cards)if(card&&this.cards.get(card.key)===card){this.cards.delete(card.key);this.maskBytes-=card.mask.byteLength;}
    if(page.mesh){this.scene.remove(page.mesh);page.mesh.dispose();}page.geometry.dispose();page.texture.dispose();page.material.dispose();page.depth.dispose();page.distance.dispose();this.pages.splice(this.pages.indexOf(page),1);
    const {width,height}=page.texture.image;if(!this.pages.some(other=>other.texture.image.width===width&&other.texture.image.height===height))this.mipUploader.releaseSize(width,height);
  }
  dispose(){
    this.rasterCache.clear();for(const page of [...this.pages])this.remove(page);this.retiring.clear();for(const canvas of this.canvases.values())canvas.width=canvas.height=1;this.canvases.clear();this.pending.length=0;this.pendingRgbaBytes=this.pendingMaskBytes=this.maskBytes=0;this.rowScratch=new Uint8Array(0);this.emptyRgba=new Uint8Array(0);this.mipUploader.dispose();this.rayProbe.geometry.dispose();this.rayProbe.material.dispose();}

}

/** Full authored domains preserve the original mip grid and terminal mip
 * levels, including non-power-of-two action tiles. Transparent padding is not
 * safe to trim merely because base RGBA restoration is exact. Empty cards have
 * no visible mip at any distance and can share the minimum allocation. */
function hasPaint(rgba:Uint8ClampedArray){
  for(let i=3;i<rgba.length;i+=4)if(rgba[i])return true;
  return false;
}
