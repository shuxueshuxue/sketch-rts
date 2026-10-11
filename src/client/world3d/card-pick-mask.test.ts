import {describe,it,expect} from 'vitest';
import {packCardPickMask,cardMaskHit} from './card-pick-mask';
describe('exact packed card picking',()=>{
 it('preserves threshold, vertical flip, endpoints, and invalid UV rejection',()=>{
  const rgba=new Uint8ClampedArray(2*2*4);[0,101,102,255].forEach((a,i)=>rgba[i*4+3]=a);const mask=packCardPickMask(rgba,2,2);
  expect(mask).toEqual(new Uint8Array([3]));expect(cardMaskHit(mask,2,2,{x:0,y:0})).toBe(true);expect(cardMaskHit(mask,2,2,{x:1,y:0})).toBe(true);expect(cardMaskHit(mask,2,2,{x:1,y:1})).toBe(false);
  for(const uv of [undefined,{x:NaN,y:0},{x:0,y:Infinity},{x:-.001,y:.5},{x:.5,y:1.001}])expect(cardMaskHit(mask,2,2,uv)).toBe(false);
 });
 it.each([16,256,320,512,640])('matches every source pixel with x/y mirror at size %i',size=>{
  const rgba=new Uint8ClampedArray(size*size*4);for(let p=0;p<size*size;p++)rgba[p*4+3]=(p*13+(p%17))%256;
  const mask=packCardPickMask(rgba,size,size);expect(mask.byteLength).toBe(Math.ceil(size*size/8));let differences=0;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)for(const mx of [false,true])for(const my of [false,true]){
   const px=mx?size-1-x:x,py=my?size-1-y:y;
   if(cardMaskHit(mask,size,size,{x:(px+.5)/size,y:(py+.5)/size})!==(rgba[((size-1-py)*size+px)*4+3]!>=102))differences++;
  }
  expect(differences).toBe(0);
 });
});
