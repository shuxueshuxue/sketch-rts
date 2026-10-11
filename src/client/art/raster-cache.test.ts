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
    cache.clear();expect(cache.stats()).toEqual({entries:0,pixels:0,bytes:0,hits:0,misses:0,evictions:0});
  });
});
