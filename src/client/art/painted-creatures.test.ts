import { createCanvas } from '@napi-rs/canvas';
import { expect,it } from 'vitest';
import { paintCreature } from './painted-creatures';
import type { UnitKind } from '../../shared/types';

const kinds:UnitKind[]=['wildling','mossGnawer','ancientStag','spiderling','venomSpider','spiderQueen','dragonWhelp','redDragon',
  'golem','rubbleGolem','rockGolem','graniteGolem','stonebackBrute','ogreWarrior','ogreMage','ogreLord','murlocPeon','murlocHunter','tidePriest','deepSnapper','spirit'];
for(const kind of kinds)it(`${kind} has a visible impact and recovery, with planted feet`,()=>{
  const paint=(mode:'idle'|'attack',frame:number)=>{
    const canvas=createCanvas(160,160),ctx=canvas.getContext('2d');ctx.translate(70,95);
    paintCreature(ctx as unknown as CanvasRenderingContext2D,kind,'#477b91',{mode,frame});
    return ctx.getImageData(0,0,160,160).data;
  };
  const idle=paint('idle',0),impact=paint('attack',0),middle=paint('attack',2);
  expect(impact.reduce((n,p,i)=>n+Number(p!==idle[i]),0)).toBeGreaterThan(100);
  expect(impact.reduce((n,p,i)=>n+Number(p!==middle[i]),0)).toBeGreaterThan(100);
  expect(paint('attack',5)).toEqual(idle);
});
