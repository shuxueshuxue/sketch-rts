import { afterEach, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { RasterCache } from './raster-cache';
import { setScratchCanvasFactory } from './scratch-canvas';

const factory = (w: number, h: number) => createCanvas(w,h) as unknown as HTMLCanvasElement;
afterEach(() => setScratchCanvasFactory(undefined));
describe('cropped artwork cache', () => {
  it('preserves every pixel and the world anchor at original density', () => {
    setScratchCanvasFactory(factory);
    const cache = new RasterCache();
    const paint = (b: CanvasRenderingContext2D) => {
      b.fillStyle = '#674432'; b.fillRect(-13,-31,25,48);
      b.fillStyle = '#cdbb8890'; b.beginPath(); b.ellipse(5,-28,16,7,.2,0,Math.PI*2); b.fill();
    };
    const art = cache.get('actor',4,paint), original = factory(512,512), composed = factory(512,512);
    const a=original.getContext('2d')!, b=composed.getContext('2d')!;
    a.translate(256,256); a.scale(4,4); paint(a);
    b.drawImage(art.canvas,(art.x+64)*4,(art.y+64)*4);
    expect(b.getImageData(0,0,512,512).data).toEqual(a.getImageData(0,0,512,512).data);
    expect(cache.stats().pixels).toBeLessThan(512*512/4);
    expect(cache.get('actor',4,() => { throw Error('unexpected redraw'); })).toBe(art);
    expect(cache.stats().hits).toBe(1);
  });
  it('isolates nested authored painters without clearing their parent work surface', () => {
    setScratchCanvasFactory(factory);
    const cache=new RasterCache();
    const outer=cache.get('outer',2,b=>{
      b.fillStyle='#a02030';b.fillRect(-10,-10,20,20);
      const inner=cache.get('inner',2,c=>{c.fillStyle='#2040a0';c.fillRect(0,0,5,5);});
      b.drawImage(inner.canvas,20,20);
    });
    const ctx=outer.canvas.getContext('2d')!;
    const x=Math.round((-outer.x)*2), y=Math.round((-outer.y)*2);
    expect(Array.from(ctx.getImageData(x,y,1,1).data)).toEqual([160,32,48,255]);
    expect(cache.stats().entries).toBe(2);
  });
  it('bounds retained pixels, respects LRU and clears all state', () => {
    setScratchCanvasFactory(factory);
    const cache=new RasterCache(5000,2);
    const paint=(b:CanvasRenderingContext2D)=>{b.fillStyle='#fff'; b.fillRect(0,0,10,10);};
    const first=cache.get('one',2,paint);cache.get('two',2,paint);cache.get('one',2,paint);cache.get('three',2,paint);
    expect(cache.get('one',2,paint)).toBe(first);
    expect(cache.stats()).toMatchObject({entries:2,evictions:1});
    expect(cache.stats().pixels).toBeLessThanOrEqual(5000);
    cache.get('large',2,b=>b.fillRect(-64,-64,128,128));
    expect(cache.stats().pixels).toBeLessThanOrEqual(5000);
    cache.clear();expect(cache.stats()).toMatchObject({entries:0,pixels:0,bytes:0,hits:0,misses:0,evictions:0,ownedCanvasBytes:0});
  });
});

it('reuses both scratch domains and clears leaked clips, transforms, paths and saved states',()=>{
 const created:HTMLCanvasElement[]=[];
 setScratchCanvasFactory((w,h)=>{const canvas=factory(w,h);created.push(canvas);return canvas;});
 const cache=new RasterCache();
 for(let i=0;i<6;i++){
  const size=i%2?160:128;
  const art=cache.get(`dirty:${i}`,2,b=>{
   b.fillStyle='#ed4030';b.fillRect(-8,-8,16,16);
   b.save();b.beginPath();b.rect(200,200,1,1);b.clip();b.translate(500,500);b.globalAlpha=0;
  },size);
  expect(Array.from(art.canvas.getContext('2d')!.getImageData(Math.round(-art.x*2),Math.round(-art.y*2),1,1).data)).toEqual([237,64,48,255]);
 }
 expect(created.filter(c=>c.width===256&&c.height===256)).toHaveLength(1);
 expect(created.filter(c=>c.width===320&&c.height===320)).toHaveLength(1);
 cache.clear();expect(created.every(c=>c.width===1&&c.height===1)).toBe(true);
});
it('reuses evicted crop backing stores without stale pixels and releases them on clear',()=>{
 const created:HTMLCanvasElement[]=[];
 setScratchCanvasFactory((w,h)=>{const canvas=factory(w,h);created.push(canvas);return canvas;});
 const cache=new RasterCache(5000,1);
 const paint=(color:string)=>(b:CanvasRenderingContext2D)=>{b.fillStyle=color;b.fillRect(0,0,10,10);};
 const first=cache.get('first',2,paint('#ff0000'));
 cache.get('second',2,paint('#00ff00'));
 const third=cache.get('third',2,paint('#0000ff'));
 expect(third.canvas).toBe(first.canvas);expect(third.x).toBe(-1);expect(third.y).toBe(-1);
 expect(Array.from(third.canvas.getContext('2d')!.getImageData(5,5,1,1).data)).toEqual([0,0,255,255]);
 expect(Array.from(third.canvas.getContext('2d')!.getImageData(0,0,1,1).data)).toEqual([0,0,0,0]);
 expect(created).toHaveLength(3);cache.clear();expect(created.every(c=>c.width===1&&c.height===1)).toBe(true);
});
it('keeps an evicted nested result intact until its parent has composed it',()=>{
 setScratchCanvasFactory(factory);const cache=new RasterCache(5000,1);
 const outer=cache.get('outer',2,b=>{
  const a=cache.get('nested-red',2,c=>{c.fillStyle='#ff0000';c.fillRect(0,0,5,5);});
  cache.get('nested-blue',2,c=>{c.fillStyle='#0000ff';c.fillRect(0,0,5,5);});
  cache.get('nested-green',2,c=>{c.fillStyle='#00ff00';c.fillRect(0,0,5,5);});
  b.drawImage(a.canvas,0,0);
 });
 expect(Array.from(outer.canvas.getContext('2d')!.getImageData(8,8,1,1).data)).toEqual([255,0,0,255]);cache.clear();
});
it('returns a leased scratch after a throwing painter and resets its dirty clip',()=>{
 setScratchCanvasFactory(factory);const cache=new RasterCache();
 expect(()=>cache.get('throws',2,b=>{b.save();b.beginPath();b.rect(1000,1000,1,1);b.clip();throw Error('paint failed');})).toThrow('paint failed');
 const art=cache.get('clean',2,b=>{b.fillStyle='#fff';b.fillRect(0,0,4,4);});
 expect(art.canvas.getContext('2d')!.getImageData(4,4,1,1).data[3]).toBe(255);cache.clear();
});

it('preserves warm entries for oversized one-off art and releases that art after consumption',()=>{
 setScratchCanvasFactory(factory);const cache=new RasterCache(5000,2);
 const warm=cache.get('warm',2,b=>b.fillRect(0,0,5,5));
 const large=cache.get('large',2,b=>b.fillRect(-64,-64,128,128));
 expect(cache.stats().entries).toBe(1);expect(cache.get('warm',2,()=>{throw Error('warm should survive');})).toBe(warm);
 expect(large.canvas.width).toBeGreaterThan(1);cache.clear();expect(large.canvas.width).toBe(1);expect(large.canvas.height).toBe(1);
});
it('bounds spare and scratch pools and falls back to a full context reset when reset is unavailable',()=>{
 const created:HTMLCanvasElement[]=[];
 setScratchCanvasFactory((w,h)=>{
  const canvas=factory(w,h);created.push(canvas);
  Object.defineProperty(canvas.getContext('2d')!,'reset',{value:undefined});return canvas;
 });
 const cache=new RasterCache(5000,1);
 for(let i=0;i<18;i++)cache.get(`shape:${i}`,2,b=>{
  b.fillRect(0,0,2+i,4);b.save();b.beginPath();b.rect(2000,2000,1,1);b.clip();
 },128+i*2);
 // Four idle scratch surfaces, eight spare crops, one cached and one retired.
 expect(created.filter(canvas=>canvas.width>1&&canvas.height>1).length).toBeLessThanOrEqual(14);
 const clean=cache.get('clean-fallback',2,b=>{b.fillStyle='#ff0000';b.fillRect(0,0,4,4);},162);
 expect(Array.from(clean.canvas.getContext('2d')!.getImageData(4,4,1,1).data)).toEqual([255,0,0,255]);
 cache.clear();expect(created.every(canvas=>canvas.width===1&&canvas.height===1)).toBe(true);
});

it('reports every owned backing store and lets a painter finish safely across clear',()=>{
 const created:HTMLCanvasElement[]=[];
 setScratchCanvasFactory((w,h)=>{const canvas=factory(w,h);created.push(canvas);return canvas;});
 const cache=new RasterCache();
 const art=cache.get('cleared-inside',2,b=>{
  b.fillStyle='#ff0000';b.fillRect(0,0,4,4);
  expect(cache.stats()).toMatchObject({leasedCanvases:1,leasedBytes:256*256*4,ownedCanvasBytes:256*256*4});
  cache.clear();b.fillStyle='#0000ff';b.fillRect(4,0,4,4);
 });
 expect(Array.from(art.canvas.getContext('2d')!.getImageData(4,4,1,1).data)).toEqual([255,0,0,255]);
 expect(Array.from(art.canvas.getContext('2d')!.getImageData(12,4,1,1).data)).toEqual([0,0,255,255]);
 expect(cache.stats()).toMatchObject({entries:0,scratchCanvases:0,leasedCanvases:0,retiredCanvases:1,ownedCanvasBytes:art.canvas.width*art.canvas.height*4});
 expect(created[0]!.width).toBe(1);cache.clear();expect(cache.stats().ownedCanvasBytes).toBe(0);
});
