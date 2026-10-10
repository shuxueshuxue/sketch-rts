import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { snapToFootprint, setBuildingBodies } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { strengthOf } from '../policy/v6/strength';
import { BOOTSTRAP_VERSIONS, bootstrapPolicyContext } from './policy';
import { bootstrapEconomy } from './economy';
import { miningAssignments } from './mining-assignments';
import { planBootstrapGeneral } from './mine-defense';

it.each(BOOTSTRAP_VERSIONS.flatMap(version => (['grove', 'ember'] as const)
  .flatMap(race => [false, true].map(mirrored => ({ version, race, mirrored }))))) (
  'escorts its contested replacement through construction instead of resuming a distant assault ($version/$race, mirror=$mirrored)', ({ version, race, mirrored }) => {
    const x = (value: number) => mirrored ? 4096 - value : value;
    const heavy = race === 'grove' ? 'knight' : 'ashChieftain';
    let scene = sketchScene('critical-mining-escort').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' }).player('raiders', { team: 'b' })
      .townHall('us', x(500), 500).goldMine('empty-main', x(788), 500, 0)
      .townHall('us', x(1200), 1300).goldMine('working', x(1488), 1300, 6000)
      .goldMine('replacement', x(2300), 2400, 6000).townHall('foe', x(3500), 600)
      .townHall('raiders', x(3500), 3600)
      .worker('us', x(1200), 1550, { id: 'builder' });
    for (let i = 0; i < 8; i++) scene = scene.building('us', 'farm', x(400 + i * 64), 3600)
      .unit('us', heavy, x(1200 + i % 4 * 45), 1700 + Math.floor(i / 4) * 45, { id: `screen-${i}` });
    for (let i = 0; i < 5; i++) scene = scene.worker('us', x(1350), 1270 + i * 25,
      { order: { type: 'mine', resourceId: 'working', phase: 'toMine', timer: 0 } });
    for (let i = 0; i < 4; i++) scene = scene.unit('raiders', 'footman', x(3550 + i % 2 * 40), 3000 + Math.floor(i / 2) * 40, { id: `raider-${i}` })
      .unit('foe', 'knight', x(3360 + i % 2 * 40), 600 + Math.floor(i / 2) * 40, { id: `garrison-${i}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === 'foe').map(unit => unit.id) });
    issuePlayerCommand(game, 'raiders', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === 'raiders').map(unit => unit.id) });
    const target = game.buildings.find(building => building.owner === 'foe')!, army = game.units.filter(unit => unit.id.startsWith('screen-'));
    memory.v6 = { phase: 0, general: { mode: 'attack', target: { x: target.x, y: target.y }, targetHallId: target.id,
      group: army.map(unit => unit.id), groupStart: strengthOf(army) } };
    let returned = false;
    const replacementLoads = new Set<string>();
    for (let tick = 0; tick < 4000 && !returned && !game.match.winner; tick++) {
      if (tick === 300) issuePlayerCommand(game, 'raiders', { type: 'attackMove',
        unitIds: game.units.filter(unit => unit.id.startsWith('raider-')).map(unit => unit.id), x: x(2300), y: 2400 });
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), context = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
        context.doctrines = [{ id: 'requested-replacement', race, weight: 1, raids: [], standIn: heavy,
          phases: [{ wants: [{ bases: 2, priority: 76 }], advanceShare: 1, advanceSupply: 1000 }] }];
        context.armyWants = [];
        issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshot, 'us', [AI_SCRIPT_LIBRARY.economy, bootstrapEconomy,
          miningAssignments, { ...AI_SCRIPT_LIBRARY.v6General, run: planBootstrapGeneral }], context)
          .map(entry => ({ ...entry, playerId: 'us', source: 'external-agent' as const })));
      }
      const gathering = game.units.filter(unit => unit.owner === 'us' && unit.order.type === 'mine'
        && unit.order.resourceId === 'replacement' && unit.order.phase === 'gather' && unit.carryingGold === 0);
      const carrying = game.units.filter(unit => unit.owner === 'us' && replacementLoads.has(unit.id) && unit.order.type === 'mine'
        && unit.order.resourceId === 'replacement' && unit.order.phase === 'return' && unit.carryingGold > 0);
      stepGame(game);
      for (const unit of gathering) if (unit.order.type === 'mine' && unit.order.resourceId === 'replacement'
        && unit.order.phase === 'return' && unit.carryingGold > 0) replacementLoads.add(unit.id);
      returned = carrying.some(unit => unit.hp > 0 && unit.carryingGold === 0 && unit.order.type === 'mine' && unit.order.phase === 'toMine');
    }
    expect(returned).toBe(true);
    expect(game.units.some(unit => unit.id === 'builder')).toBe(true);
    expect(game.buildings.filter(building => building.owner === 'us' && building.kind === 'townHall' && building.complete)).toHaveLength(3);
    expect(game.units.filter(unit => unit.id.startsWith('raider-'))).toHaveLength(0);
    expect(game.match.winner).toBeNull();
    expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(400);
    const mined = 12000 - game.resources.reduce((sum, mine) => sum + mine.amount, 0);
    const carried = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
    expect(game.players.us!.gold + carried + game.match.stats.goldSpent.us!).toBe(500 + mined);
  }, 15000);
