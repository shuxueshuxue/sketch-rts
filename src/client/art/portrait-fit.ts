import {createScratchCanvas} from './scratch-canvas';
type Art={canvas:HTMLCanvasElement;x:number;y:number;width:number;height:number};

/** Owns only UI portrait pixels. Draws finish synchronously; nested painters
 * receive separate work surfaces and cannot retire a parent's borrowed image. */
export class FittedPortraitCache {
  private cache=new Map<string,Art>();
  private work:HTMLCanvasElement[]=[];
  private leased=new Map<HTMLCanvasElement,number>();
  private retired=new Set<HTMLCanvasElement>();
  private epoch=0;
  constructor(private budget=12*1024*1024,private limit=96){}
  private retire(canvas:HTMLCanvasElement){
    if(this.leased.has(canvas))this.retired.add(canvas);
    else canvas.width=canvas.height=1;
  }
  private lease(canvas:HTMLCanvasElement){this.leased.set(canvas,(this.leased.get(canvas)??0)+1);}
  private release(canvas:HTMLCanvasElement){
    const count=this.leased.get(canvas)??0;if(count>1){this.leased.set(canvas,count-1);return;}
    this.leased.delete(canvas);
    if(this.retired.delete(canvas))this.retire(canvas);
  }
  draw(ctx:CanvasRenderingContext2D,key:string,paint:(ctx:CanvasRenderingContext2D)=>void,x:number,y:number,width:number,height:number,bust=false){
    let art=this.cache.get(key),source:HTMLCanvasElement|undefined;
    const epoch=this.epoch;
    try{
      if(!art){
        source=this.work.pop()??createScratchCanvas(512,512);this.lease(source);
        const brush=source.getContext('2d')!;
        // Keep the original fresh-canvas defaults, including miter joins and
        // the alpha>8/bust measurement. Do not borrow world raster settings.
        if(typeof brush.reset==='function')brush.reset();else source.width=512;
        brush.translate(256,256);brush.scale(4,4);paint(brush);
        const data=brush.getImageData(0,0,512,512).data;
        const bounds=(limit=512)=>{let left=512,top=512,right=0,bottom=0;
          for(let py=0;py<limit;py++)for(let px=0;px<512;px++)if(data[(py*512+px)*4+3]!>8){left=Math.min(left,px);right=Math.max(right,px);top=Math.min(top,py);bottom=Math.max(bottom,py);}
          return{x:left,y:top,width:Math.max(1,right-left+1),height:Math.max(1,bottom-top+1)};
        };
        let box=bounds();if(bust)box=bounds(Math.round(box.y+box.height*.65));
        const cropped=createScratchCanvas(box.width,box.height);this.lease(cropped);
        art={canvas:cropped,x:0,y:0,width:box.width,height:box.height};
        cropped.getContext('2d')!.drawImage(source,box.x,box.y,box.width,box.height,0,0,box.width,box.height);
        const prior=this.cache.get(key);
        if(epoch===this.epoch && prior){this.cache.delete(key);this.retire(prior.canvas);}
        let pixels=[...this.cache.values()].reduce((sum,value)=>sum+value.width*value.height,0);
        const cost=box.width*box.height;
        while(epoch===this.epoch && this.cache.size && (this.cache.size>=this.limit || pixels+cost>this.budget)){
          const oldest=this.cache.keys().next().value!,value=this.cache.get(oldest)!;
          pixels-=value.width*value.height;this.cache.delete(oldest);this.retire(value.canvas);
        }
        if(epoch===this.epoch && cost<=this.budget && this.limit>0)this.cache.set(key,art);
        else this.retire(cropped);
      }else this.lease(art.canvas);
      const scale=Math.min(width/art.width,height/art.height)*.94,w=art.width*scale,h=art.height*scale;
      ctx.drawImage(art.canvas,art.x,art.y,art.width,art.height,x+(width-w)/2,y+(height-h)/2,w,h);
    }finally{
      if(art){if(this.cache.get(key)!==art)this.retire(art.canvas);this.release(art.canvas);}
      if(source){this.release(source);if(epoch===this.epoch && this.work.length<4)this.work.push(source);else this.retire(source);}
    }
  }
  clear(){
    this.epoch++;
    for(const art of this.cache.values())this.retire(art.canvas);
    for(const canvas of this.work)this.retire(canvas);
    this.cache.clear();this.work.length=0;
  }
  stats(){
    const cached=new Set([...this.cache.values()].map(art=>art.canvas));
    const owned=new Set([...cached,...this.work,...this.leased.keys(),...this.retired]);
    const bytes=(canvases:Iterable<HTMLCanvasElement>)=>{let n=0;for(const canvas of canvases)n+=canvas.width*canvas.height*4;return n;};
    return{entries:this.cache.size,cacheBytes:bytes(cached),workCanvases:this.work.length,workBytes:bytes(this.work),leasedCanvases:this.leased.size,leasedBytes:bytes(this.leased.keys()),retiredCanvases:this.retired.size,retiredBytes:bytes(this.retired),ownedCanvasBytes:bytes(owned)};
  }
}
const portraits=new FittedPortraitCache();
/** Measure painted pixels once, then fit the subject to any UI rectangle. */
export const drawFittedPortrait=portraits.draw.bind(portraits);
export const clearFittedPortraits=()=>portraits.clear();
export const fittedPortraitStats=()=>portraits.stats();
