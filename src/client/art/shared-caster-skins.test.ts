import { afterEach, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { createGame, issuePlayerCommand } from '../../shared/sim';
import { checksumGame } from '../../shared/sim/checksum';
import { appearanceFor, appearanceForKind, appearanceKey, corpseAppearanceFor, unitArtFaction } from './unit-appearance';
import { clearCanvasArtCache, drawAtlasCorpse, drawAtlasUnit, drawAtlasUnitFigure } from '../atlas-art';
import { setScratchCanvasFactory } from './scratch-canvas';
import type { RaceId } from '../../shared/types';

afterEach(()=>{clearCanvasArtCache();setScratchCanvasFactory(undefined);});
for(const kind of ['priest','summoner'] as const) {
 it(`${kind} preserves owner skin across battlefield, portrait, corpse caches and real equipment changes`,()=>{
  setScratchCanvasFactory((w,h)=>createCanvas(w,h) as unknown as HTMLCanvasElement);
  const game=createGame('bareDuel',{aiPlayers:[]});
  const unit=game.spawnUnit('player',kind,700,700);
  const render=(race:RaceId,mode:'world'|'portrait'|'corpse')=>{
   game.players.player!.race=race;
   const before=checksumGame(game),canvas=createCanvas(256,256),b=canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
   const appearance=appearanceFor(game,unit);
   if(mode==='world')drawAtlasUnit(b,kind,{x:128,y:150},2,'#476f69',1,{mode:'cast',frame:0},appearance);
   else if(mode==='portrait')drawAtlasUnitFigure(b,kind,256,256,'#476f69',appearance);
   else drawAtlasCorpse(b,kind,{x:128,y:128},2,0,undefined,'','#77766e',corpseAppearanceFor(game,unit));
   expect(checksumGame(game)).toBe(before);
   return canvas.toBuffer('image/png');
  };
  for(const mode of ['world','portrait','corpse'] as const){
   const grove=render('grove',mode),ember=render('ember',mode);
   expect(grove.equals(ember)).toBe(false);
   expect(render('grove',mode).equals(grove)).toBe(true);
  }
  game.players.player!.race='ember';
  expect(appearanceFor(game,unit)).toBe(appearanceForKind(kind,'ember'));
  const item={id:'skin-test-sword',kind:'greatSword' as const,x:700,y:700,cooldownRemaining:0};game.items.push(item);
  issuePlayerCommand(game,'player',{type:'pickupItem',unitId:unit.id,itemId:item.id});
  issuePlayerCommand(game,'player',{type:'wieldItem',unitId:unit.id,itemId:item.id,hand:'right'});
  expect(appearanceFor(game,unit)).toMatchObject({weapon:'greatSword',shield:false,appearance:{ember:true}});
  expect(appearanceKey(appearanceForKind(kind,'grove'))).not.toEqual(appearanceKey(appearanceForKind(kind,'ember')));
 });
}
it('keeps distinct native fire and curse units while shared roles use owner faction',()=>{
 expect(unitArtFaction('priest','ember')).toBe('ember');
 expect(unitArtFaction('summoner','grove')).toBe('grove');
 expect(unitArtFaction('sparkArcher','grove')).toBe('ember');
 expect(unitArtFaction('ashHexer','grove')).toBe('ember');
 expect(appearanceForKind('sparkArcher','ember')).toEqual({});
 expect(appearanceForKind('priest')).toEqual({});
});
