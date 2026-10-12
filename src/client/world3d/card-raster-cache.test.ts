import {expect,it} from 'vitest';
import {CardRasterCache} from './card-raster-cache';
it('preserves all RGBA bytes, low alpha, transparent colours and row offsets',()=>{
 for(const width of [1,3,128,176]){
  const height=19,rgba=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if((x+y)%5===0){const i=(y*width+x)*4;rgba.set([x%256,y*7,(x*y)%256,(x+y)%3],i);}
  const cache=new CardRasterCache();cache.put('pose',rgba,width,height);expect(cache.get('pose')).toEqual(rgba);
  const first=cache.get('pose')!;first.fill(255);expect(cache.get('pose')).toEqual(rgba);
 }
});
it('never retains caller arrays and obeys byte and entry limits with LRU eviction',()=>{
 const cache=new CardRasterCache(50),rgba=new Uint8ClampedArray([1,2,3,4]);
 for(const id of ['a','b','c'])cache.put(id,rgba,1,1);
 expect(cache.get('a')).toEqual(rgba);cache.put('d',rgba,1,1);expect(cache.get('b')).toBeUndefined();
 rgba.fill(0);expect(cache.get('a')).toEqual(new Uint8ClampedArray([1,2,3,4]));expect(cache.stats().bytes).toBeLessThanOrEqual(50);
 cache.clear();expect(cache.stats().bytes).toBe(0);expect(cache.stats().entries).toBe(0);
 for(let i=0;i<1100;i++)cache.put(String(i),rgba,1,1);expect(cache.stats().entries).toBe(1024);
});
it('skips oversized entries and supports unaligned source views',()=>{
 const rgba=new Uint8ClampedArray(new ArrayBuffer(17),1,16);rgba.fill(128);
 const cache=new CardRasterCache(100);cache.put('offset',rgba,2,2);expect(cache.get('offset')).toEqual(rgba);
 const small=new CardRasterCache(1);small.put('big',rgba,2,2);expect(small.stats().bytes).toBe(0);
});
it('round-trips mixed literal and repeated runs without scratch overflow',()=>{
 let seed=137;const next=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
 for(let sample=0;sample<120;sample++){
  const width=1+next()%180,height=1+next()%21,rgba=new Uint8ClampedArray(width*height*4),words=new Uint32Array(rgba.buffer);
  for(let i=0;i<words.length;){const count=1+next()%9,value=next()%4===0?0:next();words.fill(value,i,Math.min(words.length,i+count));i+=count;}
  const cache=new CardRasterCache();cache.put('mixed',rgba,width,height);expect(cache.get('mixed')).toEqual(rgba);cache.clear();expect(cache.stats().ownedBytes).toBe(0);
 }
});
it('releases an unprofitable scanning workload instead of retaining its full budget',()=>{
 const cache=new CardRasterCache(64),rgba=new Uint8ClampedArray([1,2,3,255]);
 for(let i=0;i<40;i++){cache.get(String(i));cache.put(String(i),rgba,1,1,0);}
 expect(cache.stats().backoffs).toBe(1);expect(cache.stats().ownedBytes).toBe(0);expect(cache.stats().bypassRequests).toBeGreaterThan(0);
 cache.clear();expect(cache.stats().bypassRequests).toBe(0);cache.put('new-scene',rgba,1,1,10);expect(cache.get('new-scene')).toEqual(rgba);
});
