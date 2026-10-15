import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { UNIT_DEFS } from '../../shared/catalog';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { bootstrapPolicyContext } from './policy';
import { missingMiningWorkers, planMiningWorkforce } from './workforce';

const fixture = (tick: number) => JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/mining-workforce-knight-${tick}.json.gz`, import.meta.url))).toString());

// Real ordinary0 knight worlds, nextId and both policy memories. The match
// eventually won at135692; these are economic efficiency regressions, not a
// changed result or proof that lack of two workers prevented that victory.
describe('transported mining labor belongs to its actual destination', () => {
  it.each(['v9_archer','v9_summoner','v9_knight'] as const)('%s does not credit two committed other-island assault workers to the central mines', version => {
    const frame=fixture(132000),game=createGame('bareDuel');
    restoreSnapshotIntoGame(game,frame.snapshot,frame.nextId);
    const snapshot=snapshotGame(game),context=bootstrapPolicyContext(snapshot,'p0',version,{teams:snapshot.teams!,memory:frame.memories.p0});
    const before=JSON.stringify(snapshot);
    expect(missingMiningWorkers(snapshot,'p0',1,context)).toBe(2);
    const commands=planMiningWorkforce(snapshot,'p0',1,context);
    expect(commands).toEqual([{type:'train',buildingId:'building-p0-townHall-11793',unitKind:'worker'}]);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(game.players.p0!.gold).toBe(90.57);
    expect(game.players.p0!.supplyUsed+UNIT_DEFS.worker.supplyUsed).toBeLessThanOrEqual(game.players.p0!.supplyCap);
    issuePlayerCommand(game,'p0',commands[0]!);
    expect(game.players.p0!.gold).toBe(15.57);
    expect(game.match.stats.goldSpent.p0! - frame.snapshot.match.stats.goldSpent.p0).toBe(75);
    expect(game.buildings.find(building=>building.id==='building-p0-townHall-11793')!.queue).toMatchObject([{unitKind:'worker',paidGold:75}]);
  });

  it('credits the actual rebasing worker once while excluding the other ship returning to a different island', () => {
    const frame=fixture(135600),game=createGame('bareDuel');
    restoreSnapshotIntoGame(game,frame.snapshot,frame.nextId);
    const snapshot=snapshotGame(game),context=bootstrapPolicyContext(snapshot,'p0','v9_knight',{teams:snapshot.teams!,memory:frame.memories.p0});
    expect(context.memory.naval!.ferries!['unit-p0-carrier-6933']!.purpose).toBe('rebase');
    expect(context.memory.naval!.ferries!['unit-p0-carrier-6933']!.targetId).toBe('gold-mainland-2');
    expect(missingMiningWorkers(snapshot,'p0',1,context)).toBe(1);
    expect(planMiningWorkforce(snapshot,'p0',1,context)).toEqual([{type:'train',buildingId:'building-p0-townHall-11793',unitKind:'worker'}]);
  });
});
