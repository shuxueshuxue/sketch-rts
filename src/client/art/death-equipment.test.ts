import {createCanvas} from '@napi-rs/canvas';
import {afterEach,describe,it,expect} from 'vitest';
import {createGame,issuePlayerCommand,stepGame,snapshotGame,restoreSnapshotIntoGame} from '../../shared/sim';
import {checksumGame} from '../../shared/sim/checksum';
import {appearanceFor,corpseAppearanceFor} from './unit-appearance';
import {paintCorpse} from './corpses';
import {storyFigure} from './story-rig';
import {drawAtlasCorpse,drawAtlasModel,clearCanvasArtCache,canvasArtCacheStats} from '../atlas-art';
import {setScratchCanvasFactory} from './scratch-canvas';
import type {WorldItem,Corpse} from '../../shared/types';
import {sampleFigurePose,type FigurePresentation} from './rig';
import {figures} from './appearance';
import {IDLE_FRAME} from '../unit-animation';
import {resolveReleaseSocket} from './release-socket';
const POSE={mode:'attack' as const,frame:0,aim:-4};
function setup(){const game=createGame('bareDuel',{aiPlayers:[]});game.scriptedVictory=true;const unit=game.spawnUnit('player','footman',700,700);return{game,unit};}
function equip(game:ReturnType<typeof createGame>,unit:ReturnType<typeof setup>['unit'],kind:'greatSword'|'issuedWeapon'|'roundShield',hand:'right'|'left',weaponKind?:WorldItem['weaponKind']){
 const item:WorldItem={id:`death-kit-${kind}`,kind,x:unit.x,y:unit.y,cooldownRemaining:0,...(weaponKind?{weaponKind}:{})};game.items.push(item);
 issuePlayerCommand(game,'player',{type:'pickupItem',unitId:unit.id,itemId:item.id});issuePlayerCommand(game,'player',{type:'wieldItem',unitId:unit.id,itemId:item.id,hand});
 expect(unit.hands?.[hand]).toBe(item.id);return item;
}
function image(paint:(b:CanvasRenderingContext2D)=>void){const c=createCanvas(240,180),b=c.getContext('2d');b.translate(120,90);paint(b as unknown as CanvasRenderingContext2D);return c.toBuffer('image/png');}
afterEach(()=>{clearCanvasArtCache();setScratchCanvasFactory(undefined);});
describe('death-time equipment presentation',()=>{
 it.each(['greatSword','issuedWeapon'] as const)('captures a real %s before dropping it, without changing inventory or entity IDs',kind=>{
  const {game,unit}=setup();equip(game,unit,'roundShield','left');equip(game,unit,kind,'right',kind==='issuedWeapon'?'archer':undefined);
  const live=appearanceFor(game,unit),held=game.items.filter(item=>item.carrierId===unit.id).map(item=>({...item})),nextId=game.nextId;
  unit.hp=0;stepGame(game);
  const corpse=game.corpses!.find(c=>c.unitId===unit.id)!;
  expect(corpse).toMatchObject({equipmentCaptured:true,rightItemKind:kind,...(kind==='issuedWeapon'?{weaponKind:'archer'}:{})});
  expect(corpseAppearanceFor(game,corpse)).toMatchObject({weapon:live.weapon,shield:sampleFigurePose(figures[unit.kind]!,IDLE_FRAME,live).shield,...(live.shieldStyle?{shieldStyle:live.shieldStyle}:{})});
  if(kind==='greatSword')expect(corpseAppearanceFor(game,corpse).shield).toBe(false);
  for(const prior of held){
   const expected={...prior,x:unit.x,y:unit.y};for(const key of ['carrierId','slot','shipId','holdSlot','mountId','aim'] as const)delete expected[key];
   expect(game.items.find(item=>item.id===prior.id)).toEqual(expected);
  }
  expect(game.nextId).toBe(nextId);expect(game.units.some(u=>u.id===unit.id)).toBe(false);
  const saved=snapshotGame(game),hash=checksumGame(game);restoreSnapshotIntoGame(game,JSON.parse(JSON.stringify(saved)),game.nextId);expect(checksumGame(game)).toBe(hash);
  game.corpses![0]!.weaponKind='worker';expect(saved.corpses![0]!.weaponKind).toBe(kind==='issuedWeapon'?'archer':undefined);
  const older=JSON.parse(JSON.stringify(saved));for(const corpse of older.corpses)for(const key of ['equipmentCaptured','rightItemKind','weaponKind','leftItemKind','ownerRace'])delete corpse[key];
  restoreSnapshotIntoGame(game,older,game.nextId);expect(corpseAppearanceFor(game,game.corpses![0]!)).toEqual({});
 });
 it('captures a held round shield and freezes owner skin independently from later changes',()=>{
  const {game,unit}=setup();equip(game,unit,'roundShield','left');game.players.player!.race='ember';
  unit.hp=0;stepGame(game);const corpse=game.corpses!.find(c=>c.unitId===unit.id)!;
  expect(corpse).toMatchObject({leftItemKind:'roundShield',ownerRace:'ember'});
  expect(corpseAppearanceFor(game,corpse)).toMatchObject({shield:true,shieldStyle:'round'});
  game.players.player!.race='grove';expect(corpseAppearanceFor(game,{...corpse,kind:'priest'})).toMatchObject({robe:true,cloth:'#928174'});
 });
 it('keeps cloak identity and distinct sword/shield shapes in remains',()=>{
  const sword=image(b=>paintCorpse(b,'priest',{weapon:'sword',shield:false}));
  expect(image(b=>paintCorpse(b,'priest',{weapon:'greatSword',shield:false})).equals(sword)).toBe(false);
  expect(image(b=>paintCorpse(b,'priest',{weapon:'sword',shield:false,robe:true})).equals(sword)).toBe(true);
  expect(image(b=>paintCorpse(b,'footman',{shield:true,shieldStyle:'round'})).equals(image(b=>paintCorpse(b,'footman',{shield:true,shieldStyle:'kite'})))).toBe(false);
 });
 it('preserves story costume defaults but shares actual gear through live, corpse, cache and release paths',()=>{
  setScratchCanvasFactory((w,h)=>createCanvas(w,h) as unknown as HTMLCanvasElement);
  const {game,unit}=setup();unit.variant='test/story';
  const authored={weapon:'staff' as const,cloth:'#af6034',headwear:false};const painter=storyFigure('priest',authored,.8),model={paint:painter,remains:painter.remains};
  equip(game,unit,'issuedWeapon','right','footman');expect(appearanceFor(game,unit)).toEqual({});
  equip(game,unit,'greatSword','right');const gear=appearanceFor(game,unit);expect(gear).toMatchObject({weapon:'greatSword',shield:false});
  const live=(presentation:FigurePresentation)=>image(b=>drawAtlasModel(b,'test/story',model,{x:0,y:0},1,'#476f69',1,POSE,presentation));
  const defaultPixels=live({}),equippedPixels=live(gear);expect(equippedPixels.equals(defaultPixels)).toBe(false);expect(live(gear).equals(equippedPixels)).toBe(true);
  expect(canvasArtCacheStats().hits).toBeGreaterThan(0);
  const defaultSocket=resolveReleaseSocket({kind:unit.kind,radius:unit.radius,pose:POSE,model});
  const socket=resolveReleaseSocket({kind:unit.kind,radius:unit.radius,pose:POSE,model,presentation:gear});expect(socket).not.toEqual(defaultSocket);
  unit.hp=0;stepGame(game);const corpse=game.corpses!.find(c=>c.unitId===unit.id)!;const remains=corpseAppearanceFor(game,corpse);
  const actual=image(b=>drawAtlasCorpse(b,unit.kind,{x:0,y:0},1,0,model,'test/story','#476f69',remains));
  const expected=image(b=>drawAtlasCorpse(b,unit.kind,{x:0,y:0},1,0,{paint:painter,remains:storyFigure('priest',{...authored,weapon:'greatSword',shield:false},.8).remains},'expected','#476f69'));
  expect(actual.equals(expected)).toBe(true);
  const old:Corpse={...corpse,rightItemKind:'issuedWeapon',weaponKind:'footman'};expect(corpseAppearanceFor(game,old).weapon).toBeUndefined();
 });
});
