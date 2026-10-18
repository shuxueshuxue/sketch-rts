import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expect,it} from 'vitest';
import {createGame,restoreSnapshotIntoGame,snapshotGame} from '../../shared/sim';
import {bootstrapPolicyContext,BOOTSTRAP_VERSIONS} from './policy';
import {planBootstrapEconomy,rankBootstrapGoals} from './economy';
import {navalBudgetReserve} from '../policy/naval';
function saved(){const f=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/established-colony-care-40200.json.gz',import.meta.url))).toString());const game=createGame('bareDuel');restoreSnapshotIntoGame(game,f.snapshot,f.nextId);return {game,memory:f.memories.p0};}
it.each(BOOTSTRAP_VERSIONS)('%s funds higher-priority care at working income before its additional hall',version=>{
 const {game,memory}=saved(),s=snapshotGame(game),before=JSON.stringify(s),o=bootstrapPolicyContext(s,'p0',version,{memory,teams:game.teams});
 expect(s.players.p0!.gold).toBe(177.56);expect(navalBudgetReserve(s,'p0',o)).toBe(0);
 const goals=rankBootstrapGoals(s,'p0',o),care=goals.find(g=>g.id==='colony:recovery:building-p0-townHall-10072')!,capital=goals.find(g=>g.id==='naval:islandHall')!;
 expect(care.priority).toBeGreaterThan(capital.priority);expect(care.cost).toBe(115);expect(capital.cost).toBe(400);
 expect(planBootstrapEconomy(s,'p0',o)).toContainEqual(care.issue(new Set()));expect(JSON.stringify(s)).toBe(before);
});
