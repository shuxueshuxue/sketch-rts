import { expect,it,vi } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { paintPortrait } from './portrait-cache';
import { bakedImage,installBakedImage } from './art/baked-assets';
it('refreshes early training buttons after lazy art loads, matching later queue portraits without repainting every frame',()=>{
  const canvas=()=>Object.assign(createCanvas(32,32),{dataset:{}}) as unknown as HTMLCanvasElement;
  const button=canvas(),queue=canvas(),key='portrait-cache-test';
  const paint=vi.fn((target:HTMLCanvasElement)=>{const ctx=target.getContext('2d')!,art=bakedImage(key);if(art)ctx.drawImage(art,0,0,32,32);else{ctx.fillStyle='#442200';ctx.fillRect(0,0,32,32);}});
  paintPortrait(button,key,paint);const fallback=button.getContext('2d')!.getImageData(0,0,32,32).data.slice();
  const art=createCanvas(32,32);art.getContext('2d').fillStyle='#22bb88';art.getContext('2d').fillRect(0,0,32,32);installBakedImage(key,art as unknown as CanvasImageSource);
  paintPortrait(queue,key,paint);paintPortrait(button,key,paint);
  const pixels=(target:HTMLCanvasElement)=>target.getContext('2d')!.getImageData(0,0,32,32).data;
  expect(pixels(button)).toEqual(pixels(queue));expect(pixels(button)).not.toEqual(fallback);
  for(let frame=0;frame<60;frame++){paintPortrait(button,key,paint);paintPortrait(queue,key,paint);}expect(paint).toHaveBeenCalledTimes(3);
});
