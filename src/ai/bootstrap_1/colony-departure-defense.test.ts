import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {createGame,restoreSnapshotIntoGame,snapshotGame} from '../../shared/sim';
import {planNavalTactics} from '../policy/naval';
import {bootstrapPolicyContext} from './policy';

it.each(['v9_archer','v9_summoner','v9_knight'] as const)('%s reserves actual island defenders before an enemy convoy lands',version=>{
 const saved=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/knight-colony-defense.json.gz',import.meta.url))).toString());
 const game=createGame('bareDuel');restoreSnapshotIntoGame(game,saved.snapshot,saved.nextId);
 const guards=['unit-p0-lancer-1343','unit-p0-footman-6758','unit-p0-footman-6751'];
 const commands=(incoming:boolean)=>{
  const s=snapshotGame(game);if(!incoming)s.units.find(u=>u.id==='unit-p1-transport-1522')!.order={type:'idle'};
  const options=bootstrapPolicyContext(s,'p0',version,{memory:structuredClone(saved.memory),teams:game.teams});
  return planNavalTactics(s,'p0',options).filter(c=>c.type==='board').flatMap(c=>c.unitIds);
 };
 expect(commands(true).filter(id=>guards.includes(id))).toEqual([]);
 expect(commands(false).filter(id=>guards.includes(id))).toEqual(expect.arrayContaining(guards));
});
