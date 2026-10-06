import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createCanvas} from '@napi-rs/canvas';
import {worldModels,matchModelKeys} from './model-library';
import {currentModelPortrait} from './model-portraits';
import {setScratchCanvasFactory} from '../art/scratch-canvas';
const fetcher=vi.fn(async(url:string)=>new Response(readFileSync(`public/art/world3d/${url.split('/art/world3d/')[1]!.split('?')[0]}`)));
beforeAll(async()=>{vi.stubGlobal('fetch',fetcher);setScratchCanvasFactory((w,h)=>createCanvas(w,h) as unknown as HTMLCanvasElement);await worldModels.prepare(matchModelKeys,'match');});
afterAll(()=>{worldModels.dispose();setScratchCanvasFactory(undefined);vi.unstubAllGlobals();});
it('fits every current ship and building in UI without a second resource request or a stale sprite',()=>{
  expect(fetcher).toHaveBeenCalledTimes(31);
  for(const key of matchModelKeys){const image=currentModelPortrait(key,'#65908c')!;expect(image,key).toBeTruthy();const data=image.getContext('2d')!.getImageData(0,0,256,256).data;
    let left=256,top=256,right=0,bottom=0,ink=0;
    for(let y=0;y<256;y++)for(let x=0;x<256;x++)if(data[(y*256+x)*4+3]!>8){ink++;left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
    expect(ink,key).toBeGreaterThan(1500);expect(Math.max(right-left,bottom-top),key).toBeGreaterThan(232);expect(Math.min(left,top,255-right,255-bottom),key).toBeGreaterThan(3);
    expect(currentModelPortrait(key,'#65908c')).toBe(image);
  }
  expect(fetcher).toHaveBeenCalledTimes(31);
});
