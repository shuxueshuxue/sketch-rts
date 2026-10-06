import {afterEach,expect,it,vi} from 'vitest';
import {createCanvas} from '@napi-rs/canvas';
import {paintPortrait} from './portrait-cache';
import {installModelPortraits} from './model-portraits';
afterEach(()=>installModelPortraits(undefined));
it('fills high-resolution selection canvases at their CSS size and repaints after resizing',()=>{
  const canvas=Object.assign(createCanvas(192,192),{dataset:{},clientWidth:90,clientHeight:90}) as unknown as HTMLCanvasElement;
  const paint=vi.fn((target:HTMLCanvasElement)=>{const ctx=target.getContext('2d')!;ctx.fillStyle='#aabb88';ctx.fillRect(0,0,target.clientWidth,target.clientHeight);});
  paintPortrait(canvas,'unit',paint);expect(canvas.getContext('2d')!.getImageData(180,180,1,1).data[3]).toBe(255);
  for(let frame=0;frame<60;frame++)paintPortrait(canvas,'unit',paint);expect(paint).toHaveBeenCalledTimes(1);
  Object.assign(canvas,{clientWidth:72,clientHeight:72});paintPortrait(canvas,'unit',paint);expect(paint).toHaveBeenCalledTimes(2);
  expect(canvas.getContext('2d')!.getImageData(180,180,1,1).data[3]).toBe(255);
  expect(canvas.getContext('2d')!.getTransform().a).toBe(1);
});
it('refreshes existing training and queue portraits together when current model art becomes available',()=>{
  const canvas=()=>Object.assign(createCanvas(32,32),{dataset:{}}) as unknown as HTMLCanvasElement;
  const button=canvas(),queue=canvas();let color='#442200';
  const paint=vi.fn((target:HTMLCanvasElement)=>{const ctx=target.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,32,32);});
  paintPortrait(button,'ship',paint);const before=button.getContext('2d')!.getImageData(0,0,32,32).data.slice();
  color='#22bb88';installModelPortraits(()=>undefined);
  paintPortrait(queue,'ship',paint);paintPortrait(button,'ship',paint);
  expect(button.getContext('2d')!.getImageData(0,0,32,32).data).toEqual(queue.getContext('2d')!.getImageData(0,0,32,32).data);
  expect(button.getContext('2d')!.getImageData(0,0,32,32).data).not.toEqual(before);
});
