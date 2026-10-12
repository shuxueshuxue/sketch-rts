import {paintEquipmentAsset} from './equipment';
import {sampleMotion} from './motion';
import {equipmentForKind} from './rig';
import { createCanvas } from '@napi-rs/canvas';
import { expect, it } from 'vitest';
import { ITEM_DEFS } from '../../shared/equipment';
import type { ItemKind, UnitKind } from '../../shared/types';
import { drawPaintedItem } from './items';

it('renders every gameplay item through the shared shop, inventory and drop painter', () => {
  for (const kind of Object.keys(ITEM_DEFS) as ItemKind[]) for (const ground of [false, true]) {
    const canvas = createCanvas(96, 96);
    const ctx = canvas.getContext('2d');
    drawPaintedItem(ctx as unknown as CanvasRenderingContext2D, kind, { x: 48, y: 48 }, 58, ground);
    const pixels = ctx.getImageData(0, 0, 96, 96).data;
    let covered = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) covered++;
    expect(covered, `${kind} ground=${ground}`).toBeGreaterThan(100);
    const transform = ctx.getTransform();
    expect([transform.a, transform.b, transform.c, transform.d, transform.e, transform.f]).toEqual([1, 0, 0, 1, 0, 0]);
  }
});

it('uses actual issued bow, pike and javelin geometry in both inventory and ground records',()=>{
 const render=(source:UnitKind,ground:boolean)=>{const c=createCanvas(120,120);drawPaintedItem(c.getContext('2d') as unknown as CanvasRenderingContext2D,'issuedWeapon',{x:60,y:60},72,ground,source);return c.getContext('2d').getImageData(0,0,120,120).data;};
 for(const ground of [false,true]){
  const images=['archer','lancer','murlocHunter','footman'].map(kind=>Buffer.from(render(kind as UnitKind,ground)).toString('base64'));
  expect(new Set(images).size).toBe(4);
 }
 for(const source of ['archer','lancer','murlocHunter'] as const){
  const expected=createCanvas(120,120),b=expected.getContext('2d');b.translate(60,60);b.scale(72/40,72/40);b.lineJoin=b.lineCap='round';b.scale(.72,.72);
  const weapon=equipmentForKind(source)!;if(weapon==='pike')b.translate(0,12);
  paintEquipmentAsset(b as unknown as CanvasRenderingContext2D,{}, {weapon,wrist:[0,0],angle:weapon==='pike'?-Math.PI/2:0,impact:0,cast:0,motion:sampleMotion({mode:'idle',frame:0})});
  expect(render(source,false)).toEqual(b.getImageData(0,0,120,120).data);
 }
});

it('keeps every issued weapon inside the actual 80px equipment/drag canvas at size 58',()=>{
 const kinds:UnitKind[]=['footman','emberRavager','lancer','archer','priest','summoner','worker','ogreWarrior','murlocHunter','thornSlinger'];
 for(const kind of kinds){
  // The surrounding guard catches ink that a production-sized canvas would discard.
  const c=createCanvas(96,96),b=c.getContext('2d');b.translate(8,8);
  drawPaintedItem(b as unknown as CanvasRenderingContext2D,'issuedWeapon',{x:40,y:40},58,false,kind);
  const data=b.getImageData(0,0,96,96).data;let ink=0,outside=0;
  for(let y=0;y<96;y++)for(let x=0;x<96;x++)if(data[(y*96+x)*4+3]){ink++;if(x<=8||x>=87||y<=8||y>=87)outside++;}
  expect(ink,kind).toBeGreaterThan(20);expect(outside,kind).toBe(0);
 }
});
