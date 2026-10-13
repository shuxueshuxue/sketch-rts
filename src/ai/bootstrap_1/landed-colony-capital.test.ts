import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { BUILDING_DEFS, UNIT_DEFS, trainingBuildingFor } from '../../shared/catalog';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { snapshotGame, stepGame } from '../../shared/sim';
import { sameGround, setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { BOOTSTRAP_VERSIONS, bootstrapPolicyContext } from './policy';
import { planBootstrapEconomy } from './economy';

it.each(BOOTSTRAP_VERSIONS.flatMap(version => (['grove', 'ember'] as const).flatMap(race =>
  [false, true].flatMap(mirror => (['landed', 'unlanded', 'ally', 'home-raid'] as const).map(state => ({ version, race, mirror, state }))))))(
  '$version funds the $state $race colony before another recruit (mirror=$mirror)', ({ version, race, mirror, state }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const heavy = race === 'grove' ? 'knight' : 'ashChieftain';
    let scene = sketchScene('landed-colony-capital').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('peer', { team: 'a' })
      .townHall('us', x(500), 500).goldMine('main', x(500 + GOLD_MINE_RULES.mainDistance), 500, 10000)
      .townHall('us', x(800), 1400).goldMine('natural', x(800 + GOLD_MINE_RULES.mainDistance), 1400, 10000)
      .townHall('peer', x(1000), 3400).goldMine('island', x(3300), 1900, 10000)
      .building('us', trainingBuildingFor(race, heavy)!, x(700), 850, { id: 'factory' })
      .farms('us', 8, x(500), 2400)
      .worker('us', x(state === 'unlanded' ? 700 : 2900), 1900, { id: 'settler' });
    for (let index = 0; index < 10; index++) scene = scene.worker('us', x(index < 5 ? 650 : 950),
      (index < 5 ? 500 : 1400) + index % 5 * 25, { id: `miner-${index}`,
        order: { type: 'mine', resourceId: index < 5 ? 'main' : 'natural', phase: 'toMine', timer: 0 } });
    if (state === 'ally') scene = scene.townHall('peer', x(3012), 1900);
    if (state === 'home-raid') {
      scene = scene.player('foe', { race, team: 'b' }).townHall('foe', x(1300), 3400)
        .unit('foe', heavy, x(1000), 550, { order: { type: 'attackMove', x: x(500), y: 500 } });
      for (let index = 0; index < 3; index++) scene = scene.unit('us', heavy, x(620 + index * 40), 610);
    }
    const game = scene.build().createGame(), memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128,
      cells: Array.from({ length: 128 }, () => '.'.repeat(58) + '~'.repeat(12) + '.'.repeat(58)).join('') };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
    options.doctrines = [{ id: 'recruit-during-colony', race, weight: 1, raids: [], standIn: heavy,
      phases: [{ wants: [{ unit: heavy, count: 6, priority: 66 }], advanceShare: 1, advanceSupply: 1000 }] }];
    options.armyWants = [];
    const commands = planBootstrapEconomy(snapshot, 'us', options);
    sdk.issue(commands.map(command => ({ playerId: 'us', scriptId: 'economy', command })), {}, { checksum: false });
    if (state === 'landed') {
      expect(commands.some(command => command.type === 'build' && command.buildingKind === 'townHall')).toBe(true);
      expect(commands.some(command => command.type === 'train' && command.unitKind === heavy)).toBe(false);
    } else {
      expect(game.match.stats.goldSpent.us).toBe(UNIT_DEFS[heavy].cost);
      expect(commands.some(command => command.type === 'train' && command.unitKind === heavy)).toBe(true);
    }
    if (state === 'home-raid') expect(commands.some(command => command.type === 'build'
      && command.buildingKind === 'defenseTower')).toBe(true);
    for (let tick = 0; tick < 1200; tick++) stepGame(game);
    const island = game.resources.find(mine => mine.id === 'island')!;
    expect(game.buildings.some(hall => hall.owner === 'us' && hall.kind === 'townHall' && hall.complete
      && sameGround(game.map, hall, island))).toBe(state === 'landed');
    expect(game.match.stats.unitsLost.us).toBe(0);
    // Native construction hands the completed hall to its builder for one paid repair tick.
    const expectedSpend = state === 'landed' ? BUILDING_DEFS.townHall.cost + 1
      : UNIT_DEFS[heavy].cost + (state === 'unlanded' ? BUILDING_DEFS.shipyard.cost
          : state === 'home-raid' ? BUILDING_DEFS.defenseTower.cost : 0);
    expect(game.match.stats.goldSpent.us).toBe(expectedSpend);
    const extracted = 30000 - game.resources.reduce((total, mine) => total + mine.amount, 0);
    const carried = game.units.filter(unit => unit.owner === 'us').reduce((total, unit) => total + unit.carryingGold, 0);
    expect(game.players.us!.gold + carried + expectedSpend).toBe(500 + extracted);
  }, 30000);
