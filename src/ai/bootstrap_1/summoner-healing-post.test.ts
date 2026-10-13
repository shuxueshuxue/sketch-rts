import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { BUILDING_DEFS, healingBuildingKindForRace, requiredSupplyCap, UNIT_DEFS } from '../../shared/catalog';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';
import { rankV6Goals } from '../policy/v6/economy';

function woundedOpening(race: 'grove' | 'ember', mirror: boolean) {
  const x = (value: number) => mirror ? 4096 - value : value;
  const kind = race === 'grove' ? 'footman' : 'emberRavager';
  let scene = sketchScene('summoner-heals-before-caster-tech').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).playerState('us', { gold: 0 }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).goldMine('income', x(788), 500, 10000)
    .townHall('foe', x(3500), 3500).worker('foe', x(3400), 3400)
    .building('us', race === 'grove' ? 'barracks' : 'emberForge', x(600), 1000)
    .worker('us', x(950), 900, { id: 'builder' });
  for (let i = 0; i < 3; i++) scene = scene.building('us', 'farm', x(400 + i * 100), 1300);
  for (let i = 0; i < 5; i++) scene = scene.worker('us', x(540 + i * 20), 520,
    { order: { type: 'mine', resourceId: 'income', phase: 'toMine', timer: 0 } });
  for (let i = 0; i < 6; i++) scene = scene.unit('us', kind, x(740 + i % 3 * 42), 740 + Math.floor(i / 3) * 42,
    { id: `patient-${i}`, hp: i === 0 ? 30 : Math.floor(UNIT_DEFS[kind].hp * .44) });
  const game = scene.build().createGame();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  return game;
}

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ race, mirror }))))(
  'pays for actual $race healing before unlocking priests (mirror=$mirror)', ({ race, mirror }) => {
    const game = woundedOpening(race, mirror), memory = createAiPolicyMemory();
    const patients = game.units.filter(unit => unit.id.startsWith('patient-'));
    const before = patients.map(unit => unit.hp), kind = healingBuildingKindForRace(race);
    let firstHealing = -1;
    for (let tick = 0; tick < 1600 && firstHealing < 0; tick++) {
      if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
        { playerId: 'us', version: 'v9_summoner', memory }, { teams: game.teams }));
      stepGame(game);
      if (patients.some((unit, i) => unit.hp > before[i]!)) firstHealing = game.tick;
    }
    const diagnostic = JSON.stringify({ tick: game.tick, firstHealing, cap: game.players.us!.supplyCap,
      buildings: game.buildings.filter(building => building.owner === 'us').map(building => [building.kind, building.complete]),
      health: patients.map(unit => unit.hp), memory });
    expect(firstHealing, diagnostic).toBeGreaterThan(0);
    expect(game.players.us!.supplyCap, diagnostic).toBeLessThan(requiredSupplyCap('priest'));
    expect(game.units.some(unit => unit.owner === 'us' && unit.kind === 'priest'), diagnostic).toBe(false);
    expect(game.buildings.some(building => building.owner === 'us' && building.kind === kind && building.complete), diagnostic).toBe(true);
    expect(game.match.stats.goldSpent.us!).toBeGreaterThanOrEqual(BUILDING_DEFS[kind].cost);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(patients.every(unit => game.units.includes(unit))).toBe(true);
    const carrying = game.units.filter(unit => unit.owner === 'us').reduce((sum, unit) => sum + unit.carryingGold, 0);
    expect(game.players.us!.gold + game.match.stats.goldSpent.us! + carrying).toBe(10000 - game.resources[0]!.amount);
  });

it('retains the stock v7/v8 healing-post distinction', () => {
  const game = woundedOpening('ember', false), snapshot = snapshotGame(game);
  for (const version of ['v7', 'v8'] as const) {
    const goals = rankV6Goals(snapshot, 'us', { version, requestedVersion: version, memory: createAiPolicyMemory(), teams: game.teams });
    expect(goals.some(goal => goal.id === 'well')).toBe(version === 'v8');
  }
});
