export type ResourcePhase = 'startup' | 'home' | 'match';
export type ResourceEntry = { url:string; label:string; phases:Set<ResourcePhase>; expected:number|undefined; loaded:number; state:'loading'|'ready'|'failed'; elapsed:number; error?:string };
export type ResourceManifest = { assets:{url:string;bytes:number;kind:string;stage:string;revision?:string}[] };
type Fetcher = typeof fetch;

/** In-flight and retained byte requests are shared across phases. Counts bytes read from the response,
 * not simulated timer progress; unknown lengths remain explicitly unknown. */
export class ResourceLoader {
  readonly entries=new Map<string,ResourceEntry>();
  phase:ResourcePhase='startup';
  private assetsByPath=new Map<string,ResourceManifest['assets'][number]>();
  private sizesByUrl=new Map<string,number>();
  private assetsByStage=new Map<string,ResourceManifest['assets']>();
  private requests=new Map<string,Promise<ArrayBuffer>>();
  private retainedBytes=new Map<string,number>();
  private images=new Map<string,Promise<CanvasImageSource>>();
  private decodedImages=new Map<string,CanvasImageSource>();
  private controllers=new Set<AbortController>();
  private generation=0;
  private listeners=new Set<()=>void>();
  private notificationQueued=false;
  private progressTimer:ReturnType<typeof setTimeout>|undefined;
  private active=0;
  private waiting:(()=>void)[]=[];
  constructor(readonly base:string,private fetcher:Fetcher|undefined=undefined,private clock:()=>number=()=>performance.now()){}
  subscribe(listener:()=>void){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  private changed(){
    if(this.progressTimer!==undefined){clearTimeout(this.progressTimer);this.progressTimer=undefined;}
    if(this.notificationQueued || !this.listeners.size)return;
    this.notificationQueued=true;const generation=this.generation;
    queueMicrotask(()=>{if(generation!==this.generation)return;this.notificationQueued=false;for(const listener of this.listeners)listener();});
  }
  private progressChanged(){
    if(this.progressTimer!==undefined || !this.listeners.size)return;
    this.progressTimer=setTimeout(()=>{this.progressTimer=undefined;this.changed();},32);
  }
  private async slot(){if(this.active>=4)await new Promise<void>(resolve=>this.waiting.push(resolve));else this.active++;}
  private release(){const next=this.waiting.shift();if(next)next();else this.active--;}
  url(path:string){const asset=this.assetsByPath.get(path);return `${this.base}${path}${asset?.revision&&(asset.kind==='model'||asset.kind==='texture')?`?v=${asset.revision}`:''}`;}
  size(url:string){return this.sizesByUrl.get(url);}
  async initialize(){
    const generation=this.generation,url=this.url('resource-manifest.json');
    const request=this.bytes(url,resourceText('资源目录','Resource catalog'),'startup');
    try{
      const manifest:ResourceManifest=JSON.parse(new TextDecoder().decode(await request));
      if(generation!==this.generation)return;
      const byPath=new Map<string,ResourceManifest['assets'][number]>(),byStage=new Map<string,ResourceManifest['assets']>();
      for(const asset of manifest.assets){byPath.set(asset.url,asset);const stage=byStage.get(asset.stage)??[];stage.push(asset);byStage.set(asset.stage,stage);}
      this.assetsByPath=byPath;this.assetsByStage=byStage;
      this.sizesByUrl=new Map(manifest.assets.map(asset=>[this.url(asset.url),asset.bytes]));
    }catch{/* Development and older hosts can report actual bytes without a manifest. */}
    finally{this.releaseBytes(url,request);}
  }
  async warm(stage:string,phase:ResourcePhase){
    await Promise.all((this.assetsByStage.get(stage)??[]).map(asset=>{
      const url=this.url(asset.url),browserOwned=asset.kind==='code'||asset.kind==='style'||asset.kind==='font';
      // These resources are consumed by import/CSS, which already owns their
      // decoded data. Their fetch only primes HTTP cache, not a second JS buffer cache.
      if(browserOwned&&this.entries.get(url)?.state==='ready'){this.recordUse(url,phase);return;}
      const request=this.bytes(url,asset.url,phase);
      return browserOwned?request.finally(()=>this.releaseBytes(url,request)):request;
    }));
  }
  /** Register reuse of a decoded resource without starting another byte request. */
  recordUse(url:string,phase:ResourcePhase=this.phase){const entry=this.entries.get(url);if(entry&&!entry.phases.has(phase)){entry.phases.add(phase);this.changed();}}
  /** Decoders own their results. Releasing a completed byte cache never affects
   * callers already awaiting the same request; a later byte consumer can use HTTP cache. */
  releaseBytes(url:string,request?:Promise<ArrayBuffer>){if(request&&this.requests.get(url)!==request)return;if(this.retainedBytes.delete(url))this.requests.delete(url);}
  cacheStats(){return{requests:this.requests.size,images:this.images.size,retainedBytes:[...this.retainedBytes.values()].reduce((sum,bytes)=>sum+bytes,0),active:this.active,queued:this.waiting.length};}
  /** Application teardown only: renderer owners share these request/decode caches. */
  dispose(){
    this.generation++;for(const controller of this.controllers)controller.abort();
    if(this.progressTimer!==undefined)clearTimeout(this.progressTimer);this.progressTimer=undefined;this.notificationQueued=false;
    for(const image of this.decodedImages.values())closeImage(image);
    this.images.clear();this.decodedImages.clear();this.requests.clear();this.retainedBytes.clear();this.entries.clear();this.listeners.clear();
    this.assetsByPath.clear();this.sizesByUrl.clear();this.assetsByStage.clear();
  }
  bytes(url:string,label=url,phase:ResourcePhase=this.phase):Promise<ArrayBuffer>{
    const existing=this.entries.get(url);this.recordUse(url,phase);
    const known=this.requests.get(url);if(known)return known;
    const entry:ResourceEntry={url,label,phases:existing?.phases??new Set([phase]),expected:this.size(url),loaded:0,state:'loading',elapsed:0};
    this.entries.set(url,entry);this.changed();
    const generation=this.generation,controller=new AbortController();
    let request!:Promise<ArrayBuffer>;request=(async()=>{
      await this.slot();const start=this.clock();
      try{
        if(generation!==this.generation)throw new Error('Resource loader was disposed');
        this.controllers.add(controller);
        const response=await (this.fetcher??fetch)(url,{cache:/\.json(?:\?|$)/.test(url)?'no-cache':'force-cache',signal:controller.signal});
        if(generation!==this.generation)throw new Error('Resource loader was disposed');
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const length=Number(response.headers.get('content-length'));
        if(entry.expected===undefined && !response.headers.get('content-encoding') && length>0)entry.expected=length;
        let data:ArrayBuffer;
        if(response.body){
          const reader=response.body.getReader(),chunks:Uint8Array[]=[],cancel=()=>{void reader.cancel().catch(()=>{});};
          controller.signal.addEventListener('abort',cancel,{once:true});
          try{while(true){const result=await reader.read();if(result.done)break;chunks.push(result.value);entry.loaded+=result.value.byteLength;entry.elapsed=this.clock()-start;this.progressChanged();}}
          finally{controller.signal.removeEventListener('abort',cancel);reader.releaseLock();}
          if(generation!==this.generation)throw new Error('Resource loader was disposed');
          const joined=new Uint8Array(entry.loaded);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}data=joined.buffer;
        }else{data=await response.arrayBuffer();entry.loaded=data.byteLength;}
        if(generation!==this.generation)throw new Error('Resource loader was disposed');
        entry.expected=data.byteLength;entry.state='ready';this.retainedBytes.set(url,data.byteLength);return data;
      }catch(error){entry.state='failed';entry.error=error instanceof Error?error.message:String(error);if(this.requests.get(url)===request)this.requests.delete(url);throw error;}
      finally{this.controllers.delete(controller);entry.elapsed=this.clock()-start;this.release();if(generation===this.generation)this.changed();}
    })();
    this.requests.set(url,request);return request;
  }
  image(url:string,label=url,phase:ResourcePhase=this.phase){
    // Register shared use even if the decoded bitmap already exists.
    this.recordUse(url,phase);
    let image=this.images.get(url);if(!image){const generation=this.generation,request=this.bytes(url,label,phase);image=request.then(async buffer=>{
      const blob=new Blob([buffer]);let bitmap:CanvasImageSource;
      if(typeof createImageBitmap==='function')bitmap=await createImageBitmap(blob);
      else{const address=URL.createObjectURL(blob);try{bitmap=await new Promise<HTMLImageElement>((resolve,reject)=>{const bitmap=new Image();bitmap.onload=()=>resolve(bitmap);bitmap.onerror=()=>reject(new Error(`无法解码 ${label}`));bitmap.src=address;});}finally{URL.revokeObjectURL(address);}}
      if(generation!==this.generation){closeImage(bitmap);throw new Error('Resource loader was disposed');}
      this.decodedImages.set(url,bitmap);return bitmap;
    }).catch(error=>{if(this.images.get(url)===image)this.images.delete(url);throw error;}).finally(()=>this.releaseBytes(url,request));this.images.set(url,image);}return image;
  }
  summary(phase:ResourcePhase){
    const entries=[...this.entries.values()].filter(entry=>entry.phases.has(phase));
    const loaded=entries.reduce((sum,entry)=>sum+entry.loaded,0),total=entries.reduce((sum,entry)=>sum+(entry.expected??0),0);
    const unknown=entries.some(entry=>entry.expected===undefined);
    const reused=entries.filter(entry=>entry.state==='ready'&&entry.phases.values().next().value!==phase).reduce((sum,entry)=>sum+entry.loaded,0);
    return{entries,loaded,total,unknown,reused,ready:entries.filter(entry=>entry.state==='ready').length,failed:entries.filter(entry=>entry.state==='failed').length};
  }
}
function closeImage(image:CanvasImageSource){if('close' in image && typeof image.close==='function')image.close();}
export function resourceSize(bytes:number){return bytes<1024?`${bytes} B`:bytes<1024*1024?`${(bytes/1024).toFixed(1)} KiB`:`${(bytes/1024/1024).toFixed(2)} MiB`;}
export const resources=new ResourceLoader((import.meta as ImportMeta & {env?:{BASE_URL?:string}}).env?.BASE_URL??'/');

export function resourceText(zh:string,en:string){return typeof navigator!=='undefined' && [...(navigator.languages.length?navigator.languages:[navigator.language])].some(language=>language.toLowerCase().startsWith('zh'))?zh:en;}
