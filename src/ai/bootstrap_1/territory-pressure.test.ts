import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import { snapshotGame, stepGame } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import type { AiPolicyContext } from '../policy/types';
import { mainArmyIntel, planBootstrapGeneral } from './mine-defense';
import { nativeLandRoad } from './safe-land-route';
import { beginTerritoryThink, finishTerritoryThink, territoryPostCommands, territoryReady } from './territory-pressure';

function pressureScene(mirror = false, soldiers = 8) {
  const x = (value: number) => mirror ? 4096 - value : value;
  let scene = sketchScene('safe-hold-to-forward-pressure').map('bareDuel').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' }).farms('us', 5, x(400), 3000)
    .townHall('us', x(500), 500).goldMine('main', x(788), 500, 10000)
    .townHall('us', x(500), 1500).goldMine('natural', x(788), 1500, 10000)
    .townHall('foe', x(3500), 3500, { id: 'enemy-main' })
    .townHall('foe', x(3000), 600, { id: 'outpost' });
  for (let i = 0; i < soldiers; i++) scene = scene.unit('us', 'footman', x(950 + i * 32), 800, { id: `fighter-${i}` });
  for (let i = 0; i < 5; i++) scene = scene.building('foe', 'defenseTower', x(2800 + i * 100), 400);
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  memory.v6 = { phase: 0, doctrine: { profileId: 'steady', strategyId: 'pressure', decidedTick: 0 } };
  const options: AiPolicyContext = { memory, version: 'v2', requestedVersion: 'v7', teams: game.teams,
    armyWants: [], doctrines: [{ id: 'pressure', race: 'grove', weight: 1, standIn: 'footman', raids: [],
      phases: [{ wants: [{ bases: 2, priority: 76 }], advanceShare: 1, advanceSupply: 1000 }] }] };
  const think = () => {
    const commands = planBootstrapGeneral(snapshotGame(game), 'us', options);
    issueCommandFrame(game, commands.map(command => ({ playerId: 'us', scriptId: 'v6General', command })));
    return commands;
  };
  const advance = (ticks: number) => { for (let i = 0; i < ticks; i++) { if (game.tick % 15 === 0) think(); stepGame(game); } };
  return { game, memory, options, think, advance };
}

it('keeps thirty seconds of safe hold across a defense and needs only the remaining thirty', () => {
  const { game, memory, options } = pressureScene();
  const observe = (tick: number, safe: boolean) => {
    game.tick = tick;
    memory.v6!.general = { mode: safe ? 'hold' : 'defend', target: { x: 500, y: 500 } };
    const snapshot = snapshotGame(game);
    beginTerritoryThink(snapshot, options, safe);
    finishTerritoryThink(snapshot, options, mainArmyIntel(snapshot, 'us', options), safe, false);
  };
  for (let tick = 0; tick <= 600; tick += 15) observe(tick, true);
  expect(memory.territory!.idleTicks).toBe(600);
  for (let tick = 615; tick <= 1215; tick += 15) observe(tick, false);
  expect(memory.territory!.idleTicks).toBe(600);
  expect(territoryReady(options)).toBe(false);
  for (let tick = 1230; tick < 1830; tick += 15) observe(tick, true);
  expect(territoryReady(options)).toBe(false);
  observe(1830, true);
  expect(territoryReady(options)).toBe(true);
});

it.each([false, true])('turns a safe idle local edge into a real expansion sortie after sixty seconds (mirror=%s)', mirror => {
  const { game, memory, advance } = pressureScene(mirror);
  advance(1200);
  expect(memory.landAttack).toBeUndefined();
  advance(16);
  expect(memory.landAttack?.targetId).toBe('outpost');
  expect(memory.territory!.lastAction?.kind).toBe('attack');
  const before = { ...game.units.find(unit => unit.id === 'fighter-0')! };
  advance(300);
  const after = game.units.find(unit => unit.id === before.id)!;
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(200);
  expect(game.buildings.find(building => building.id === 'enemy-main')!.hp).toBe(900);
});

it.each([false, true])('occupies and keeps a safe forward post when the expansion is too strong (mirror=%s)', mirror => {
  const { game, memory, advance } = pressureScene(mirror, 4);
  advance(2200);
  expect(memory.landAttack).toBeUndefined();
  const objective = structuredClone(memory.territory!.objective!);
  expect(objective.targetId).toBe('outpost');
  expect(objective.reachedTick).toBeDefined();
  const atPost = () => game.units.filter(unit => unit.owner === 'us'
    && Math.hypot(unit.x - objective.point.x, unit.y - objective.point.y) <= 240).length;
  expect(atPost()).toBeGreaterThanOrEqual(3);
  advance(300);
  expect(memory.territory!.objective?.point).toEqual(objective.point);
  expect(atPost()).toBeGreaterThanOrEqual(3);
  expect(game.buildings.find(building => building.id === 'outpost')!.hp).toBe(900);
});

it.each([false, true])('still prioritizes a real home threat and uses the existing retreat rule on a limited sortie (mirror=%s)', mirror => {
  const { game, memory, think, advance } = pressureScene(mirror);
  advance(1216);
  expect(memory.landAttack?.targetId).toBe('outpost');
  const fighter = game.units.find(unit => unit.id === 'fighter-0')!;
  for (let i = 0; i < 30; i++) game.spawnUnit('foe', 'knight', fighter.x + (mirror ? -1 : 1) * (300 + i % 5 * 32),
    fighter.y + Math.floor(i / 5) * 32);
  think();
  expect(memory.landAttackResult).toMatchObject({ result: 'withdrew' });
  expect(memory.landAttackResult!.reason).toMatch(/^general:retreat/);
  expect(memory.v6!.general!.mode).not.toBe('attack');
  const hall = game.buildings.find(building => building.owner === 'us' && building.kind === 'townHall')!;
  const raider = game.spawnUnit('foe', 'knight', hall.x + 100, hall.y + 100);
  raider.order = { type: 'attack', targetId: hall.id };
  think();
  expect(['defend', 'guard']).toContain(memory.v6!.general!.mode);
  expect(memory.landAttack).toBeUndefined();
});


it('pauses the forward caster anchor for a home threat even when all front fighters are borrowed', () => {
  const { game, memory, options, think, advance } = pressureScene(false, 4);
  advance(2200);
  const point = structuredClone(memory.territory!.objective!.point);
  memory.support = { baseId: 'care', unitIds: game.units.filter(unit => unit.owner === 'us').map(unit => unit.id), sinceTick: game.tick };
  const home = game.buildings.find(building => building.owner === 'us' && building.kind === 'townHall')!;
  const raider = game.spawnUnit('foe', 'knight', home.x + 100, home.y + 100);
  raider.order = { type: 'attack', targetId: home.id };
  expect(mainArmyIntel(snapshotGame(game), 'us', options).intrusion).toBeDefined();
  think();
  expect(memory.territory!.objective!.point).toEqual(point);
  expect(memory.v6!.general!.target).not.toEqual(point);
  expect(Math.hypot(memory.v6!.general!.target!.x - home.x, memory.v6!.general!.target!.y - home.y)).toBeLessThan(500);
});

it('keeps an existing post when another task borrows two of its four soldiers', () => {
  const { game, memory, think, advance } = pressureScene(false, 4);
  advance(2200);
  const point = memory.territory!.objective!.point;
  const party = game.units.filter(unit => unit.owner === 'us' && unit.kind === 'footman')
    .sort((a, b) => Math.hypot(a.x - point.x, a.y - point.y) - Math.hypot(b.x - point.x, b.y - point.y));
  const borrowed = party.slice(2).map(unit => unit.id);
  memory.support = { baseId: 'other-task', unitIds: borrowed, sinceTick: game.tick };
  const commands = think();
  expect(commands.flatMap(command => 'unitIds' in command ? command.unitIds : []).some(id => borrowed.includes(id))).toBe(false);
  advance(300);
  expect(memory.territory!.objective?.targetId).toBe('outpost');
  const home = game.buildings.find(building => building.owner === 'us' && building.kind === 'townHall')!;
  expect(party.slice(0, 2).every(unit => Math.hypot(unit.x - home.x, unit.y - home.y) > 700)).toBe(true);
});

it('keeps post slots on locally connected ground instead of sending soldiers on a cross-river detour', () => {
  const { game, memory, options } = pressureScene(false, 4);
  const cells = [...game.map.terrain!.cells];
  // The next row is forest except for a distant passage. Slots just across
  // it are walkable, but the executed road takes a map-wide detour.
  for (let col = 0; col < 100; col++) cells[26 * 128 + col] = 'T';
  game.map.terrain = { ...game.map.terrain!, cells: cells.join('') };
  setBuildingBodies(game.map, game.buildings);
  const point = { x: 1200, y: 800 };
  memory.v6!.general = { mode: 'hold', target: point };
  memory.territory = { idleTicks: 1200, lastTick: game.tick, idle: false,
    objective: { targetId: 'outpost', point, sinceTick: game.tick } };
  const snapshot = snapshotGame(game);
  const result = territoryPostCommands(snapshot, 'us', options, mainArmyIntel(snapshot, 'us', options), true);
  expect(result).toBeDefined();
  const slots = memory.territory.objective!.slots!;
  expect(slots).toHaveLength(9);
  expect(slots.filter(slot => slot.x === point.x && slot.y === point.y).length).toBeGreaterThan(1);
  const scout = { ...game.units.find(unit => unit.kind === 'footman')!, ...point };
  for (const slot of slots) expect(nativeLandRoad(snapshot, scout, slot)!.ticks)
    .toBeLessThanOrEqual((Math.hypot(slot.x - point.x, slot.y - point.y) + 128) / scout.speed * 20);
});
