import {createCanvas} from '@napi-rs/canvas';
import {afterEach,describe,expect,it} from 'vitest';
import {MERCENARY_UNIT_KINDS} from '../../shared/catalog';
import {createGame,issuePlayerCommand,stepGame} from '../../shared/sim';
import {checksumGame} from '../../shared/sim/checksum';
import type {MercenaryUnitKind,UnitKind,WorldItem} from '../../shared/types';
import {clearCanvasArtCache,drawAtlasCorpse,drawAtlasUnit,drawAtlasUnitFigure,drawAtlasUnitPortrait} from '../atlas-art';
import type {UnitAnimationFrame} from '../unit-animation';
import {paintFigure} from './painted-units';
import {hasMercenaryModel} from './painted-mercenaries';
import {paintCorpse} from './corpses';
import {figureReleaseSocket} from './release-socket';
import {figureWeaponSurface} from './weapon-surface';
import {type FigurePresentation} from './rig';
import {setScratchCanvasFactory} from './scratch-canvas';
import {appearanceFor,corpseAppearanceFor} from './unit-appearance';

const COLOR='#6b7f68',IDLE:UnitAnimationFrame={mode:'idle',frame:0};
const previous:Record<MercenaryUnitKind,UnitKind>={mercenary:'footman',contractArcher:'archer',fieldMedic:'priest'};
function image(paint:(brush:CanvasRenderingContext2D)=>void){
  const canvas=createCanvas(320,320),b=canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  b.translate(160,180);b.scale(2,2);const before=b.getTransform();paint(b);expect(b.getTransform()).toEqual(before);
  return canvas.toBuffer('image/png');
}
function figure(kind:UnitKind,pose=IDLE,presentation:FigurePresentation={},color=COLOR){return image(b=>paintFigure(b,kind,color,pose,1,presentation));}
afterEach(()=>{clearCanvasArtCache();setScratchCanvasFactory(undefined);});

describe('independent hired-company models',()=>{
  it('covers exactly the real hire catalog and dispatches three independently painted costumes',()=>{
    const kinds=MERCENARY_UNIT_KINDS.filter(hasMercenaryModel);expect(kinds).toEqual(MERCENARY_UNIT_KINDS);
    for(const kind of kinds)expect(figure(kind).equals(figure(previous[kind])),kind).toBe(false);
    expect(hasMercenaryModel('footman')).toBe(false);
    expect(new Set(kinds.map(kind=>figure(kind).toString('base64'))).size).toBe(kinds.length);
  });

  it.each(MERCENARY_UNIT_KINDS)('%s retains visible idle, gait, attack variations, casting and directed preparation',kind=>{
    expect(figure(kind,{mode:'idle',frame:2}).equals(figure(kind))).toBe(false);
    expect(figure(kind,{mode:'walk',frame:2}).equals(figure(kind,{mode:'walk',frame:6}))).toBe(false);
    expect(new Set([0,1,2].map(variant=>figure(kind,{mode:'attack',frame:0,variant}).toString('base64'))).size).toBe(3);
    expect(figure(kind,{mode:'cast',frame:0}).equals(figure(kind,{mode:'attack',frame:0}))).toBe(false);
    const ready=figure(kind,{mode:'idle',frame:0,carry:6,carryAim:-4});
    expect(ready.equals(figure(kind,{mode:'idle',frame:0,carry:6,carryAim:4}))).toBe(false);
    expect(ready.equals(figure(kind,{mode:'attack',frame:0,aim:-4,carry:6,carryAim:-4}))).toBe(false);
    expect(figure(kind,IDLE,{},'#ad5c46').equals(figure(kind))).toBe(false);
    expect(figure(kind,IDLE,{headwear:false}).equals(figure(kind))).toBe(false);
  });

  it('keeps equipped spear contacts and blood-bearing surfaces attached to every new body through up/down recovery',()=>{
    const canvas=createCanvas(240,240),b=canvas.getContext('2d'),presentation={weapon:'pike',shield:false} as const;
    for(const kind of MERCENARY_UNIT_KINDS)for(const aim of [-6,-4,0,4,6])for(let frame=0;frame<6;frame++){
      const pose:UnitAnimationFrame={mode:'attack',frame,aim,carry:6,carryAim:aim};
      const socket=figureReleaseSocket(kind,pose,presentation)!,surface=figureWeaponSurface(kind,pose,presentation)!;
      b.resetTransform();b.clearRect(0,0,240,240);b.translate(120,120);
      paintFigure(b as unknown as CanvasRenderingContext2D,kind,COLOR,pose,1,presentation);
      const pixels=b.getImageData(Math.round(socket.x+120)-2,Math.round(socket.y+120)-2,5,5).data;
      expect(pixels.some((value,index)=>index%4===3&&value>0),`${kind}/${aim}/${frame}`).toBe(true);
      const tip=surface.segments[1]!.b;
      expect(Math.hypot(tip[0]-socket.x,tip[1]-(socket.y-socket.ground))).toBeLessThanOrEqual(1.001);
    }
    for(const aim of [-6,-4,0,4,6]){
      const pose:UnitAnimationFrame={mode:'cast',frame:0,aim},socket=figureReleaseSocket('fieldMedic',pose)!;
      b.resetTransform();b.clearRect(0,0,240,240);b.translate(120,120);
      paintFigure(b as unknown as CanvasRenderingContext2D,'fieldMedic',COLOR,pose,1);
      expect(b.getImageData(Math.round(socket.x+120)-2,Math.round(socket.y+120)-2,5,5).data.some((v,i)=>i%4===3&&v>0)).toBe(true);
    }
  });

  it.each(MERCENARY_UNIT_KINDS)('%s uses its actual new model in battlefield, bust and full-figure UI entry points',kind=>{
    setScratchCanvasFactory((w,h)=>createCanvas(w,h) as unknown as HTMLCanvasElement);
    const modes=['world','portrait','figure'] as const;
    for(const mode of modes){
      const render=(unitKind:UnitKind,appearance:FigurePresentation={})=>{
        const canvas=createCanvas(256,256),b=canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
        if(mode==='world')drawAtlasUnit(b,unitKind,{x:128,y:165},2,COLOR,1,IDLE,appearance);
        else if(mode==='portrait')drawAtlasUnitPortrait(b,unitKind,0,0,256,COLOR,appearance);
        else drawAtlasUnitFigure(b,unitKind,256,256,COLOR,appearance);
        return canvas.toBuffer('image/png');
      };
      const actual=render(kind);expect(actual.equals(render(previous[kind])),`${kind}/${mode}`).toBe(false);
      expect(actual.equals(render(kind)),`${kind}/${mode}/warm`).toBe(true);
      expect(actual.equals(render(kind,{weapon:'greatSword',shield:false})),`${kind}/${mode}/equipment`).toBe(false);
    }
  });

  it.each(MERCENARY_UNIT_KINDS)('%s keeps its costume and captured equipment in real death records without art mutating rules',kind=>{
    setScratchCanvasFactory((w,h)=>createCanvas(w,h) as unknown as HTMLCanvasElement);
    const game=createGame('bareDuel',{aiPlayers:[]});game.scriptedVictory=true;
    const unit=game.spawnUnit('player',kind,700,700);
    const weapon:WorldItem={id:`merc-kit-${kind}`,kind:'greatSword',x:700,y:700,cooldownRemaining:0};game.items.push(weapon);
    issuePlayerCommand(game,'player',{type:'pickupItem',unitId:unit.id,itemId:weapon.id});
    issuePlayerCommand(game,'player',{type:'wieldItem',unitId:unit.id,itemId:weapon.id,hand:'right'});
    const live=appearanceFor(game,unit),hash=checksumGame(game);
    expect(live).toMatchObject({weapon:'greatSword',shield:false});
    figure(kind,{mode:'attack',frame:0,aim:4},live);expect(checksumGame(game)).toBe(hash);
    unit.hp=0;stepGame(game);const corpse=game.corpses!.find(c=>c.unitId===unit.id)!;
    expect(corpse).toMatchObject({kind,equipmentCaptured:true,rightItemKind:'greatSword'});
    const remains=corpseAppearanceFor(game,corpse);expect(remains).toMatchObject({weapon:'greatSword',shield:false});
    const before=checksumGame(game);
    expect(image(b=>paintCorpse(b,kind,remains)).equals(image(b=>paintCorpse(b,previous[kind],remains)))).toBe(false);
    image(b=>drawAtlasCorpse(b,kind,{x:0,y:0},1,0,undefined,'',COLOR,remains));
    expect(checksumGame(game)).toBe(before);
  });
});
