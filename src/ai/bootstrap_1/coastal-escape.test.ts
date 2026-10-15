import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {createGame,issuePlayerCommand,restoreSnapshotIntoGame,snapshotGame,stepGame} from '../../shared/sim';
import {MOVE_ORDER_ARRIVAL_RANGE} from '../../shared/movement-rules';
import {shipProfile} from '../../shared/ship-geometry';
import type {BootstrapAiVersion} from '../../shared/types';
import {planBootstrapNaval} from './expedition-recovery';
import {bootstrapPolicyContext} from './policy';

const id='unit-p0-bombardShip-26580';
function observed(version:BootstrapAiVersion='v9_summoner') {
 const saved=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/coastal-escape-turn-trap.json.gz',import.meta.url))).toString());
 const game=createGame('bareDuel');restoreSnapshotIntoGame(game,saved.snapshot,saved.nextId);
 const snapshot=snapshotGame(game),ship=snapshot.units.find(u=>u.id===id)!;
 const options=bootstrapPolicyContext(snapshot,'p0',version,{memory:structuredClone(saved.memory),teams:game.teams});
 return {game,snapshot,ship,options};
}

it.each(['v9_archer','v9_summoner','v9_knight'] as const)('%s uses a real short astern move with covering fire in the observed fatal turn geometry',version=>{
 const {snapshot,ship,options}=observed(version);
 expect(snapshot.tick).toBe(165915);expect(ship.hp).toBe(ship.maxHp);
 const commands=planBootstrapNaval(snapshot,'p0',options).filter(c=>'unitIds'in c&&c.unitIds.includes(id));
 const command=commands.find(c=>c.type==='move');
 expect(command?.type).toBe('move');
 if(command?.type!=='move')throw new Error('missing ordinary escape move');
 const dx=command.x-ship.x,dy=command.y-ship.y,heading=ship.sailing!.heading;
 expect(dx*Math.cos(heading)+dy*Math.sin(heading)).toBeLessThan(-70);
 expect(Math.abs(-dx*Math.sin(heading)+dy*Math.cos(heading))).toBeLessThan(1e-6);
 expect(Math.hypot(dx,dy)).toBeLessThan(shipProfile(ship)!.length*.5);
 expect(command).toEqual({type:'move',unitIds:[id],x:command.x,y:command.y});
 expect(options.memory.naval!.coastalRetreat![id]).toEqual({x:command.x,y:command.y,astern:true});
});

it('finishes the native short move after passing 70px remaining and restores its precise saved mark',()=>{
 const {game,snapshot,ship,options}=observed();
 const command=planBootstrapNaval(snapshot,'p0',options).find(c=>c.type==='move'&&c.unitIds.includes(id));
 if(command?.type!=='move')throw new Error('missing ordinary escape move');
 issuePlayerCommand(game,'p0',command);
 // Native movement only; this is arrival regression, not a full-AI outcome.
 for(let i=0;i<100;i++)stepGame(game);
 const actual=game.units.find(u=>u.id===id)!,remaining=Math.hypot(actual.x-command.x,actual.y-command.y);
 expect(remaining).toBeGreaterThan(MOVE_ORDER_ARRIVAL_RANGE);expect(remaining).toBeLessThan(70);
 expect(actual.x).toBeGreaterThan(ship.x);
 const memory=JSON.parse(JSON.stringify(options.memory));
 const retreat=structuredClone(memory.naval.coastalRetreat[id]);
 const next=snapshotGame(game),context=bootstrapPolicyContext(next,'p0','v9_summoner',{memory,teams:game.teams});
 const commands=planBootstrapNaval(next,'p0',context).filter(c=>'unitIds'in c&&c.unitIds.includes(id));
 expect(commands).toEqual([]);
 expect(context.memory.naval!.coastalRetreat![id]).toEqual(retreat);
});
