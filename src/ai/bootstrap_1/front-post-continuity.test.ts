import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { SdkCommandFrameRuntime } from '../../sdk/commands/frame';
import { issuePlayerCommand, snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { walkingDistance } from '../../shared/terrain';
import { SUPPORT_BUILDING_HEAL } from '../../shared/catalog';
import { createAiPolicyMemory } from '../memory';
import { planAiOwnerCommandEntries } from '../planner-context';

const cases = (['v9_archer', 'v9_summoner', 'v9_knight'] as const).flatMap(version =>
  (['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ version, race, mirror }))));

it.each(cases)('$version restores its idle wounded $race soldier before rejoining (mirror=$mirror)',
  ({ version, race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    let scene = sketchScene('wounded-post-continuity').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(500), 500).townHall('foe', x(3500), 3500)
      .building('us', race === 'grove' ? 'moonWell' : 'emberShrine', x(500), 900, { id: 'well' })
      .unit('us', race === 'grove' ? 'lancer' : 'emberRavager', x(820), 500, { id: 'patient' });
    for (let i = 0; i < 5; i++) scene = scene.unit('us', race === 'grove' ? 'lancer' : 'emberRavager',
      x(400 + i * 80), 700, { id: `screen-${i}` });
    for (const [i, angle] of [-0.3, 0, 0.3].entries()) scene = scene.unit('foe', 'ballista',
      x(820 + Math.cos(angle) * 380), 500 + Math.sin(angle) * 380, { id: `gun-${i}` });
    const game = scene.build().createGame();
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    const patient = game.units.find(unit => unit.id === 'patient')!;
    const guns = game.units.filter(unit => unit.owner === 'foe');
    issuePlayerCommand(game, 'us', { type: 'holdPosition', unitIds: game.units.filter(unit => unit.owner === 'us').map(unit => unit.id) });
    for (const gun of guns) issuePlayerCommand(game, 'foe', { type: 'cast', unitId: gun.id, ability: 'pinningBolt', targetId: patient.id });
    for (let tick = 0; tick < 100 && game.projectiles.length < 3; tick++) stepGame(game);
    expect(game.projectiles).toHaveLength(3);
    issuePlayerCommand(game, 'foe', { type: 'move', unitIds: guns.map(unit => unit.id), x: x(3500), y: 3000, avoidCombat: true });
    for (let tick = 0; tick < 600; tick++) stepGame(game);
    expect(patient.hp).toBe(patient.maxHp - 108);
    const memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
    let firstHealHp: number | undefined;
    for (let tick = 0; tick < 1200; tick++) {
      if (tick % 15 === 0) sdk.issue(planAiOwnerCommandEntries(snapshotGame(game),
        { playerId: 'us', version, policyMode: 'combat', memory }, { teams: game.teams }), {}, { checksum: false });
      stepGame(game);
      if (firstHealHp === undefined && patient.hp > patient.maxHp - 108) firstHealHp = patient.hp;
    }
    expect(firstHealHp).toBeDefined();
    expect(game.units).toContain(patient);
    expect(patient.hp).toBe(patient.maxHp);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
    expect(game.players.us!.gold).toBe(500);
  });

it.each((['grove', 'ember'] as const).flatMap(race => [false, true].map(mirror => ({ race, mirror }))))
('keeps a wounded $race healer using its own available spell (mirror=$mirror)', ({ race, mirror }) => {
  const x = (value: number) => mirror ? 4096 - value : value;
  const game = sketchScene('healing-before-rest-order').map('openClaims').replaceDefaults()
    .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
    .townHall('us', x(500), 500).townHall('foe', x(3500), 3500)
    .building('us', race === 'grove' ? 'moonWell' : 'emberShrine', x(1000), 1000)
    .unit('us', race === 'grove' ? 'priest' : 'emberAcolyte', x(1100), 1000,
      { id: 'healer', hp: 20 }).build().createGame();
  game.scriptedVictory = true;
  const healer = game.units.find(unit => unit.id === 'healer')!;
  const memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
  sdk.issue(planAiOwnerCommandEntries(snapshotGame(game),
    { playerId: 'us', version: 'v9_knight', policyMode: 'combat', memory }, { teams: game.teams }), {}, { checksum: false });
  stepGame(game);
  expect(healer.hp).toBeGreaterThan(20 + SUPPORT_BUILDING_HEAL);
  expect(game.match.stats.unitsLost.us).toBe(0);
  expect(game.match.stats.goldSpent.us).toBe(0);
});

it.each(cases)('$version stays inside actual $race healing range across a sealed wall (mirror=$mirror)',
  ({ version, race, mirror }) => {
    const x = (value: number) => mirror ? 4096 - value : value;
    const post = race === 'grove' ? 'moonWell' : 'emberShrine';
    const game = sketchScene('healing-range-before-road').map('openClaims').replaceDefaults()
      .player('us', { race, team: 'a' }).player('foe', { team: 'b' })
      .townHall('us', x(1400), 500).townHall('foe', x(3500), 3500)
      .building('us', post, x(900), 1700, { id: 'ready' })
      .building('us', post, x(1800), 1700, { id: 'road' })
      .unit('us', race === 'grove' ? 'lancer' : 'emberRavager', x(1100), 1700,
        { id: 'patient', hp: 20 }).build().createGame();
    game.scriptedVictory = true;
    game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) =>
      (mirror ? 127 - index % 128 : index % 128) === 31 ? 'T' : '.').join('') };
    for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
    setBuildingBodies(game.map, game.buildings);
    const patient = game.units.find(unit => unit.id === 'patient')!;
    const ready = game.buildings.find(building => building.id === 'ready')!;
    const road = game.buildings.find(building => building.id === 'road')!;
    expect(Math.hypot(patient.x - ready.x, patient.y - ready.y)).toBeLessThan(ready.attackRange);
    expect(walkingDistance(game.map, patient, ready)).toBeUndefined();
    expect(walkingDistance(game.map, patient, road)).toBeGreaterThan(0);
    const memory = createAiPolicyMemory(), sdk = new SdkCommandFrameRuntime(game);
    for (let tick = 0; tick < 1200; tick++) {
      if (tick % 15 === 0) sdk.issue(planAiOwnerCommandEntries(snapshotGame(game),
        { playerId: 'us', version, policyMode: 'combat', memory }, { teams: game.teams }), {}, { checksum: false });
      stepGame(game);
    }
    expect(game.units).toContain(patient);
    expect(patient.hp).toBe(patient.maxHp);
    expect(game.match.stats.unitsLost.us).toBe(0);
    expect(game.match.stats.goldSpent.us).toBe(0);
  });
