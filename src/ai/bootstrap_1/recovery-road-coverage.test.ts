import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint, walkingDistance } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import type { AiScript } from '../policy/types';
import { frontRecovery, postRecoveryAssignments } from './front-recovery';
import { bootstrapPolicyContext } from './policy';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].flatMap(mirror =>
    (['crossing', 'escaping', 'healing-zone', 'wall', 'ally'] as const).map(kind => ({ version, race, mirror, kind })))));

it.each(cases)('$version recovers its $race patient along the $kind road (mirror=$mirror)', ({ version, race, mirror, kind }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const wall = kind === 'wall', inside = kind === 'escaping' || kind === 'healing-zone';
  const start = { x: x(wall ? 2600 : 1200), y: 1000 };
  const near = { x: x(kind === 'healing-zone' ? 1000 : wall ? 2600 : inside ? 2200 : 2300), y: wall ? 1600 : 1000 };
  const far = { x: x(32), y: wall ? 64 : 1000 };
  let scene = sketchScene('critical-patient-road-coverage').map('bareDuel').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' }).player('ally', { team: 'a' })
    .townHall('us', x(500), 3500).townHall('foe', x(3500), 3500)
    .unit('us', race === 'grove' ? 'footman' : 'emberRavager', start.x, start.y, { id: 'patient', hp: 21 })
    .building('us', race === 'grove' ? 'moonWell' : 'emberShrine', near.x, near.y, { id: 'near' })
    .building(kind === 'ally' ? 'ally' : 'foe', 'defenseTower', x(wall ? 3600 : inside ? 1650 : 1750), wall ? 1120 : 1000);
  if (kind !== 'healing-zone') scene = scene.building('us', race === 'grove' ? 'moonWell' : 'emberShrine', far.x, far.y, { id: 'far' });
  const game = scene.build().createGame(), patient = game.units.find(unit => unit.id === 'patient')!, memory = createAiPolicyMemory();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
    const col = mirror ? 127 - index % 128 : index % 128;
    return wall && Math.floor(index / 128) === 39 && col >= 45 && col <= 119 ? 'T' : '.';
  }).join('') };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  const nearPost = game.buildings.find(building => building.id === 'near')!;
  if (kind !== 'healing-zone') {
    const farPost = game.buildings.find(building => building.id === 'far')!;
    expect(walkingDistance(game.map, patient, nearPost)!).toBeLessThan(walkingDistance(game.map, patient, farPost)!);
  }
  const options = bootstrapPolicyContext(snapshotGame(game), 'us', version, { memory, teams: game.teams });
  const assignment = postRecoveryAssignments(snapshotGame(game), 'us', options).find(item => item.patient.id === patient.id)!;
  const marching: AiScript = { id: 'marching', phase: 'tactics', run: () =>
    ({ type: 'attackMove', unitIds: [patient.id], x: nearPost.x, y: nearPost.y }) };
  issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: [patient.id] });
  let damage = 0, careOrders = 0;
  game.observer = { hit(_source, target, taken) { if (target.id === patient.id) damage += taken; } };
  for (let tick = 0; tick < 2400 && game.units.includes(patient) && patient.hp < patient.maxHp; tick++) {
    if (tick % 15 === 0) {
      const snapshot = snapshotGame(game), context = bootstrapPolicyContext(snapshot, 'us', version, { memory, teams: game.teams });
      const entries = runAiCommandEntriesFromScripts(snapshot, 'us', [frontRecovery, marching], context);
      careOrders += entries.filter(entry => entry.scriptId === 'frontRecovery').length;
      issueCommandFrame(game, entries.map(entry => ({ ...entry, playerId: 'us' })));
    }
    stepGame(game);
  }
  const diagnostic = JSON.stringify({ tick: game.tick, hp: patient.hp, damage, order: patient.order, careOrders });
  console.log(JSON.stringify({ version, race, mirror, kind, post: assignment.post.id, tick: game.tick, alive: game.units.includes(patient), hp: patient.hp, damage, careOrders }));
  expect(game.units, diagnostic).toContain(patient);
  expect(patient.hp, diagnostic).toBe(patient.maxHp);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
  if (!wall) expect(assignment.post.id).toBe(kind === 'ally' || kind === 'healing-zone' ? 'near' : 'far');
  if (!inside) expect(damage).toBe(0);
});
