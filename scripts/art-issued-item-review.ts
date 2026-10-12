/** Node-only metadata consumer sheet; not a substitute for browser UI interaction. */
import {createCanvas} from '@napi-rs/canvas';
import {mkdirSync,writeFileSync} from 'node:fs';
import {drawPaintedItem} from '../src/client/art/items';
import type {WorldItem} from '../src/shared/types';
import {polygon,line,ellipse} from '../src/client/art/kit';
import {ITEM_MATERIAL} from '../src/client/art/materials';
const canvas=createCanvas(1100,680),b=canvas.getContext('2d');b.fillStyle='#e6dfcc';b.fillRect(0,0,1100,680);
b.fillStyle='#303738';b.font='bold 23px sans-serif';b.fillText('Issued item source identity across existing consumers',24,36);b.font='14px sans-serif';b.fillText('Shared painter at real sizes; metadata dispatch study, not DOM/drop gameflow proof. Equipment / drag: 80px canvas, size 58.',24,64);
const items:WorldItem[]=(['archer','lancer','murlocHunter','footman'] as const).map((weaponKind,i)=>({id:`review:${i}`,kind:'issuedWeapon',weaponKind,x:0,y:0,cooldownRemaining:0}));
const consumers=[{name:'World drop · 30',size:30,ground:true},{name:'Inventory · 38×.8',size:30.4,ground:false},{name:'Equipment · 58',size:58,ground:false},{name:'Drag ghost · 58',size:58,ground:false}];
consumers.forEach((entry,i)=>b.fillText(entry.name,245+i*210,98));
items.forEach((item,row)=>{
 const y=160+row*104;b.fillStyle='#303738';b.fillText(`${item.kind} / ${item.weaponKind}`,24,y+4);
 consumers.forEach((entry,column)=>{
  const icon=createCanvas(80,80),ctx=icon.getContext('2d');drawPaintedItem(ctx as unknown as CanvasRenderingContext2D,item.kind,{x:40,y:40},entry.size,entry.ground,item.weaponKind);
  const x=255+column*210;b.strokeStyle='#aaa38d';b.strokeRect(x-1,y-41,82,82);b.drawImage(icon,x,y-40);
 });
});
b.fillStyle='#303738';b.fillText('Greatsword icon: former item study → shared held geometry',24,625);
const old=createCanvas(80,80),o=old.getContext('2d') as unknown as CanvasRenderingContext2D;o.translate(40,40);o.scale(58/40,58/40);o.lineJoin=o.lineCap='round';const m=ITEM_MATERIAL;
polygon(o,[[-3,-19],[3,-19],[3,6],[0,10],[-3,6]],m.steel,m.ink,.9);line(o,[[-9,8],[9,8]],m.gold,3);line(o,[[0,9],[0,17]],m.leather,4);ellipse(o,0,18,2,2,m.gold);
b.drawImage(old,595,574);const next=createCanvas(80,80);drawPaintedItem(next.getContext('2d') as unknown as CanvasRenderingContext2D,'greatSword',{x:40,y:40},58);b.drawImage(next,795,574);
const dir='docs/art/refactor/final-equipment';mkdirSync(dir,{recursive:true});writeFileSync(`${dir}/issued-item-consumers.png`,canvas.toBuffer('image/png'));
