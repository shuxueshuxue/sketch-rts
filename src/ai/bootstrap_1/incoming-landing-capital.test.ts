import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { boardUnit, syncDecks } from '../../shared/decks';
import { combatCapability } from '../../shared/combat-capabilities';
import { currentBerthLandings } from '../../shared/naval';
import type { Unit } from '../../shared/types';
import { createGame, issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame } from '../../shared/sim';
import { sameGround, setBuildingBodies, walkableGoal, walkingDistance } from '../../shared/terrain';
import { createAiPolicyMemory } from '../memory';
import { coastOnWater, colonyNavalWant, navalBudgetReserve } from '../policy/naval';
import { bootstrapPolicyContext } from './policy';

// These are incoming-threat/reserve boundaries, not a full spending or match test.
// The actual runner already budgets miningWorkforce after the naval reserve.
// Its old15060 purchase followed a zero reserve; these queries alone do not
// establish successful spending protection, colonization or match victory.
function unloadGoal(boat: Unit) {
  if (boat.order.type !== 'unload') throw new Error('Expected the actual unload goal');
  return boat.order;
}

function field(options: { x?: number; y?: number; team?: string; crew?: boolean; detour?: 'long' | 'closed' } = {}) {
  const game = sketchScene('incoming-landing-capital-boundary').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove', team: 'a' }).player('foe', { race: 'grove', team: options.team ?? 'b' })
    .townHall('us', 2500, 500).townHall('foe', 3500, 3500)
    .worker('us', 2600, 650).goldMine('home', 2788, 500, 1000).goldMine('remote', 788, 500, 6000)
    .unit('us', 'transport', 1200, 1500, { id: 'economic-ferry' })
    .unit('foe', 'transport', options.x ?? 1500, options.y ?? 500, { id: 'convoy' })
    .unit('foe', 'archer', 1500, 550, { id: 'raider' }).build().createGame();
  game.map.terrain = { cell: 32, cols: 128, rows: 128, cells: Array.from({ length: 128 * 128 }, (_, index) => {
    const col = index % 128, row = Math.floor(index / 128);
    return col < 32 || col >= (options.detour ? 70 : 71) && col < 92 || col >= 103
      || options.detour && col >= 48 && col <= 55 && (options.detour === 'closed' || row < 110) ? '.' : '~';
  }).join('') };
  setBuildingBodies(game.map, game.buildings);
  syncDecks(game.units);
  const boat = game.units.find(unit => unit.id === 'convoy')!, raider = game.units.find(unit => unit.id === 'raider')!;
  if (options.detour) boat.sailing!.heading = Math.PI / 2;
  if (options.crew !== false) expect(boardUnit(boat, raider, game.units)).toBe(true);
  else game.units.splice(game.units.indexOf(raider), 1);
  syncDecks(game.units);
  issuePlayerCommand(game, 'foe', { type: 'unload', unitIds: [boat.id], x: 2400, y: 500 });
  const query = () => {
    const snapshot = snapshotGame(game), before = JSON.stringify(snapshot);
    const options = bootstrapPolicyContext(snapshot, 'us', 'v9_summoner', { memory: createAiPolicyMemory(), teams: game.teams });
    const result = { reserve: navalBudgetReserve(snapshot, 'us', options), want: colonyNavalWant(snapshot, 'us', options)?.id };
    expect(JSON.stringify(snapshot)).toBe(before);
    return result;
  };
  return { game, boat, raider, query };
}

it('reports the existing400 colony reserve in actual14400 instead of releasing it for a distant unload intention', () => {
  const saved = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/summoner-unseen-colony-capital-14400.json.gz', import.meta.url))).toString());
  const game = createGame('bareDuel'); restoreSnapshotIntoGame(game, saved.snapshot, saved.nextId);
  expect(snapshotGame(game)).toEqual(saved.snapshot); expect(saved.memories.p1).toBeDefined();
  const snapshot = snapshotGame(game), before = JSON.stringify(snapshot), boat = snapshot.units.find(unit => unit.id === 'unit-p1-transport-1366')!;
  expect(boat.order).toEqual({ type: 'unload', x: 3824, y: 7856 });
  const coast = coastOnWater(snapshot, unloadGoal(boat), boat)!;
  expect(walkingDistance(snapshot.map, boat, coast, 'sea')).toBeGreaterThan(900);
  expect(currentBerthLandings(snapshot.map, boat, unloadGoal(boat), snapshot.units)).toEqual([]);
  expect(navalBudgetReserve(snapshot, 'p0', bootstrapPolicyContext(snapshot, 'p0', 'v9_summoner', {
    memory: structuredClone(saved.memories.p0), teams: game.teams,
  }))).toBe(400);
  expect(JSON.stringify(snapshot)).toBe(before);
});

it('still reserves defense before a nearby convoy lands and keeps the established colony-production warning', () => {
  const { game, boat, query } = field(), snapshot = snapshotGame(game), coast = coastOnWater(snapshot, unloadGoal(boat), boat)!;
  expect(currentBerthLandings(snapshot.map, boat, unloadGoal(boat), snapshot.units)).toEqual([]);
  expect(walkingDistance(snapshot.map, boat, coast, 'sea')).toBeLessThanOrEqual(900);
  expect(query().reserve).toBe(0);
  game.buildings.push({ ...structuredClone(game.buildings.find(building => building.owner === 'us')!), id: 'original-main', x: 500, y: 3000 });
  const hall = game.buildings.pop()!; game.buildings.unshift(hall); setBuildingBodies(game.map, game.buildings);
  expect(query().want).toBe('naval:footholdProducer');
});

it('recognizes a moving near-shore convoy before stationary portrait landing is available', () => {
  const { game, boat, query } = field({ x: 1900 });
  boat.sailing!.speed = 12; boat.sailing!.velocityX = 12;
  const snapshot = snapshotGame(game);
  expect(currentBerthLandings(snapshot.map, boat, unloadGoal(boat), snapshot.units)).toEqual([]);
  expect(query().reserve).toBe(0);
  expect(game.units.find(unit => unit.id === 'raider')!.deck?.shipId).toBe(boat.id);
});

it('recognizes a real current landing on the home island even far from its hall and nominal unload coast', () => {
  const { game, boat, raider, query } = field({ x: 2140, y: 2600 }), snapshot = snapshotGame(game);
  const coast = coastOnWater(snapshot, unloadGoal(boat), boat)!;
  expect(walkingDistance(snapshot.map, boat, coast, 'sea')).toBeGreaterThan(900);
  expect(currentBerthLandings(snapshot.map, boat, unloadGoal(boat), snapshot.units).some(landing => landing.passengerId === raider.id)).toBe(true);
  expect(query().reserve).toBe(0);
  expect(combatCapability(snapshot, raider).armed).toBe(true);
  issuePlayerCommand(game, 'foe', { type: 'unloadPassenger', transportId: boat.id, passengerId: raider.id });
  expect(raider.deck).toBeUndefined();
  expect(sameGround(game.map, raider, game.buildings.find(building => building.owner === 'us')!)).toBe(true);
});

it('keeps capital for a straight-line-near convoy separated by a long sea detour or disconnected water', () => {
  for (const detour of ['long', 'closed'] as const) {
    const { game, boat, query } = field({ x: 1470, detour }), snapshot = snapshotGame(game);
    const coast = coastOnWater(snapshot, unloadGoal(boat), boat), road = coast && walkingDistance(snapshot.map, boat, coast, 'sea');
    const goal = unloadGoal(boat), nearestWater = walkableGoal(snapshot.map, goal.x, goal.y, 'sea');
    expect(Math.hypot(boat.x - nearestWater.x, boat.y - nearestWater.y)).toBeLessThan(900);
    expect(road === undefined || road > 900).toBe(true);
    expect(currentBerthLandings(snapshot.map, boat, unloadGoal(boat), snapshot.units)).toEqual([]);
    expect(query().reserve).toBe(400);
  }
});

it('preserves relation, destination-ground and armed-passenger boundaries', () => {
  expect(field({ team: 'a' }).query().reserve).toBe(400);
  expect(field({ crew: false }).query().reserve).toBe(400);
  const { game, boat, query } = field();
  issuePlayerCommand(game, 'foe', { type: 'unload', unitIds: [boat.id], x: 500, y: 500 });
  expect(query().reserve).toBe(400);
});
