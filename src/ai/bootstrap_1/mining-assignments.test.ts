import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { miningAssignments } from './mining-assignments';

function miningRaid() {
  let scene = sketchScene('mining-hall-destruction').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'ember', team: 'b' })
    .playerState('us', { gold: 0 })
    .building('us', 'townHall', 400, 600, { id: 'lost-hall' }).goldMine('lost', 688, 600, 4000)
    .townHall('us', 1700, 600).goldMine('working', 1988, 600, 4000)
    .townHall('foe', 2800, 2800).farms('us', 3, 400, 2000);
  for (let index = 0; index < 5; index++) scene = scene.worker('us', 650 + index * 30, 600, { id: `lost-miner-${index}` });
  for (let index = 0; index < 2; index++) scene = scene.worker('us', 1800 + index * 40, 600, { id: `working-miner-${index}` });
  // Shells strike the western wall, away from the miners' eastern hauling route.
  for (let index = 0; index < 3; index++) scene = scene.unit('foe', 'catapult', 80 + index * 60, 600);
  const game = scene.build().createGame();
  issuePlayerCommand(game, 'us', { type: 'mine', resourceId: 'lost', unitIds: game.units.filter(unit => unit.id.startsWith('lost-miner-')).map(unit => unit.id) });
  issuePlayerCommand(game, 'us', { type: 'mine', resourceId: 'working', unitIds: game.units.filter(unit => unit.id.startsWith('working-miner-')).map(unit => unit.id) });
  issuePlayerCommand(game, 'foe', { type: 'attack', targetId: 'lost-hall', unitIds: game.units.filter(unit => unit.owner === 'foe').map(unit => unit.id) });
  return game;
}

describe('bootstrap_1 mining assignments', () => {
  it('recalls surviving miners and restores hauling after artillery destroys their hall', () => {
    const control = miningRaid(), candidate = miningRaid();
    const contexts = [control, candidate].map(game => ({ version: 'v2' as const, requestedVersion: 'v9' as const, memory: createAiPolicyMemory(), teams: game.teams }));
    const fallen = [false, false], survivors = [0, 0];
    for (let tick = 0; tick < 1600; tick++) {
      for (const [index, game] of [control, candidate].entries()) {
        if (tick % 15 === 0) for (const entry of runAiCommandEntriesFromScripts(snapshotGame(game), 'us',
          index === 0 ? [AI_SCRIPT_LIBRARY.economy] : [AI_SCRIPT_LIBRARY.economy, miningAssignments], contexts[index]!)) issuePlayerCommand(game, 'us', entry.command);
        stepGame(game);
        if (!fallen[index] && !game.buildings.some(building => building.id === 'lost-hall')) {
          fallen[index] = true;
          survivors[index] = game.units.filter(unit => unit.id.startsWith('lost-miner-')).length;
          // The battery holds the captured mine; it can still shoot workers who stay there.
          issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === 'foe').map(unit => unit.id) });
        }
      }
    }
    expect(candidate.buildings.some(building => building.id === 'lost-hall')).toBe(false);
    expect(survivors).toEqual([5, 5]);
    expect(control.units.filter(unit => unit.id.startsWith('lost-miner-')).length).toBeLessThan(survivors[0]!);
    expect(candidate.units.filter(unit => unit.id.startsWith('lost-miner-')).length)
      .toBeGreaterThan(control.units.filter(unit => unit.id.startsWith('lost-miner-')).length);
    expect(candidate.buildings.filter(building => building.owner === 'us' && building.kind === 'townHall')).toHaveLength(1);
    expect(candidate.units.filter(unit => unit.id.startsWith('working-miner-'))).toHaveLength(2);
    expect(candidate.units.filter(unit => unit.owner === 'us' && unit.order.type === 'mine' && unit.order.resourceId === 'working'))
      .toHaveLength(candidate.units.filter(unit => unit.owner === 'us').length);
    expect(candidate.players.us!.gold).toBeGreaterThan(control.players.us!.gold);
    expect(candidate.match.stats.goldSpent.us).toBe(0);
  });
});
