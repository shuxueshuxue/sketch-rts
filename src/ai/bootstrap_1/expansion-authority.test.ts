import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { snapToFootprint, sameGround } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { BOOTSTRAP_VERSIONS, bootstrapPolicyContext } from './policy';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { miningWorkforce } from './workforce';
import { bootstrapEconomy } from './economy';
import { miningAssignments } from './mining-assignments';

it.each(BOOTSTRAP_VERSIONS.flatMap(version => (['grove', 'ember'] as const)
  .flatMap(race => [false, true].map(mirrored => ({ version, race, mirrored }))))) (
  'clears and mines its natural instead of a distant naval land detour ($version/$race, mirror=$mirrored)', ({ version, race, mirrored }) => {
    const x = (value: number) => mirrored ? 4096 - value : value;
    let scene = sketchScene('one-land-expansion-plan').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).goldMine('main', x(788), 500, 10000)
      .goldMine('natural', x(1600), 1000, 10000).goldMine('detour', x(3000), 500, 10000)
      .townHall('foe', x(3400), 3500).unit('neutral', 'footman', x(1600), 940, { id: 'natural-guard' });
    for (let i = 0; i < 4; i++) scene = scene.unit('foe', 'knight', x(3350 + i % 2 * 45), 3400 + Math.floor(i / 2) * 45,
      { order: { type: 'hold', x: x(3350 + i % 2 * 45), y: 3400 + Math.floor(i / 2) * 45 } });
    for (let i = 0; i < 3; i++) scene = scene.worker('us', x(600), 470 + i * 25,
      { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.terrain = { cell: 32, cols: 128, rows: 128,
      cells: Array.from({ length: 128 }, () => Array.from({ length: 128 }, (_, col) => {
        const across = mirrored ? 127 - col : col;
        return across >= 114 && across < 120 ? '~' : '.';
      }).join('')).join('') };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    let returned = false;
    const minedLoads = new Set<string>();
    const sites: { x: number; y: number }[] = [];
    for (let tick = 0; tick < 6000 && !returned && !game.match.winner; tick++) {
      if (tick % 15 === 0) {
        const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory }, { teams: game.teams });
        for (const { command } of entries) if (command.type === 'build' && command.buildingKind === 'townHall') sites.push(command);
        issueCommandFrame(game, entries);
      }
      const gathering = game.units.filter(unit => unit.owner === 'us' && unit.order.type === 'mine'
        && unit.order.resourceId === 'natural' && unit.order.phase === 'gather' && unit.carryingGold === 0);
      const returning = game.units.filter(unit => unit.owner === 'us' && minedLoads.has(unit.id) && unit.order.type === 'mine'
        && unit.order.resourceId === 'natural' && unit.order.phase === 'return' && unit.carryingGold > 0);
      stepGame(game);
      for (const unit of gathering) if (unit.order.type === 'mine' && unit.order.resourceId === 'natural'
        && unit.order.phase === 'return' && unit.carryingGold > 0) minedLoads.add(unit.id);
      returned = returning.some(unit => unit.hp > 0 && unit.carryingGold === 0 && unit.order.type === 'mine' && unit.order.phase === 'toMine');
    }
    expect(returned).toBe(true);
    expect(game.units.some(unit => unit.id === 'natural-guard')).toBe(false);
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every(site => Math.hypot(site.x - x(1600), site.y - 1000) <= 320)).toBe(true);
    expect(sameGround(game.map, { x: x(500), y: 500 }, { x: x(3900), y: 500 })).toBe(false);
    expect(game.match.winner).toBeNull();
    const mined = 30000 - game.resources.reduce((sum, mine) => sum + mine.amount, 0);
    const carrying = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
    expect(game.players.us!.gold + carrying + game.match.stats.goldSpent.us!).toBe(500 + mined);
  }, 20000);

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirrored => ({ race, mirrored }))))(
  'still expands and mines an established $race overseas colony (mirror=$mirrored)', ({ race, mirrored }) => {
    const x = (value: number) => mirrored ? 4096 - value : value;
    const fighter = race === 'grove' ? 'footman' : 'emberRavager';
    let scene = sketchScene('colony-local-expansion').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).goldMine('main', x(788), 500, 10000)
      .townHall('us', x(3000), 1000).goldMine('colony', x(3288), 1000, 10000)
      .goldMine('next', x(3300), 2400, 10000).townHall('foe', x(3500), 3600)
      .tower('us', x(2800), 1000).farms('us', 4, x(2800), 2750)
      .building('us', race === 'grove' ? 'barracks' : 'emberForge', x(2900), 800)
      .worker('us', x(3300), 2100, { id: 'settler' });
    for (let i = 0; i < 5; i++) scene = scene.worker('us', x(600), 470 + i * 25,
      { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } })
      .worker('us', x(3140), 970 + i * 25, { order: { type: 'mine', resourceId: 'colony', phase: 'toMine', timer: 0 } });
    for (let i = 0; i < 8; i++) scene = scene.unit('us', fighter, x(2950 + i % 4 * 35), 1200 + Math.floor(i / 4) * 35);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.terrain = { cell: 32, cols: 128, rows: 128,
      cells: Array.from({ length: 128 }, () => Array.from({ length: 128 }, (_, col) => {
        const across = mirrored ? 127 - col : col;
        return across >= 64 && across < 75 ? '~' : '.';
      }).join('')).join('') };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    let returned = false;
    const minedLoads = new Set<string>();
    for (let tick = 0; tick < 3000 && !returned; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', 'v9_knight', { memory, teams: game.teams });
        options.doctrines = [{ id: 'established-colony', race, weight: 1, raids: [], standIn: fighter,
          phases: [{ wants: [{ bases: 2, priority: 66 }], advanceShare: 1, advanceSupply: 1000 }] }];
        options.armyWants = [];
        issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshot, 'us',
          [AI_SCRIPT_LIBRARY.economy, miningWorkforce, bootstrapEconomy, miningAssignments], options)
          .map(entry => ({ ...entry, playerId: 'us', source: 'external-agent' as const })));
      }
      const gathering = game.units.filter(unit => unit.owner === 'us' && unit.order.type === 'mine'
        && unit.order.resourceId === 'next' && unit.order.phase === 'gather' && unit.carryingGold === 0);
      const returning = game.units.filter(unit => unit.owner === 'us' && minedLoads.has(unit.id) && unit.order.type === 'mine'
        && unit.order.resourceId === 'next' && unit.order.phase === 'return' && unit.carryingGold > 0);
      stepGame(game);
      for (const unit of gathering) if (unit.order.type === 'mine' && unit.order.resourceId === 'next'
        && unit.order.phase === 'return' && unit.carryingGold > 0) minedLoads.add(unit.id);
      returned = returning.some(unit => unit.hp > 0 && unit.carryingGold === 0 && unit.order.type === 'mine' && unit.order.phase === 'toMine');
    }
    expect(returned).toBe(true);
    expect(game.buildings.filter(building => building.owner === 'us' && building.kind === 'townHall' && building.complete)).toHaveLength(3);
    expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(400);
    expect(game.match.winner).toBeNull();
    const mined = 30000 - game.resources.reduce((sum, mine) => sum + mine.amount, 0);
    const carrying = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
    expect(game.players.us!.gold + carrying + game.match.stats.goldSpent.us!).toBe(500 + mined);
  });
