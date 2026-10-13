import {describe,it,expect} from 'vitest';
import {updateCardPixels} from './card-upload-region';
function mark(data:Uint8Array,x:number,y:number,width:number,rgba:readonly number[]=[50,25,75,255]){data.set(rgba,(y*width+x)*4);}
describe('lossless card upload regions',()=>{
 it('finds exclusive pixel bounds and copies all four components',()=>{
  const previous=new Uint8Array(8*8*4),next=previous.slice();mark(next,2,1,8);mark(next,4,5,8,[30,40,50,0]);
  expect(updateCardPixels(previous,next,8,8)).toEqual({left:2,top:1,right:5,bottom:6});expect(previous).toEqual(next);
 });
 it('includes transparent RGB and clears disappearing old paint',()=>{
  const previous=new Uint8Array(8*8*4),next=previous.slice();mark(previous,0,7,8);mark(next,7,0,8,[1,2,3,0]);
  expect(updateCardPixels(previous,next,8,8)).toEqual({left:0,top:0,right:8,bottom:8});expect(previous).toEqual(next);
  expect(updateCardPixels(previous,new Uint8Array(previous.length),8,8)).toEqual({left:7,top:0,right:8,bottom:1});expect(previous.every(value=>value===0)).toBe(true);
 });
 it('returns no upload for identical full domains',()=>{
  const previous=new Uint8Array(4*4*4);mark(previous,3,3,4);
  expect(updateCardPixels(previous,previous.slice(),4,4)).toBeNull();expect(updateCardPixels(previous,previous,4,4)).toBeNull();
 });
 it('supports rectangular rasters and unaligned RGBA subarrays',()=>{
  const previous=new Uint8Array(3*5*4+1).subarray(1),next=new Uint8Array(previous.length+3).subarray(3);mark(next,2,4,3,[1,2,3,4]);
  expect(updateCardPixels(previous,next,3,5)).toEqual({left:2,top:4,right:3,bottom:5});expect(previous).toEqual(next);
 });
 it('matches complete replacement through a deterministic changing sequence',()=>{
  const width=17,height=13,previous=new Uint8Array(width*height*4);let seed=17;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let pass=0;pass<80;pass++){
   const before=previous.slice(),next=pass%5===0?new Uint8Array(before.length):before.slice();
   for(let pixel=0;pixel<13;pixel++)mark(next,random()%width,random()%height,width,[random()%256,random()%256,random()%256,pass%2?0:random()%256]);
   const region=updateCardPixels(previous,next,width,height);expect(previous).toEqual(next);
   if(region)for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    if(x>=region.left&&x<region.right&&y>=region.top&&y<region.bottom)continue;
    const offset=(y*width+x)*4;expect(next.subarray(offset,offset+4)).toEqual(before.subarray(offset,offset+4));
   }
  }
 });
 it('rejects incompatible rasters before changing the source',()=>{
  const previous=new Uint8Array(16);expect(()=>updateCardPixels(previous,new Uint8Array(12),2,2)).toThrow('Invalid');expect(()=>updateCardPixels(previous,previous,1.5,2)).toThrow('Invalid');expect(previous.every(value=>value===0)).toBe(true);
 });
});
