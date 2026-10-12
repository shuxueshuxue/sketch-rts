import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

it.each((['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror })))))(
  '$version gives an existing mainland $race healer ownership of critical recovery (mirror=$mirror)', ({ version, race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const patientKind = race === 'grove' ? 'knight' : 'ashChieftain', healerKind = 'priest';
  let scene = sketchScene('mainland-medical-priority').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).townHall('foe', x(3500), 3500)
    .unit('us', patientKind, x(2500), 2200, { id: 'patient', hp: 20 })
    .unit('us', healerKind, x(2100), 2200, { id: 'healer' });
  for (let index = 0; index < 3; index++) scene = scene.unit('us', race === 'grove' ? 'footman' : 'emberRavager', x(2000 + index * 40), 1700);
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  const patient = game.units.find(unit => unit.id === 'patient')!;
  const first = planAiOwnerCommandEntries(snapshotGame(game), { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams });
  expect(first.filter(entry => entry.scriptId === 'medicalRecovery')).toEqual([
    { playerId: 'us', scriptId: 'medicalRecovery', command: { type: 'cast', unitId: 'healer', ability: race === 'grove' ? 'heal' : 'heal', targetId: patient.id } },
  ]);
  expect(first.some(entry => entry.scriptId === 'v6Backline' && 'unitIds' in entry.command && entry.command.unitIds.includes('healer'))).toBe(false);
  issueCommandFrame(game, first);
  for (let tick = 0; tick < 1200 && patient.hp < patient.maxHp * .35; tick++) {
    if (tick % 15 === 0) issueCommandFrame(game, planAiOwnerCommandEntries(snapshotGame(game),
      { playerId: 'us', version, memory, policyMode: 'combat' }, { teams: game.teams }));
    stepGame(game);
  }
  console.log(JSON.stringify({ version, race, mirror, tick: game.tick, hp: patient.hp, maxHp: patient.maxHp }));
  expect(patient.hp).toBeGreaterThanOrEqual(patient.maxHp * .35);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
});
