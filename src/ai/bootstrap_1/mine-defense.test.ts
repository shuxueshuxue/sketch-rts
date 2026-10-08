import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext } from './policy';
import { mineDefense, planBootstrapGeneral } from './mine-defense';
import { readV6Intel } from '../policy/v6/intel';

function twoFronts(raiders = 4, guard: 'lancer' | 'knight' = 'lancer') {
  let scene = sketchScene('independent-mine-defense').replaceDefaults()
    .player('us', { team: 'a', race: 'grove' }).player('fa', { team: 'b', race: 'grove' }).player('fb', { team: 'b', race: 'grove' })
    .townHall('us', 400, 1000).townHall('us', 1600, 1600, { id: 'mine-hall' })
    .goldMine('main', 688, 1000, 4000).goldMine('natural', 1888, 1600, 4000)
    .townHall('fa', 3500, 3000, { id: 'attack-hall' }).townHall('fb', 3500, 800)
    .farms('us', 8, 400, 2200);
  for (let i = 0; i < 5; i++) scene = scene.worker('us', 1650 + i * 35, 1700, { id: `miner-${i}` });
  for (let i = 0; i < 2; i++) scene = scene.unit('us', guard, 1750 + i * 50, 1800, { id: `guard-melee-${i}` });
  for (let i = 0; i < 3; i++) scene = scene.unit('us', 'horseArcher', 1650 + i * 50, 1850, { id: `guard-ranged-${i}` });
  for (let i = 0; i < 10; i++) scene = scene.unit('us', 'horseArcher', 2650 + i % 3 * 40, 2800 + Math.floor(i / 3) * 40,
    { id: `striker-${i}`, order: { type: 'attackMove', x: 3500, y: 3000 } });
  for (let i = 0; i < raiders; i++) scene = scene.unit('fb', 'footman', 1560 + i % 3 * 35, 1120 - Math.floor(i / 3) * 35,
    { id: `raider-${i}`, order: { type: 'attackMove', x: 1600, y: 1600 } });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  issuePlayerCommand(game, 'us', { type: 'mine', unitIds: game.units.filter(unit => unit.kind === 'worker').map(unit => unit.id), resourceId: 'natural' });
  memory.v6 = { phase: 3, general: { mode: 'attack', targetHallId: 'attack-hall', target: { x: 3500, y: 3000 },
    group: game.units.filter(unit => unit.id.startsWith('striker')).map(unit => unit.id), groupStart: 15 } };
  return { game, memory, context: () => bootstrapPolicyContext(snapshotGame(game), 'us', 'v9_archer', { memory, teams: game.teams, policyMode: 'combat' }) };
}

describe('bootstrap_1 independent mine defense', () => {
  it('defends the miners while the distant main army completes its attack', () => {
    const { game, context } = twoFronts(4, 'knight');
    issuePlayerCommand(game, 'us', { type: 'setAutocast', unitIds: game.units.filter(unit => unit.kind === 'knight').map(unit => unit.id), ability: 'charge', enabled: false });
    let guardCharged = false;
    for (let tick = 0; tick < 1200 && !game.match.winner; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game);
        for (const { command } of runAiCommandEntriesFromScripts(snapshot, 'us',
          [mineDefense, { ...AI_SCRIPT_LIBRARY.v6General, run: planBootstrapGeneral }], context())) {
          if (command.type === 'cast' && command.ability === 'charge') guardCharged = true;
          issuePlayerCommand(game, 'us', command);
        }
      }
      stepGame(game);
    }
    expect(game.buildings.find(building => building.id === 'mine-hall')!.hp).toBeGreaterThan(700);
    expect(guardCharged).toBe(true);
    expect(game.units.filter(unit => unit.kind === 'worker')).toHaveLength(5);
    expect(game.units.filter(unit => unit.id.startsWith('raider'))).toHaveLength(0);
    expect(game.buildings.some(building => building.id === 'attack-hall')).toBe(false);
  });

  it('keeps a raid that exceeds a detachment in the main commander’s defense scope', () => {
    const { game, context, memory } = twoFronts(18), snapshot = snapshotGame(game);
    expect(mineDefense.claimsUnits!(snapshot, 'us', context()).size).toBe(0);
    const commands = planBootstrapGeneral(snapshot, 'us', context());
    expect(commands.some(command => 'unitIds' in command && command.unitIds.some(id => id.startsWith('striker')))).toBe(true);
    expect(['defend', 'guard']).toContain(memory.v6!.general!.mode);
  });

  it('releases the guard as soon as the raid is removed, without changing enemy intel', () => {
    const { game, context } = twoFronts();
    const snapshot = snapshotGame(game), options = context(), intel = structuredClone(readV6Intel(snapshot, 'us', options));
    expect(mineDefense.claimsUnits!(snapshot, 'us', options).size).toBeGreaterThan(0);
    planBootstrapGeneral(snapshot, 'us', options);
    expect(readV6Intel(snapshot, 'us', options)).toEqual(intel);
    game.units = game.units.filter(unit => !unit.id.startsWith('raider'));
    expect(mineDefense.claimsUnits!(snapshotGame(game), 'us', context()).size).toBe(0);
  });
});
