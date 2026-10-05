/** node --import tsx scripts/render-corpse-review.ts */
import {createCanvas} from '@napi-rs/canvas';
import {writeFileSync,mkdirSync} from 'node:fs';
import {installHeadlessCanvas} from '../src/recorder/record';
import {drawAtlasCorpse,drawAtlasUnit} from '../src/client/atlas-art';
import {UNIT_CARDS} from '../src/client/content/units';
import type {UnitKind} from '../src/shared/types';
installHeadlessCanvas();
const kinds=Object.keys(UNIT_CARDS) as UnitKind[],cols=6,w=1440,h=90+Math.ceil(kinds.length/cols)*150;
const canvas=createCanvas(w,h),b=canvas.getContext('2d'),c=b as unknown as CanvasRenderingContext2D;
b.fillStyle='#b9b49e';b.fillRect(0,0,w,h);b.fillStyle='#363c33';b.font='bold 25px sans-serif';b.fillText('FALLEN / PERSISTENT PENCIL REMAINS',24,36);b.font='14px sans-serif';b.fillText(`${kinds.length} unit kinds / enlarged study with living silhouette for reference / no timed deletion`,24,64);
kinds.forEach((kind,i)=>{
 const x=12+i%cols*238,y=90+Math.floor(i/cols)*150;
 b.fillStyle='#c9c3ae';b.fillRect(x,y,226,140);
 b.save();b.globalAlpha=.72;drawAtlasCorpse(c,kind,{x:x+94,y:y+70},1.9,i%6);b.restore();
 drawAtlasUnit(c,kind,{x:x+193,y:y+75},.6,'#66776a');
 b.fillStyle='#464b40';b.font='12px sans-serif';b.fillText(UNIT_CARDS[kind].name.en,x+10,y+125);
});
mkdirSync('docs/art/corpses',{recursive:true});writeFileSync('docs/art/corpses/catalog.png',canvas.toBuffer('image/png'));
const detail=createCanvas(960,390),d=detail.getContext('2d'),dc=d as unknown as CanvasRenderingContext2D;
d.fillStyle='#bfb9a3';d.fillRect(0,0,960,390);d.fillStyle='#363c33';d.font='bold 23px sans-serif';d.fillText('QUIET REMAINS / PENCIL STUDIES',22,32);
(['worker','footman','archer','knight','priest','redDragon'] as UnitKind[]).forEach((kind,i)=>{
 const x=16+i%3*316,y=53+Math.floor(i/3)*165;
 d.fillStyle='#cdc6af';d.fillRect(x,y,300,150);
 d.save();d.globalAlpha=.72;drawAtlasCorpse(dc,kind,{x:x+137,y:y+65},2.65,i%3);d.restore();
 d.fillStyle='#4d5144';d.font='14px sans-serif';d.fillText(UNIT_CARDS[kind].name.en,x+14,y+133);
});writeFileSync('docs/art/corpses/studies.png',detail.toBuffer('image/png'));
