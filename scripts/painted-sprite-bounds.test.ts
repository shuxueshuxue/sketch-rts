import { actionPaintSize } from '../src/client/art/action-direction';
import { ART_TILE_SIZE } from '../src/client/art/raster-cache';
import { paintCorpse } from '../src/client/art/corpses';
import { createCanvas } from '@napi-rs/canvas';
import { describe,it,expect } from 'vitest';
import { paintFigure,hasPaintedUnit } from '../src/client/art/painted-units';
import { paintBuildingModel, type SiteModelKind } from '../src/client/art/building-models';
import { UNIT_CARDS } from '../src/client/content/units';
import { BUILDING_CARDS } from '../src/client/content/buildings';
import type { UnitKind,BuildingKind } from '../src/shared/types';
import type { UnitAnimationFrame } from '../src/client/unit-animation';
import { unitMover } from '../src/shared/catalog';
function assertFits(paint:(b:CanvasRenderingContext2D)=>void,label:string,tileSize:number=ART_TILE_SIZE){
  // Render beyond the production tile so detached outlying pixels cannot be
  // silently clipped before the assertion sees them. Keep the clear edge rule.
  const padding=16,size=tileSize+padding*2;
  const c=createCanvas(size,size),b=c.getContext('2d');b.translate(size/2,size/2);
  paint(b as unknown as CanvasRenderingContext2D);
  const pixels=b.getImageData(0,0,size,size).data;
  let ink=0,edge=0;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const a=pixels[(y*size+x)*4+3]!;ink+=a>0?1:0;
    if(x<=padding||x>=padding+tileSize-1||y<=padding||y>=padding+tileSize-1)edge+=a;
  }
  expect(ink,label+' is visible').toBeGreaterThan(80);
  expect(edge,label+' is not clipped by atlas').toBe(0);
}
describe('painted atlas bounds',()=>{
  it('keeps every ship steady across sailing frames while land siege wheels still turn',()=>{
    const render=(kind:UnitKind,pose:UnitAnimationFrame)=>{
      const c=createCanvas(128,128),b=c.getContext('2d');b.translate(64,64);
      paintFigure(b as unknown as CanvasRenderingContext2D,kind,'#476f69',pose,1);
      return c.toBuffer('image/png');
    };
    for(const kind of Object.keys(UNIT_CARDS) as UnitKind[]){
      if(unitMover(kind)!=='sea')continue;
      const idle=render(kind,{mode:'idle',frame:0});
      for(let frame=0;frame<8;frame++)expect(render(kind,{mode:'walk',frame}),`${kind}/${frame}`).toEqual(idle);
    }
    expect(render('siegeRam',{mode:'walk',frame:1})).not.toEqual(render('siegeRam',{mode:'idle',frame:0}));
  });
  it('fits a visible corpse or wreck for every unit kind',()=>{
    for(const kind of Object.keys(UNIT_CARDS) as UnitKind[])assertFits(b=>paintCorpse(b,kind),kind+' corpse');
  });
  it('fits every humanoid action and facing inside its production atlas domain',()=>{
    for(const kind of Object.keys(UNIT_CARDS) as UnitKind[]){
      if(!hasPaintedUnit(kind))continue;
      for(const mode of ['idle','walk','attack','cast'] as const)for(let frame=0;frame<(mode==='walk'?8:mode==='idle'?1:6);frame++){
        const pose:UnitAnimationFrame={mode,frame};
        const size=actionPaintSize(pose,kind);
        for(const facing of [-1,1] as const)assertFits(b=>paintFigure(b,kind,'#476f69',pose,facing),`${kind}/${mode}/${frame}/${facing}/tile${size}`,size);
      }
    }
  });
  it('fits all projected buildings including their ground shadows',()=>{
    for(const kind of ['citadel','fort-lance','fort-flame','fort-mortar','fort-ward','fort-wall'] as SiteModelKind[])assertFits(b=>paintBuildingModel(b,kind,'#476f69'),kind);
    for(const kind of Object.keys(BUILDING_CARDS) as BuildingKind[])assertFits(b=>paintBuildingModel(b,kind,'#476f69'),kind);
  });
});
