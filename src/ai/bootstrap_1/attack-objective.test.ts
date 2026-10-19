import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { issueCommandFrame } from '../../sdk/commands/frame';
import { snapshotGame, stepGame } from '../../shared/sim';
import { setBuildingBodies, snapToFootprint } from '../../shared/terrain';
import type { GameCommand } from '../../shared/types';
import type { Game } from '../../shared/sim';
import { createAiPolicyMemory } from '../memory';
import { runAiCommandEntriesFromScripts } from '../policy/script-runner';
import type { AiPolicyContext } from '../policy/types';
import { prepareExpansionMission, expansionMissionUnitIds } from './expansion-mission';
import { rankBootstrapGoals, bootstrapEconomy } from './economy';
import { miningAssignments } from './mining-assignments';
import { mainArmyIntel, planBootstrapGeneral } from './mine-defense';
import { attackArrivalTicks } from './attack-objective';

function battle(expanding = false, roadCamp = false) {
  let scene = sketchScene('attack-through-a-result').map('openClaims').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' })
    .playerState('us', { gold: expanding ? 400 : 0 })
    .farms('us', 5, 400, 3000).townHall('us', 400, 400).goldMine('main', 688, 400, 10000)
    .townHall('foe', 3500, 3500, { id: 'enemy-main' })
    .townHall('foe', 2600, 650, { id: 'outpost' })
    .worker('foe', 3420, 3400).worker('foe', 3500, 3400).worker('foe', 3580, 3400);
  if (expanding) scene = scene.goldMine('natural', 1600, 1550, 10000)
    .unit('neutral', 'ogreWarrior', 1700, 1550, { id: 'guard' }).worker('us', 800, 600, { id: 'builder' });
  else scene = scene.townHall('us', 400, 1500).goldMine('natural', 688, 1500, 10000);
  if (roadCamp) scene = scene.unit('neutral', 'ogreLord', 1800, 700, { id: 'road-guard' });
  for (let i = 0; i < 8; i++) scene = scene.unit('us', 'knight', 1050 + i * 32, 800, { id: `fighter-${i}` });
  const game = scene.build().createGame(), memory = createAiPolicyMemory();
  game.scriptedVictory = true;
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: '.'.repeat(128 * 128) };
  for (const building of game.buildings) Object.assign(building, snapToFootprint(game.map, building.radius, building));
  setBuildingBodies(game.map, game.buildings);
  const options: AiPolicyContext = { memory, version: 'v2', requestedVersion: 'v9', teams: game.teams,
    armyWants: [], doctrines: [{ id: 'attack-with-a-screen', race: 'grove', weight: 1, standIn: 'knight', raids: [],
      phases: [{ wants: [{ bases: 2, priority: 76 }], advanceShare: 1, advanceSupply: 1000 }] }] };
  const think = () => {
    const snapshot = snapshotGame(game);
    prepareExpansionMission(snapshot, 'us', options, mainArmyIntel(snapshot, 'us', options));
    const commands = planBootstrapGeneral(snapshot, 'us', options);
    const economy = expanding ? runAiCommandEntriesFromScripts(snapshot, 'us', [bootstrapEconomy, miningAssignments], options) : [];
    issueCommandFrame(game, [...economy.map(entry => ({ ...entry, playerId: 'us' })),
      ...commands.map(command => ({ playerId: 'us', scriptId: 'v6General', command }))]);
    return commands;
  };
  return { game, memory, options, think };
}

function advance(game: Game, ticks: number, think: () => GameCommand[]) {
  for (let i = 0; i < ticks; i++) { if (game.tick % 15 === 0) think(); stepGame(game); }
}

it('keeps the assault open until the selected expansion is physically destroyed', () => {
  const { game, memory, think } = battle();
  think();
  expect(memory.landAttack?.targetId).toBe('outpost');
  expect(memory.landAttackResult).toBeUndefined();
  for (let i = 0; i < 1500 && game.buildings.some(building => building.id === 'outpost'); i++) {
    if (game.tick % 15 === 0) think();
    expect(memory.landAttack?.targetId).toBe('outpost');
    expect(memory.landAttackResult).toBeUndefined();
    stepGame(game);
  }
  expect(game.buildings.some(building => building.id === 'outpost')).toBe(false);
  think();
  expect(memory.landAttackResult).toMatchObject({ targetId: 'outpost', result: 'destroyed', reason: 'target-gone' });
  expect(game.buildings.find(building => building.id === 'enemy-main')!.hp).toBe(900);
});

it('clears and builds the mine with its own small party while the rest destroy an enemy expansion', () => {
  const { game, memory, think } = battle(true);
  think();
  const reserved = expansionMissionUnitIds(memory);
  expect(reserved.length).toBeGreaterThan(0);
  expect(reserved.length).toBeLessThan(8);
  expect(memory.landExpansion?.combat?.creep?.center.x).toBe(1700);
  expect(memory.landAttack?.targetId).toBe('outpost');
  expect(memory.landAttack!.general.group!.every(id => !reserved.includes(id))).toBe(true);
  advance(game, 2400, think);
  expect(game.buildings.some(building => building.id === 'outpost')).toBe(false);
  expect(game.buildings.some(building => building.owner === 'us' && building.kind === 'townHall' && building.complete
    && Math.hypot(building.x - 1600, building.y - 1550) < 340)).toBe(true);
  expect(game.units.some(unit => unit.id === 'guard')).toBe(false);
});

it('pauses for a real home defense, then resumes the same unfinished attack', () => {
  const { game, memory, think } = battle();
  think();
  const since = memory.landAttack!.sinceTick;
  const invaders = Array.from({ length: 5 }, (_, i) => ({ ...structuredClone(game.units.find(unit => unit.id === 'fighter-0')!),
    id: `intruder-${i}`, owner: 'foe', x: 600 + i * 32, y: 450, order: { type: 'attack' as const, targetId: game.buildings[0]!.id } }));
  game.units.push(...invaders);
  advance(game, 30, think);
  expect(memory.landAttack).toMatchObject({ targetId: 'outpost', sinceTick: since, paused: 'defense' });
  expect(memory.landAttackResult).toBeUndefined();
  game.units = game.units.filter(unit => !unit.id.startsWith('intruder-'));
  advance(game, 60, think);
  expect(memory.landAttack).toMatchObject({ targetId: 'outpost', sinceTick: since });
  expect(memory.landAttack!.paused).toBeUndefined();
  for (let i = 0; i < 1800 && game.buildings.some(b => b.id === 'outpost'); i++) {
    if (game.tick % 15 === 0) think(); stepGame(game);
  }
  think();
  expect(game.buildings.some(building => building.id === 'outpost')).toBe(false);
  expect(memory.landAttackResult).toMatchObject({ targetId: 'outpost', result: 'destroyed' });
});

it('records losing the attacking army as failure while the target is still standing', () => {
  const { game, memory, think } = battle();
  think();
  game.units = game.units.filter(unit => unit.owner !== 'us');
  think();
  expect(memory.landAttack).toBeUndefined();
  expect(memory.landAttackResult).toMatchObject({ targetId: 'outpost', result: 'army-lost' });
  expect(game.buildings.find(building => building.id === 'outpost')!.hp).toBe(900);
});

it('intercepts a new hall only when the actual steering arrival precedes its remaining construction', () => {
  const { game, memory, think } = battle();
  const outpost = game.buildings.find(building => building.id === 'outpost')!;
  outpost.complete = false; outpost.buildProgress = 0;
  const builder = game.units.find(unit => unit.owner === 'foe')!;
  builder.x = outpost.x - 100; builder.y = outpost.y;
  builder.order = { type: 'repair', buildingId: outpost.id };
  const unit = game.units.find(unit => unit.id === 'fighter-0')!;
  const snapshot = snapshotGame(game);
  expect(attackArrivalTicks(snapshot, unit, outpost)).toBeLessThan(outpost.buildTime);
  think();
  expect(memory.landAttack?.targetId).toBe(outpost.id);
  advance(game, 600, think);
  expect(game.buildings.some(building => building.id === outpost.id)).toBe(false);
});

it('clears a blocking road camp as a child of the same attack and then destroys the original target', () => {
  const { game, memory, think } = battle(false, true);
  game.buildings.find(building => building.owner === 'us' && building.kind === 'townHall')!.y = 700;
  game.map.terrain = { cell: 32, cols: 128, rows: 128,
    cells: Array.from({ length: 128 * 128 }, (_, index) => Math.floor(index / 128) >= 16 && Math.floor(index / 128) <= 29 ? '.' : '~').join('') };
  setBuildingBodies(game.map, game.buildings);
  think();
  expect(memory.landAttack).toMatchObject({ targetId: 'outpost', camp: { center: { x: 1800, y: 700 } } });
  expect(memory.landAttackResult).toBeUndefined();
  for (let i = 0; i < 2400 && game.buildings.some(b => b.id === 'outpost'); i++) {
    if (game.tick % 15 === 0) think(); stepGame(game);
  }
  think();
  expect(game.units.some(unit => unit.id === 'road-guard')).toBe(false);
  expect(game.buildings.some(building => building.id === 'outpost')).toBe(false);
  expect(memory.landAttackResult).toMatchObject({ targetId: 'outpost', result: 'destroyed' });
});

it('records the existing retreat judgment and actually withdraws from an overwhelming army', () => {
  const { game, memory, think } = battle();
  think();
  stepGame(game);
  const target = game.buildings.find(building => building.id === 'outpost')!;
  const before = Math.hypot(game.units.find(unit => unit.id === 'fighter-0')!.x - target.x, 800 - target.y);
  const fighter = game.units.find(unit => unit.id === 'fighter-0')!;
  game.units.push(...Array.from({ length: 30 }, (_, i) => ({ ...structuredClone(fighter), owner: 'foe', id: `wall-${i}`,
    x: 1620 + i % 5 * 32, y: 700 + Math.floor(i / 5) * 32, order: { type: 'idle' as const } })));
  think();
  expect(memory.landAttackResult).toMatchObject({ targetId: 'outpost', result: 'withdrew' });
  expect(memory.landAttackResult!.reason).toMatch(/^general:retreat/);
  for (let i = 0; i < 150; i++) stepGame(game);
  const survivor = game.units.find(unit => unit.id === 'fighter-0')!;
  expect(Math.hypot(survivor.x - target.x, survivor.y - target.y)).toBeGreaterThan(before + 100);
  expect(target.hp).toBe(900);
});

it('reserves the hall capital through the private camp while retaining the main assault state', () => {
  const { game, memory, options, think } = battle(true);
  think();
  const general = structuredClone(memory.v6!.general);
  const goals = rankBootstrapGoals(snapshotGame(game), 'us', options);
  expect(goals.some(goal => goal.id === 'bases:2' && goal.cost === 400 && goal.save && goal.hold)).toBe(true);
  expect(memory.v6!.general).toEqual(general);
  expect(memory.v6!.general?.mode).toBe('attack');
});
