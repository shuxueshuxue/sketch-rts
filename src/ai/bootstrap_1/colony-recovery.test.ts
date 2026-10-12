import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { BUILDING_DEFS, healingBuildingKindForRace } from '../../shared/catalog';
import { GOLD_MINE_RULES, upkeepGoldIncome } from '../../shared/mining';
import { snapshotGame, stepGame } from '../../shared/sim';
import { sameGround, setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

it.each(cases)('$version builds paid $race care for its separated island patient (mirror=$mirror)', ({ version, race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const patientKind = race === 'grove' ? 'footman' : 'emberRavager';
  const medic = 'priest';
  let scene = sketchScene('colony-local-recovery').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500, { id: 'home' })
    .goldMine('main', x(500 + GOLD_MINE_RULES.mainDistance), 500, 6000)
    .townHall('us', x(2900), 2300, { id: 'colony' })
    .goldMine('island', x(2900 + GOLD_MINE_RULES.mainDistance), 2300, 6000)
    .townHall('foe', x(500), 3500).farms('us', 6, x(200), 1700)
    .unit('us', patientKind, x(3050), 2480, { id: 'patient', hp: 20 })
    .unit('us', medic, x(600), 800, { id: 'mainland-medic' });
  for (let index = 0; index < 5; index++) scene = scene
    .worker('us', x(600), 500 + index * 25, { order: { type: 'mine', resourceId: 'main', phase: 'toMine', timer: 0 } })
    .worker('us', x(3000), 2300 + index * 25, { order: { type: 'mine', resourceId: 'island', phase: 'toMine', timer: 0 } });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
    const column = mirror ? 127 - index % 128 : index % 128;
    return column < 31 || column >= 76 ? '.' : '~';
  }).join('') };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  const patient = game.units.find(unit => unit.id === 'patient')!;
  const clinicKind = healingBuildingKindForRace(race);
  const purchases: { tick: number; unitId: string }[] = [];
  let income = 0;
  // Procurement, a worker's road, ordinary construction and repeated healing
  // all take simulation time. This horizon checks completion of that whole task.
  for (let tick = 0; tick < 3600 && patient.hp < patient.maxHp; tick++) {
    if (tick % 15 === 0) {
      const entries = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory }, { teams: game.teams });
      for (const { command } of entries) if (command.type === 'build' && command.buildingKind === clinicKind
        && sameGround(game.map, command, patient))
        purchases.push({ tick: game.tick, unitId: command.unitId });
      issueCommandFrame(game, entries);
    }
    const returning = game.units.filter(unit => unit.owner === 'us' && unit.kind === 'worker' && unit.carryingGold > 0)
      .map(unit => ({ unit, load: unit.carryingGold }));
    stepGame(game);
    for (const { unit, load } of returning) if (unit.carryingGold === 0) income += upkeepGoldIncome(load, game.players.us!.supplyUsed);
  }
  const clinic = game.buildings.find(building => building.owner === 'us' && building.kind === clinicKind
    && sameGround(game.map, building, patient));
  expect(clinic?.complete).toBe(true);
  expect(purchases.length).toBeGreaterThan(0);
  expect(game.buildings.filter(building => building.owner === 'us' && building.kind === clinicKind
    && sameGround(game.map, building, patient))).toHaveLength(1);
  expect(patient.hp).toBe(patient.maxHp);
  expect(game.units).toContain(patient);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBeGreaterThanOrEqual(BUILDING_DEFS[clinicKind].cost);
  expect(game.players.us!.gold + game.match.stats.goldSpent.us!).toBeCloseTo(500 + income, 6);
});
