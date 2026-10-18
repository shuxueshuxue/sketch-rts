import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {loadingApproach} from './loading-approach';
import {createGame,restoreSnapshotIntoGame,snapshotGame} from '../../shared/sim';
import type {GameCommand} from '../../shared/types';
const input=new URL('./fixtures/loading-approach-51060.json.gz',import.meta.url);
function saved(){
 const f=JSON.parse(gunzipSync(readFileSync(input)).toString());
 const game=createGame('bareDuel');restoreSnapshotIntoGame(game,f.snapshot,f.nextId);
 return {game,s:snapshotGame(game),options:{memory:f.memory,teams:f.teams},planned:f.planned.map((e:any)=>e.command) as GameCommand[]};
}
it('uses only the existing berth coordinate after the actual failed approach',()=>{
 const {s,options,planned}=saved();expect(loadingApproach(s,'p0',options,planned)).toEqual([{type:'move',unitIds:['unit-p0-transport-5237'],x:4152,y:5880}]);
 expect(loadingApproach(s,'p0',options,planned)).toEqual([]);
});
it.each(['recent-progress','crew-changed','berth-changed','other-command','already-moving','no-shore-crew','sailing-mission'] as const)('preserves native activity: %s',reason=>{
 const {s,options,planned}=saved(),id='unit-p0-transport-5237',boat=s.units.find(u=>u.id===id)!;
 const crew=s.units.filter(u=>u.order.type==='board'&&u.order.transportId===id&&!u.deck);
 if(reason==='recent-progress')options.memory.naval.loadingApproaches[id].tick=s.tick;
 if(reason==='crew-changed')crew[0]!.order={type:'idle'};
 if(reason==='berth-changed')for(const u of crew)if(u.order.type==='board')u.order.berth!.x+=64;
 if(reason==='other-command')planned.push({type:'holdPosition',unitIds:[id]});
 if(reason==='already-moving')boat.order={type:'move',x:5000,y:5000};
 if(reason==='no-shore-crew')for(const u of crew){u.x=100;u.y=100;}
 if(reason==='sailing-mission')options.memory.naval.ferries[id].phase='sailing';
 expect(loadingApproach(s,'p0',options,planned)).toEqual([]);
});
