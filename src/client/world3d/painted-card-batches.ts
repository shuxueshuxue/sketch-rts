import {CardMipUploader,createCardArray,type CardTextureRenderer} from './card-mip-uploader';
import { ART_TILE_SIZE } from '../art/raster-cache';
import * as THREE from 'three';
import {SHIP_CAMERA} from '../../shared/ship-geometry';

const LAYERS=16,PIXEL_BUDGET=12*1024*1024,TILT=Math.tan(SHIP_CAMERA.tilt);
type Request={key:string;density:number;paint:(ctx:CanvasRenderingContext2D)=>void;matrix:THREE.Matrix4;id:string;foot:number;tileSize:number;opacity:number};
type Card={key:string;page:Page;layer:number;used:number;tileSize:number};
type Page={texture:THREE.DataArrayTexture;dirty:Set<number>;uploaded:boolean;cards:(Card|undefined)[];geometry:THREE.PlaneGeometry;material:THREE.MeshBasicMaterial;depth:THREE.MeshDepthMaterial;distance:THREE.MeshDistanceMaterial;mesh?:THREE.InstancedMesh;capacity:number;ids:string[];entries:Card[];matrices:THREE.Matrix4[];feet:number[];opacities:number[];used:number};

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
  constructor(private scene:THREE.Scene,private anisotropy:number,private policy:PaintedCardPolicy={}){this.mipUploader=new CardMipUploader(anisotropy);}
  begin(){this.frame++;this.pending.length=0;for(const page of this.pages){page.ids.length=page.entries.length=page.matrices.length=page.feet.length=page.opacities.length=0;}}
  private createPage(width:number,height:number){
    const texture=createCardArray(new Uint8Array(width*height*4*LAYERS),width,height,LAYERS,this.anisotropy);
    const material=new THREE.MeshBasicMaterial({map:texture,alphaTest:this.policy.alphaTest??.4,side:THREE.DoubleSide,toneMapped:false,transparent:this.policy.transparent??false,depthWrite:this.policy.depthWrite??true,depthTest:true});
    const depth=new THREE.MeshDepthMaterial({map:texture,alphaTest:.4,side:THREE.DoubleSide,depthPacking:THREE.RGBADepthPacking});
    const distance=new THREE.MeshDistanceMaterial({map:texture,alphaTest:.4,side:THREE.DoubleSide});
    for(const item of [material,depth,distance])configure(item,this.policy.transparent??false);
    const page:Page={texture,dirty:new Set(),uploaded:false,cards:new Array(LAYERS),geometry:new THREE.PlaneGeometry(1,1),material,depth,distance,capacity:0,ids:[],entries:[],matrices:[],feet:[],opacities:[],used:this.frame};
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
    if(oldest&&this.stats().pixels>=PIXEL_BUDGET){this.cards.delete(oldest.key);return{page:oldest.page,layer:oldest.layer};}
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
  private raster({key,density,paint,matrix,id,foot,tileSize,opacity}:Request){
    let card=this.cards.get(key);
    if(!card){
      const size=tileSize*density;
      let canvas=this.canvases.get(size);if(!canvas){canvas=document.createElement('canvas');canvas.width=canvas.height=size;this.canvases.set(size,canvas);}
      const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.resetTransform();ctx.clearRect(0,0,size,size);ctx.save();ctx.scale(density,density);ctx.translate(tileSize/2,tileSize/2);paint(ctx);ctx.restore();
      // This RGBA buffer is also the precise picking mask; do not allocate a
      // second per-pose alpha image or retain the rasterization canvas.
      const rgba=ctx.getImageData(0,0,size,size).data;
      const retainedSize=hasPaint(rgba)?size:16,{page,layer}=this.slot(retainedSize,retainedSize);
      const pixels=page.texture.image.data as Uint8Array,base=layer*retainedSize*retainedSize*4,row=retainedSize*4;
      // Match CanvasTexture's UNPACK_FLIP_Y at upload time, rather than
      // subtracting interpolated UVs in the fragment shader at cutout edges.
      pixels.fill(0,base,base+retainedSize*retainedSize*4);
      if(retainedSize===size)for(let y=0;y<size;y++)pixels.set(rgba.subarray(y*row,(y+1)*row),base+(size-1-y)*row);
      page.dirty.add(layer);this.rasterizations++;
      card={key,page,layer,used:this.frame,tileSize};page.cards[layer]=card;this.cards.set(key,card);
    }
    this.instance(card,matrix,id,foot,opacity);
  }
  private compact(){
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
      const moved=new Map<Card,Card>();let destination:Page|undefined;
      for(let i=0;i<active.length;i++){
        const old=active[i]!,layer=i%LAYERS;if(layer===0)destination=this.createPage(width,height);
        const page=destination!,card={...old,page,layer,used:this.frame};
        const bytes=width*height*4,source=old.page.texture.image.data as Uint8Array;
        (page.texture.image.data as Uint8Array).set(source.subarray(old.layer*bytes,(old.layer+1)*bytes),layer*bytes);
        page.dirty.add(layer);page.cards[layer]=card;this.cards.set(card.key,card);moved.set(old,card);this.copiedLayers++;
      }
      for(const old of pages){
        for(let i=0;i<old.entries.length;i++){
          const card=moved.get(old.entries[i]!)!;const page=card.page;
          page.ids.push(old.ids[i]!);page.entries.push(card);page.matrices.push(old.matrices[i]!);page.feet.push(old.feet[i]!);page.opacities.push(old.opacities[i]!);
        }
        this.remove(old);
      }
    }
  }
  finish(){
    for(const request of this.pending)this.raster(request);this.pending.length=0;
    this.compact();
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
  /** finish() is CPU preparation only. Call upload immediately before rendering
   * color or shadow passes; no instance may sample an uninitialized mip chain. */
  upload(renderer:CardTextureRenderer){this.mipUploader.upload(this.pages,renderer);}
  /** Called during context loss, before the renderer restores its state. CPU
   * base/picking data survives; fresh wrappers avoid stale Three GPU ownership. */
  invalidateGPU(){
    this.mipUploader.dispose();
    for(const page of this.pages){
      const old=page.texture,{width,height,depth,data}=old.image;old.dispose();
      page.texture=createCardArray(data as Uint8Array,width,height,depth,this.anisotropy);page.uploaded=false;page.dirty.clear();
      for(let layer=0;layer<page.cards.length;layer++)if(page.cards[layer])page.dirty.add(layer);
      for(const material of [page.material,page.depth,page.distance]){material.map=page.texture;material.needsUpdate=true;}
    }
  }
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
    if(uv.x<0||uv.y<0||uv.x>1||uv.y>1)return false;
    const x=Math.min(width-1,Math.floor(uv.x*width)),y=Math.min(height-1,Math.floor(uv.y*height));
    return page.texture.image.data![(card.layer*width*height+y*width+x)*4+3]!>=102;
  }
  objects(){return this.pages.flatMap(page=>page.mesh?.visible?[page.mesh]:[]);}
  // Texture storage estimates only (not total process/GPU memory). GPU mip
  // allocation uses a complete chain; scratch canvases and instance buffers
  // are separately owned and released by dispose().
  stats(){const pixels=this.pages.reduce((n,page)=>n+page.texture.image.width*page.texture.image.height*LAYERS,0);return{pages:this.pages.length,cards:this.cards.size,pixels,cpuBytes:pixels*4,gpuBytes:Math.ceil(pixels*4*4/3),rasterizations:this.rasterizations,copiedLayers:this.copiedLayers,...this.mipUploader.stats()};}
  private remove(page:Page){for(const card of page.cards)if(card&&this.cards.get(card.key)===card)this.cards.delete(card.key);if(page.mesh){this.scene.remove(page.mesh);page.mesh.dispose();}page.geometry.dispose();page.texture.dispose();page.material.dispose();page.depth.dispose();page.distance.dispose();this.pages.splice(this.pages.indexOf(page),1);const {width,height}=page.texture.image;if(!this.pages.some(other=>other.texture.image.width===width&&other.texture.image.height===height))this.mipUploader.releaseSize(width,height);}
  dispose(){for(const page of [...this.pages])this.remove(page);this.canvases.clear();this.pending.length=0;this.mipUploader.dispose();this.rayProbe.geometry.dispose();this.rayProbe.material.dispose();}
}

/** Full authored domains preserve the original mip grid and terminal mip
 * levels, including non-power-of-two action tiles. Transparent padding is not
 * safe to trim merely because base RGBA restoration is exact. Empty cards have
 * no visible mip at any distance and can share the minimum allocation. */
function hasPaint(rgba:Uint8ClampedArray){
  for(let i=3;i<rgba.length;i+=4)if(rgba[i])return true;
  return false;
}
