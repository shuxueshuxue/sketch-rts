import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { BUILDING_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { snapToFootprint, setBuildingBodies } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { AI_SCRIPT_LIBRARY } from '../policy/core';
import { miningWorkforce } from './workforce';
import { bootstrapEconomy, rankBootstrapGoals } from './economy';
import { bootstrapPolicyContext } from './policy';
import { miningAssignments } from './mining-assignments';

function replacementScene(race: 'grove' | 'ember', mirrored: boolean) {
  const x = (value: number) => mirrored ? 4096 - value : value;
  const heavy = race === 'grove' ? 'knight' : 'ashChieftain';
  let scene = sketchScene('covered-replacement-mine').map('openClaims').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).goldMine('empty-main', x(788), 500, 0)
    .townHall('us', x(1200), 1300).goldMine('working', x(1488), 1300, 10000)
    .goldMine('replacement', x(2300), 1800, 10000).townHall('foe', x(3500), 500)
    .building('us', UNIT_DEFS[heavy].trainedAt!, x(800), 800)
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
  memory.v6 = { phase: 2 };
  issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.id.startsWith('screen-')).map(unit => unit.id) });
  issuePlayerCommand(game, 'foe', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.id.startsWith('garrison-')).map(unit => unit.id) });
  return { game, memory, x };
}

it.each((['v9_archer', 'v9_knight'] as const).flatMap(version => (['grove', 'ember'] as const)
  .flatMap(race => [false, true].map(mirrored => ({ version, race, mirrored }))))) (
  'pays for cover, builds and mines the cleared replacement while the army holds elsewhere ($version/$race, mirror=$mirrored)', ({ version, race, mirrored }) => {
    const { game, memory, x } = replacementScene(race, mirrored);
    let returned = false, damage = 0;
    const replacementLoads = new Set<string>();
    game.observer = { hit(_source, target, taken) { if (target.owner === 'us') damage += taken; } };
    for (let tick = 0; tick < 4000 && !returned; tick++) {
      if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game), {
        playerId: 'us', version, memory,
        scripts: [AI_SCRIPT_LIBRARY.economy, miningWorkforce, bootstrapEconomy, miningAssignments],
      }, { teams: game.teams }));
      // A reassigned miner may still carry a load from the working mine.
      const gathering = game.units.filter(unit => unit.owner === 'us' && unit.order.type === 'mine'
        && unit.order.resourceId === 'replacement' && unit.order.phase === 'gather' && unit.carryingGold === 0);
      const carrying = game.units.filter(unit => unit.owner === 'us' && replacementLoads.has(unit.id) && unit.order.type === 'mine'
        && unit.order.resourceId === 'replacement' && unit.order.phase === 'return' && unit.carryingGold > 0);
      stepGame(game);
      for (const unit of gathering) if (unit.order.type === 'mine' && unit.order.resourceId === 'replacement'
        && unit.order.phase === 'return' && unit.carryingGold > 0) replacementLoads.add(unit.id);
      returned = carrying.some(unit => unit.carryingGold === 0 && unit.order.type === 'mine' && unit.order.phase === 'toMine');
    }
    expect(returned).toBe(true);
    expect(game.buildings.filter(building => building.owner === 'us' && building.kind === 'townHall' && building.complete)).toHaveLength(3);
    expect(game.units.filter(unit => unit.id.startsWith('screen-'))).toHaveLength(4);
    expect(damage).toBe(0);
    expect(game.buildings.some(building => building.owner === 'us' && building.kind === 'defenseTower' && building.complete
      && Math.hypot(building.x - x(2300), building.y - 1800) <= building.attackRange)).toBe(true);
    expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(BUILDING_DEFS.defenseTower.cost + BUILDING_DEFS.townHall.cost);
    expect(game.match.winner).toBeNull();
    const mined = 20000 - game.resources.reduce((total, mine) => total + mine.amount, 0);
    const carried = game.units.filter(unit => unit.owner === 'us').reduce((total, unit) => total + unit.carryingGold, 0);
    expect(game.players.us!.gold + carried + game.match.stats.goldSpent.us!).toBe(500 + mined);
  }, 20000);

it.each(['covered', 'two-incomes', 'no-income', 'guarded', 'occupied', 'rising'] as const)(
  'does not buy replacement-mine cover when %s', condition => {
    const { game, memory } = replacementScene('grove', false);
    if (condition === 'two-incomes') game.resources.find(mine => mine.id === 'empty-main')!.amount = 10000;
    if (condition === 'no-income') game.resources.find(mine => mine.id === 'working')!.amount = 0;
    if (condition === 'guarded' || condition === 'occupied') {
      const unit = game.units.find(unit => unit.id === 'garrison-0')!;
      unit.owner = condition === 'guarded' ? 'neutral' : 'foe';
      Object.assign(unit, { x: 2300, y: 1800, order: { type: 'hold', x: 2300, y: 1800 } });
    }
    if (condition === 'covered' || condition === 'rising') {
      const tower = sketchScene('existing-mine-cover').replaceDefaults().player('us')
        .tower('us', 2300, 1650, { complete: condition === 'covered' }).build().createGame().buildings[0]!;
      game.buildings.push(tower);
    }
    setBuildingBodies(game.map, game.buildings);
    const snapshot = snapshotGame(game);
    const options = bootstrapPolicyContext(snapshot, 'us', 'v9_knight', { memory, teams: game.teams });
    expect(rankBootstrapGoals(snapshot, 'us', options).some(goal => goal.id.startsWith('mining-cover:'))).toBe(false);
    if (condition === 'covered') expect(rankBootstrapGoals(snapshot, 'us', options).some(goal => goal.id.startsWith('bases:'))).toBe(true);
  });
