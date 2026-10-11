import * as THREE from 'three';
import {SHIP_CAMERA} from '../../shared/ship-geometry';

const LAYERS=16,PIXEL_BUDGET=12*1024*1024,TILT=Math.tan(SHIP_CAMERA.tilt);
type Request={key:string;density:number;paint:(ctx:CanvasRenderingContext2D)=>void;matrix:THREE.Matrix4;id:string;foot:number};
type Card={key:string;page:Page;layer:number;used:number};
type Page={texture:THREE.DataArrayTexture;cards:(Card|undefined)[];geometry:THREE.PlaneGeometry;material:THREE.MeshBasicMaterial;depth:THREE.MeshDepthMaterial;distance:THREE.MeshDistanceMaterial;mesh?:THREE.InstancedMesh;capacity:number;ids:string[];entries:Card[];matrices:THREE.Matrix4[];feet:number[];used:number};

/** Each layer has its own full-resolution mip chain: unlike a packed atlas,
 * filtering cannot borrow another pose's pixels. Stock cutout materials retain
 * Three's color handling, depth and shadow passes. */
export function patchCardShader(shader:{vertexShader:string;fragmentShader:string}){
  shader.vertexShader='attribute float cardLayer;\nvarying float vCardLayer;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvCardLayer = cardLayer;');
  shader.fragmentShader='precision highp sampler2DArray;\nvarying float vCardLayer;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_pars_fragment>','uniform highp sampler2DArray map;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','diffuseColor *= texture(map, vec3(vMapUv, vCardLayer));');
}
function configure(material:THREE.Material){material.onBeforeCompile=patchCardShader;material.customProgramCacheKey=()=> 'painted-card-array-v1';}

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
  private canvases=new Map<number,HTMLCanvasElement>();
  constructor(private scene:THREE.Scene,private anisotropy:number){}
  begin(){this.frame++;this.pending.length=0;for(const page of this.pages){page.ids.length=page.entries.length=page.matrices.length=page.feet.length=0;}}
  private createPage(size:number){
    const texture=new THREE.DataArrayTexture(new Uint8Array(size*size*4*LAYERS),size,size,LAYERS);
    texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.anisotropy=this.anisotropy;
    const material=new THREE.MeshBasicMaterial({map:texture,alphaTest:.4,side:THREE.DoubleSide,toneMapped:false});
    const depth=new THREE.MeshDepthMaterial({map:texture,alphaTest:.4,side:THREE.DoubleSide,depthPacking:THREE.RGBADepthPacking});
    const distance=new THREE.MeshDistanceMaterial({map:texture,alphaTest:.4,side:THREE.DoubleSide});
    for(const item of [material,depth,distance])configure(item);
    const page:Page={texture,cards:new Array(LAYERS),geometry:new THREE.PlaneGeometry(128,128/TILT).translate(0,17/TILT,0),material,depth,distance,capacity:0,ids:[],entries:[],matrices:[],feet:[],used:this.frame};
    this.pages.push(page);return page;
  }
  private slot(size:number){
    let oldest:Card|undefined;
    for(const page of this.pages){
      if(page.texture.image.width!==size)continue;
      for(let layer=0;layer<LAYERS;layer++){
        const card=page.cards[layer];if(!card)return{page,layer};
        if(card.used!==this.frame&&(!oldest||card.used<oldest.used))oldest=card;
      }
    }
    // Keep a bounded warm cache, but never evict a card referenced by this
    // frame. Large visible armies may legitimately exceed the soft budget.
    if(oldest&&this.stats().pixels>=PIXEL_BUDGET){this.cards.delete(oldest.key);return{page:oldest.page,layer:oldest.layer};}
    return{page:this.createPage(size),layer:0};
  }
  add(key:string,density:number,paint:(ctx:CanvasRenderingContext2D)=>void,matrix:THREE.Matrix4,id:string,foot:number){
    const card=this.cards.get(key);
    // Protect every warm pose used this frame before allocating any new one.
    // Otherwise one early cache miss can evict a later visible pose, cascading
    // into a full rerasterization of an army larger than the soft budget.
    if(card){this.instance(card,matrix,id,foot);return;}
    this.pending.push({key,density,paint,matrix,id,foot});
  }
  private instance(card:Card,matrix:THREE.Matrix4,id:string,foot:number){
    card.used=card.page.used=this.frame;
    const page=card.page;page.ids.push(id);page.entries.push(card);page.matrices.push(matrix);page.feet.push((foot-17)/TILT);
  }
  private raster({key,density,paint,matrix,id,foot}:Request){
    let card=this.cards.get(key);
    if(!card){
      const size=128*density,{page,layer}=this.slot(size);
      let canvas=this.canvases.get(size);if(!canvas){canvas=document.createElement('canvas');canvas.width=canvas.height=size;this.canvases.set(size,canvas);}
      const ctx=canvas.getContext('2d',{willReadFrequently:false})!;ctx.resetTransform();ctx.clearRect(0,0,size,size);ctx.save();ctx.scale(density,density);ctx.translate(64,64);paint(ctx);ctx.restore();
      // This RGBA buffer is also the precise picking mask; do not allocate a
      // second per-pose alpha image or retain the rasterization canvas.
      const rgba=ctx.getImageData(0,0,size,size).data;
      const pixels=page.texture.image.data as Uint8Array,base=layer*size*size*4,row=size*4;
      // Match CanvasTexture's UNPACK_FLIP_Y at upload time, rather than
      // subtracting interpolated UVs in the fragment shader at cutout edges.
      for(let y=0;y<size;y++)pixels.set(rgba.subarray(y*row,(y+1)*row),base+(size-1-y)*row);
      page.texture.addLayerUpdate(layer);page.texture.needsUpdate=true;this.rasterizations++;
      card={key,page,layer,used:this.frame};page.cards[layer]=card;this.cards.set(key,card);
    }
    this.instance(card,matrix,id,foot);
  }
  private compact(){
    if(this.stats().pixels<=PIXEL_BUDGET)return;
    const sizes=new Set(this.pages.map(page=>page.texture.image.width));
    for(const size of sizes){
      const pages=this.pages.filter(page=>page.texture.image.width===size);
      const active=pages.flatMap(page=>page.cards.filter((card):card is Card=>Boolean(card&&card.used===this.frame)));
      const needed=Math.ceil(active.length/LAYERS);
      // Only repair severe fragmentation, e.g. a large army leaving ten
      // survivors spread across ten old pages. Do not repack normal animation
      // churn or briefly exceed the working set's necessary page count.
      if(!needed||needed*2>pages.length)continue;
      const moved=new Map<Card,Card>();let destination:Page|undefined;
      for(let i=0;i<active.length;i++){
        const old=active[i]!,layer=i%LAYERS;if(layer===0)destination=this.createPage(size);
        const page=destination!,card={key:old.key,page,layer,used:this.frame};
        const bytes=size*size*4,source=old.page.texture.image.data as Uint8Array;
        (page.texture.image.data as Uint8Array).set(source.subarray(old.layer*bytes,(old.layer+1)*bytes),layer*bytes);
        page.texture.addLayerUpdate(layer);page.texture.needsUpdate=true;page.cards[layer]=card;this.cards.set(card.key,card);moved.set(old,card);this.copiedLayers++;
      }
      for(const old of pages){
        for(let i=0;i<old.entries.length;i++){
          const card=moved.get(old.entries[i]!)!;const page=card.page;
          page.ids.push(old.ids[i]!);page.entries.push(card);page.matrices.push(old.matrices[i]!);page.feet.push(old.feet[i]!);
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
        page.geometry.setAttribute('cardLayer',new THREE.InstancedBufferAttribute(new Float32Array(page.capacity),1).setUsage(THREE.DynamicDrawUsage));
        const mesh=page.mesh=new THREE.InstancedMesh(page.geometry,page.material,page.capacity);
        mesh.name='PaintedCards';mesh.castShadow=true;mesh.receiveShadow=true;mesh.customDepthMaterial=page.depth;mesh.customDistanceMaterial=page.distance;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.userData.ids=page.ids;mesh.userData.paintedHit=(index:number,uv?:{x:number;y:number})=>this.hit(page,index,uv);
        this.scene.add(mesh);
      }
      const mesh=page.mesh!,layers=page.geometry.getAttribute('cardLayer');mesh.count=count;mesh.visible=true;
      for(let i=0;i<count;i++){
        this.offset.makeTranslation(0,page.feet[i]!,0);
        mesh.setMatrixAt(i,this.matrix.copy(page.matrices[i]!).multiply(this.offset));
        layers.setX(i,page.entries[i]!.layer);
      }
      layers.needsUpdate=mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();
    }
  }
  private hit(page:Page,index:number,uv?:{x:number;y:number}){
    const card=page.entries[index];if(!card||!uv)return false;
    const size=page.texture.image.width,x=Math.min(size-1,Math.max(0,Math.floor(uv.x*size))),y=size-1-Math.min(size-1,Math.max(0,Math.floor((1-uv.y)*size)));
    return page.texture.image.data![(card.layer*size*size+y*size+x)*4+3]!>=102;
  }
  objects(){return this.pages.flatMap(page=>page.mesh?.visible?[page.mesh]:[]);}
  // Texture storage estimates only (not total process/GPU memory). GPU mip
  // allocation uses a complete chain; scratch canvases and instance buffers
  // are separately owned and released by dispose().
  stats(){const pixels=this.pages.reduce((n,page)=>n+page.texture.image.width**2*LAYERS,0);return{pages:this.pages.length,cards:this.cards.size,pixels,cpuBytes:pixels*4,gpuBytes:Math.ceil(pixels*4*4/3),rasterizations:this.rasterizations,copiedLayers:this.copiedLayers};}
  private remove(page:Page){for(const card of page.cards)if(card&&this.cards.get(card.key)===card)this.cards.delete(card.key);if(page.mesh){this.scene.remove(page.mesh);page.mesh.dispose();}page.geometry.dispose();page.texture.dispose();page.material.dispose();page.depth.dispose();page.distance.dispose();this.pages.splice(this.pages.indexOf(page),1);}
  dispose(){for(const page of [...this.pages])this.remove(page);this.canvases.clear();this.pending.length=0;}
}
