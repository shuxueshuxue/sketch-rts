import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import * as models from '../../campaigns/ashen-march/models';
import type { UnitPainter } from '../../story/cast';
import type { UnitAnimationFrame } from '../unit-animation';
const painters=Object.entries(models).filter(([name])=>name.startsWith('paint')) as [string,UnitPainter][];
function render(paint:UnitPainter,pose:UnitAnimationFrame,facing:1|-1=1){
  const canvas=createCanvas(192,192), b=canvas.getContext('2d');
  b.translate(96,112);b.scale(facing,1);
  const before=b.getTransform();
  paint(b as unknown as CanvasRenderingContext2D,'#386d61',pose,facing);
  expect(b.getTransform()).toEqual(before);
  // All story anatomies share one ground line; a base kind may have an entirely
  // different body (the cinder hound's rules, for example, use cinderRunner).
  const pixels=b.getImageData(0,0,192,192).data;
  let bottom=0;
  for(let y=0;y<192;y++)for(let x=0;x<192;x++)if(pixels[(y*192+x)*4+3]!>8)bottom=y;
  expect(bottom).toBeGreaterThanOrEqual(127);
  expect(bottom).toBeLessThanOrEqual(132);
  return canvas.toBuffer('image/png');
}
describe('Ashen March articulated appearances',()=>{
  it('migrates every campaign painter',()=>expect(painters).toHaveLength(23));
  it.each(painters)('%s animates real walking, breathing and distinct attack/cast poses',(name,paint)=>{
    const rest=render(paint,{mode:'idle',frame:0});
    expect(render(paint,{mode:'walk',frame:2}).equals(rest)).toBe(false);
    expect(render(paint,{mode:'idle',frame:2}).equals(rest)).toBe(false);
    const attack=render(paint,{mode:'attack',frame:0,variant:0});
    expect(attack.equals(rest)).toBe(false);
    expect(render(paint,{mode:'cast',frame:0}).equals(attack)).toBe(false);
    expect(render(paint,{mode:'attack',frame:5,variant:2}).equals(rest)).toBe(true);
    expect(render(paint,{mode:'walk',frame:2},-1).equals(render(paint,{mode:'walk',frame:2}))).toBe(false);
  });
  it('preserves a distinct silhouette or identifying detail for every character',()=>{
    const images=painters.map(([,paint])=>render(paint,{mode:'idle',frame:0}).toString('base64'));
    expect(new Set(images).size).toBe(painters.length);
  });
});
