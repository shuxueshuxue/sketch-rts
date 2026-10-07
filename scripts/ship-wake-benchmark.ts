import { createCanvas } from '@napi-rs/canvas';
import { createGame } from '../src/shared/sim';
import { createUnit } from '../src/shared/map';
import { ShipWakeTracker } from '../src/client/ship-wakes';
import { setScratchCanvasFactory } from '../src/client/art/scratch-canvas';
import { SIM_TICKS_PER_SECOND } from '../src/shared/time';

// Isolated software-Canvas cost (not GPU timing or whole-game frame time).
setScratchCanvasFactory((w,h)=>createCanvas(w,h) as unknown as HTMLCanvasElement);
for(const ships of [8,32,64]){
  const game=createGame('bareDuel',{aiPlayers:[]});
  game.map.terrain={cell:32,cols:100,rows:60,cells:'~'.repeat(6000)};
  game.units=Array.from({length:ships},(_,i)=>createUnit(`s${i}`,'player','warship',180+i%8*150,130+Math.floor(i/8)*100));
  const wakes=new ShipWakeTracker();
  for(let i=0;i<SIM_TICKS_PER_SECOND*6;i++){
    game.tick=i;for(const u of game.units)u.x+=60/SIM_TICKS_PER_SECOND;
    wakes.update(game,i*1000/SIM_TICKS_PER_SECOND);
  }
  const canvas=createCanvas(1600,1000),ctx=canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  const view={x:0,y:0,width:1600,height:1000};
  wakes.draw(ctx,game.units,view,6000);
  const start=performance.now();
  for(let i=0;i<30;i++)wakes.draw(ctx,game.units,view,6000+i*10);
  console.log(JSON.stringify({ships,samples:wakes.sampleCount,msPerDraw:(performance.now()-start)/30}));
}
