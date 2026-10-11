import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {createCanvas} from '@napi-rs/canvas';
import {createScratchCanvas,setScratchCanvasFactory} from './scratch-canvas';
import {FittedPortraitCache,clearFittedPortraits,drawFittedPortrait,fittedPortraitStats} from './portrait-fit';
import {clearCanvasArtCache} from '../atlas-art';
import {paintFigure} from './painted-units';
import {appearanceForKind} from './unit-appearance';
const made:HTMLCanvasElement[]=[];
beforeEach(()=>{made.length=0;setScratchCanvasFactory((w,h)=>{const c=createCanvas(w,h) as unknown as HTMLCanvasElement;made.push(c);return c;});});
afterEach(()=>{clearFittedPortraits();setScratchCanvasFactory(undefined);});
const target=()=>createCanvas(156,140) as unknown as HTMLCanvasElement;
const pixels=(c:HTMLCanvasElement)=>Buffer.from(c.getContext('2d')!.getImageData(0,0,c.width,c.height).data);
// Frozen pre-pool algorithm: independent defaults, threshold, bust and fit.
function previousDraw(ctx:CanvasRenderingContext2D,paint:(b:CanvasRenderingContext2D)=>void,bust:boolean){
 const canvas=createScratchCanvas(512,512),brush=canvas.getContext('2d')!;
 brush.translate(256,256);brush.scale(4,4);paint(brush);
 const data=brush.getImageData(0,0,512,512).data;
 const bounds=(limit=512)=>{let left=512,top=512,right=0,bottom=0;
  for(let py=0;py<limit;py++)for(let px=0;px<512;px++)if(data[(py*512+px)*4+3]!>8){left=Math.min(left,px);right=Math.max(right,px);top=Math.min(top,py);bottom=Math.max(bottom,py);}
  return{x:left,y:top,width:Math.max(1,right-left+1),height:Math.max(1,bottom-top+1)};
 };
 let box=bounds();if(bust)box=bounds(Math.round(box.y+box.height*.65));
 const cropped=createScratchCanvas(box.width,box.height);
 cropped.getContext('2d')!.drawImage(canvas,box.x,box.y,box.width,box.height,0,0,box.width,box.height);
 const scale=Math.min(140/box.width,124/box.height)*.94,w=box.width*scale,h=box.height*scale;
 ctx.drawImage(cropped,0,0,box.width,box.height,8+(140-w)/2,8+(124-h)/2,w,h);
 canvas.width=canvas.height=cropped.width=cropped.height=1;
}
describe('UI portrait pixels and ownership',()=>{
 it('preserves exact old RGBA for fixed outfits, alpha threshold, bust and empty paintings',()=>{
  const cache=new FittedPortraitCache();
  const paintings=[
   (b:CanvasRenderingContext2D)=>paintFigure(b,'footman','#507b71',{mode:'idle',frame:0},1),
   (b:CanvasRenderingContext2D)=>paintFigure(b,'priest','#a85644',{mode:'idle',frame:0},1,appearanceForKind('priest','ember')),
   (b:CanvasRenderingContext2D)=>paintFigure(b,'knight','#507b71',{mode:'idle',frame:0},1,{weapon:'greatSword'}),
   (b:CanvasRenderingContext2D)=>{b.fillStyle='rgba(40,80,160,0.03)';b.fillRect(-55,-55,110,110);b.fillStyle='#615746';b.fillRect(-4,-10,14,37);},
   (_b:CanvasRenderingContext2D)=>{},
  ];
  try{for(const [i,paint] of paintings.entries())for(const bust of [false,true]){
   const before=target(),after=target();previousDraw(before.getContext('2d')!,paint,bust);
   cache.draw(after.getContext('2d')!,`${i}:${bust}`,paint,8,8,140,124,bust);
   expect(pixels(after).equals(pixels(before)),`case ${i}, bust=${bust}`).toBe(true);
  }}finally{cache.clear();}
 });
 it('reuses fresh-default work surfaces and explicitly shrinks budget evictions and clear',()=>{
  const cache=new FittedPortraitCache(1024*1024,2),ctx=target().getContext('2d')!;
  const paint=(b:CanvasRenderingContext2D)=>{expect(b.globalAlpha).toBe(1);expect(b.lineJoin).toBe('miter');b.fillRect(-5,-5,10,10);b.save();b.globalAlpha=.1;b.lineJoin='round';b.beginPath();b.rect(0,0,1,1);b.clip();};
  for(let i=0;i<12;i++)cache.draw(ctx,String(i),paint,0,0,80,80);
  expect(made.filter(c=>c.width===512&&c.height===512)).toHaveLength(1);
  expect(cache.stats()).toMatchObject({entries:2,workCanvases:1,leasedCanvases:0,retiredCanvases:0});
  expect(made.filter(c=>c.width===1&&c.height===1)).toHaveLength(10);
  expect(cache.stats().ownedCanvasBytes).toBe(made.reduce((n,c)=>n+(c.width===1?0:c.width*c.height*4),0));
  cache.clear();expect(cache.stats().ownedCanvasBytes).toBe(0);expect(made.every(c=>c.width===1&&c.height===1)).toBe(true);
 });
 it('uses distinct work leases for nested paint and preserves both pictures',()=>{
  const cache=new FittedPortraitCache(),actual=target(),expected=target();
  const nested=(b:CanvasRenderingContext2D)=>{b.fillStyle='#884422';b.fillRect(-4,-7,8,14);};
  const outer=(b:CanvasRenderingContext2D)=>{b.fillStyle='#558866';b.fillRect(-25,-25,50,50);cache.draw(b,'inner',nested,-10,-10,20,20);};
  cache.draw(actual.getContext('2d')!,'outer',outer,8,8,140,124);
  // Independent replay of the same composition, without shared working state.
  previousDraw(expected.getContext('2d')!,b=>{b.fillStyle='#558866';b.fillRect(-25,-25,50,50);cache.draw(b,'inner',nested,-10,-10,20,20);},false);
  expect(pixels(actual).equals(pixels(expected))).toBe(true);
  expect(cache.stats()).toMatchObject({entries:2,workCanvases:2,leasedCanvases:0});cache.clear();
 });
 it('keeps active images alive across nested clear and repeated borrowing, then retires them',()=>{
  const cache=new FittedPortraitCache(),ctx=target().getContext('2d')!,paint=(b:CanvasRenderingContext2D)=>b.fillRect(-3,-3,6,6);
  cache.draw(ctx,'same',paint,0,0,80,80);
  let parent:HTMLCanvasElement|undefined;
  const nested={drawImage:(image:HTMLCanvasElement)=>{expect(image).toBe(parent);cache.clear();expect(image.width).toBe(24);expect(cache.stats().retiredCanvases).toBe(1);}} as unknown as CanvasRenderingContext2D;
  const outer={drawImage:(image:HTMLCanvasElement)=>{parent=image;cache.draw(nested,'same',paint,0,0,80,80);expect(image.width).toBe(24);}} as unknown as CanvasRenderingContext2D;
  cache.draw(outer,'same',paint,0,0,80,80);
  expect(parent!.width).toBe(1);expect(cache.stats().ownedCanvasBytes).toBe(0);
 });
 it('does not repopulate a cleared generation or strand leases on painter exceptions',()=>{
  const cache=new FittedPortraitCache(),ctx=target().getContext('2d')!;
  cache.draw(ctx,'clear',b=>{cache.clear();b.fillRect(-4,-4,8,8);},0,0,80,80);
  expect(cache.stats().ownedCanvasBytes).toBe(0);
  expect(()=>cache.draw(ctx,'error',()=>{throw new Error('paint');},0,0,80,80)).toThrow('paint');
  expect(cache.stats().leasedCanvases).toBe(0);cache.clear();expect(cache.stats().ownedCanvasBytes).toBe(0);
 });
 it('caps idle work surfaces after deep nesting and retires the excess',()=>{
  const cache=new FittedPortraitCache();
  const draw=(ctx:CanvasRenderingContext2D,depth:number)=>cache.draw(ctx,String(depth),b=>{b.fillRect(-2,-2,4,4);if(depth)draw(b,depth-1);},0,0,20,20);
  draw(target().getContext('2d')!,6);
  expect(cache.stats()).toMatchObject({workCanvases:4,workBytes:4*512*512*4,leasedCanvases:0});
  cache.clear();expect(cache.stats().ownedCanvasBytes).toBe(0);
 });
 it('connects the existing atlas clear to UI portrait ownership',()=>{
  drawFittedPortrait(target().getContext('2d')!,'atlas-clear',b=>b.fillRect(-2,-2,4,4),0,0,80,80);
  expect(fittedPortraitStats().ownedCanvasBytes).toBeGreaterThan(0);clearCanvasArtCache();expect(fittedPortraitStats().ownedCanvasBytes).toBe(0);
 });
});

it('measures tall antlers and long tails without clipping in an explicitly enlarged domain',()=>{
 const cache=new FittedPortraitCache(),canvas=target();
 cache.draw(canvas.getContext('2d')!,'large',b=>{b.fillStyle='#ff0000';b.fillRect(-78,-80,8,8);b.fillStyle='#0000ff';b.fillRect(68,70,8,8);},0,0,140,124,false,176);
 const rgba=pixels(canvas);let red=0,blue=0;
 for(let i=0;i<rgba.length;i+=4){if(rgba[i]!>200&&rgba[i+2]!<30)red++;if(rgba[i+2]!>200&&rgba[i]!<30)blue++;}
 expect(red).toBeGreaterThan(10);expect(blue).toBeGreaterThan(10);
 cache.clear();expect(cache.stats().ownedCanvasBytes).toBe(0);
});
