/** npx tsx scripts/art-shared-caster-review.ts — shared roles, owner skin and cache proof. */
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createGame } from '../src/shared/sim';
import { appearanceFor, corpseAppearanceFor } from '../src/client/art/unit-appearance';
import { drawAtlasCorpse, drawAtlasUnit, drawAtlasUnitFigure } from '../src/client/atlas-art';
import { setScratchCanvasFactory } from '../src/client/art/scratch-canvas';
setScratchCanvasFactory((w,h)=>createCanvas(w,h) as unknown as HTMLCanvasElement);
const canvas=createCanvas(1250,700),b=canvas.getContext('2d'),c=b as unknown as CanvasRenderingContext2D;
b.fillStyle='#d0c7b1';b.fillRect(0,0,1250,700);b.fillStyle='#343b3b';b.font='bold 23px sans-serif';
b.fillText('Shared casters · owner faction · identical team color',24,36);
const labels=['Ready','Cast release','Attack contact','Equipped greatsword','Portrait','Remains'];
labels.forEach((label,i)=>{b.font='14px sans-serif';b.fillText(label,205+i*170,78);});
const game=createGame('bareDuel',{aiPlayers:[]});
let row=0;
for(const kind of ['priest','summoner'] as const)for(const race of ['grove','ember'] as const){
 game.players.player.race=race;
 const unit=game.spawnUnit('player',kind,700,700);
 const y=175+row++*145,presentation=appearanceFor(game,unit);
 b.fillStyle='#343b3b';b.font='15px sans-serif';b.fillText(`${kind} / ${race}`,15,y-15);
 for(let col=0;col<4;col++)drawAtlasUnit(c,kind,{x:245+col*170,y},1.8,'#476f69',1,
  {mode:col===1?'cast':col===2?'attack':'idle',frame:0,variant:1},col===3?{...presentation,weapon:'greatSword',shield:false}:presentation);
 b.save();b.translate(855,y-90);drawAtlasUnitFigure(c,kind,140,130,'#476f69',presentation);b.restore();
 drawAtlasCorpse(c,kind,{x:1110,y:y-15},1.8,0,undefined,'','#77766e',corpseAppearanceFor(game,unit));
}
mkdirSync('docs/art/refactor/after',{recursive:true});
writeFileSync('docs/art/refactor/after/shared-caster-skins.png',canvas.toBuffer('image/png'));
