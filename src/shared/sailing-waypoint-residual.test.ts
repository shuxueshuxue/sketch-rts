import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {createGame,restoreSnapshotIntoGame,snapshotGame,stepGame} from './sim';

it('leaves an already reached repair-route waypoint despite the keel lateral residual, including save/restore',()=>{
 const saved=JSON.parse(gunzipSync(readFileSync(new URL('../ai/bootstrap_1/fixtures/summoner-repair-waypoint.json.gz',import.meta.url))).toString());
 const game=createGame('bareDuel');restoreSnapshotIntoGame(game,saved.snapshot,saved.nextId);
 const ship=game.units.find(u=>u.id==='unit-p0-carrier-40005')!,start={x:ship.x,y:ship.y};
 const first=ship.sailing!.route!.points[0]!;
 expect(Math.hypot(first.x-ship.x,first.y-ship.y)).toBeGreaterThan(1e-7);
 expect(Math.hypot(first.x-ship.x,first.y-ship.y)).toBeLessThan(1e-5);
 let replay:ReturnType<typeof createGame>|undefined;
 for(let i=0;i<180;i++){
  if(i===30){const frame=JSON.parse(JSON.stringify({snapshot:snapshotGame(game),nextId:game.nextId}));replay=createGame('bareDuel');restoreSnapshotIntoGame(replay,frame.snapshot,frame.nextId);}
  stepGame(game);if(replay)stepGame(replay);
 }
 expect(Math.hypot(ship.x-start.x,ship.y-start.y)).toBeGreaterThan(30);
 expect(snapshotGame(replay!)).toEqual(snapshotGame(game));expect(replay!.nextId).toBe(game.nextId);
},60000);
