import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'node:fs';
import { installHeadlessCanvas } from '../src/recorder/record';
import { MenuBackdrop } from '../src/client/menu-scenes';
import { drawAtlasUnitPortrait, drawAtlasUnit, drawAtlasMine, drawAtlasCamp, drawAtlasShop } from '../src/client/atlas-art';
import { UNIT_DEFS } from '../src/shared/catalog';
import type { UnitKind } from '../src/shared/types';
installHeadlessCanvas();
const out='docs/art/playtest-refinement'; mkdirSync(out,{recursive:true});
for(let i=0;i<3;i++) {
 const canvas=createCanvas(1440,900),b=canvas.getContext('2d');
 const scene=new MenuBackdrop({mercenaryStock:()=>'',unitKind:k=>k},i);
 for(let frame=0;frame<=90;frame++) scene.draw(b as unknown as CanvasRenderingContext2D,1440,900,frame*100);
 writeFileSync(`${out}/menu-${i}.png`,canvas.toBuffer('image/png'));
}
const canvas=createCanvas(1440,1120),b=canvas.getContext('2d');
b.fillStyle='#bdb5a1'; b.fillRect(0,0,1440,1120);
(Object.keys(UNIT_DEFS) as UnitKind[]).forEach((kind,i)=>{
 const x=90+i%8*178,y=115+Math.floor(i/8)*180;
 drawAtlasUnit(b as unknown as CanvasRenderingContext2D,kind,{x,y},1.65,'#746d59',1,{mode:'idle',frame:0});
 b.font='13px sans-serif'; b.fillStyle='#36332e';b.fillText(kind,x-65,y+53);
});
drawAtlasMine(b as unknown as CanvasRenderingContext2D,{x:1350,y:1030});
writeFileSync(`${out}/units.png`,canvas.toBuffer('image/png'));

const sites=createCanvas(1040,420),c=sites.getContext('2d'); c.fillStyle='#bdb5a1';c.fillRect(0,0,1040,420);
const brush=c as unknown as CanvasRenderingContext2D;
c.save();c.translate(140,190);c.scale(2.4,2.4);drawAtlasMine(brush,{x:0,y:0});c.restore();
drawAtlasShop(brush,{x:515,y:190},2.7); drawAtlasCamp(brush,{x:850,y:190},2.7);
c.fillStyle='#37342d';c.font='18px sans-serif';c.fillText('GOLD MINE',80,345);c.fillText('TRADING HOUSE',425,345);c.fillText('MERCENARY CAMP',760,345);
writeFileSync(`${out}/sites.png`,sites.toBuffer('image/png'));

const portraits=createCanvas(1000,470),pb=portraits.getContext('2d');
pb.fillStyle='#1c2428';pb.fillRect(0,0,1000,470);
(['worker','footman','archer','knight','priest','witch','golem','redDragon','spiderQueen','warship'] as UnitKind[]).forEach((kind,i)=>{
 const x=25+i%5*195,y=22+Math.floor(i/5)*232;
 drawAtlasUnitPortrait(pb as unknown as CanvasRenderingContext2D,kind,x,y,160,'#857a62');
 pb.fillStyle='#d7c9b0';pb.font='15px sans-serif';pb.fillText(kind,x,y+185);
});
writeFileSync(`${out}/portraits.png`,portraits.toBuffer('image/png'));
