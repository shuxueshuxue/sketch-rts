import { afterEach, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { createGame } from '../shared/sim';
import { createUnit } from '../shared/map';
import { SIM_TICKS_PER_SECOND } from '../shared/time';
import { ShipWakeTracker } from './ship-wakes';
import { setScratchCanvasFactory } from './art/scratch-canvas';

function scene(){
  const game=createGame('bareDuel',{aiPlayers:[]});
  game.map={...game.map,width:640,height:640,terrain:{cell:32,cols:20,rows:20,cells:'~'.repeat(400)}};
  const ship=createUnit('ship','player','warship',240,320);
  game.units=[ship];return {game,ship};
}
afterEach(()=>setScratchCanvasFactory(undefined));
describe('physical ship wake history',()=>{
  it('requires actual displacement, even when a move is ordered',()=>{
    const {game,ship}=scene(),wakes=new ShipWakeTracker();
    ship.order={type:'move',x:500,y:320};
    for(let i=0;i<100;i++){game.tick=i;wakes.update(game,i*1000/SIM_TICKS_PER_SECOND);}
    expect(wakes.sampleCount).toBe(0);
  });
  it('keeps a bounded trail after stopping, then lets it dissipate',()=>{
    const {game,ship}=scene(),wakes=new ShipWakeTracker();
    for(let i=0;i<400;i++){game.tick=i;ship.x+=2;wakes.update(game,i*1000/SIM_TICKS_PER_SECOND);}
    expect(wakes.sampleCount).toBeGreaterThan(20);
    expect(wakes.sampleCount).toBeLessThanOrEqual(35);
    game.tick++;wakes.update(game,20_050);expect(wakes.sampleCount).toBeGreaterThan(0);
    game.tick+=seconds(6);wakes.update(game,26_050);expect(wakes.sampleCount).toBe(0);
  });
  it('cannot turn a resync or teleport into a cross-map streak',()=>{
    const {game,ship}=scene(),wakes=new ShipWakeTracker();
    wakes.update(game,0);game.tick=4;ship.x+=2;wakes.update(game,200);expect(wakes.sampleCount).toBe(1);
    game.tick=5;ship.x+=500;wakes.update(game,250);expect(wakes.sampleCount).toBe(1);
    game.tick=0;wakes.update(game,300);expect(wakes.sampleCount).toBe(0);
  });
  it('clips bow foam and old trails to the same coastline',()=>{
    setScratchCanvasFactory((w,h)=>createCanvas(w,h) as unknown as HTMLCanvasElement);
    const {game,ship}=scene(),wakes=new ShipWakeTracker();
    game.map.terrain!.cells=Array.from({length:20},()=>'.'.repeat(10)+'~'.repeat(10)).join('');
    ship.x=340;wakes.update(game,0);game.tick=4;ship.x+=12;wakes.update(game,200);
    const canvas=createCanvas(640,640),ctx=canvas.getContext('2d');
    wakes.draw(ctx as unknown as CanvasRenderingContext2D,game.units,{x:0,y:0,width:640,height:640},200);
    const land=ctx.getImageData(0,0,280,640).data,water=ctx.getImageData(340,200,240,240).data;
    expect(land.some((value,i)=>i%4===3&&value>0)).toBe(false);
    expect(water.some((value,i)=>i%4===3&&value>0)).toBe(true);
  });
});
function seconds(value:number){return value*SIM_TICKS_PER_SECOND;}
