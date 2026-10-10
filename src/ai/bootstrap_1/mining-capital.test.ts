import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { BUILDING_DEFS, RACE_DEFS, UNIT_DEFS, UPGRADE_DEFS } from '../../shared/catalog';
import { snapToFootprint, setBuildingBodies } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import { bootstrapPolicyContext } from './policy';
import { bootstrapEconomy } from './economy';
import { miningAssignments } from './mining-assignments';

it.each((['v9_archer', 'v9_knight'] as const).flatMap(version => (['grove', 'ember'] as const)
  .flatMap(race => [false, true].map(mirrored => ({ version, race, mirrored }))))) (
  'funds the replacement before research consumes its final working mine ($version/$race, mirror=$mirrored)', ({ version, race, mirrored }) => {
    const x = (value: number) => mirrored ? 4096 - value : value;
    const heavy = race === 'grove' ? 'knight' : 'ashChieftain';
    const lab = UPGRADE_DEFS.weaponTraining.researchBuildingKinds.find(kind => RACE_DEFS[race].buildableBuildings.includes(kind))!;
    let scene = sketchScene('replacement-mining-capital').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).goldMine('empty-main', x(788), 500, 0)
      .townHall('us', x(1200), 1300).goldMine('working', x(1488), 1300, 125)
      .goldMine('replacement', x(2300), 1800, 10000).townHall('foe', x(3500), 500)
      .building('us', lab, x(800), 800).building('us', UNIT_DEFS[heavy].trainedAt!, x(800), 1000)
      .worker('us', x(1200), 1500, { id: 'builder' });
    for (let i = 0; i < 8; i++) scene = scene.building('us', 'farm', x(400 + i * 64), 3000)
      .unit('foe', 'knight', x(3300 + i % 4 * 40), 650 + Math.floor(i / 4) * 40, { id: `garrison-${i}` });
    for (let i = 0; i < 5; i++) scene = scene.worker('us', x(1350), 1270 + i * 25,
      { order: { type: 'mine', resourceId: 'working', phase: 'toMine', timer: 0 } });
    for (let i = 0; i < 4; i++) scene = scene.unit('us', heavy, x(1450 + i % 2 * 45), 1300 + Math.floor(i / 2) * 45, { id: `screen-${i}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.id.startsWith('screen-')).map(unit => unit.id) });
    issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === 'foe').map(unit => unit.id) });
    let returned = false;
    for (let tick = 0; tick < 3000 && !returned; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), context = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
        context.doctrines = [{ id: 'replacement-before-tech', race, weight: 1, raids: [], standIn: heavy,
          phases: [{ wants: [{ bases: 2, priority: 76 }, { upgrade: 'weaponTraining', level: 2, priority: 59 }],
            advanceShare: 1, advanceSupply: 1000 }] }];
        context.armyWants = [];
        issueCommandFrame(game, runAiCommandEntriesFromScripts(snapshot, 'us', [AI_SCRIPT_LIBRARY.economy, bootstrapEconomy, miningAssignments], context)
          .map(entry => ({ ...entry, playerId: 'us', source: 'external-agent' as const })));
      }
      const carrying = game.units.filter(unit => unit.owner === 'us' && unit.order.type === 'mine'
        && unit.order.resourceId === 'replacement' && unit.order.phase === 'return' && unit.carryingGold > 0);
      stepGame(game);
      returned = carrying.some(unit => unit.carryingGold === 0 && unit.order.type === 'mine' && unit.order.phase === 'toMine');
    }
    expect(returned).toBe(true);
    expect(game.buildings.filter(building => building.owner === 'us' && building.kind === 'townHall' && building.complete)).toHaveLength(3);
    expect(game.units.filter(unit => unit.id.startsWith('screen-'))).toHaveLength(4);
    expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(BUILDING_DEFS.defenseTower.cost + BUILDING_DEFS.townHall.cost);
    expect(game.match.winner).toBeNull();
    const mined = 10125 - game.resources.reduce((sum, mine) => sum + mine.amount, 0);
    const carried = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
    expect(game.players.us!.gold + carried + game.match.stats.goldSpent.us!).toBe(500 + mined);
  }, 15000);
