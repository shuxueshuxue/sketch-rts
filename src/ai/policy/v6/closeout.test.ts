import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../../sdk/scene';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../../shared/sim';
import { createAiPolicyMemory } from '../../memory';
import { AI_SCRIPT_LIBRARY } from '../core';
import { runAiCommandEntriesFromScripts } from '../script-runner';
import { planV6Closeout } from './closeout';

const closeout = AI_SCRIPT_LIBRARY.v6Closeout;

describe('closeout allocation', () => {
  it.each(['grove', 'ember'] as const)('clears the beaten opponent with three ordinary %s fighters and leaves the main army intact', race => {
    const heavy = race === 'grove' ? 'knight' : 'ashChieftain';
    let scene = sketchScene('closeout-with-a-main-army').replaceDefaults()
      .player('us', { race, team: 'a' }).player('beaten', { team: 'b' }).player('active', { team: 'b' })
      .townHall('us', 500, 500).townHall('beaten', 3000, 2000, { id: 'last-hall', hp: 48 })
      .building('beaten', 'farm', 3300, 2000, { id: 'last-farm' }).townHall('active', 3500, 3400)
      .farms('us', 10, 400, 1600);
    for (let i = 0; i < 12; i++) scene = scene.unit('us', heavy, i < 3 ? 2700 + i * 35 : 1000 + i * 35, i < 3 ? 2000 : 1100, { id: `fighter-${i}` });
    for (let i = 0; i < 3; i++) scene = scene.worker('active', 3500 + i * 35, 3300);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    const options = () => ({ version: 'v2' as const, requestedVersion: 'v7' as const, memory, teams: game.teams });
    for (const command of planV6Closeout(snapshotGame(game), 'us', options())) issuePlayerCommand(game, 'us', command);
    expect(memory.v6!.closeout!.unitIds).toEqual(['fighter-2', 'fighter-1', 'fighter-0']);
    for (let tick = 0; tick < 800; tick++) {
      if (tick % 15 === 0) for (const { command } of runAiCommandEntriesFromScripts(snapshotGame(game), 'us', [closeout], options())) issuePlayerCommand(game, 'us', command);
      stepGame(game);
    }
    expect(game.buildings.filter(building => building.owner === 'beaten')).toHaveLength(0);
    expect(game.units.filter(unit => unit.owner === 'us')).toHaveLength(12);
    expect(game.units.filter(unit => unit.id.startsWith('fighter-') && Number(unit.id.slice(8)) >= 3)
      .every(unit => unit.y === 1100)).toBe(true);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });

  it('does not strip the stronger main army to raze a defeated player protected by towers', () => {
    let scene = sketchScene('protected-closeout').replaceDefaults()
      .player('us', { team: 'a' }).player('beaten', { team: 'b' }).player('active', { team: 'b' })
      .townHall('us', 500, 500).townHall('beaten', 3000, 2000, { hp: 48 }).townHall('active', 3500, 3400)
      .farms('us', 8, 400, 1600);
    for (let i = 0; i < 12; i++) scene = scene.unit('us', 'footman', 2600 + i % 4 * 35, 2200 + Math.floor(i / 4) * 35);
    for (let i = 0; i < 3; i++) scene = scene.building('beaten', 'defenseTower', 2920 + i * 80, 1800);
    for (let i = 0; i < 3; i++) scene = scene.worker('active', 3500 + i * 35, 3300);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    const options = ({ version: 'v2' as const, requestedVersion: 'v7' as const, memory, teams: game.teams });
    expect(planV6Closeout(snapshotGame(game), 'us', options)).toEqual([]);
    expect(memory.v6!.closeout).toBeUndefined();
  });

  it('finishes a mainland target without claiming nearby colonists across the water', () => {
    let scene = sketchScene('closeout-on-walkable-ground').replaceDefaults()
      .player('us', { team: 'a' }).player('beaten', { team: 'b' }).player('active', { team: 'b' })
      .townHall('us', 500, 500).townHall('beaten', 1600, 1700, { id: 'last-hall', hp: 48 })
      .townHall('active', 3500, 3400).farms('us', 12, 400, 2400);
    for (let i = 0; i < 12; i++) scene = scene.unit('us', 'knight', 500 + i % 4 * 35, 1700 + Math.floor(i / 4) * 35, { id: `main-${i}` });
    for (let i = 0; i < 3; i++) scene = scene.unit('us', 'knight', 2400, 1700 + i * 35, { id: `colonist-${i}` })
      .worker('active', 3500 + i * 35, 3300);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.width = game.map.height = 4000;
    game.map.terrain = { cell: 40, cols: 100, rows: 100,
      cells: Array.from({ length: 100 }, () => '.'.repeat(45) + '~'.repeat(10) + '.'.repeat(45)).join('') };
    const options = { version: 'v2' as const, requestedVersion: 'v7' as const, memory, teams: game.teams };
    for (const command of planV6Closeout(snapshotGame(game), 'us', options)) issuePlayerCommand(game, 'us', command);
    expect(memory.v6!.closeout!.unitIds.every(id => id.startsWith('main-'))).toBe(true);
    for (let tick = 0; tick < 800; tick++) {
      if (tick % 15 === 0) for (const command of planV6Closeout(snapshotGame(game), 'us', options)) issuePlayerCommand(game, 'us', command);
      stepGame(game);
    }
    expect(game.buildings.some(building => building.id === 'last-hall')).toBe(false);
    expect(game.units.filter(unit => unit.id.startsWith('colonist-')).every(unit => unit.x === 2400)).toBe(true);
  });

  it('uses the remaining three fighters to win when no other live army or economy needs a main force', () => {
    let scene = sketchScene('last-closeout').replaceDefaults()
      .player('us', { team: 'a' }).player('beaten', { team: 'b' })
      .townHall('us', 500, 500).townHall('beaten', 3000, 2000, { hp: 48 })
      .building('beaten', 'farm', 3300, 2000).farms('us', 4, 400, 1600);
    for (let i = 0; i < 3; i++) scene = scene.unit('us', 'footman', 2700 + i * 35, 2000);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    const options = { version: 'v2' as const, requestedVersion: 'v7' as const, memory, teams: game.teams };
    for (let tick = 0; tick < 800 && !game.match.winner; tick++) {
      if (tick % 15 === 0) for (const command of planV6Closeout(snapshotGame(game), 'us', options)) issuePlayerCommand(game, 'us', command);
      stepGame(game);
    }
    expect(game.match.winner).toBe('us');
    expect(game.units.filter(unit => unit.owner === 'us')).toHaveLength(3);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
});
