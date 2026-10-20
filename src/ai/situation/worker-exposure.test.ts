import { expect,it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { mountedThreatReach,THINK_TICKS } from '../policy/threat-reach';
import { workerExposure } from './worker-exposure';

it('matches the original point safety threshold for ranged, melee, neutral and building threats',()=>{
  const game=sketchScene('worker-exposure-boundaries').map('bareDuel').replaceDefaults().player('us').player('foe')
    .unit('us','worker',400,500,{id:'worker'}).unit('foe','horseArcher',1500,1500,{id:'rider'})
    .unit('foe','lancer',2000,2000,{id:'lancer'}).unit('neutral','wildling',2500,2500,{id:'guard'})
    .tower('foe',3000,1000,{id:'tower'}).build().createGame();
  const snapshot=snapshotGame(game),worker=snapshot.units.find(unit=>unit.id==='worker')!;
  for(const foe of [...snapshot.units.filter(unit=>unit.id!=='worker'),...snapshot.buildings])for(const gap of [0,50,100,160,250,350,450,550,650,800]){
    const point={x:foe.x+gap,y:foe.y},reach=mountedThreatReach(snapshot,foe,{...worker,...point},THINK_TICKS);
    expect(workerExposure(snapshot,worker,point,{foes:[foe]}).length>0).toBe(reach>0&&gap<=reach+160);
  }
});

it('checks a charge annulus along a road even when its closest point lies inside minimum range',()=>{
  const game=sketchScene('charge-road').map('bareDuel').replaceDefaults().player('us').player('foe')
    .unit('us','worker',1500,2000,{id:'worker'}).unit('foe','lancer',2000,2000,{id:'lancer'}).build().createGame();
  const snapshot=snapshotGame(game),worker=snapshot.units.find(unit=>unit.id==='worker')!,foe=snapshot.units.find(unit=>unit.id==='lancer')!;
  const road=[{x:1500,y:2000},{x:2500,y:2000}];
  expect(workerExposure(snapshot,worker,road,{foes:[foe]}).length).toBeGreaterThan(0);
});
