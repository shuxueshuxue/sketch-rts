import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { ABILITY_DEFS, BUILDING_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { bootstrapPolicyContext } from './policy';
import { towerRushGoal } from './tower-rush';

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirrored => ({ race, mirrored }))))(
  'the $race tower convoy lets its loaded miner deposit before paid construction (mirror=$mirrored)', ({ race, mirrored }) => {
    const x = (value: number) => mirrored ? 4096 - value : value;
    const casterKind = race === 'grove' ? 'summoner' : 'pyreCaller';
    let scene = sketchScene('tower-mining-handoff').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).goldMine('main', x(500 + GOLD_MINE_RULES.mainDistance), 500, 10000)
      .townHall('foe', x(2300), 700)
      .worker('us', x(600), 500, { id: 'loaded-miner', order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
    for (let index = 0; index < 5; index++) scene = scene.worker('us', x(500), 1800 + index * 25,
      { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } });
    for (let index = 0; index < 4; index++) scene = scene.unit('us', casterKind, x(1300), 670 + index * 25);
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    const miner = game.units.find(unit => unit.id === 'loaded-miner')!;
    for (let tick = 0; tick < 300 && miner.carryingGold === 0; tick++) stepGame(game);
    expect(miner.carryingGold).toBe(GOLD_MINE_RULES.goldPerTrip);
    for (const caster of game.units.filter(unit => unit.kind === casterKind)) {
      const ability = UNIT_DEFS[caster.kind].abilities.find(ability => ABILITY_DEFS[ability].behavior === 'summon')!;
      issuePlayerCommand(game, 'us', { type: 'cast', unitId: caster.id, ability, x: caster.x + (mirrored ? -100 : 100), y: caster.y });
    }
    stepGame(game);
    const snapshot = snapshotGame(game), context = bootstrapPolicyContext(snapshot, 'us', 'v9_summoner', { memory, teams: game.teams });
    const goal = towerRushGoal(snapshot, 'us', context)!;
    expect(goal).toBeDefined();
    const command = goal.issue(new Set())!;
    expect(command.type).toBe('build');
    issuePlayerCommand(game, 'us', command);
    expect(miner.order.type).toBe('mine');
    let deposited = false;
    for (let tick = 0; tick < 1600; tick++) {
      stepGame(game);
      if (miner.carryingGold === 0 && miner.order.type === 'mine' && miner.order.phase === 'toMine') deposited = true;
      if (game.buildings.some(building => building.owner === 'us' && building.kind === 'defenseTower' && building.complete)) break;
    }
    expect(deposited).toBe(true);
    expect(game.buildings.some(building => building.owner === 'us' && building.kind === 'defenseTower' && building.complete)).toBe(true);
    expect(game.units).toContain(miner);
    expect(game.units.filter(unit => unit.kind === 'worker')).toHaveLength(6);
    expect(game.match.winner).toBeNull();
    expect(game.match.stats.goldSpent.us).toBe(BUILDING_DEFS.defenseTower.cost);
    const mined = 10000 - game.resources.find(mine => mine.id === 'main')!.amount;
    const carried = game.units.filter(unit => unit.owner === 'us').reduce((total, unit) => total + unit.carryingGold, 0);
    expect(game.players.us!.gold + carried + game.match.stats.goldSpent.us!).toBe(500 + mined);
  }, 30000);
