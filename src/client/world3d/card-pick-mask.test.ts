import {describe,it,expect,vi} from 'vitest';
import {packCardPickMask,cardMaskHit} from './card-pick-mask';

function expectSourceAlpha(rgba:Uint8ClampedArray,width:number,height:number,flipY:boolean){
 const mask=packCardPickMask(rgba,width,height,flipY);let differences=0;
 expect(mask.byteLength).toBe(Math.ceil(width*height/8));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const sourceY=flipY?height-1-y:y;
  if(cardMaskHit(mask,width,height,{x:(x+.5)/width,y:(y+.5)/height})!==(rgba[(sourceY*width+x)*4+3]!>=102))differences++;
 }
 expect(differences).toBe(0);return mask;
}

describe('exact packed card picking',()=>{
 it('preserves threshold, vertical flip, endpoints, and invalid UV rejection',()=>{
  const rgba=new Uint8ClampedArray(2*2*4);[0,101,102,255].forEach((a,i)=>rgba[i*4+3]=a);const mask=packCardPickMask(rgba,2,2);
  expect(mask).toEqual(new Uint8Array([3]));expect(cardMaskHit(mask,2,2,{x:0,y:0})).toBe(true);expect(cardMaskHit(mask,2,2,{x:1,y:0})).toBe(true);expect(cardMaskHit(mask,2,2,{x:1,y:1})).toBe(false);
  for(const uv of [undefined,{x:NaN,y:0},{x:0,y:Infinity},{x:-.001,y:.5},{x:.5,y:1.001}])expect(cardMaskHit(mask,2,2,uv)).toBe(false);
 });
 it.each([3,16,176,256,320,352,512,640,704])('matches every source pixel with x/y mirror at size %i',size=>{
  const rgba=new Uint8ClampedArray(size*size*4);for(let p=0;p<size*size;p++)rgba[p*4+3]=(p*13+(p%17))%256;
  const mask=packCardPickMask(rgba,size,size);expect(mask.byteLength).toBe(Math.ceil(size*size/8));let differences=0;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)for(const mx of [false,true])for(const my of [false,true]){
   const px=mx?size-1-x:x,py=my?size-1-y:y;
   if(cardMaskHit(mask,size,size,{x:(px+.5)/size,y:(py+.5)/size})!==(rgba[((size-1-py)*size+px)*4+3]!>=102))differences++;
  }
  expect(differences).toBe(0);
 });
});

it('preserves unsigned alpha thresholds and literal row bits in both orientations',()=>{
 const rgba=new Uint8ClampedArray(8*2*4);
 [0,101,102,127,128,255,1,100,102,0,0,0,0,0,0,102].forEach((alpha,p)=>{
  rgba[p*4+3]=alpha;if(alpha===101)rgba[p*4]=rgba[p*4+1]=rgba[p*4+2]=255;
 });
 expect(packCardPickMask(rgba,8,2,false)).toEqual(new Uint8Array([0x3c,0x81]));expect(packCardPickMask(rgba,8,2,true)).toEqual(new Uint8Array([0x81,0x3c]));
 for(const flipY of [false,true])expectSourceAlpha(rgba,8,2,flipY);
});

it('ignores transparent RGB and does not turn OR-ed subthreshold alpha into a picked pixel',()=>{
 const rgba=new Uint8ClampedArray(8*3*4);for(let p=0;p<24;p++)rgba[p*4]=rgba[p*4+1]=rgba[p*4+2]=255;
 [64,32,8,101].forEach((alpha,p)=>rgba[(8+p)*4+3]=alpha);rgba[23*4+3]=102;
 const before=rgba.slice();expect(packCardPickMask(rgba,8,3,false)).toEqual(new Uint8Array([0,0,0x80]));expect(packCardPickMask(rgba,8,3,true)).toEqual(new Uint8Array([0x80,0,0]));expect(rgba).toEqual(before);
});

it.each([0,255])('preserves all 256 alpha values with RGB %i and fresh zero masks',rgb=>{
 const rgba=new Uint8ClampedArray(16*16*4);for(let p=0;p<256;p++){rgba[p*4]=rgba[p*4+1]=rgba[p*4+2]=rgb;rgba[p*4+3]=p;}
 for(const flipY of [false,true])expectSourceAlpha(rgba,16,16,flipY);
 rgba.fill(0);expect(packCardPickMask(rgba,16,16).every(byte=>byte===0)).toBe(true);
});

it('preserves one-bit order across eight rows',()=>{
 const rgba=new Uint8ClampedArray(8*8*4);for(let i=0;i<8;i++)rgba[(i*8+i)*4+3]=102;
 expect(packCardPickMask(rgba,8,8,false)).toEqual(new Uint8Array([1,2,4,8,16,32,64,128]));expect(packCardPickMask(rgba,8,8,true)).toEqual(new Uint8Array([128,64,32,16,8,4,2,1]));
});

it.each([0,1,2,3,4,7,8,15])('bounds aligned and unaligned subarray reads at byte offset %i',offset=>{
 const width=16,height=13,length=width*height*4,backing=new Uint8ClampedArray(offset+length+12);backing.fill(255);
 const rgba=backing.subarray(offset,offset+length);
 for(let p=0;p<width*height;p++){rgba[p*4]=p&255;rgba[p*4+1]=255;rgba[p*4+2]=0;rgba[p*4+3]=(p*29)%256;}
 const before=backing.slice();for(const flipY of [false,true])expectSourceAlpha(rgba,width,height,flipY);expect(backing).toEqual(before);
});

it.each([0,3,4,31,32,33,35])('respects a %i-byte view without reading opaque pixels outside it',length=>{
 const backing=new Uint8ClampedArray(48);backing.fill(255);const rgba=backing.subarray(4,4+length),expected=length<4?0:length<32?(1<<Math.floor(length/4))-1:255;
 const before=backing.slice();for(const flipY of [false,true])expect(packCardPickMask(rgba,8,1,flipY)).toEqual(new Uint8Array([expected]));expect(backing).toEqual(before);
});

it('keeps NPOT row bits contiguous without byte padding at row boundaries',()=>{
 for(const [width,height,points,plain,flipped] of [
  [3,3,[[0,0],[2,0],[2,1],[1,2]],[0xa5,0],[0x62,1]],
  [9,2,[[8,0],[0,1]],[0,3,0],[1,0,2]],
 ] as const){
  const rgba=new Uint8ClampedArray(width*height*4);for(const [x,y] of points)rgba[(y*width+x)*4+3]=102;
  expect(packCardPickMask(rgba,width,height,false)).toEqual(new Uint8Array(plain));expect(packCardPickMask(rgba,width,height,true)).toEqual(new Uint8Array(flipped));
 }
});

it.each([[8,3],[16,13],[176,13],[352,7],[704,5],[3,7],[9,11]])('preserves seeded random RGBA for a %i×%i source', (width,height)=>{
 for(const seed of [1,0x91d13]){
  const rgba=new Uint8ClampedArray(width*height*4);let state=seed;
  for(let i=0;i<rgba.length;i++){state=(Math.imul(state,1664525)+1013904223)>>>0;rgba[i]=state>>>24;}
  const before=rgba.slice();for(const flipY of [false,true])expectSourceAlpha(rgba,width,height,flipY);expect(rgba).toEqual(before);
 }
});

it('uses byte access when host words do not put alpha in the high byte',async()=>{
 const NativeUint32Array=Uint32Array,rgba=new Uint8ClampedArray(8*2*4);rgba[3]=102;rgba[63]=255;let sourceWordViews=0;
 vi.resetModules();
 vi.stubGlobal('Uint32Array',function(...args:unknown[]){
  if(args.length===1&&args[0] instanceof ArrayBuffer&&args[0].byteLength===4&&new Uint8Array(args[0])[0]===1)return new NativeUint32Array([0x01000000]);
  if(args[0]===rgba.buffer&&args.length===3)sourceWordViews++;
  return Reflect.construct(NativeUint32Array,args);
 });
 try{
  const {packCardPickMask:pack}=await import('./card-pick-mask');
  expect(pack(rgba,8,2,false)).toEqual(new Uint8Array([1,128]));expect(pack(rgba,8,2,true)).toEqual(new Uint8Array([128,1]));expect(sourceWordViews).toBe(0);
 }finally{vi.unstubAllGlobals();vi.resetModules();}
});

it('accepts already GPU-oriented recovery pixels without a second vertical flip',()=>{
 const width=176,height=13,rgba=new Uint8ClampedArray(width*height*4),flipped=new Uint8ClampedArray(rgba.length);
 for(let p=0;p<width*height;p++)rgba[p*4+3]=(p*29)%256;
 for(let y=0;y<height;y++)flipped.set(rgba.subarray(y*width*4,(y+1)*width*4),(height-1-y)*width*4);
 expect(packCardPickMask(flipped,width,height,false)).toEqual(packCardPickMask(rgba,width,height));
});
