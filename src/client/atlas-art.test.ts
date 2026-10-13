import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createCanvas} from '@napi-rs/canvas';
import {setImmediate as yieldImmediate} from 'node:timers/promises';
import type {RaceId,UnitKind,WorldItem} from '../shared/types';
import {createGame,issuePlayerCommand} from '../shared/sim';
import {checksumGame} from '../shared/sim/checksum';
import type {UnitModel} from '../story/cast';
import type {UnitAnimationFrame} from './unit-animation';
import type {FigurePresentation} from './art/rig';
import * as painters from './art/painted-units';
import {setScratchCanvasFactory} from './art/scratch-canvas';
import {fittedPortraitStats} from './art/portrait-fit';
import {appearanceFor,appearanceForKind,appearanceKey,isCatalogPresentation} from './art/unit-appearance';
import {canvasArtCacheStats,clearCanvasArtCache,drawAtlasModel,drawAtlasUnit,drawAtlasUnitFigure,drawAtlasUnitPortrait} from './atlas-art';

const BLUE='#477b91',RED='#a85644';
const canvas=()=>createCanvas(480,480) as unknown as HTMLCanvasElement;
const pixels=(target:HTMLCanvasElement)=>Buffer.from(target.getContext('2d')!.getImageData(0,0,target.width,target.height).data);
function world(kind:UnitKind,pose:UnitAnimationFrame,color=BLUE,facing:1|-1=1,zoom=1,presentation:FigurePresentation={}){
  const target=canvas(),ctx=target.getContext('2d')!;
  ctx.translate(240,240);ctx.scale(zoom,zoom);
  drawAtlasUnit(ctx,kind,{x:0,y:0},1,color,facing,pose,presentation);
  return pixels(target);
}

beforeEach(()=>{
  clearCanvasArtCache();
  setScratchCanvasFactory((width,height)=>createCanvas(width,height) as unknown as HTMLCanvasElement);
});
afterEach(()=>{clearCanvasArtCache();setScratchCanvasFactory(undefined);vi.restoreAllMocks();});

describe('catalog Canvas paint identities',()=>{
  it('reuses the proven idle pairs without changing fresh painter arguments, world shadows or cropped output',async()=>{
    const paint=vi.spyOn(painters,'paintFigure');let cases=0;
    for(const kind of ['footman','redDragon'] as const)for(const [a,b] of [[0,4],[1,3],[5,7]])for(const facing of [-1,1] as const)for(const zoom of [1,2]){
      clearCanvasArtCache();paint.mockClear();
      const first:UnitAnimationFrame={mode:'idle',frame:b!},paired:UnitAnimationFrame={mode:'idle',frame:a!};
      world(kind,first,BLUE,facing,zoom);
      const shared=world(kind,paired,BLUE,facing,zoom);
      expect(canvasArtCacheStats()).toMatchObject({misses:1,hits:1,entries:1});
      expect(paint).toHaveBeenCalledTimes(1);
      expect(paint.mock.calls[0]![3]).toBe(first);
      clearCanvasArtCache();
      const fresh=world(kind,paired,BLUE,facing,zoom);
      expect(pixelsEqual(shared,fresh),JSON.stringify({kind,a,b,facing,zoom})).toBe(true);
      if(++cases%4===0)await yieldImmediate();
    }
  });

  it('shares intrinsic creature color in the actual world, portrait and full-figure entries while keeping those entries separate',()=>{
    const paint=vi.spyOn(painters,'paintFigure'),pose:UnitAnimationFrame={mode:'idle',frame:0};
    expect(pixelsEqual(world('redDragon',pose,BLUE),world('redDragon',pose,RED))).toBe(true);
    expect(canvasArtCacheStats()).toMatchObject({misses:1,hits:1});
    const portrait=(color:string)=>{const target=canvas();drawAtlasUnitPortrait(target.getContext('2d')!,'redDragon',0,0,180,color);return pixels(target);};
    const figure=(color:string)=>{const target=canvas();drawAtlasUnitFigure(target.getContext('2d')!,'redDragon',180,180,color);return pixels(target);};
    expect(pixelsEqual(portrait(BLUE),portrait(RED))).toBe(true);
    expect(pixelsEqual(figure(BLUE),figure(RED))).toBe(true);
    expect(paint).toHaveBeenCalledTimes(3);
    expect(fittedPortraitStats().entries).toBe(2);
    clearCanvasArtCache();paint.mockClear();
    expect(pixelsEqual(world('footman',pose,BLUE),world('footman',pose,RED))).toBe(false);
    expect(canvasArtCacheStats()).toMatchObject({misses:2,hits:0});
    const bust=canvas(),body=canvas();
    drawAtlasUnitPortrait(bust.getContext('2d')!,'footman',0,0,180,BLUE);
    drawAtlasUnitFigure(body.getContext('2d')!,'footman',180,180,BLUE);
    expect(pixelsEqual(pixels(bust),pixels(body))).toBe(false);
    expect(fittedPortraitStats().entries).toBe(2);
  });

  it('shares real issued, two-handed and round-shield catalog kits without changing original pose, gear or game facts',async()=>{
    const paint=vi.spyOn(painters,'paintFigure');let cases=0;
    const rows:{kind:UnitKind;race:RaceId;kit:LiveKit}[]=[
      {kind:'footman',race:'grove',kit:'issued'}, {kind:'footman',race:'grove',kit:'issued-shield'},
      {kind:'footman',race:'grove',kit:'greatSword'}, {kind:'lancer',race:'grove',kit:'issued'},
      {kind:'archer',race:'grove',kit:'issued'},
      ...(['priest','summoner'] as const).flatMap(kind=>(['issued','greatSword','shield'] as const).map(kit=>({kind,race:'ember' as const,kit}))),
    ];
    for(const row of rows){
      const {game,unit,presentation}=liveKit(row.kind,row.race,row.kit),before=checksumGame(game);
      expect(Reflect.ownKeys(presentation).length).toBeGreaterThan(0);
      expect(Object.isFrozen(presentation)).toBe(true);expect(isCatalogPresentation(presentation)).toBe(true);
      expect(appearanceFor(game,unit)).toBe(presentation);
      if(row.race==='ember')expect(presentation).toMatchObject({appearance:{ember:true}});
      for(const [a,b] of [[0,4],[1,3],[5,7]]){
        clearCanvasArtCache();paint.mockClear();
        const first:UnitAnimationFrame={mode:'idle',frame:b!,carry:6,carryAim:-4},paired={...first,frame:a!};
        world(row.kind,first,BLUE,-1,1,presentation);
        const shared=world(row.kind,paired,BLUE,-1,1,presentation);
        expect(canvasArtCacheStats(),JSON.stringify({row,a,b})).toMatchObject({misses:1,hits:1,entries:1});
        expect(paint).toHaveBeenCalledTimes(1);expect(paint.mock.calls[0]![3]).toBe(first);
        expect(paint.mock.calls[0]![5]).toBe(presentation);
        clearCanvasArtCache();expect(pixelsEqual(shared,world(row.kind,paired,BLUE,-1,1,presentation))).toBe(true);
        if(++cases%4===0)await yieldImmediate();
      }
      expect(checksumGame(game)).toBe(before);
    }
  });

  it('keeps catalog-kit clones and custom details raw, and preserves equipment and Ember material identities across actual UI entries',()=>{
    const paint=vi.spyOn(painters,'paintFigure');
    const issued=liveKit('footman','grove','issued').presentation;
    const detail:NonNullable<FigurePresentation['detail']>=(ctx,rig,stage)=>{
      if(stage==='body'){ctx.fillStyle=rig.motion.breathe===0?'#ff0000':'#0000ff';ctx.fillRect(31,-50,6,6);}
    };
    const custom:FigurePresentation[]=[{...issued},Object.freeze({...issued}),{...issued,detail},
      Object.create(issued),Object.assign(Object.create(null),issued),new Proxy(issued,{})];
    for(const presentation of custom){
      clearCanvasArtCache();paint.mockClear();expect(isCatalogPresentation(presentation)).toBe(false);
      const a=world('footman',{mode:'idle',frame:0},BLUE,1,1,presentation);
      const b=world('footman',{mode:'idle',frame:4},BLUE,1,1,presentation);
      expect(canvasArtCacheStats()).toMatchObject({misses:2,hits:0});expect(paint).toHaveBeenCalledTimes(2);
      if(presentation.detail)expect(pixelsEqual(a,b)).toBe(false);
    }
    const ember=appearanceForKind('priest','ember'),base=appearanceForKind('priest','grove');
    expect(isCatalogPresentation(ember)).toBe(true);expect(Object.isFrozen(ember.appearance)).toBe(true);
    expect(isCatalogPresentation({...ember})).toBe(false);expect(appearanceKey(ember)).not.toBe(appearanceKey(base));
    const kits=[issued,liveKit('footman','grove','issued-shield').presentation,liveKit('footman','grove','greatSword').presentation];
    clearCanvasArtCache();paint.mockClear();
    for(const route of ['portrait','figure'] as const){
      const rendered=kits.map(presentation=>{
        const target=canvas(),ctx=target.getContext('2d')!;
        if(route==='portrait')drawAtlasUnitPortrait(ctx,'footman',0,0,180,BLUE,presentation);
        else drawAtlasUnitFigure(ctx,'footman',180,180,BLUE,presentation);
        return pixels(target);
      });
      expect(pixelsEqual(rendered[0]!,rendered[1]!)).toBe(false);
      expect(pixelsEqual(rendered[0]!,rendered[2]!)).toBe(false);
    }
    expect(fittedPortraitStats().entries).toBe(6);expect(paint).toHaveBeenCalledTimes(6);
    expect(paint.mock.calls.map(call=>call[5])).toEqual([...kits,...kits]);
  });

  it('keeps custom detail, appearance, motion and nonstandard presentations on their original identities',()=>{
    const paint=vi.spyOn(painters,'paintFigure');
    const detail:NonNullable<FigurePresentation['detail']>=(ctx,rig,stage)=>{
      if(stage!=='body')return;
      ctx.fillStyle=rig.motion.breathe===0?'#ff0000':'#0000ff';ctx.fillRect(31,-50,6,6);
    };
    const presentations:FigurePresentation[]=[{detail},{appearance:{armor:true}},{motion:'thrust'},{cloth:'#bb3311'},{weapon:undefined},
      Object.defineProperty({},'detail',{value:detail}),Object.create({detail}),Object.defineProperty({},Symbol('custom'),{value:true})];
    for(const presentation of presentations){
      clearCanvasArtCache();paint.mockClear();
      const a=world('footman',{mode:'idle',frame:0},BLUE,1,1,presentation);
      const b=world('footman',{mode:'idle',frame:4},BLUE,1,1,presentation);
      expect(canvasArtCacheStats()).toMatchObject({misses:2,hits:0});
      expect(paint).toHaveBeenCalledTimes(2);
      if(presentation.detail)expect(pixelsEqual(a,b)).toBe(false);
    }
    clearCanvasArtCache();paint.mockClear();
    for(const color of [BLUE,RED]){
      const target=canvas();drawAtlasUnitPortrait(target.getContext('2d')!,'redDragon',0,0,180,color,{appearance:{armor:true}});
      drawAtlasUnitFigure(target.getContext('2d')!,'redDragon',180,180,color,{appearance:{armor:true}});
    }
    expect(paint).toHaveBeenCalledTimes(4);expect(fittedPortraitStats().entries).toBe(4);
  });

  it('preserves authored facing, density, domains and non-equivalent animation phases',()=>{
    const paint=vi.spyOn(painters,'paintFigure'),idle:UnitAnimationFrame={mode:'idle',frame:0};
    const right=world('footman',idle),left=world('footman',idle,BLUE,-1),other=world('footman',{mode:'idle',frame:2});
    world('footman',idle,BLUE,1,2);
    expect(pixelsEqual(right,left)).toBe(false);expect(pixelsEqual(right,other)).toBe(false);
    expect(canvasArtCacheStats()).toMatchObject({misses:4,hits:0});
    clearCanvasArtCache();paint.mockClear();
    world('siegeRam',idle);world('siegeRam',{mode:'cast',frame:0});
    expect(canvasArtCacheStats()).toMatchObject({misses:2,hits:0});
    expect(paint.mock.calls.map(call=>call[0].canvas.width)).toEqual([256,352]);
  });

  it('keeps opaque campaign models on the raw pose and team identities',()=>{
    const seen:UnitAnimationFrame[]=[];
    const model:UnitModel={paint:(ctx,_team,pose={mode:'idle',frame:0})=>{seen.push(pose);ctx.fillStyle=pose.frame===0?'#ff0000':'#0000ff';ctx.fillRect(-8,-20,16,30);}};
    const draw=(pose:UnitAnimationFrame)=>{const target=canvas(),ctx=target.getContext('2d')!;drawAtlasModel(ctx,'campaign:opaque',model,{x:240,y:240},1,BLUE,1,pose);return pixels(target);};
    const a:UnitAnimationFrame={mode:'idle',frame:0},b:UnitAnimationFrame={mode:'idle',frame:4};
    expect(pixelsEqual(draw(a),draw(b))).toBe(false);
    expect(seen).toEqual([a,b]);expect(seen[0]).toBe(a);expect(seen[1]).toBe(b);
    expect(canvasArtCacheStats()).toMatchObject({misses:2,hits:0});
  });
});

const pixelsEqual=(a:Buffer,b:Buffer)=>a.equals(b);

type LiveKit='issued'|'issued-shield'|'greatSword'|'shield';
function liveKit(kind:UnitKind,race:RaceId,kit:LiveKit){
  const game=createGame('bareDuel',{aiPlayers:[]}),unit=game.spawnUnit('player',kind,700,700);
  game.players.player!.race=race;
  const wield=(kind:WorldItem['kind'],hand:'right'|'left',weaponKind?:UnitKind)=>{
    const item:WorldItem={id:`atlas-${hand}-${kind}`,kind,x:unit.x,y:unit.y,cooldownRemaining:0,...(weaponKind?{weaponKind}:{})};
    game.items.push(item);
    issuePlayerCommand(game,'player',{type:'pickupItem',unitId:unit.id,itemId:item.id});
    issuePlayerCommand(game,'player',{type:'wieldItem',unitId:unit.id,itemId:item.id,hand});
    expect(unit.hands?.[hand]).toBe(item.id);
  };
  if(kit==='issued'||kit==='issued-shield')wield('issuedWeapon','right',kind);
  if(kit==='greatSword')wield('greatSword','right');
  if(kit==='shield'||kit==='issued-shield')wield('roundShield','left');
  return{game,unit,presentation:appearanceFor(game,unit)};
}
