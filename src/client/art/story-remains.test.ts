import { createCanvas } from '@napi-rs/canvas';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CAST } from '../../campaigns/ashen-march/cast';
import { paintCorpse } from './corpses';
import type {EquipmentKind} from './equipment';
import {clearCanvasArtCache,canvasArtCacheStats,drawAtlasCorpse} from '../atlas-art';
import {setScratchCanvasFactory} from './scratch-canvas';
import type {CastMember} from '../../story/cast';
import type { UnitPainter } from '../../story/cast';
import { paintFenWolf,paintFenWolfAlpha,paintCinderHound,paintColossus,paintColossusBroken,paintElder,paintAshe,paintVillagerWoman } from '../../campaigns/ashen-march/models';
function pixels(paint:UnitPainter){
  const c=createCanvas(160,100),b=c.getContext('2d');b.translate(80,40);
  const before=b.getTransform();paint(b as unknown as CanvasRenderingContext2D,'#386d61');expect(b.getTransform()).toEqual(before);
  const data=b.getImageData(0,0,160,100).data;let top=100,bottom=0;
  for(let y=0;y<100;y++)for(let x=0;x<160;x++)if(data[(y*160+x)*4+3]!>8){top=Math.min(top,y);bottom=Math.max(bottom,y);}
  return {height:bottom-top,png:c.toBuffer('image/png')};
}
describe('story remains use their actual appearance',()=>{
  it.each(Object.values(CAST))('$id supplies low-lying remains instead of rotating the live model',member=>{
    expect(member.model.remains).toBeTypeOf('function');
    const remains=pixels(member.model.remains);
    expect(remains.height).toBeLessThan(40);
    expect(remains.height).toBeGreaterThan(5);
    expect(remains.png.equals(pixels(member.model.paint).png)).toBe(false);
  });
  it('retains wolf, alpha and ember-hound appearances independently of their combat base kinds',()=>{
    const wolf=pixels(paintFenWolf.remains).png;
    expect(pixels(paintFenWolfAlpha.remains).png.equals(wolf)).toBe(false);
    expect(pixels(paintCinderHound.remains).png.equals(wolf)).toBe(false);
    expect(pixels(paintCinderHound.remains).png.equals(pixels(b=>paintCorpse(b,'cinderRunner')).png)).toBe(false);
  });
  it('keeps tree roots/leaves and broken molten plates separate from generic rubble',()=>{
    const stone=pixels(paintColossus.remains).png;
    expect(pixels(paintColossusBroken.remains).png.equals(stone)).toBe(false);
    expect(pixels(paintElder.remains).png.equals(stone)).toBe(false);
  });
  it('distinguishes relaxed sling, short javelin, club and civilian fork from a sword',()=>{
    const weapons:EquipmentKind[]=['none','sword','javelin','sling','club','pitchfork'];
    const images=weapons.map(weapon=>pixels(b=>paintCorpse(b,'footman',{weapon,shield:false})).png.toString('base64'));
    expect(new Set(images).size).toBe(weapons.length);
  });
  it('never invents the worker pickaxe for unarmed civilian appearances',()=>{
    const worker=pixels(b=>paintCorpse(b,'worker')).png;
    expect(pixels(paintAshe.remains).png.equals(worker)).toBe(false);
    expect(pixels(paintVillagerWoman.remains).png.equals(worker)).toBe(false);
    expect(pixels(b=>paintCorpse(b,'worker',{weapon:'none',headwear:false,shield:false})).png.equals(worker)).toBe(false);
  });
});

describe('story remains in the world atlas',()=>{
  beforeEach(()=>{clearCanvasArtCache();setScratchCanvasFactory((w,h)=>createCanvas(w,h) as unknown as HTMLCanvasElement);});
  afterEach(()=>{clearCanvasArtCache();setScratchCanvasFactory(undefined);});
  function cached(member:CastMember,useModel=true){
    const canvas=createCanvas(180,110),b=canvas.getContext('2d');
    drawAtlasCorpse(b as unknown as CanvasRenderingContext2D,member.rules.base,{x:90,y:45},1,0,useModel?member.model:undefined,useModel?member.id:'','#386d61');
    return canvas.toBuffer('image/png');
  }
  it('keys same-base story remains by variant and reuses the exact cached image',()=>{
    const wolf=cached(CAST.fenWolf),alpha=cached(CAST.fenWolfAlpha);
    expect(wolf.equals(alpha)).toBe(false);
    expect(canvasArtCacheStats().entries).toBe(2);
    expect(cached(CAST.fenWolf).equals(wolf)).toBe(true);
    expect(canvasArtCacheStats().hits).toBe(1);
  });
  it('chooses the model anatomy for the cinder hound rather than its cinderRunner combat base',()=>{
    expect(cached(CAST.cinderHound).equals(cached(CAST.cinderHound,false))).toBe(false);
  });
});
