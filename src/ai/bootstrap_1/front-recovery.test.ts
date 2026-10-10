import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { planBootstrapGeneral } from './mine-defense';
import { bootstrapPolicyContext } from './policy';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

function field(race: 'grove' | 'ember', mirror: boolean, well: 'working' | 'absent' | 'incomplete' | 'covered' = 'working') {
  const x = (value: number) => mirror ? 4096 - value : value;
  const fighter = race === 'grove' ? 'lancer' : 'emberRavager';
  let scene = sketchScene('critical-front-actual-well').map('openClaims').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { race: 'grove', team: 'b' })
    .townHall('us', x(500), 500).townHall('foe', x(3500), 3500)
    .unit('us', fighter, x(820), 500, { id: 'patient' });
  if (well !== 'absent') scene = scene.building('us', race === 'grove' ? 'moonWell' : 'emberShrine', x(500), 900,
    { id: 'well', complete: well !== 'incomplete' });
  if (well === 'covered') scene = scene.building('foe', 'defenseTower', x(300), 1100);
  for (let index = 0; index < 5; index++) scene = scene.unit('us', fighter, x(400 + index * 80), 700, { id: `screen-${index}` });
  for (const [index, angle] of [-0.3, 0, 0.3].entries()) scene = scene.unit('foe', 'ballista',
    x(820 + Math.cos(angle) * 380), 500 + Math.sin(angle) * 380, { id: `gun-${index}` });
  const game = scene.build().createGame();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  const own = game.units.filter(unit => unit.owner === 'us'), guns = game.units.filter(unit => unit.owner === 'foe');
  const patient = own.find(unit => unit.id === 'patient')!;
  issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: own.map(unit => unit.id) });
  for (const gun of guns) issuePlayerCommand(game, 'foe', { type: 'cast', unitId: gun.id, ability: 'pinningBolt', targetId: patient.id });
  for (let tick = 0; tick < 100 && game.projectiles.length < 3; tick++) stepGame(game);
  expect(game.projectiles).toHaveLength(3);
  issuePlayerCommand(game, 'foe', { type: 'move', unitIds: guns.map(unit => unit.id), x: x(3500), y: 3000 });
  for (let tick = 0; tick < 30; tick++) stepGame(game);
  expect(patient.hp).toBe(patient.maxHp - 108);
  return { game, patient };
}

it.each(cases)('$version heals a genuinely wounded $race front soldier at its existing post (mirror=$mirror)',
  ({ version, race, mirror }) => {
    const { game, patient } = field(race, mirror);
    const well = game.buildings.find(building => building.id === 'well')!;
    const snapshot = snapshotGame(game), memory = createAiPolicyMemory();
    const context = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
    const commands = planBootstrapGeneral(snapshot, 'us', context);
    expect(commands).toContainEqual({ type: 'move', unitIds: [patient.id], x: well.x, y: well.y });
    for (const command of commands) issuePlayerCommand(game, 'us', command);
    for (let tick = 0; tick < 1200; tick++) stepGame(game);
    expect(game.units).toContain(patient);
    expect(patient.hp).toBe(patient.maxHp);
    expect(game.players.us!.gold).toBe(500);
    expect(game.match.stats.goldSpent.us).toBe(0);
    expect(game.match.winner).toBeNull();
  });

it.each((['absent', 'incomplete', 'covered'] as const).flatMap(well =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ well, race, mirror })))))
('keeps the ordinary hall retreat when the $race well is $well (mirror=$mirror)', ({ well, race, mirror }) => {
  const { game, patient } = field(race, mirror, well);
  const hall = game.buildings.find(building => building.owner === 'us' && building.kind === 'townHall')!;
  const snapshot = snapshotGame(game), memory = createAiPolicyMemory();
  const context = bootstrapPolicyContext(snapshot, 'us', 'v9_knight', { memory, teams: game.teams });
  expect(planBootstrapGeneral(snapshot, 'us', context)).toContainEqual({ type: 'move', unitIds: [patient.id], x: hall.x, y: hall.y });
});
