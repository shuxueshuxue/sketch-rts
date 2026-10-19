import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { BUILDING_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { BOOTSTRAP_VERSIONS, bootstrapPolicyContext } from './policy';
import { planBootstrapGeneral } from './mine-defense';
import { expansionMissionUnitIds } from './expansion-mission';

it.each(BOOTSTRAP_VERSIONS.flatMap(version => (['grove', 'ember'] as const).flatMap(race =>
  [false, true].flatMap(mirror => (['wish', 'funded', 'builder', 'working'] as const).map(state => ({ version, race, mirror, state }))))))(
  '$version/$race retains a funded construction screen and lets surplus attack ($state, mirror=$mirror)', ({ version, race, mirror, state }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const heavy = race === 'grove' ? 'knight' : 'ashChieftain';
    let scene = sketchScene('unfunded-expansion-host').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500, { id: 'home' }).goldMine('spent', x(788), 500, state === 'working' ? 6000 : 0)
      .goldMine('next', x(1700), 1900, 6000).townHall('foe', x(3400), 500, { id: 'target' })
      .worker('us', x(580), 520, { id: 'builder' }).farms('us', 8, x(500), 3500);
    for (let i = 0; i < 8; i++) scene = scene.unit('us', heavy, x(1300 + i % 4 * 45), 1700 + Math.floor(i / 4) * 45, { id: `host-${i}` });
    const game = scene.build().createGame(), memory = createAiPolicyMemory();
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    if (state === 'builder') issuePlayerCommand(game, 'us', { type: 'build', unitId: 'builder', buildingKind: 'townHall', x: x(1412), y: 1900 });
    if (state !== 'funded') {
      issuePlayerCommand(game, 'us', { type: 'train', buildingId: 'home', unitKind: 'worker' });
      issuePlayerCommand(game, 'us', { type: 'train', buildingId: 'home', unitKind: 'worker' });
      if (state !== 'builder') issuePlayerCommand(game, 'us', { type: 'build', unitId: 'builder', buildingKind: 'farm', x: x(600), y: 580 });
      for (let tick = 0; tick < 200; tick++) stepGame(game);
      expect(game.players.us!.gold).toBe(500 - 2 * UNIT_DEFS.worker.cost - (state !== 'builder' ? BUILDING_DEFS.farm.cost : 0));
    }
    const target = game.buildings.find(building => building.id === 'target')!;
    let attacked = false;
    for (let tick = 0; tick < 1800; tick++) {
      if (tick % 15 === 0) {
        const snapshot = snapshotGame(game), options = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
        options.doctrines = [{ id: 'unfunded-capital-wish', race, weight: 1, raids: [], standIn: heavy,
          phases: [{ wants: [{ bases: 2, priority: 66 }], advanceShare: 1, advanceSupply: 1000 }] }];
        for (const command of planBootstrapGeneral(snapshot, 'us', options)) issuePlayerCommand(game, 'us', command);
        const screen = expansionMissionUnitIds(memory);
        if (state !== 'wish') {
          expect(screen).toHaveLength(3);
          expect(memory.landAttack?.general.group?.some(id => screen.includes(id)) ?? false).toBe(false);
        } else expect(screen).toHaveLength(0);
        attacked ||= memory.v6?.general?.mode === 'attack';
      }
      stepGame(game);
    }
    expect(attacked).toBe(true);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(target.hp).toBeLessThan(target.maxHp);
    const carried = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
    expect(game.players.us!.gold + carried + game.match.stats.goldSpent.us!).toBe(500);
  }, 30000);
