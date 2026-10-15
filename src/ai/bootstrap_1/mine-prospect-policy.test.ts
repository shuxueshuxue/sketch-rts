import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { planAiOwnerCommandEntries } from '../planner-context';
import { BOOTSTRAP_VERSIONS } from './policy';

function checkpoint(name: string) {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL(`./fixtures/${name}.json.gz`, import.meta.url))).toString());
  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  return { game, snapshot: snapshotGame(game), memory: saved.memory };
}

it.each(BOOTSTRAP_VERSIONS)('%s retains the real 46785 capital for the safe 6000-gold island instead of a dying 480-gold mine', version => {
  const { game, snapshot, memory } = checkpoint('archer-dying-colony');
  const dying = snapshot.resources.find(mine => mine.id === 'gold-satellite-2')!;
  const safe = snapshot.resources.find(mine => mine.id === 'gold-seat2-main')!;
  expect(snapshot.tick).toBe(46785);
  expect(snapshot.players.p0!.gold).toBe(412.45);
  expect(snapshot.players.p0!.supplyUsed).toBe(105);
  expect(dying.amount).toBe(480);
  expect(safe.amount).toBe(6000);
  expect(memory.naval.island.plan.mineId).toBe(dying.id);
  const original = JSON.stringify(snapshot);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, memory }, { teams: game.teams });
  expect(entries.filter(({ command }) => command.type === 'build' && command.buildingKind === 'townHall'
    && Math.hypot(command.x - dying.x, command.y - dying.y) < 320)).toEqual([]);
  expect(memory.naval.island.plan.mineId).toBe(safe.id);
  // Neither the source world's resource amounts nor the observed cash is changed to obtain this decision.
  expect(JSON.stringify(snapshot)).toBe(original);
});

it.each(BOOTSTRAP_VERSIONS)('%s declines the real 49125 ten-worker rebase before its target mine runs dry during the voyage', version => {
  const { game, snapshot, memory } = checkpoint('archer-dying-rebase-before-policy');
  const dying = snapshot.resources.find(mine => mine.id === 'gold-satellite-2')!;
  const carrierId = 'unit-p0-carrier-3510';
  expect(snapshot.tick).toBe(49125);
  expect(dying.amount).toBe(250);
  expect(snapshot.units.filter(unit => unit.order.type === 'mine' && unit.order.resourceId === dying.id)).toHaveLength(2);
  expect(memory.naval.ferries[carrierId]).toBeUndefined();
  const original = JSON.stringify(snapshot);
  const entries = planAiOwnerCommandEntries(snapshot, { playerId: 'p0', version, memory }, { teams: game.teams });
  const mission = memory.naval.ferries[carrierId];
  expect(mission?.purpose === 'rebase' && mission.targetId === dying.id).toBe(false);
  const workers = new Set(snapshot.units.filter(unit => unit.owner === 'p0' && unit.kind === 'worker').map(unit => unit.id));
  const boarding = entries.flatMap(({ command }) => command.type === 'board' && command.transportId === carrierId
    ? command.unitIds.filter(id => workers.has(id)) : []);
  if (boarding.length) {
    // The same hull may instead take engineers to the observed untouched safe mine.
    expect(mission?.purpose).toBe('settle');
    expect(mission?.targetId).toBe('gold-seat2-main');
    expect(snapshot.resources.find(mine => mine.id === mission.targetId)!.amount).toBe(6000);
  }
  expect(JSON.stringify(snapshot)).toBe(original);
});
