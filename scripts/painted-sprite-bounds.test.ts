import { paintCorpse } from '../src/client/art/corpses';
import { createCanvas } from '@napi-rs/canvas';
import { describe,it,expect } from 'vitest';
import { paintFigure,hasPaintedUnit } from '../src/client/art/painted-units';
import { paintBuildingModel, type SiteModelKind } from '../src/client/art/building-models';
import { UNIT_CARDS } from '../src/client/content/units';
import { BUILDING_CARDS } from '../src/client/content/buildings';
import type { UnitKind,BuildingKind } from '../src/shared/types';
import type { UnitAnimationFrame } from '../src/client/unit-animation';
function assertFits(paint:(b:CanvasRenderingContext2D)=>void,label:string){
  const c=createCanvas(128,128),b=c.getContext('2d');b.translate(64,64);
  paint(b as unknown as CanvasRenderingContext2D);
  const pixels=b.getImageData(0,0,128,128).data;
  let ink=0,edge=0;
  for(let y=0;y<128;y++)for(let x=0;x<128;x++){
    const a=pixels[(y*128+x)*4+3]!;ink+=a>0?1:0;
    if(x===0||x===127||y===0||y===127)edge+=a;
  }
  expect(ink,label+' is visible').toBeGreaterThan(80);
  expect(edge,label+' is not clipped by atlas').toBe(0);
}
describe('painted atlas bounds',()=>{
  it('fits a visible corpse or wreck for every unit kind',()=>{
    for(const kind of Object.keys(UNIT_CARDS) as UnitKind[])assertFits(b=>paintCorpse(b,kind),kind+' corpse');
  });
  it('fits every humanoid action and facing inside the existing atlas tile',()=>{
    for(const kind of Object.keys(UNIT_CARDS) as UnitKind[]){
      if(!hasPaintedUnit(kind))continue;
      for(const mode of ['idle','walk','attack','cast'] as const)for(let frame=0;frame<(mode==='walk'?8:mode==='idle'?1:6);frame++){
        const pose:UnitAnimationFrame={mode,frame};
        for(const facing of [-1,1] as const)assertFits(b=>paintFigure(b,kind,'#476f69',pose,facing),`${kind}/${mode}/${frame}/${facing}`);
      }
    }
  });
  it('fits all projected buildings including their ground shadows',()=>{
    for(const kind of ['citadel','fort-lance','fort-flame','fort-mortar','fort-ward','fort-wall'] as SiteModelKind[])assertFits(b=>paintBuildingModel(b,kind,'#476f69'),kind);
    for(const kind of Object.keys(BUILDING_CARDS) as BuildingKind[])assertFits(b=>paintBuildingModel(b,kind,'#476f69'),kind);
  });
});
