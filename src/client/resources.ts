export type ResourcePhase = 'startup' | 'home' | 'match';
export type ResourceEntry = { url:string; label:string; phases:Set<ResourcePhase>; expected:number|undefined; loaded:number; state:'loading'|'ready'|'failed'; elapsed:number; error?:string };
export type ResourceManifest = { assets:{url:string;bytes:number;kind:string;stage:string;revision?:string}[] };
type Fetcher = typeof fetch;

/** One request per URL, shared across phases. Counts bytes read from the response,
 * not simulated timer progress; unknown lengths remain explicitly unknown. */
export class ResourceLoader {
  readonly entries=new Map<string,ResourceEntry>();
  phase:ResourcePhase='startup';
  private manifest:ResourceManifest={assets:[]};
  private requests=new Map<string,Promise<ArrayBuffer>>();
  private images=new Map<string,Promise<CanvasImageSource>>();
  private listeners=new Set<()=>void>();
  private active=0;
  private waiting:(()=>void)[]=[];
  constructor(readonly base:string,private fetcher:Fetcher|undefined=undefined,private clock:()=>number=()=>performance.now()){}
  subscribe(listener:()=>void){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  private changed(){for(const listener of this.listeners)listener();}
  private async slot(){if(this.active>=4)await new Promise<void>(resolve=>this.waiting.push(resolve));else this.active++;}
  private release(){const next=this.waiting.shift();if(next)next();else this.active--;}
  url(path:string){const asset=this.manifest.assets.find(asset=>asset.url===path);return `${this.base}${path}${asset?.revision&&['model','texture'].includes(asset.kind)?`?v=${asset.revision}`:''}`;}
  size(url:string){return this.manifest.assets.find(asset=>this.url(asset.url)===url)?.bytes;}
  async initialize(){try{this.manifest=JSON.parse(new TextDecoder().decode(await this.bytes(this.url('resource-manifest.json'),resourceText('资源目录','Resource catalog'),'startup')));}catch{/* Development and older hosts can report actual bytes without a manifest. */}}
  async warm(stage:string,phase:ResourcePhase){await Promise.all(this.manifest.assets.filter(asset=>asset.stage===stage).map(asset=>this.bytes(this.url(asset.url),asset.url,phase)));}
  bytes(url:string,label=url,phase:ResourcePhase=this.phase):Promise<ArrayBuffer>{
    const existing=this.entries.get(url);if(existing){existing.phases.add(phase);this.changed();}
    const known=this.requests.get(url);if(known)return known;
    const entry:ResourceEntry={url,label,phases:existing?.phases??new Set([phase]),expected:this.size(url),loaded:0,state:'loading',elapsed:0};
    this.entries.set(url,entry);this.changed();
    const request=(async()=>{
      await this.slot();const start=this.clock();
      try{
        const response=await (this.fetcher??fetch)(url,{cache:/\.json(?:\?|$)/.test(url)?'no-cache':'force-cache'});
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const length=Number(response.headers.get('content-length'));
        if(entry.expected===undefined && !response.headers.get('content-encoding') && length>0)entry.expected=length;
        let data:ArrayBuffer;
        if(response.body){
          const reader=response.body.getReader(),chunks:Uint8Array[]=[];
          while(true){const result=await reader.read();if(result.done)break;chunks.push(result.value);entry.loaded+=result.value.byteLength;entry.elapsed=this.clock()-start;this.changed();}
          const joined=new Uint8Array(entry.loaded);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}data=joined.buffer;
        }else{data=await response.arrayBuffer();entry.loaded=data.byteLength;}
        entry.expected=data.byteLength;entry.state='ready';return data;
      }catch(error){entry.state='failed';entry.error=error instanceof Error?error.message:String(error);this.requests.delete(url);throw error;}
      finally{entry.elapsed=this.clock()-start;this.release();this.changed();}
    })();
    this.requests.set(url,request);return request;
  }
  image(url:string,label=url,phase:ResourcePhase=this.phase){
    // Register shared use even if the decoded bitmap already exists.
    const data=this.bytes(url,label,phase);
    let image=this.images.get(url);if(!image){image=data.then(async buffer=>{
      const blob=new Blob([buffer]);if(typeof createImageBitmap==='function')return createImageBitmap(blob);
      const address=URL.createObjectURL(blob);try{return await new Promise<HTMLImageElement>((resolve,reject)=>{const bitmap=new Image();bitmap.onload=()=>resolve(bitmap);bitmap.onerror=()=>reject(new Error(`无法解码 ${label}`));bitmap.src=address;});}finally{URL.revokeObjectURL(address);}
    }).catch(error=>{this.images.delete(url);throw error;});this.images.set(url,image);}return image;
  }
  summary(phase:ResourcePhase){
    const entries=[...this.entries.values()].filter(entry=>entry.phases.has(phase));
    const loaded=entries.reduce((sum,entry)=>sum+entry.loaded,0),total=entries.reduce((sum,entry)=>sum+(entry.expected??0),0);
    const unknown=entries.some(entry=>entry.expected===undefined);
    const reused=entries.filter(entry=>entry.state==='ready'&&entry.phases.values().next().value!==phase).reduce((sum,entry)=>sum+entry.loaded,0);
    return{entries,loaded,total,unknown,reused,ready:entries.filter(entry=>entry.state==='ready').length,failed:entries.filter(entry=>entry.state==='failed').length};
  }
}
export function resourceSize(bytes:number){return bytes<1024?`${bytes} B`:bytes<1024*1024?`${(bytes/1024).toFixed(1)} KiB`:`${(bytes/1024/1024).toFixed(2)} MiB`;}
export const resources=new ResourceLoader((import.meta as ImportMeta & {env?:{BASE_URL?:string}}).env?.BASE_URL??'/');

export function resourceText(zh:string,en:string){return typeof navigator!=='undefined' && [...(navigator.languages.length?navigator.languages:[navigator.language])].some(language=>language.toLowerCase().startsWith('zh'))?zh:en;}
