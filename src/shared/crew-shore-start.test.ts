import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {createGame,restoreSnapshotIntoGame,snapshotGame,stepGame} from './sim';
import {connectedSurfacePath,decksCanTransfer} from './connected-decks';
import {canBoard} from './decks';

it('walks a shore-supported foredeck start toward another hull in the real outfitted fleet',()=>{
 const saved=JSON.parse(gunzipSync(readFileSync(new URL('../ai/bootstrap_1/fixtures/archer-shore-start.json.gz',import.meta.url))).toString());
 const game=createGame('bareDuel');restoreSnapshotIntoGame(game,saved.snapshot,saved.nextId);
 const crew=game.units.find(u=>u.id==='unit-p0-archer-18505')!,source=game.units.find(u=>u.id===crew.deck!.shipId)!,target=game.units.find(u=>u.id==='unit-p0-warship-1115')!;
 expect(canBoard(target,crew,game.units)).toBe(true);
 expect(decksCanTransfer(source,target,crew)).toBe(true);
 expect(connectedSurfacePath(crew,target,[source,target,crew],game.map)?.complete).toBe(true);
 const ocean={...game.map,terrain:{...game.map.terrain!,cells:'~'.repeat(game.map.terrain!.cells.length)}};
 expect(connectedSurfacePath(crew,target,[source,target,crew],ocean)?.complete).toBe(false);
 let replay:ReturnType<typeof createGame>|undefined;
 for(let i=0;i<1800 && crew.deck?.shipId!==target.id;i++) {
  if(i===15) {
   const checkpoint=JSON.parse(JSON.stringify({snapshot:snapshotGame(game),nextId:game.nextId}));
   replay=createGame('bareDuel');restoreSnapshotIntoGame(replay,checkpoint.snapshot,checkpoint.nextId);
  }
  stepGame(game);if(replay)stepGame(replay);
 }
 expect(replay).toBeDefined();
 expect(snapshotGame(replay!)).toEqual(snapshotGame(game));
 expect(replay!.nextId).toBe(game.nextId);
 expect(crew.deck?.shipId).toBe(target.id);
 expect(game.units.includes(crew)).toBe(true);
},60000);
