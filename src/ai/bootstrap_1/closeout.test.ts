import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext } from './policy';
import { mineDefense, mineGuardUnitIds, planBootstrapCloseout } from './mine-defense';

const closeout = { ...AI_SCRIPT_LIBRARY.v6Closeout, run: planBootstrapCloseout };

describe('bootstrap_1 closeout allocation', () => {
  it.each([false, true])('keeps the mining detachment when closeout selects its crew (existing assignment=%s)', ongoing => {
    let scene = sketchScene('closeout-with-mine-guards').replaceDefaults()
      .player('us', { team: 'a' }).player('beaten', { team: 'b' }).player('active', { team: 'b' })
      .townHall('us', 500, 500).townHall('us', 1000, 1600, { id: 'mine-hall' })
      .goldMine('mine', 1288, 1600, 4000).townHall('beaten', 1650, 1700, { id: 'last-hall', hp: 48 })
      .townHall('active', 3500, 3400).farms('us', 12, 400, 2400);
    for (let i = 0; i < 5; i++) scene = scene.worker('us', 1100 + i * 35, 1700, { id: `miner-${i}` });
    for (let i = 0; i < 3; i++) scene = scene.unit('us', 'knight', 1300 + i * 35, 1700, { id: `guard-${i}` })
      .unit('active', 'footman', 1000 + i * 35, 1100, { id: `raider-${i}`, order: { type: 'attackMove', x: 1000, y: 1600 } });
    for (let i = 0; i < 11; i++) scene = scene.unit('us', 'knight', 2500 + i % 4 * 35, 2800 + Math.floor(i / 4) * 35, { id: `main-${i}` });
    for (let i = 0; i < 8; i++) scene = scene.unit('active', 'footman', 3500 + i % 4 * 35, 3400 + Math.floor(i / 4) * 35);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    issuePlayerCommand(game, 'us', { type: 'mine', unitIds: ['miner-0', 'miner-1', 'miner-2', 'miner-3', 'miner-4'], resourceId: 'mine' });
    const options = () => bootstrapPolicyContext(snapshotGame(game), 'us', 'v9_knight', { memory, teams: game.teams });
    const guards = mineGuardUnitIds(snapshotGame(game), 'us', options());
    expect(guards.size).toBe(3);
    if (ongoing) memory.v6 = { closeout: { unitIds: [...guards], targetId: 'last-hall', sinceTick: 0 } };
    for (const { command } of runAiCommandEntriesFromScripts(snapshotGame(game), 'us', [mineDefense, closeout], options())) issuePlayerCommand(game, 'us', command);
    expect(memory.v6!.closeout!.unitIds.every(id => !guards.has(id))).toBe(true);
    for (let tick = 0; tick < 1000; tick++) {
      if (tick % 15 === 0) for (const { command } of runAiCommandEntriesFromScripts(snapshotGame(game), 'us', [mineDefense, closeout], options())) issuePlayerCommand(game, 'us', command);
      stepGame(game);
    }
    expect(game.units.filter(unit => unit.id.startsWith('miner-'))).toHaveLength(5);
    expect(game.units.filter(unit => unit.id.startsWith('raider-'))).toHaveLength(0);
    expect(game.buildings.some(building => building.id === 'last-hall')).toBe(false);
    expect(game.buildings.find(building => building.id === 'mine-hall')!.hp).toBe(900);
  });
});
