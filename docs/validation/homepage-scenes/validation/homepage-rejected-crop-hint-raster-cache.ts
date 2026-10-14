import { createScratchCanvas } from './scratch-canvas';

export const ART_TILE_SIZE=128;
export const ART_ACTION_SIZE=176;

type Raster = { canvas: HTMLCanvasElement; x: number; y: number; density: number };

/** Keep the authored resolution and anchor, but retain only painted pixels.
 * Bounded work-surface and crop pools reuse backing stores across cache misses.
 * Returned rasters are borrowed for immediate drawing, until the next top-level
 * get() or clear(); nested painters keep their borrowed rasters until they return.
 * Transparent padding is not part of the retained entry budget. */
export class RasterCache {
  private entries = new Map<string, Raster>();
  private scratch: HTMLCanvasElement[] = [];
  private spare: HTMLCanvasElement[] = [];
  private retired: HTMLCanvasElement[] = [];
  private depth = 0;
  private leased = new Set<HTMLCanvasElement>();
  private epoch = 0;
  private pixels = 0;

  private hits = 0;
  private misses = 0;
  private evictions = 0;
  constructor(private budget = 12 * 1024 * 1024, private limit = 1024) {}

  get(key: string, density: number, paint: (brush: CanvasRenderingContext2D) => void, tileSize:number=ART_TILE_SIZE): Raster {
    if(!this.depth)this.recycleRetired();
    const id = `${key}:${density}:${tileSize}`;
    const cached = this.entries.get(id);
    if (cached) {
      this.hits++;
      this.entries.delete(id); this.entries.set(id, cached);
      return cached;
    }
    this.misses++;
    const origin=tileSize/2,size = tileSize * density;
    const epoch=this.epoch,source=this.take(this.scratch,size,size);
    this.leased.add(source);
    const brush=this.reset(source,true);
    brush.scale(density,density);brush.translate(origin,origin);
    brush.lineJoin=brush.lineCap='round';
    this.depth++;
    try {
      paint(brush);
      const rgba = brush.getImageData(0, 0, size, size).data;
      let left = size, top = size, right = -1, bottom = -1;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (rgba[(y * size + x) * 4 + 3]) {
          if (x < left) left = x; if (x > right) right = x;
          if (y < top) top = y; if (y > bottom) bottom = y;
        }
      }
      if (right < left) { left = top = 0; right = bottom = 0; }
      // Two clear texels preserve bilinear filtering at the original cutout edge.
      left = Math.max(0, left - 2); top = Math.max(0, top - 2);
      right = Math.min(size - 1, right + 2); bottom = Math.min(size - 1, bottom + 2);
      const canvas = this.take(this.spare,right-left+1,bottom-top+1);
      // Crops feed CPU card painters as well as Canvas display. Request the
      // readback path when their first context is created, avoiding a cold
      // card's synchronous GPU crop readback in browsers that accelerate it.
      this.reset(canvas,true).drawImage(source,left,top,canvas.width,canvas.height,0,0,canvas.width,canvas.height);
      const result = { canvas, x: left / density - origin, y: top / density - origin, density };
      const cost = canvas.width * canvas.height;
      while (epoch===this.epoch && cost<=this.budget && this.entries.size && (this.entries.size >= this.limit || this.pixels + cost > this.budget)) {
        const oldest = this.entries.keys().next().value!;
        const old = this.entries.get(oldest)!;
        this.pixels -= old.canvas.width * old.canvas.height;
        this.entries.delete(oldest); this.evictions++;this.retired.push(old.canvas);
      }
      // An oversized one-off image is still drawn, without displacing the budget
      // indefinitely or pretending it is a retained cache entry.
      if (epoch===this.epoch && cost <= this.budget) { this.entries.set(id, result); this.pixels += cost; }
      else this.retired.push(canvas);
      return result;
    } finally {
      this.depth--;
      this.leased.delete(source);
      if(epoch===this.epoch)this.put(this.scratch,source,4,4*1024*1024);else this.release(source);
    }
  }
  private take(pool:HTMLCanvasElement[],width:number,height:number){
    const index=pool.findIndex(canvas=>canvas.width===width&&canvas.height===height);
    return index<0?createScratchCanvas(width,height):pool.splice(index,1)[0]!;
  }
  private reset(canvas:HTMLCanvasElement,read=false){
    const ctx=canvas.getContext('2d',read?{willReadFrequently:true}:undefined)!;
    // reset clears pixels, clips, the current path and the entire save stack.
    // Older browser contexts use one dimension assignment for the same semantics.
    if(typeof ctx.reset==='function')ctx.reset();else canvas.width=canvas.width;
    return ctx;
  }
  private release(canvas:HTMLCanvasElement){canvas.width=1;canvas.height=1;}
  private put(pool:HTMLCanvasElement[],canvas:HTMLCanvasElement,limit:number,budget:number){
    const cost=canvas.width*canvas.height;
    if(cost>budget){this.release(canvas);return;}
    while(pool.length&&(pool.length>=limit||pool.reduce((sum,c)=>sum+c.width*c.height,0)+cost>budget))this.release(pool.shift()!);
    pool.push(canvas);
  }
  private recycleRetired(){
    // A parent painter may still use a nested result. Retire only between
    // top-level requests, after the preceding result has been drawn by its caller.
    for(const canvas of this.retired)this.put(this.spare,canvas,8,1024*1024);
    this.retired.length=0;
  }
  stats() {
    const pixels=(canvases:Iterable<HTMLCanvasElement>)=>{let sum=0;for(const canvas of canvases)sum+=canvas.width*canvas.height;return sum;};
    const scratchPixels=pixels(this.scratch),sparePixels=pixels(this.spare),retiredPixels=pixels(this.retired),leasedPixels=pixels(this.leased);
    return {entries:this.entries.size,pixels:this.pixels,bytes:this.pixels*4,hits:this.hits,misses:this.misses,evictions:this.evictions,
      scratchCanvases:this.scratch.length,scratchPixels,scratchBytes:scratchPixels*4,
      spareCanvases:this.spare.length,sparePixels,spareBytes:sparePixels*4,
      retiredCanvases:this.retired.length,retiredPixels,retiredBytes:retiredPixels*4,
      leasedCanvases:this.leased.size,leasedPixels,leasedBytes:leasedPixels*4,
      ownedCanvasBytes:(this.pixels+scratchPixels+sparePixels+retiredPixels+leasedPixels)*4};
  }
  clear() {
    // Active painters retain their lease and finish safely; finally disposes
    // leases from the old epoch instead of repopulating the cleared pool.
    this.epoch++;
    for(const canvas of [...this.entries.values()].map(value=>value.canvas).concat(this.scratch,this.spare,this.retired))this.release(canvas);
    this.entries.clear();this.scratch.length=this.spare.length=this.retired.length=0;
    this.pixels=0;this.hits=this.misses=this.evictions=0;
  }
}
