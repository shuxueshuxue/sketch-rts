import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect,it } from 'vitest';
import { createGame,restoreSnapshotIntoGame,stepGame } from './sim';
import { hullPassageClear } from './ship-navigation';
import { shipTraffic } from './ship-avoidance';
import { shipMotionLimits } from './ship-motion';
import { SIM_TICKS_PER_SECOND } from './time';
import type {GameSnapshot} from './types';

function savedScene() {
 const saved=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/crew-rendezvous-headland-first-impact-1942.json.gz',import.meta.url))).toString()) as {snapshot:GameSnapshot;nextId:number;scriptedVictory:boolean};
 const game=createGame('bareDuel',{aiPlayers:[]});
 restoreSnapshotIntoGame(game,saved.snapshot,saved.nextId);game.scriptedVictory=saved.scriptedVictory;
 return {game,source:game.units.find(unit=>unit.kind==='warship')!,receiver:game.units.find(unit=>unit.kind==='transport')!};
}

it('rechecks a published headland rendezvous turn before its real friendly hull impact',()=>{
 const {game,source,receiver}=savedScene();
 const from={x:receiver.x,y:receiver.y,heading:receiver.sailing!.heading};
 const to={...from,heading:from.heading+shipMotionLimits(receiver).turnRate/SIM_TICKS_PER_SECOND};
 expect(game.tick).toBe(1942);expect(receiver.order.type).toBe('move');
 expect(hullPassageClear(game.map,receiver,from,to)).toBe(true);
 expect(shipTraffic(receiver,game.units)(from,to)).toBe(false);
 const hp=[source.hp,receiver.hp],hits:number[]=[];
 game.observer={hit(_attacker,_target,damage){hits.push(damage);}};
 stepGame(game);
 expect(hits).toEqual([]);
 expect([source.hp,receiver.hp]).toEqual(hp);
 expect(receiver.sailing!.heading).toBe(from.heading);
});

it('continues the same exact native turn when the partner has physically left its corridor',()=>{
 const {game,source,receiver}=savedScene();
 source.x-=600;
 const before=receiver.sailing!.heading,hp=[source.hp,receiver.hp],hits:number[]=[];
 game.observer={hit(_attacker,_target,damage){hits.push(damage);}};
 stepGame(game);
 expect(receiver.sailing!.heading).toBeGreaterThan(before);
 expect(receiver.sailing!.heading-before).toBeLessThanOrEqual(shipMotionLimits(receiver).turnRate/SIM_TICKS_PER_SECOND+1e-9);
 expect([source.hp,receiver.hp]).toEqual(hp);expect(hits).toEqual([]);
});
