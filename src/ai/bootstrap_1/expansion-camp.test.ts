import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { BOOTSTRAP_VERSIONS, bootstrapPolicyContext } from './policy';
import { planBootstrapGeneral } from './mine-defense';
import { snapToFootprint } from '../../shared/terrain';
import { strengthOf } from '../policy/v6/strength';
import { bootstrapEconomy } from './economy';
import { miningAssignments } from './mining-assignments';

it.each(BOOTSTRAP_VERSIONS.flatMap(version => (['grove', 'ember'] as const)
  .flatMap(race => [false, true].flatMap(mirrored => [false, true].map(attacking => ({ version, race, mirrored, attacking }))))))(
  'clears a replacement mine after an existing hall runs dry ($version/$race, mirror=$mirrored, attack=$attacking)', ({ version, race, mirrored, attacking }) => {
    const x = (value: number) => mirrored ? 4096 - value : value;
    const heavy = race === 'grove' ? 'knight' : 'ashChieftain';
    let scene = sketchScene('replacement-mine-camp').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .playerState('us', { gold: 500 })
      .townHall('us', x(500), 500).goldMine('exhausted', x(788), 500, 0)
      .townHall('us', x(900), 500).goldMine('working', x(1188), 500, 6000)
      .goldMine('replacement', x(2500), 2300, 6000).townHall('foe', x(3600), 3600)
      .farms('us', 5, x(500), 3400).building('foe', 'farm', x(3500), 200);
    for (let i = 0; i < 5; i++) scene = scene.worker('us', x(1100), 500 + i * 25,
      { order: { type: 'mine', resourceId: 'working', phase: 'toMine', timer: 0 } });
    for (let i = 0; i < 5; i++) scene = scene.worker('us', x(550 + i * 30), 700, { id: `idle-miner-${i}` });
    for (let i = 0; i < 8; i++) scene = scene.unit('us', heavy, x(1150 + i * 35), 1200);
    for (let i = 0; i < 4; i++) scene = scene.unit('foe', 'knight', x(3500 + i * 30), 3500);
    for (let i = 0; i < 3; i++) scene = scene.unit('neutral', 'footman', x(2480 + i * 35), 2240, { id: `guard-${i}` });
    const game = scene.build().createGame();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    const memory = createAiPolicyMemory();
    let restored = false;
    const replacementLoads = new Set<string>();
    memory.v6 = { phase: 0 };
    if (attacking) {
      const army = game.units.filter(unit => unit.owner === 'us' && unit.kind !== 'worker');
      const target = game.buildings.find(building => building.owner === 'foe')!;
      memory.v6.general = { mode: 'attack', target: { x: target.x, y: target.y }, targetHallId: target.id,
        group: army.map(unit => unit.id), groupStart: strengthOf(army) };
    }
    for (let tick = 0; tick < 6000 && !restored; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game);
        const context = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
        context.doctrines = [{ id: 'replacement-mining', race, weight: 1, raids: [], standIn: 'footman',
          phases: [{ wants: [{ bases: 2, priority: 66 }], advanceShare: 1, advanceSupply: 1000 }] }];
        context.armyWants = [];
        // Isolate the requested expansion: finish its camp task, then observe ordinary construction and hauling.
        const scripts = [AI_SCRIPT_LIBRARY.economy, bootstrapEconomy, miningAssignments];
        if (game.units.some(unit => unit.id.startsWith('guard-')))
          scripts.push({ ...AI_SCRIPT_LIBRARY.v6General, run: planBootstrapGeneral });
        issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshot, 'us', scripts, context)
          .map(entry => ({ ...entry, playerId: 'us', source: 'external-agent' as const })));
      }
      // A reassigned builder can still be carrying gold from the old mine.
      const gathering = game.units.filter(unit => unit.owner === 'us' && unit.order.type === 'mine'
        && unit.order.resourceId === 'replacement' && unit.order.phase === 'gather' && unit.carryingGold === 0);
      const returning = game.units.filter(unit => unit.owner === 'us' && replacementLoads.has(unit.id) && unit.order.type === 'mine'
        && unit.order.resourceId === 'replacement' && unit.order.phase === 'return' && unit.carryingGold > 0);
      stepGame(game);
      for (const unit of gathering) if (unit.order.type === 'mine' && unit.order.resourceId === 'replacement'
        && unit.order.phase === 'return' && unit.carryingGold > 0) replacementLoads.add(unit.id);
      restored = game.buildings.some(building => building.owner === 'us' && building.kind === 'townHall' && building.complete
        && Math.hypot(building.x - x(2500), building.y - 2300) < 320)
        && returning.some(unit => unit.hp > 0 && unit.carryingGold === 0 && unit.order.type === 'mine' && unit.order.phase === 'toMine');
    }
    expect(memory.v6!.plays!['general:clearExpansion']).toBe(1);
    expect(game.units.some(unit => unit.id.startsWith('guard-'))).toBe(false);
    expect(restored).toBe(true);
    expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(400);
    const mined = 12000 - game.resources.reduce((sum, mine) => sum + mine.amount, 0);
    expect(game.players.us!.gold + game.match.stats.goldSpent.us! + game.units.filter(unit => unit.owner === 'us')
      .reduce((sum, unit) => sum + unit.carryingGold, 0)).toBe(500 + mined);
    expect(game.resources.find(mine => mine.id === 'replacement')!.amount).toBeLessThan(6000);
  }, 15000);
