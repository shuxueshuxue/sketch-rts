import {describe,it,expect} from 'vitest';
import {createCanvas} from '@napi-rs/canvas';
import {drawCombatAir,drawCombatBody,drawCombatGround} from './combat-effects';
import type {CombatPresentationFrame} from '../combat-presentation';
const empty=():CombatPresentationFrame=>({body:[],droplets:[],ground:[],speedLines:[]});
function surface(){const canvas=createCanvas(160,160);return {canvas,ctx:canvas.getContext('2d') as unknown as CanvasRenderingContext2D};}
function bounds(canvas:ReturnType<typeof surface>["canvas"]){
 const data=canvas.getContext('2d').getImageData(0,0,160,160).data;let x0=160,y0=160,x1=-1,y1=-1,pixels=0;
 for(let y=0;y<160;y++)for(let x=0;x<160;x++)if(data[(y*160+x)*4+3]){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);pixels++;}
 return {x0,y0,x1,y1,pixels};
}
const projection={worldToScreen:(p:{x:number;y:number})=>p,nearScreen:()=>true};
describe('combat ink layers',()=>{
 it('keeps body stains below the face and mirrors only their attachment offset',()=>{
  const mark={unitId:'u',x:900,y:900,height:24,localX:6,localY:-24,radius:2,angle:.1,alpha:.7};
  const right=surface(),left=surface();drawCombatBody(right.ctx,[mark],{x:80,y:90},1);drawCombatBody(left.ctx,[mark],{x:100,y:90},-1);
  const a=bounds(right.canvas),b=bounds(left.canvas);expect(a.pixels).toBeGreaterThan(0);expect(b.x0-a.x0).toBe(8);expect(a.y0).toBeGreaterThan(60);expect(a.y1).toBeLessThan(73);
 });
 it('projects settled world stains with the camera and leaves context alpha unchanged',()=>{
  const frame=empty();frame.ground.push({x:100,y:100,height:0,radius:4,angle:.4,alpha:.6});
  const a=surface(),b=surface();a.ctx.globalAlpha=.9;drawCombatGround(a.ctx,frame,projection);drawCombatGround(b.ctx,frame,{...projection,worldToScreen:p=>({x:p.x-30,y:p.y-20})});
  expect(bounds(a.canvas).x0-bounds(b.canvas).x0).toBe(30);expect(bounds(a.canvas).y0-bounds(b.canvas).y0).toBe(20);expect(a.ctx.globalAlpha).toBeCloseTo(.9,2);
 });
 it('puts raised deck stains only in the elevated pass and preserves their floor height',()=>{
  const frame=empty();frame.ground.push({x:80,y:110,height:30,radius:3,angle:0,alpha:1});
  const ground=surface(),deck=surface();drawCombatGround(ground.ctx,frame,projection);drawCombatGround(deck.ctx,frame,projection,true);
  expect(bounds(ground.canvas).pixels).toBe(0);expect(bounds(deck.canvas).pixels).toBeGreaterThan(0);expect(bounds(deck.canvas).y1).toBeLessThan(110);
 });
 it('draws short vertical lines for vertical charges, culls offscreen ink and honors reduced motion',()=>{
  const frame=empty();frame.speedLines.push({unitId:'u',x:80,y:90,height:0,dx:0,dy:1,length:30,width:1,alpha:1});
  const a=surface(),b=surface(),c=surface();drawCombatAir(a.ctx,frame,projection);drawCombatAir(b.ctx,frame,projection,undefined,true);drawCombatAir(c.ctx,frame,{...projection,nearScreen:()=>false});
  const box=bounds(a.canvas);expect(box.y1-box.y0).toBeGreaterThan(25);expect(box.x1-box.x0).toBeLessThan(4);expect(bounds(b.canvas).pixels).toBe(0);expect(bounds(c.canvas).pixels).toBe(0);
 });
 it('uses the actual projected actor anchor instead of stale simulation coordinates',()=>{
  const frame=empty();frame.speedLines.push({unitId:'u',x:900,y:900,height:10,dx:1,dy:0,length:20,width:1,alpha:1});
  const a=surface();drawCombatAir(a.ctx,frame,projection,()=>({x:80,y:70}));const box=bounds(a.canvas);expect(box.x1).toBeLessThan(80);expect(box.y0).toBeGreaterThan(65);expect(box.pixels).toBeGreaterThan(0);
 });
});
