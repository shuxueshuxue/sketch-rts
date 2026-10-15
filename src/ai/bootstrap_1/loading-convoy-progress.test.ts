import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {createGame,restoreSnapshotIntoGame,snapshotGame} from '../../shared/sim';
import {shipPassengers} from '../../shared/ship-geometry';
import {planNavalTactics} from '../policy/naval';
import {bootstrapPolicyContext} from './policy';

it.each(['v9_archer','v9_summoner','v9_knight'] as const)('%s retains loaded crew while its actual companion ferries still approach, and cancels a wholly stalled convoy',version=>{
 const saved=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/archer-loading-convoy.json.gz',import.meta.url))).toString());
 for(const progressing of [true,false]){
  const game=createGame('bareDuel');restoreSnapshotIntoGame(game,saved.snapshot,saved.nextId);
  const s=snapshotGame(game),options=bootstrapPolicyContext(s,'p0',version,{memory:structuredClone(saved.memory),teams:game.teams});
  const id='unit-p0-carrier-4129',ferries=options.memory.naval!.ferries!,mission=ferries[id]!;
  mission.progress!.tick=s.tick-1215;
  if(!progressing)for(const [key,m] of Object.entries(ferries)){
   const ship=s.units.find(u=>u.id===key)!;
   m.progress={tick:s.tick-1215,x:ship.x,y:ship.y,heading:ship.sailing!.heading,phase:m.phase,crew:shipPassengers(s.units,ship).map(u=>u.id).join('|')};
  }
  const commands=planNavalTactics(s,'p0',options);
  expect(mission.phase).toBe(progressing?'loading':'return');
  expect(commands.some(c=>c.type==='unload'&&c.unitIds.includes(id))).toBe(!progressing);
 }
});
