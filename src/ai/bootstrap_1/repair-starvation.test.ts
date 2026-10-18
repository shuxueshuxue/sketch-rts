import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { createGame, restoreSnapshotIntoGame, snapshotGame, stepGame } from '../../shared/sim';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { planAiOwnerCommandEntries } from '../planner-context';
import { transportNeedsRecovery } from './transport-recovery';

const boatIds = ['unit-p0-transport-5237', 'unit-p0-carrier-6518'];
function saved() {
  const frame = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/repair-starvation-84000.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel');
  restoreSnapshotIntoGame(game, frame.snapshot, frame.nextId);
  return { game, memory: frame.memories.p0 };
}

it.each(['v9_archer', 'v9_summoner', 'v9_knight'] as const)(
  '%s uses both operational hulls when the actual exhausted economy cannot pay for maintenance', version => {
    const { game, memory } = saved();
    const gold = game.players.p0!.gold;
    const hp = boatIds.map(id => game.units.find(unit => unit.id === id)!.hp);
    const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'p0', version, memory }, { teams: game.teams });
    for (const id of boatIds) expect(entries.some(entry => entry.command.type === 'board' && entry.command.transportId === id)).toBe(true);
    issueCommandFrame(game, entries);
    for (let tick = 0; tick < 15; tick++) stepGame(game);
    expect(game.players.p0!.gold).toBe(gold);
    expect(boatIds.map(id => game.units.find(unit => unit.id === id)!.hp)).toEqual(hp);
    expect(game.units.some(unit => unit.order.type === 'board' && unit.order.transportId === boatIds[0])).toBe(true);
  });

it.each(['funded', 'working-mine', 'carried-gold', 'rudder', 'rigging', 'hull'] as const)(
  'keeps recovery when the real post has a funding path or an unsafe hull (%s)', scenario => {
    const { game } = saved();
    if (scenario === 'funded') game.players.p0!.gold = 1;
    if (scenario === 'working-mine') game.resources.find(resource => resource.id === 'gold-seat0-main')!.amount = 500;
    if (scenario === 'carried-gold') game.units.find(unit => unit.owner === 'p0' && unit.kind === 'worker')!.carryingGold = 10;
    for (const id of boatIds) {
      const boat = game.units.find(unit => unit.id === id)!;
      if (scenario === 'rudder') boat.shipParts!.rudder = 0;
      if (scenario === 'rigging') boat.shipParts!.rigging = 0;
      if (scenario === 'hull') boat.hp = boat.maxHp * .2;
      expect(transportNeedsRecovery(snapshotGame(game), boat)).toBe(true);
    }
  });
