import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { GameSnapshot } from '../../shared/types';
import { describe, expect, it } from 'vitest';
import { createBuilding, createUnit } from '../../shared/map';
import { createGame } from '../../shared/sim';
import { planVoyageRoute } from '../../shared/ship-navigation';
import { installedWeapons, shipMounts } from '../../shared/ship-equipment';
import { shipLaunchPose, shipLaunchPrototype } from '../../shared/ship-launch';
import { coursePerformance } from '../../shared/ship-wind';
import { resolveUnitDamage } from '../../shared/damage';
import { attackDamageProfile } from '../../shared/damage-types';
import { observationJsonBytes } from './observation-json-bytes';
import { assessVoyageRisks, VOYAGE_RISK_MEMORY_BYTES, VOYAGE_RISK_SAMPLES_PER_THINK,
  transportExpectedLoss, voyageExpectedLoss, type VoyageRiskMemory, type VoyageRiskRequest } from './voyage-risk';

function world() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = [createUnit('ferry', 'player', 'transport', 1000, 2000)];
  game.buildings = []; game.items = []; game.obstacles = []; game.resources = [];
  game.map = { ...game.map, width: 20000, height: 10000, wind: { direction: Math.PI, speed: 80 },
    terrain: { cols: 200, rows: 100, cell: 100, cells: '~'.repeat(20000) } };
  game.units[0]!.sailing = { heading: 0, speed: 0, load: 0, balance: 0 };
  return game;
}
const state = (): VoyageRiskMemory => ({ version: 1, owner: 'player', tick: -1, routeIds: [], entries: [] });
function request(game: ReturnType<typeof world>, x = 1256, y = 2000, id = 'route'): VoyageRiskRequest {
  const destination = { x, y };
  return { id, shipId: 'ferry', seaId: 'sea:1', destination,
    route: planVoyageRoute(game.map, game.units[0]!, destination) };
}
function tower(game: ReturnType<typeof world>, range = 600) {
  const unit = createBuilding('coastal-tower', 'enemy', 'defenseTower', 1128, 2100, true);
  unit.attackDamage = 10; unit.attackCooldown = 20; unit.attackRange = range;
  game.buildings.push(unit); return unit;
}
const bytes = (value: ReturnType<typeof assessVoyageRisks>, memory: VoyageRiskMemory) => JSON.stringify({ results: [...value.results], memory });

describe('bounded native voyage exposure', () => {
  it('proves an empty basin safe without route planning or sampling', () => {
    const game = world(), memory = state();
    const { route: _native, ...query } = request(game);
    const result = assessVoyageRisks(game, 'player', [query], memory);
    expect(result.routePlans).toBe(0); expect(result.samplesUsed).toBe(0);
    expect(result.results.get('route')).toMatchObject({ status: 'known', survivalProbability: 1,
      expectedDamage: 0, basis: 'no-capable-basin-enemy', threatIds: [] });
    expect(memory.entries).toEqual([]);
  });

  it('integrates tower DPS over actual passage time, including native hull protection', () => {
    const game = world(), hazard = tower(game), ship = game.units[0]!;
    const result = assessVoyageRisks(game, 'player', [request(game)], state()).results.get('route')!;
    const wind = coursePerformance(ship, game.map, 0, { assumeTrimmed: true });
    const seconds = 256 / Math.max(wind.targetSpeed, wind.auxiliarySpeed);
    const damage = resolveUnitDamage(game, ship, hazard.attackDamage, attackDamageProfile(hazard.kind)).damage * seconds;
    expect(result.status).toBe('known'); if (result.status !== 'known') return;
    expect(result.expectedDamage).toBeCloseTo(damage, 10);
    expect(result.survivalProbability).toBeCloseTo(Math.max(0, 1 - damage / ship.hp), 10);
    expect(result.expectedHpLoss).toBeCloseTo(Math.min(ship.hp, damage), 10);
  });

  it('charges no damage when the native course detours outside the same tower range', () => {
    const game = world(); tower(game, 120);
    game.units[0]!.y = 1400;
    const result = assessVoyageRisks(game, 'player', [request(game, 1256, 1400)], state()).results.get('route');
    expect(result).toMatchObject({ status: 'known', expectedDamage: 0, survivalProbability: 1 });
  });

  it('publishes only after deterministic sample work and resumes identically from serialized mid-route memory', () => {
    const game = world(); tower(game, 30000);
    const query = request(game, 13000), memory = state();
    const first = assessVoyageRisks(game, 'player', [query], memory);
    expect(first.samplesUsed).toBe(VOYAGE_RISK_SAMPLES_PER_THINK);
    expect(first.results.get('route')).toMatchObject({ status: 'unknown', reasonCode: 'voyage-risk-sampling-deferred', samples: 256, totalSamples: 375 });
    const before = JSON.stringify(memory), repeat = assessVoyageRisks(game, 'player', [query], memory);
    expect(repeat.samplesUsed).toBe(0); expect(JSON.stringify(memory)).toBe(before);
    expect([...repeat.results]).toEqual([...first.results]);
    const restored = JSON.parse(before) as VoyageRiskMemory, cold = JSON.parse(JSON.stringify(game)) as typeof game;
    game.tick += 15; cold.tick = game.tick;
    const continuous = assessVoyageRisks(game, 'player', [query], memory);
    const fork = assessVoyageRisks(cold, 'player', [structuredClone(query)], restored);
    expect(bytes(continuous, memory)).toBe(bytes(fork, restored));
    expect(continuous.results.get('route')?.status).toBe('known');
    expect(observationJsonBytes(memory)).toBeLessThanOrEqual(VOYAGE_RISK_MEMORY_BYTES);
  });

  it('is byte-identical with another owner prewarming the basin and reversed target requests', () => {
    const game = world(); tower(game, 30000);
    const queries = [request(game, 13000, 2000, 'a'), request(game, 14000, 2000, 'b')];
    const cold = JSON.parse(JSON.stringify(game)) as typeof game, a = state(), b = state();
    const expected = assessVoyageRisks(cold, 'player', queries, a);
    const other = createUnit('other-hull', 'enemy', 'transport', 6000, 2000);
    game.units.push(other);
    assessVoyageRisks(game, 'enemy', [{ id: 'other', shipId: other.id, seaId: 'sea:1', destination: { x: 6500, y: 2000 } }],
      { ...state(), owner: 'enemy' });
    game.units.pop();
    const actual = assessVoyageRisks(game, 'player', [...queries].reverse(), b);
    expect(bytes(actual, b)).toBe(bytes(expected, a));
  });

  it('invalidates changed exposure facts and never turns partial geometry into a safe course', () => {
    const game = world(), hazard = tower(game, 30000), memory = state(), query = request(game, 13000);
    assessVoyageRisks(game, 'player', [query], memory);
    game.tick += 15; hazard.attackDamage *= 2;
    const fresh = assessVoyageRisks(game, 'player', [query], memory);
    expect(fresh.results.get('route')).toMatchObject({ status: 'unknown', samples: 256 });
    expect(assessVoyageRisks(game, 'player', [{ ...query, route: { ...query.route!, partial: true } }], state()).results.get('route'))
      .toMatchObject({ status: 'unknown', reasonCode: 'voyage-native-route-incomplete' });
  });

  it('does not combine a distant mortar range with close-range cannon DPS', () => {
    const game = world(), attacker = game.spawnUnit('enemy', 'bombardShip', 1780, 2000);
    const cannon = { id: 'short-cannon', kind: 'shipCannon' as const, shipId: attacker.id, mountId: 'port0',
      x: attacker.x, y: attacker.y, durability: 90, cooldownRemaining: 0 };
    game.items.push(cannon);
    attacker.fittings!.push({ ...shipMounts(attacker).find(mount => mount.id === 'port0')!, id: cannon.id });
    expect(installedWeapons(game, attacker)).toHaveLength(2);
    const query = request(game), both = assessVoyageRisks(game, 'player', [query], state()).results.get('route')!;
    cannon.durability = 0;
    const mortarOnly = assessVoyageRisks(game, 'player', [query], state()).results.get('route')!;
    expect(both.status).toBe('known'); expect(mortarOnly.status).toBe('known');
    if (both.status !== 'known' || mortarOnly.status !== 'known') return;
    expect(both.expectedDamage).toBeGreaterThan(0);
    expect(both.expectedDamage).toBe(mortarOnly.expectedDamage);
  });

  it('uses the specified producer native launch pose and does not silently substitute a surviving yard', () => {
    const game = world(), yard = createBuilding('quoted-yard', 'player', 'shipyard', 4000, 4000, true);
    game.buildings.push(yard, createBuilding('other-yard', 'player', 'shipyard', 7000, 4000, true));
    const pose = shipLaunchPose(game, yard, shipLaunchPrototype(yard, 'transport'))!;
    expect(pose).toBeDefined();
    const query: VoyageRiskRequest = { id: 'new-ship', productionBuildingId: yard.id, seaId: 'sea:1',
      destination: { x: pose.x + 200, y: pose.y } };
    expect(assessVoyageRisks(game, 'player', [query], state()).results.get(query.id))
      .toMatchObject({ status: 'known', survivalProbability: 1 });
    yard.hp = 0;
    expect(assessVoyageRisks(game, 'player', [query], state()).results.get(query.id))
      .toMatchObject({ status: 'unknown', reasonCode: 'voyage-hull-producer-or-basin-unknown' });
  });

  it('does not charge an armed hull in a different sea basin', () => {
    const game = world(), terrain = game.map.terrain!;
    terrain.cells = Array.from({ length: terrain.rows }, () => '~'.repeat(80) + '.'.repeat(40) + '~'.repeat(80)).join('');
    game.units.push(createUnit('far-cutter', 'enemy', 'cutter', 15000, 2000));
    const result = assessVoyageRisks(game, 'player', [request(game)], state());
    expect(result.samplesUsed).toBe(0);
    expect(result.results.get('route')).toMatchObject({ status: 'known', survivalProbability: 1,
      basis: 'no-capable-basin-enemy' });
  });
  it('prices sinking passengers once, including actual deck/cabin people omitted by the proposed manifest', () => {
    const game = world(), soldier = createUnit('soldier', 'player', 'footman', 1000, 2000), worker = createUnit('worker', 'player', 'worker', 1000, 2000);
    soldier.deck = { shipId: 'ferry', x: 0, y: 0 }; worker.cabin = { shipId: 'ferry' };
    game.units.push(soldier, worker);
    const quote = voyageExpectedLoss({ snapshot: game, shipId: 'ferry', passengerIds: [soldier.id, soldier.id],
      shipResidualGold: 240, survivalProbability: .75 });
    expect(quote.status).toBe('known'); if (quote.status !== 'known') return;
    expect(quote.passengers.map(passenger => passenger.unitId)).toEqual(['soldier', 'worker']);
    expect(quote.expectedLossGold).toBe(.25 * (240 + 100 + 75));
    expect(voyageExpectedLoss({ snapshot: game, passengerIds: ['missing'], shipResidualGold: 240, survivalProbability: 1 }))
      .toMatchObject({ status: 'unknown', reasonCode: 'voyage-passenger-value-unknown' });
  });

  it('does not charge shore-waiting passengers when the empty approach sinks', () => {
    const game = world(), waiting = createUnit('waiting', 'player', 'footman', 1000, 2000), aboard = createUnit('aboard', 'player', 'worker', 1000, 2000);
    aboard.deck = { shipId: 'ferry', x: 0, y: 0 }; game.units.push(waiting, aboard);
    const safe = assessVoyageRisks(game, 'player', [request(game)], state()).results.get('route')!;
    expect(safe.status).toBe('known'); if (safe.status !== 'known') return;
    const doomed = { ...safe, survivalProbability: 0, expectedDamage: game.units[0]!.hp, expectedHpLoss: game.units[0]!.hp };
    const quote = transportExpectedLoss({ snapshot: game, shipId: 'ferry', boardingPassengerIds: ['waiting'], shipResidualGold: 240,
      stages: { approach: doomed, loaded: safe } });
    expect(quote).toMatchObject({ status: 'known', successProbability: 0, passengerLossGold: 75, hullLossGold: 240,
      expectedLossGold: 315, waitingSinkingProbability: 0,
      passengerLosses: [{ unitId: 'aboard', valueGold: 75 }, { unitId: 'waiting', valueGold: 0 }] });
    const loadedLoss = transportExpectedLoss({ snapshot: game, shipId: 'ferry', boardingPassengerIds: ['waiting'], shipResidualGold: 240,
      stages: { approach: safe, loaded: doomed } });
    expect(loadedLoss).toMatchObject({ status: 'known', passengerLossGold: 175, expectedLossGold: 415 });
    const mixed = transportExpectedLoss({ snapshot: game, shipId: 'ferry', boardingPassengerIds: ['waiting'], shipResidualGold: 240,
      stages: { approach: { ...safe, survivalProbability: .8 }, loaded: { ...safe, survivalProbability: .5 } } });
    expect(mixed).toMatchObject({ status: 'known', passengerLosses: [
      { unitId: 'aboard', valueGold: 45 }, { unitId: 'waiting', valueGold: 40 }] });
    if (mixed.status === 'known') expect(mixed.passengerLosses.reduce((sum, loss) => sum + loss.valueGold, 0)).toBeCloseTo(mixed.passengerLossGold, 12);
  });

  it('resumes the real Ne native route cursor identically in a cold fork', () => {
    const pack = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/objective-event-frames.json.gz', import.meta.url))).toString());
    const frame: { snapshot: GameSnapshot; owner: string } = pack.cases.find((entry: { event: string }) => entry.event === 'Ne');
    const snapshot = frame.snapshot, memory = { ...state(), owner: frame.owner };
    const query: VoyageRiskRequest = { id: 'Ne-native', productionBuildingId: 'building-player-4-shipyard-1410',
      seaId: 'sea:1', destination: { x: 3344, y: 7216 } };
    const first = assessVoyageRisks(snapshot, frame.owner, [query], memory);
    expect(first.results.get(query.id)).toMatchObject({ status: 'unknown', reasonCode: 'voyage-native-route-deferred' });
    expect(memory.nativeRoutes).toHaveLength(1);
    snapshot.tick += 15;
    assessVoyageRisks(snapshot, frame.owner, [query], memory);
    expect(JSON.parse(memory.nativeRoutes![0]!.job).searchSteps).toBeGreaterThan(0);
    const forkMemory = JSON.parse(JSON.stringify(memory)) as VoyageRiskMemory;
    const forkWorld = JSON.parse(JSON.stringify(snapshot)) as GameSnapshot;
    snapshot.tick += 15; forkWorld.tick = snapshot.tick;
    const hot = assessVoyageRisks(snapshot, frame.owner, [query], memory);
    const cold = assessVoyageRisks(forkWorld, frame.owner, [query], forkMemory);
    expect(bytes(hot, memory)).toBe(bytes(cold, forkMemory));
    expect(JSON.parse(memory.nativeRoutes![0]!.job).searchSteps).toBeGreaterThan(1);
  });

});
