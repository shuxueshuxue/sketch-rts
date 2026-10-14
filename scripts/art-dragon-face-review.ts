/** Native-size atlas and portrait review; optional enlarged views never replace these. */
import {createCanvas} from '@napi-rs/canvas';
import {mkdirSync,writeFileSync} from 'node:fs';
import {drawAtlasUnit,drawAtlasUnitPortrait} from '../src/client/atlas-art';
import {setScratchCanvasFactory} from '../src/client/art/scratch-canvas';
import {unitGlyphScale} from '../src/client/glyphs';
import {UNIT_DEFS} from '../src/shared/catalog';
import type {UnitAnimationFrame} from '../src/client/unit-animation';
const stage=process.argv[2]??'after',out='docs/art/refactor/followup/dragon-faces';mkdirSync(out,{recursive:true});
setScratchCanvasFactory((w,h)=>createCanvas(w,h) as unknown as HTMLCanvasElement);
const poses:UnitAnimationFrame[]=[{mode:'idle',frame:0},{mode:'idle',frame:0},{mode:'attack',frame:0,aim:-4},{mode:'attack',frame:0,aim:0},{mode:'attack',frame:0,aim:4},{mode:'cast',frame:0,aim:-4}];
const canvas=createCanvas(1440,640),b=canvas.getContext('2d'),ctx=b as unknown as CanvasRenderingContext2D;
b.fillStyle='#d8ceba';b.fillRect(0,0,1440,640);b.fillStyle='#39382f';b.font='17px sans-serif';b.fillText(`Dragon head/neck · ${stage} · actual world glyph scale, UI portraits 48px / 96px`,20,27);
const labels=['idle right','idle mirrored','attack −60°','attack 0°','attack +60°','cast −60°'];
for(const [row,kind] of (['dragonWhelp','redDragon'] as const).entries()){
 const y=180+row*225;b.fillStyle='#39382f';b.fillText(`${kind} radius=${UNIT_DEFS[kind].radius}, glyph=${unitGlyphScale(UNIT_DEFS[kind].radius)}`,15,y-110);
 for(let col=0;col<poses.length;col++){b.fillStyle='#655f50';b.font='13px sans-serif';b.fillText(labels[col]!,15+col*240,y-83);drawAtlasUnit(ctx,kind,{x:123+col*240,y},unitGlyphScale(UNIT_DEFS[kind].radius),'#566f73',col===1?-1:1,poses[col]!);}
 drawAtlasUnitPortrait(ctx,kind,25+row*650,520,48,'#566f73');drawAtlasUnitPortrait(ctx,kind,100+row*650,505,96,'#566f73');
 b.fillStyle='#39382f';b.fillText(kind,25+row*650,620);
}
writeFileSync(`${out}/${stage}.png`,canvas.toBuffer('image/png'));
