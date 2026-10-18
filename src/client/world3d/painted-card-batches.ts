import {CardRasterCache} from './card-raster-cache';
import {packCardPickMask,cardMaskHit} from './card-pick-mask';
import {CardMipUploader,createCardArray,cardTextureBytes,type CardMipMove,type CardTextureRenderer} from './card-mip-uploader';
import { ART_TILE_SIZE } from '../art/raster-cache';
import {configureCardMaterial,MAX_CARD_BANKS} from './card-bank-shader';
export {patchCardBankShader as patchCardShader} from './card-bank-shader';
import * as THREE from 'three';
import {SHIP_CAMERA} from '../../shared/ship-geometry';

/** Ordinary draws use implicit single-bank sampling; wider chunks are opt-in. */
export const DEFAULT_CARD_BANKS=1;
const LAYERS=16,PIXEL_BUDGET=12*1024*1024,TILT=Math.tan(SHIP_CAMERA.tilt);
type Request={key:string;density:number;paint:(ctx:CanvasRenderingContext2D)=>void;matrix:THREE.Matrix4;id:string;foot:number;tileSize:number;opacity:number;baseMip:number;order:number};
type Card={key:string;page:Page;layer:number;used:number;tileSize:number;sourceSize:number;baseMip:number;mask:Uint8Array|undefined;density:number;paint:((ctx:CanvasRenderingContext2D)=>void)|undefined};
/** Cache allocation is independent of draw order. Pages own no render objects. */
type Page={texture:THREE.DataArrayTexture;readonly mipBytes:number;uploaded:boolean;cards:(Card|undefined)[];used:number};
type Instance={card:Card|undefined;matrix:THREE.Matrix4;id:string;foot:number;opacity:number;order:number};
type DrawChunk={banks:THREE.DataArrayTexture[];pages:Page[];entries:Card[];ids:string[];feet:number[];orders:number[];geometry:THREE.PlaneGeometry;material:THREE.MeshBasicMaterial;depth:THREE.MeshDepthMaterial;distance:THREE.MeshDistanceMaterial;mesh:THREE.InstancedMesh;capacity:number;used:number;refreshMaterials:(()=>void)[]};
/** rasterBudgetMs: once a frame has painted a card and spent this long painting, the cards it still lacks wait for later
 * frames (see finish). */
export type PaintedCardPolicy={transparent?:boolean;depthWrite?:boolean;alphaTest?:number;alphaToCoverage?:boolean;castShadow?:boolean;pickable?:boolean;renderOrder?:number;maxTextureBanks?:number;rasterBudgetMs?:number};

/** Renderer-owned card cache and batches. Animation/color/facing vary per
 * instance, not per draw call. No canvas, GPU texture or material per soldier. */
export class PaintedCardBatches {
  private pages:Page[]=[];
  private allocatedPixels=0;
  private cards=new Map<string,Card>();
  private frame=0;
  private instanceOrder=0;
  // Reuse instance records, indexed by submission order. Warm hits and pending
  // uploads fill the same sequence, irrespective of raster completion order.
  private instances:Instance[]=[];
  private bindings=new Map<Card,Instance[]>();
  // The card each instance id drew this frame and last frame: a card still waiting for its raster stands in with the last.
  private shown=new Map<string,Card>();
  private shownBefore=new Map<string,Card>();
  private drawRows:Instance[]=[];
  private chunks:DrawChunk[]=[];
  private drawGroup=new THREE.Group();
  private maxTextureBanks:number;
  private pending:Request[]=[];
  private rasterizations=0;
  // Warm cards dropped to make room or with their page: each one drawn again is painted again.
  private evictions=0;
  // Requests a frame left waiting with nothing to show: a troop drawn as its health bar alone.
  private bodiless=0;
  private lazyMasks=0;
  // The distinct cards the last frame drew, and the most any frame has drawn: what the cache must hold not to repaint.
  private frameDemand=0;
  private frameKeys=new Set<string>();
  // When each card was last asked for: the cards of the last second are what an animation cycles through.
  private askedAt=new Map<string,number>();
  private peakFrameDemand=0;
  private preparedRasters=0;
  private copiedLayers=0;
  private matrix=new THREE.Matrix4();
  private offset=new THREE.Matrix4();
  private rayProbe=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  private raySphere=new THREE.Sphere();
  private rayHits:THREE.Intersection[]=[];
  // Canvases keyed by pixel size: one painted for upload only (GPU-backed), one painted to be read back.
  private canvases=new Map<string,HTMLCanvasElement>();
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
  constructor(private scene:THREE.Scene,private anisotropy:number,private policy:PaintedCardPolicy={}){
    this.maxTextureBanks=policy.maxTextureBanks??DEFAULT_CARD_BANKS;
    if(!Number.isInteger(this.maxTextureBanks)||this.maxTextureBanks<1||this.maxTextureBanks>MAX_CARD_BANKS)throw new Error('Invalid painted card bank count.');
    this.drawGroup.name='PaintedCardDraws';
    this.mipUploader=new CardMipUploader(anisotropy);
  }
  begin(){
    this.frame++;this.instanceOrder=0;this.pending.length=0;this.bindings.clear();this.frameKeys.clear();
    [this.shownBefore,this.shown]=[this.shown,this.shownBefore];this.shown.clear();
    for(const row of this.instances)if(row){row.card=undefined;row.id='';}
    // A failed upload must not expose last frame's lower-quality draw bindings.
    for(const chunk of this.chunks)this.hideChunk(chunk);
  }
  private createPage(width:number,height:number,layers=LAYERS){
    const page:Page={texture:createCardArray(width,height,layers,this.anisotropy),mipBytes:cardTextureBytes(width,height,layers),uploaded:false,cards:new Array(layers),used:this.frame};
    this.pages.push(page);this.allocatedPixels+=width*height*layers;return page;
  }
  private slot(width:number,height:number,pendingLayers:number,empty=false){
    let oldest:Card|undefined;
    for(const page of this.pages){
      if(page.texture.image.width!==width||page.texture.image.height!==height)continue;
      for(let layer=0;layer<page.texture.image.depth;layer++){
        const card=page.cards[layer];if(!card)return{page,layer};
        if(card.used!==this.frame&&(!oldest||card.used<oldest.used))oldest=card;
      }
    }
    // Keep a bounded warm cache, but never evict a card referenced by this
    // frame. Large visible armies may legitimately exceed the soft budget.
    const remainingLayers=Math.floor((PIXEL_BUDGET-this.allocatedPixels)/(width*height));
    if(oldest&&remainingLayers<1){this.evictions++;this.cards.delete(oldest.key);this.maskBytes-=oldest.mask?.byteLength??0;oldest.page.cards[oldest.layer]=undefined;return{page:oldest.page,layer:oldest.layer};}
    // Reserve only this frame's remaining unique demands, even below budget.
    // A new resident-size bin may need a few poses rather than sixteen warm
    // slots. Current visible demands may still exceed the soft budget.
    // Empty output has a cheap shared 16px domain. Keep its ordinary batching
    // below budget: many single-layer textures save no pixels over one shared
    // page. Above budget use one layer because future empty output is unknown.
    const layers=empty?(remainingLayers>0?Math.min(LAYERS,remainingLayers):1):Math.min(LAYERS,Math.max(1,pendingLayers),remainingLayers>0?remainingLayers:LAYERS);
    return{page:this.createPage(width,height,layers),layer:0};
  }
  add(key:string,density:number,paint:(ctx:CanvasRenderingContext2D)=>void,matrix:THREE.Matrix4,id:string,foot:number,tileSize:number=ART_TILE_SIZE,opacity=1,baseMip=0){
    const size=tileSize*density,factor=2**baseMip;
    if(!Number.isInteger(baseMip)||baseMip<0||baseMip>0&&(!Number.isInteger(size)||size<1||size%factor!==0))throw new Error('Invalid painted card resident mip.');
    key=`${key}:${density}:${tileSize}`;this.frameKeys.add(key);this.askedAt.set(key,this.frame);
    const order=this.instanceOrder++,card=this.cards.get(key);
    // Protect every warm pose used this frame before allocating any new one.
    // Otherwise one early cache miss can evict a later visible pose, cascading
    // into a full rerasterization of an army larger than the soft budget.
    if(card){
      card.used=card.page.used=this.frame;
      // A finer resident chain already contains every requested lower mip.
      // Residency is state of this original raster, not another asset identity.
      if(card.baseMip<=baseMip){this.instance(card,matrix,id,foot,opacity,order);return;}
    }
    this.pending.push({key,density,paint,matrix,id,foot,tileSize,opacity,baseMip,order});
  }
  private instance(card:Card,matrix:THREE.Matrix4,id:string,foot:number,opacity:number,order:number){
    card.used=card.page.used=this.frame;
    let row=this.instances[order];
    if(!row){row={card,matrix,id,foot,opacity:0,order};this.instances[order]=row;}
    else{row.card=card;row.matrix=matrix;row.id=id;row.foot=foot;row.order=order;}
    row.opacity=Math.max(0,Math.min(1,opacity));this.shown.set(id,card);
    let bindings=this.bindings.get(card);if(!bindings){bindings=[];this.bindings.set(card,bindings);}bindings.push(row);
  }
  /** Publish a successful promotion or compaction without changing submission
   * order, source geometry, matrices or alpha-mask identity. */
  private rebind(previous:Card,current:Card){
    const rows=this.bindings.get(previous);if(!rows)return;
    let target=this.bindings.get(current);if(!target){target=[];this.bindings.set(current,target);}
    for(const row of rows){row.card=current;target.push(row);}this.bindings.delete(previous);
  }
  private paintCanvas(readable:boolean,density:number,paint:(ctx:CanvasRenderingContext2D)=>void,tileSize:number){
    const size=tileSize*density,name=`${readable?'read':'upload'}:${size}`;
    let canvas=this.canvases.get(name);if(!canvas){canvas=document.createElement('canvas');canvas.width=canvas.height=size;this.canvases.set(name,canvas);}
    const ctx=canvas.getContext('2d',readable?{willReadFrequently:true}:undefined)!;ctx.resetTransform();ctx.clearRect(0,0,size,size);ctx.save();ctx.scale(density,density);ctx.translate(tileSize/2,tileSize/2);
    try{paint(ctx);}finally{ctx.restore();}
    return canvas;
  }
  private readRaster(key:string,density:number,paint:(ctx:CanvasRenderingContext2D)=>void,tileSize:number){
    const size=tileSize*density,cacheStart=performance.now();let rgba=this.rasterCache.get(key);
    this.rasterStages.cacheMs+=performance.now()-cacheStart;const fromCache=!!rgba;let paintMs=0;
    if(!rgba){
      const paintStart=performance.now();
      const ctx=this.paintCanvas(true,density,paint,tileSize).getContext('2d',{willReadFrequently:true})!;
      const paintedAt=performance.now();this.rasterStages.paintMs+=paintedAt-paintStart;
      rgba=ctx.getImageData(0,0,size,size).data;const readAt=performance.now();this.rasterStages.readbackMs+=readAt-paintedAt;paintMs=readAt-paintStart;
    }
    return{rgba,fromCache,paintMs};
  }
  private flipRows(rgba:Uint8ClampedArray,size:number){
    const row=size*4;if(this.rowScratch.length<row)this.rowScratch=new Uint8Array(row);
    for(let y=0;y<Math.floor(size/2);y++){
      const top=y*row,bottom=(size-1-y)*row;this.rowScratch.set(rgba.subarray(top,top+row));
      rgba.copyWithin(top,bottom,bottom+row);rgba.set(this.rowScratch.subarray(0,row),bottom);
    }
  }
  /** Prepare a finite authored raster during resource loading. The original
   * painter, filtering and lossless recovery cache are shared with live draws;
   * preparation allocates no GPU page, draw chunk or visible instance. */
  prepareRaster(key:string,density:number,paint:(ctx:CanvasRenderingContext2D)=>void,tileSize:number=ART_TILE_SIZE){
    key=`${key}:${density}:${tileSize}`;
    const start=performance.now(),size=tileSize*density;
    const {rgba,fromCache,paintMs}=this.readRaster(key,density,paint,tileSize);
    if(fromCache)return;
    this.pendingRgbaBytes=rgba.byteLength;this.recordPeaks();
    try{
      const flipStart=performance.now();if(hasPaint(rgba))this.flipRows(rgba,size);
      const flippedAt=performance.now();this.rasterStages.rowFlipMs+=flippedAt-flipStart;
      this.rasterCache.put(key,rgba,size,size,paintMs);this.rasterStages.cacheMs+=performance.now()-flippedAt;
      this.preparedRasters++;this.rasterWorkWallMs+=performance.now()-start;this.recordPeaks();
    }finally{this.pendingRgbaBytes=0;}
  }
  private raster({key,density,paint,matrix,id,foot,tileSize,opacity,order}:Request,renderer:CardTextureRenderer,baseMip:number,pendingLayers:Map<number,number>){
    let card=this.cards.get(key);
    if(!card||card.baseMip>baseMip){
      const previous=card;
      const start=performance.now(),size=tileSize*density;
      const cacheStart=performance.now(),cached=this.rasterCache.get(key);this.rasterStages.cacheMs+=performance.now()-cacheStart;
      if(!cached){card=this.rasterFresh(key,density,paint,tileSize,baseMip,renderer,pendingLayers,start);if(previous)this.retire(previous,card);this.instance(card,matrix,id,foot,opacity,order);return;}
      // A prepared raster comes back from its exact pixels, already in GPU row order (see prepareRaster).
      const rgba=cached;
      this.pendingRgbaBytes=rgba.byteLength;this.recordPeaks();
      try{
        const maskStart=performance.now(),painted=hasPaint(rgba),sourceSize=painted?size:16,residentMip=painted?baseMip:0,retainedSize=sourceSize/2**residentMip;
        const mask=this.policy.pickable===false?new Uint8Array(0):painted?packCardPickMask(rgba,size,size,false):new Uint8Array(16*16/8);
        this.pendingMaskBytes=mask.byteLength;this.rasterStages.pickMaskMs+=performance.now()-maskStart;
        const slotStart=performance.now();
        const {page,layer}=this.slot(retainedSize,retainedSize,pendingLayers.get(retainedSize)??1,!painted);this.recordPeaks();
        this.rasterStages.slotMs+=performance.now()-slotStart;
        this.rasterWorkWallMs+=performance.now()-start;
        if(!painted&&this.emptyRgba.length===0)this.emptyRgba=new Uint8Array(16*16*4);
        this.mipUploader.uploadLayer(page,layer,painted?rgba:this.emptyRgba,renderer,{sourceWidth:sourceSize,sourceHeight:sourceSize,baseMip:residentMip});this.recordPeaks();
        card={key,page,layer,used:this.frame,tileSize,sourceSize,baseMip:residentMip,mask,density,paint:undefined};page.cards[layer]=card;this.cards.set(key,card);this.maskBytes+=mask.byteLength;
        if(previous)this.retire(previous,card);
        this.rasterizations++;
        // Empty drawings use a separate minimum domain. Consume the original
        // planned demand once, rather than another request's 16px bin count.
        const plannedSize=size/2**baseMip;
        pendingLayers.set(plannedSize,Math.max(0,(pendingLayers.get(plannedSize)??1)-1));
      }finally{this.pendingRgbaBytes=this.pendingMaskBytes=0;}
    }
    this.instance(card,matrix,id,foot,opacity,order);
  }
  private retire(previous:Card,card:Card){this.rebind(previous,card);previous.page.cards[previous.layer]=undefined;this.maskBytes-=previous.mask?.byteLength??0;}
  /** A card painted now goes from its canvas straight to its page layer (see @@@canvas-upload): no readback, no row
   * flip, no recovery copy. Its pick mask is read back only when a pointer first asks it (see hit). */
  private rasterFresh(key:string,density:number,paint:(ctx:CanvasRenderingContext2D)=>void,tileSize:number,baseMip:number,renderer:CardTextureRenderer,pendingLayers:Map<number,number>,start:number):Card{
    const size=tileSize*density,retainedSize=size/2**baseMip;
    const paintStart=performance.now(),canvas=this.paintCanvas(false,density,paint,tileSize);this.rasterStages.paintMs+=performance.now()-paintStart;
    const slotStart=performance.now(),{page,layer}=this.slot(retainedSize,retainedSize,pendingLayers.get(retainedSize)??1,false);this.recordPeaks();
    this.rasterStages.slotMs+=performance.now()-slotStart;this.rasterWorkWallMs+=performance.now()-start;
    this.mipUploader.uploadCanvasLayer(page,layer,canvas,renderer,{sourceWidth:size,sourceHeight:size,baseMip});this.recordPeaks();
    const pickable=this.policy.pickable!==false,mask=pickable?undefined:new Uint8Array(0);
    const card:Card={key,page,layer,used:this.frame,tileSize,sourceSize:size,baseMip,mask,density,paint:pickable?paint:undefined};
    page.cards[layer]=card;this.cards.set(key,card);this.rasterizations++;
    pendingLayers.set(retainedSize,Math.max(0,(pendingLayers.get(retainedSize)??1)-1));
    return card;
  }
  private mask(card:Card){
    if(card.mask)return card.mask;
    const start=performance.now(),{rgba,fromCache}=this.readRaster(card.key,card.density,card.paint!,card.tileSize);
    card.mask=packCardPickMask(rgba,card.sourceSize,card.sourceSize,!fromCache);card.paint=undefined;
    this.maskBytes+=card.mask.byteLength;this.lazyMasks++;this.rasterStages.pickMaskMs+=performance.now()-start;
    return card.mask;
  }
  private compact(renderer:CardTextureRenderer){
    if(this.allocatedPixels<=PIXEL_BUDGET)return;
    const sizes=new Set(this.pages.map(page=>`${page.texture.image.width}:${page.texture.image.height}`));
    for(const size of sizes){
      const [width,height]=size.split(':').map(Number) as [number,number];
      const pages=this.pages.filter(page=>page.texture.image.width===width&&page.texture.image.height===height);
      const active=pages.flatMap(page=>page.cards.filter((card):card is Card=>Boolean(card&&card.used===this.frame)));
      let capacity=0,needed=0;
      for(const page of [...pages].sort((a,b)=>b.texture.image.depth-a.texture.image.depth)){
        if(capacity>=active.length)break;capacity+=page.texture.image.depth;needed++;
      }
      // Only repair severe fragmentation, e.g. a large army leaving ten
      // survivors spread across ten old pages. Do not repack normal animation
      // churn or briefly exceed the working set's necessary page count.
      if(!needed||needed*2>pages.length)continue;
      // Keep the pages holding the most visible poses. Repair the selection
      // when a short tail page would otherwise require an extra destination.
      const ranked=[...pages].sort((a,b)=>b.cards.filter(card=>card?.used===this.frame).length-a.cards.filter(card=>card?.used===this.frame).length||b.texture.image.depth-a.texture.image.depth);
      const destinations=ranked.slice(0,needed);capacity=destinations.reduce((sum,page)=>sum+page.texture.image.depth,0);
      while(capacity<active.length){
        const smallest=[...destinations].sort((a,b)=>a.texture.image.depth-b.texture.image.depth)[0]!;
        const replacement=pages.filter(page=>!destinations.includes(page)).sort((a,b)=>b.texture.image.depth-a.texture.image.depth)[0]!;
        capacity+=replacement.texture.image.depth-smallest.texture.image.depth;
        destinations[destinations.indexOf(smallest)]=replacement;
      }
      const kept=new Set(destinations),sources=pages.filter(page=>!kept.has(page));
      const holes:{page:Page;layer:number}[]=[];
      for(const page of destinations)for(let layer=0;layer<page.texture.image.depth;layer++)if(page.cards[layer]?.used!==this.frame)holes.push({page,layer});
      const displaced=active.filter(card=>!kept.has(card.page));
      const moved=new Map<Card,Card>(),moves:CardMipMove[]=[];
      for(const [i,old] of displaced.entries()){
        const {page,layer}=holes[i]!,card={...old,page,layer,used:this.frame};moved.set(old,card);
        moves.push({source:old.page,sourceLayer:old.layer,destination:page,destinationLayer:layer});
      }
      for(const source of sources)this.retiring.add(source);
      try{
        // Destinations are existing inactive holes. No active source can be a
        // destination, so failed copies leave every visible source intact.
        // Publish maps and instances only after all mip copies are submitted.
        this.mipUploader.copyLayers(moves,renderer);this.recordPeaks();
      }catch(error){
        // A partial copy can corrupt a warm destination. Invalidate all planned
        // holes conservatively; their next request must repaint/recover them.
        for(const card of moved.values()){
          const previous=card.page.cards[card.layer];
          if(previous&&this.cards.get(previous.key)===previous){this.cards.delete(previous.key);this.maskBytes-=previous.mask?.byteLength??0;}
          card.page.cards[card.layer]=undefined;
        }
        this.recordPeaks();throw error;
      }finally{this.retiring.clear();}
      for(const [old,card] of moved){
        const previous=card.page.cards[card.layer];
        if(previous&&this.cards.get(previous.key)===previous){this.cards.delete(previous.key);this.maskBytes-=previous.mask?.byteLength??0;}
        card.page.cards[card.layer]=card;card.page.used=this.frame;this.cards.set(old.key,card);
      }
      for(const [old,card] of moved)this.rebind(old,card);
      for(const old of sources)this.remove(old);
      this.copiedLayers+=moves.length;

    }
  }
  /** Complete the frame in one streaming pass. Callers provide the public GPU
   * transfer contract, including CPU-only tests. No render may precede finish. */
  finish(renderer:CardTextureRenderer){
    const finest=new Map<string,{baseMip:number;size:number}>(),pendingLayers=new Map<number,number>();
    for(const request of this.pending){
      const previous=finest.get(request.key);
      if(!previous||request.baseMip<previous.baseMip)finest.set(request.key,{baseMip:request.baseMip,size:request.tileSize*request.density/2**request.baseMip});
    }
    for(const [key,request] of finest){
      const card=this.cards.get(key);if(card&&card.baseMip<=request.baseMip)continue;
      pendingLayers.set(request.size,(pendingLayers.get(request.size)??0)+1);
    }
    // A raster takes milliseconds (a hundred at once when a match opens on its armies), so a frame paints cards until it
    // has painted one and spent its budget. A card left to paint waits for a later frame; meanwhile its instance draws
    // the coarser resident mip it has, or the card it drew last frame (its previous pose), or nothing yet.
    // Instances with nothing to show are painted first; one that can show a coarser mip or its previous pose waits, so
    // in a battle no troop goes without a body while others refresh their poses. The previous pose a waiting instance
    // shows is in use this frame: painting must not evict it.
    for(const request of this.pending){
      const card=this.cards.get(request.key);if(card&&card.baseMip<=finest.get(request.key)!.baseMip)continue;
      const before=this.shownBefore.get(request.id),stand=before&&this.cards.get(before.key);if(stand)stand.used=stand.page.used=this.frame;
    }
    const showsNothing=(request:Request)=>{const before=this.shownBefore.get(request.id);return!this.cards.get(request.key)&&!(before&&this.cards.get(before.key));};
    const deadline=performance.now()+(this.policy.rasterBudgetMs??Infinity);let painted=0;
    try{
      for(const request of [...this.pending.filter(showsNothing),...this.pending.filter(request=>!showsNothing(request))]){
        const baseMip=finest.get(request.key)!.baseMip,card=this.cards.get(request.key);
        if(!card||card.baseMip>baseMip){
          if(painted&&performance.now()>=deadline){
            const before=this.shownBefore.get(request.id),stand=card??(before&&this.cards.get(before.key));
            if(stand)this.instance(stand,request.matrix,request.id,request.foot,request.opacity,request.order);else this.bodiless++;
            continue;
          }
          painted++;
        }
        this.raster(request,renderer,baseMip,pendingLayers);
      }
    }finally{this.pending.length=0;}
    this.compact(renderer);
    this.frameDemand=this.frameKeys.size;this.peakFrameDemand=Math.max(this.peakFrameDemand,this.frameDemand);
    for(const page of [...this.pages]){
      if(!page.cards.some(card=>card?.used===this.frame)&&(!page.cards.some(Boolean)||this.frame-page.used>120||this.allocatedPixels>PIXEL_BUDGET))this.remove(page);
    }
    this.draw();
  }
  private attributes(geometry:THREE.PlaneGeometry,capacity:number){
    if(this.policy.transparent)geometry.setAttribute('cardOpacity',new THREE.InstancedBufferAttribute(new Float32Array(capacity),1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('cardRect',new THREE.InstancedBufferAttribute(new Float32Array(capacity*4),4).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('cardLayer',new THREE.InstancedBufferAttribute(new Float32Array(capacity),1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('cardBank',new THREE.InstancedBufferAttribute(new Float32Array(capacity),1).setUsage(THREE.DynamicDrawUsage));
  }
  private createChunk(banks:THREE.DataArrayTexture[],count:number,index:number){
    const material=new THREE.MeshBasicMaterial({map:banks[0]!,alphaTest:this.policy.alphaTest??.4,alphaToCoverage:this.policy.alphaToCoverage??false,side:THREE.DoubleSide,toneMapped:false,transparent:this.policy.transparent??false,depthWrite:this.policy.depthWrite??true,depthTest:true});
    const depth=new THREE.MeshDepthMaterial({map:banks[0]!,alphaTest:.4,side:THREE.DoubleSide,depthPacking:THREE.RGBADepthPacking});
    const distance=new THREE.MeshDistanceMaterial({map:banks[0]!,alphaTest:.4,side:THREE.DoubleSide});
    const refreshMaterials=[material,depth,distance].map(item=>configureCardMaterial(item,banks,this.maxTextureBanks,this.policy.transparent??false));
    const geometry=new THREE.PlaneGeometry(1,1),capacity=2**Math.ceil(Math.log2(count));this.attributes(geometry,capacity);
    const mesh=new THREE.InstancedMesh(geometry,material,capacity);
    const chunk:DrawChunk={banks,pages:[],entries:[],ids:[],feet:[],orders:[],geometry,material,depth,distance,mesh,capacity,used:this.frame,refreshMaterials};
    this.configureChunkMesh(chunk,index);this.chunks[index]=chunk;return chunk;
  }
  private configureChunkMesh(chunk:DrawChunk,index:number){
    const mesh=chunk.mesh;
    // Keep chunk ordering within the caller's pass level, e.g. remains -1 and
    // bodies 0. Every chunk follows native meshes at the same base level,
    // irrespective of bank count, cache state or material creation order.
    mesh.name='PaintedCards';mesh.castShadow=this.policy.castShadow??true;mesh.renderOrder=(this.policy.renderOrder??0)+.0001+.0009*index/(index+1);mesh.receiveShadow=true;mesh.customDepthMaterial=chunk.depth;mesh.customDistanceMaterial=chunk.distance;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.raycast=(raycaster,intersections)=>this.raycast(chunk,raycaster,intersections);
    mesh.userData.ids=chunk.ids;mesh.userData.cards=chunk.entries;mesh.userData.feet=chunk.feet;mesh.userData.orders=chunk.orders;mesh.userData.banks=chunk.pages;
    mesh.userData.paintedHit=(instance:number,uv?:{x:number;y:number})=>this.hit(chunk,instance,uv);
    this.drawGroup.add(mesh);
  }
  private resizeChunk(chunk:DrawChunk,count:number,index:number){
    this.drawGroup.remove(chunk.mesh);chunk.mesh.dispose();chunk.geometry.dispose();
    chunk.capacity=2**Math.ceil(Math.log2(count));this.attributes(chunk.geometry,chunk.capacity);
    chunk.mesh=new THREE.InstancedMesh(chunk.geometry,chunk.material,chunk.capacity);this.configureChunkMesh(chunk,index);
  }
  private hideChunk(chunk:DrawChunk){
    chunk.mesh.visible=false;chunk.mesh.count=0;
    chunk.entries.length=chunk.ids.length=chunk.feet.length=chunk.orders.length=chunk.pages.length=chunk.banks.length=0;
    for(const material of [chunk.material,chunk.depth,chunk.distance])material.map=null;
    for(const refresh of chunk.refreshMaterials)refresh();
  }
  /** Greedily retain the literal submission sequence. A ninth distinct page
   * starts a new draw; pages may recur in later draws without extra textures. */
  private draw(){
    // Instances in submission order, less those whose card is still waiting for its raster.
    const rows=this.drawRows;rows.length=0;
    for(let order=0;order<this.instanceOrder;order++){const row=this.instances[order];if(row?.card)rows.push(row);}
    let start=0,index=0;
    while(start<rows.length){
      const pageBanks=new Map<Page,number>();let end=start;
      while(end<rows.length){
        const card=rows[end]!.card!;
        if(!pageBanks.has(card.page)){
          if(pageBanks.size===this.maxTextureBanks)break;
          pageBanks.set(card.page,pageBanks.size);
        }
        end++;
      }
      let chunk=this.chunks[index];
      if(!chunk)chunk=this.createChunk([...pageBanks.keys()].map(page=>page.texture),end-start,index);
      chunk.banks.length=chunk.pages.length=0;
      for(const page of pageBanks.keys()){chunk.pages.push(page);chunk.banks.push(page.texture);}
      for(const material of [chunk.material,chunk.depth,chunk.distance])material.map=chunk.banks[0]!;
      for(const refresh of chunk.refreshMaterials)refresh();
      if(end-start>chunk.capacity)this.resizeChunk(chunk,end-start,index);
      const {mesh,geometry}=chunk,layers=geometry.getAttribute('cardLayer'),rects=geometry.getAttribute('cardRect'),banks=geometry.getAttribute('cardBank');let radius=0;
      chunk.entries.length=chunk.ids.length=chunk.feet.length=chunk.orders.length=0;chunk.used=this.frame;mesh.count=end-start;mesh.visible=true;
      for(let at=start;at<end;at++){
        const row=rows[at]!,card=row.card!,i=at-start;
        chunk.entries.push(card);chunk.ids.push(row.id);chunk.feet.push(row.foot);chunk.orders.push(row.order);
        // Preserve PlaneGeometry(...).translate(...) float32 vertices, keeping
        // mip interpolation and cutout edges on their original authored grid.
        const half=card.tileSize/2,low=Math.fround(Math.fround(-half/TILT)+row.foot/TILT),high=Math.fround(Math.fround(half/TILT)+row.foot/TILT);
        rects.setXYZW(i,-half,low,half,high);radius=Math.max(radius,Math.hypot(half,low),Math.hypot(half,high));
        mesh.setMatrixAt(i,row.matrix);layers.setX(i,card.layer);banks.setX(i,pageBanks.get(card.page)!);
        if(this.policy.transparent)geometry.getAttribute('cardOpacity').setX(i,row.opacity);
      }
      if(this.policy.transparent)geometry.getAttribute('cardOpacity').needsUpdate=true;
      rects.needsUpdate=layers.needsUpdate=banks.needsUpdate=mesh.instanceMatrix.needsUpdate=true;
      geometry.boundingSphere??=new THREE.Sphere();geometry.boundingSphere.center.set(0,0,0);geometry.boundingSphere.radius=radius;mesh.computeBoundingSphere();
      start=end;index++;
    }
    // Shadows traverse children directly; color passes sort renderOrder. Both
    // must see the identical chunk order even when a pooled mesh grows.
    for(let i=0;i<this.chunks.length;i++)this.drawGroup.children[i]=this.chunks[i]!.mesh;
    this.drawGroup.children.length=this.chunks.length;
    if(index){if(this.drawGroup.parent!==this.scene)this.scene.add(this.drawGroup);}
    // Idle chunks stay pooled, hidden, until dispose: disposing their materials would free the card shader programs, and
    // the first card drawn after a quiet spell (a corpse on a deck) would compile them again inside a frame.
    for(let i=index;i<this.chunks.length;i++)this.hideChunk(this.chunks[i]!);
  }
  private removeChunk(chunk:DrawChunk){
    this.hideChunk(chunk);this.drawGroup.remove(chunk.mesh);chunk.mesh.dispose();chunk.geometry.dispose();chunk.material.dispose();chunk.depth.dispose();chunk.distance.dispose();
    chunk.entries.length=chunk.ids.length=chunk.feet.length=chunk.orders.length=chunk.pages.length=chunk.banks.length=0;
  }
  /** With no retained pixels or painter closures, restoration deliberately
   * rebuilds visible cards from the next ordinary frame's current state. */
  invalidateGPU(){this.dispose();}
  private raycast(chunk:DrawChunk,raycaster:THREE.Raycaster,intersections:THREE.Intersection[]){
    if(this.policy.pickable===false)return;
    const mesh=chunk.mesh;if(!mesh.boundingSphere)mesh.computeBoundingSphere();
    if(!raycaster.ray.intersectsSphere(this.raySphere.copy(mesh.boundingSphere!).applyMatrix4(mesh.matrixWorld)))return;
    // GPU cardRect expands the canonical unit quad. Raycast the same authored
    // plane, then let paintedHit sample the identical source alpha texel.
    for(let i=0;i<mesh.count;i++){
      const card=chunk.entries[i]!,half=card.tileSize/2,foot=chunk.feet[i]!;
      const low=Math.fround(Math.fround(-half/TILT)+foot/TILT),high=Math.fround(Math.fround(half/TILT)+foot/TILT);
      this.offset.makeScale(card.tileSize,high-low,1).setPosition(0,(high+low)/2,0);
      mesh.getMatrixAt(i,this.matrix);this.rayProbe.matrixWorld.copy(mesh.matrixWorld).multiply(this.matrix).multiply(this.offset);
      this.rayHits.length=0;this.rayProbe.raycast(raycaster,this.rayHits);
      for(const hit of this.rayHits){hit.instanceId=i;hit.object=mesh;intersections.push(hit);}
    }
  }
  private hit(chunk:DrawChunk,index:number,uv?:{x:number;y:number}){
    const card=chunk.entries[index];if(this.policy.pickable===false||!card||!uv)return false;
    return cardMaskHit(this.mask(card),card.sourceSize,card.sourceSize,uv);
  }
  objects(){return this.chunks.filter(chunk=>chunk.mesh.visible).map(chunk=>chunk.mesh);}
  // Owned typed-array and texture storage estimates, not total process RSS or
  // Canvas backing stores. cpuBytes excludes scratch for existing consumers.
  stats(){
    let secondDemand=0;for(const [key,at] of this.askedAt){if(this.frame-at>=60)this.askedAt.delete(key);else secondDemand++;}
    const pixels=this.allocatedPixels,transfer=this.mipUploader.stats();
    const bytes=(page:Page)=>page.mipBytes;
    const gpuBytes=Math.ceil(pixels*4*4/3),allocatedMipBytes=this.pages.reduce((sum,page)=>sum+bytes(page),0),retiredGpuBytes=[...this.retiring].reduce((sum,page)=>sum+(page.uploaded?bytes(page):0),0);
    const drawBufferBytes=this.chunks.reduce((sum,chunk)=>sum+chunk.mesh.instanceMatrix.array.byteLength+Object.values(chunk.geometry.attributes).reduce((total,attribute)=>total+attribute.array.byteLength,0)+(chunk.geometry.index?.array.byteLength??0),0);
    const cpuBytes=this.maskBytes+this.pendingMaskBytes+this.pendingRgbaBytes+this.rowScratch.byteLength+this.emptyRgba.byteLength;
    return{pages:this.pages.length,cards:this.cards.size,pixels,drawChunks:this.chunks.filter(chunk=>chunk.mesh.visible).length,pooledDrawChunks:this.chunks.length,drawCapacity:this.chunks.reduce((sum,chunk)=>sum+chunk.capacity,0),drawBufferBytes,maxTextureBanks:this.maxTextureBanks,arrayCpuBytes:0,cpuBytes,gpuBytes,allocatedMipBytes,canvasBackingBytes:[...this.canvases.values()].reduce((sum,canvas)=>sum+canvas.width*canvas.height*4,0),maskBytes:this.maskBytes,pendingMaskBytes:this.pendingMaskBytes,pendingRgbaBytes:this.pendingRgbaBytes,rowScratchBytes:this.rowScratch.byteLength,retiredGpuBytes,rasterCache:this.rasterCache.stats(),ownedCpuBytes:cpuBytes+transfer.scratchCpuBytes+this.rasterCache.stats().ownedBytes,ownedGpuBytes:this.pages.reduce((sum,page)=>sum+(page.uploaded?bytes(page):0),0)+transfer.scratchGpuBytes,peakPendingRgbaBytes:this.peakPendingRgbaBytes,peakOwnedCpuBytes:this.peakOwnedCpuBytes,peakOwnedGpuBytes:this.peakOwnedGpuBytes,peakRetiredGpuBytes:this.peakRetiredGpuBytes,rasterizations:this.rasterizations,bodiless:this.bodiless,lazyMasks:this.lazyMasks,evictions:this.evictions,frameDemand:this.frameDemand,peakFrameDemand:this.peakFrameDemand,secondDemand,preparedRasters:this.preparedRasters,copiedLayers:this.copiedLayers,rasterStages:{...this.rasterStages},rasterWorkWallMs:this.rasterWorkWallMs,...transfer};
  }
  private recordPeaks(){
    // Sampling occurs several times per raster. Preserve the same ownership and
    // sample points without rebuilding unrelated draw/Canvas/public counters.
    const transfer=this.mipUploader.stats(),cpuBytes=this.maskBytes+this.pendingMaskBytes+this.pendingRgbaBytes+this.rowScratch.byteLength+this.emptyRgba.byteLength;
    const ownedCpuBytes=cpuBytes+transfer.scratchCpuBytes+this.rasterCache.stats().ownedBytes;
    let ownedGpuBytes=transfer.scratchGpuBytes,retiredGpuBytes=0;
    for(const page of this.pages)if(page.uploaded)ownedGpuBytes+=page.mipBytes;
    for(const page of this.retiring)if(page.uploaded)retiredGpuBytes+=page.mipBytes;
    this.peakPendingRgbaBytes=Math.max(this.peakPendingRgbaBytes,this.pendingRgbaBytes);this.peakOwnedCpuBytes=Math.max(this.peakOwnedCpuBytes,ownedCpuBytes);this.peakOwnedGpuBytes=Math.max(this.peakOwnedGpuBytes,ownedGpuBytes);this.peakRetiredGpuBytes=Math.max(this.peakRetiredGpuBytes,retiredGpuBytes);
  }
  private remove(page:Page){
    const sourceSizes=new Set(page.cards.flatMap(card=>card?[card.sourceSize]:[]));
    for(const card of page.cards)if(card&&this.cards.get(card.key)===card){this.evictions++;this.cards.delete(card.key);this.maskBytes-=card.mask?.byteLength??0;}
    page.texture.dispose();this.pages.splice(this.pages.indexOf(page),1);this.allocatedPixels-=page.texture.image.width*page.texture.image.height*page.texture.image.depth;
    // Resident arrays can be smaller than their full-resolution scratch, and
    // different source sizes can share an identically sized resident page.
    for(const size of sourceSizes)if(!this.pages.some(other=>other.cards.some(card=>card?.sourceSize===size)))this.mipUploader.releaseSize(size,size);
  }
  dispose(){
    for(const chunk of this.chunks)this.removeChunk(chunk);this.chunks.length=0;this.scene.remove(this.drawGroup);this.instances.length=0;this.bindings.clear();
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
