/** npx tsx scripts/art-death-equipment-review.ts — real inventory/death records. */
import {createCanvas} from '@napi-rs/canvas';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createGame,issuePlayerCommand,stepGame} from '../src/shared/sim';
import {appearanceFor,corpseAppearanceFor} from '../src/client/art/unit-appearance';
import {drawAtlasUnit,drawAtlasModel,drawAtlasCorpse} from '../src/client/atlas-art';
import {storyFigure} from '../src/client/art/story-rig';
import {setScratchCanvasFactory} from '../src/client/art/scratch-canvas';
import type {WorldItem} from '../src/shared/types';
setScratchCanvasFactory((w,h)=>createCanvas(w,h) as unknown as HTMLCanvasElement);
const c=createCanvas(1120,780),b=c.getContext('2d'),ctx=b as unknown as CanvasRenderingContext2D;
b.fillStyle='#e6dfcc';b.fillRect(0,0,c.width,c.height);b.fillStyle='#303738';b.font='bold 23px sans-serif';b.fillText('Actual equipped item → living model → death-time remains',28,38);
b.font='15px sans-serif';b.fillText('Same owner/team · real pickup + wield + death · dropped items remain in simulation',28,67);
for(let row=0;row<3;row++){
 const game=createGame('bareDuel',{aiPlayers:[]});game.scriptedVictory=true;
 const unit=game.spawnUnit('player','footman',700,700);
 const story=row===2?storyFigure('priest',{weapon:'staff',cloth:'#955734',headwear:false},.9):undefined;
 if(story)unit.variant='review/story-priest';
 const model=story?{paint:story,remains:story.remains}:undefined;
 const y=170+row*230;
 b.fillStyle='#303738';b.font='17px sans-serif';b.fillText(['Round shield','Issued archer bow','Story priest / greatsword'][row]!,28,y-65);
 if(model)drawAtlasModel(ctx,'review/story-priest',model,{x:290,y},1.8,'#486f78');else drawAtlasUnit(ctx,unit.kind,{x:290,y},1.8,'#486f78');
 const item:WorldItem={id:`review-gear-${row}`,kind:row===0?'roundShield':row===1?'issuedWeapon':'greatSword',x:unit.x,y:unit.y,cooldownRemaining:0,...(row===1?{weaponKind:'archer' as const}:{})};game.items.push(item);
 issuePlayerCommand(game,'player',{type:'pickupItem',unitId:unit.id,itemId:item.id});issuePlayerCommand(game,'player',{type:'wieldItem',unitId:unit.id,itemId:item.id,hand:row===0?'left':'right'});
 const gear=appearanceFor(game,unit);
 if(model)drawAtlasModel(ctx,'review/story-priest',model,{x:585,y},1.8,'#486f78',1,{mode:'idle',frame:0},gear);else drawAtlasUnit(ctx,unit.kind,{x:585,y},1.8,'#486f78',1,{mode:'idle',frame:0},gear);
 unit.hp=0;stepGame(game);const corpse=game.corpses!.find(c=>c.unitId===unit.id)!;
 drawAtlasCorpse(ctx,unit.kind,{x:900,y:y-3},2,0,model,unit.variant,'#486f78',corpseAppearanceFor(game,corpse));
 b.font='14px sans-serif';b.fillStyle='#303738';for(const [x,label] of [[290,'Authored default'],[585,'Equipped live'],[900,'Persistent remains']] as const)b.fillText(label,x-70,y+64);
}
const dir='docs/art/refactor/final-equipment';mkdirSync(dir,{recursive:true});writeFileSync(`${dir}/death-equipment.png`,c.toBuffer('image/png'));
