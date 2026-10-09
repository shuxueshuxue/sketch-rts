import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { planBattleRepairs } from './repair';

function fight(repair: boolean) {
  const game = sketchScene('tower-under-fire').replaceDefaults()
    .player('us', { race: 'grove' }).player('foe', { race: 'grove' })
    .playerState('us', { gold: 1000 }).townHall('us', 500, 500).townHall('foe', 2600, 2600)
    .tower('us', 700, 650, { id: 'tower', hp: 175 }).unit('us', 'worker', 520, 650, { id: 'repairer' })
    .unit('foe', 'archer', 950, 580, { id: 'a' }).unit('foe', 'archer', 950, 650, { id: 'b' })
    .unit('foe', 'archer', 950, 720, { id: 'c' }).build().createGame();
  issuePlayerCommand(game, 'foe', { type: 'attack', unitIds: ['a', 'b', 'c'], targetId: 'tower' });
  const options = { version: 'v2' as const, requestedVersion: 'v9' as const, memory: createAiPolicyMemory() };
  let commands = 0;
  for (let tick = 0; tick < 600; tick++) {
    if (repair && tick % 15 === 0) {
      for (const command of planBattleRepairs(snapshotGame(game), 'us', options)) {
        issuePlayerCommand(game, 'us', command);
        commands++;
      }
    }
    stepGame(game);
  }
  return { game, commands };
}

describe('bootstrap_1 battle repair', () => {
  it('keeps five miners when two damaged towers compete for one surplus worker', () => {
    let scene = sketchScene('repair-preserves-income').replaceDefaults()
      .player('us', { race: 'grove' }).player('foe', { race: 'grove' })
      .playerState('us', { gold: 1000 }).townHall('us', 500, 500).townHall('foe', 2600, 2600)
      .goldMine('mine', 788, 500, 4000)
      .tower('us', 650, 650, { id: 'tower-a', hp: 150 })
      .tower('us', 760, 650, { id: 'tower-b', hp: 170 })
      .unit('foe', 'archer', 900, 750, { id: 'attacker-a' })
      .unit('foe', 'archer', 980, 750, { id: 'attacker-b' });
    for (let index = 0; index < 6; index++) scene = scene.worker('us', 600 + index * 25, 550, { id: `miner-${index}` });
    const game = scene.build().createGame();
    issuePlayerCommand(game, 'us', { type: 'mine', unitIds: game.units.filter(unit => unit.owner === 'us').map(unit => unit.id), resourceId: 'mine' });
    issuePlayerCommand(game, 'foe', { type: 'attack', unitIds: ['attacker-a'], targetId: 'tower-a' });
    issuePlayerCommand(game, 'foe', { type: 'attack', unitIds: ['attacker-b'], targetId: 'tower-b' });
    const commands = planBattleRepairs(snapshotGame(game), 'us', { version: 'v2', requestedVersion: 'v9', memory: createAiPolicyMemory() });
    for (const command of commands) issuePlayerCommand(game, 'us', command);
    expect(game.units.filter(unit => unit.owner === 'us' && unit.order.type === 'mine')).toHaveLength(5);
    expect(game.units.filter(unit => unit.owner === 'us' && unit.order.type === 'repair')).toHaveLength(1);
  });

  it('spends normal gold to keep a tower alive through a ranged attack that otherwise destroys it', () => {
    const control = fight(false), candidate = fight(true);
    expect(control.game.buildings.some(building => building.id === 'tower')).toBe(false);
    expect(candidate.game.buildings.some(building => building.id === 'tower')).toBe(true);
    expect(candidate.game.players.us!.gold).toBeLessThan(control.game.players.us!.gold);
    expect(candidate.commands).toBeGreaterThan(0);
  });
});
