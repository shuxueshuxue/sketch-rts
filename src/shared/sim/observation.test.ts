import { afterEach, describe, expect, it, vi } from 'vitest';
import { boardUnit, syncDecks } from '../decks';
import { createGame, observeSimulation, removeUnit, snapshotGame, stepGame, strikeUnit, tryPlayerCommand } from '../sim';
import { canonicalGameState, checksumGame } from './checksum';
import { createBuilding } from '../map';
import { simulationObservationActive, type SimulationDamageEvent, type SimulationKillEvent, type SimulationRemovalEvent,
  type SimulationBuildingDamageEvent, type SimulationBuildingKillEvent } from './observation';

function battle() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.buildings = []; game.items = []; game.scriptedVictory = true;
  delete game.map.terrain;
  return game;
}
const stops: (() => void)[] = [];
afterEach(() => { for (const stop of stops.splice(0)) stop(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('external simulation observation', () => {
  it('records native building damage and its exact destroyer separately from unit casualties', () => {
    const a = battle(), b = battle();
    for (const game of [a, b]) {
      game.spawnUnit('enemy', 'archer', 900, 900);
      game.buildings.push(createBuilding('mine-hall', 'player', 'townHall', 500, 500, true));
    }
    const damage: SimulationBuildingDamageEvent[] = [], kills: SimulationBuildingKillEvent[] = [];
    let unitKills = 0;
    stops.push(observeSimulation(b, { buildingDamage: event => damage.push(event), buildingKill: event => kills.push(event), kill() { unitKills++; } }));
    const hpBefore = b.buildings[0]!.hp;
    for (const game of [a, b]) strikeUnit(game, game.units[0]!, game.buildings[0]!, 99999, 'ranged');
    expect(damage).toHaveLength(1); expect(kills).toHaveLength(1); expect(unitKills).toBe(0);
    expect(damage[0]).toMatchObject({ hpBefore, target: { id: 'mine-hall', kind: 'townHall' }, source: { owner: 'enemy', kind: 'archer' } });
    expect(kills[0]).toMatchObject({ building: { id: 'mine-hall', hp: b.buildings[0]!.hp }, source: { owner: 'enemy' } });
    expect(Object.isFrozen(damage[0]!.target)).toBe(true);
    expect(b.match.stats.buildingsDestroyed.enemy).toBe(1);
    stepGame(a); stepGame(b);
    expect(snapshotGame(a)).toEqual(snapshotGame(b));
    expect(checksumGame(a)).toBe(checksumGame(b));
  });

  it('observes exact lethal boundaries including a unit born and killed between thinks', () => {
    const game = battle(), damage: SimulationDamageEvent[] = [], killed: SimulationKillEvent[] = [], removed: SimulationRemovalEvent[] = [];
    stops.push(observeSimulation(game, { damage: event => damage.push(event), kill: event => killed.push(event), removed: event => removed.push(event) }));
    const source = game.spawnUnit('enemy', 'archer', 900, 900), victim = game.spawnUnit('player', 'worker', 500, 500);
    const hp = victim.hp;
    strikeUnit(game, source, victim, 99999, 'ranged');
    expect(damage).toHaveLength(1);
    expect(damage[0]).toMatchObject({ tick: 0, hpBefore: hp, target: { id: victim.id, hp: victim.hp }, source: { id: source.id, kind: 'archer', present: true }, profile: { delivery: 'ranged' } });
    expect(killed).toHaveLength(1);
    expect(removed).toHaveLength(0);
    stepGame(game); stepGame(game);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ tick: 1, reason: 'death', countedAsLoss: true, unit: { id: victim.id } });
    expect(game.match.stats.unitsLost.player).toBe(1);
  });

  it('captures the sinking killer for deck and cabin passengers without inventing damage hits', () => {
    const game = battle(), kills: SimulationKillEvent[] = [], removals: SimulationRemovalEvent[] = [];
    const ship = game.spawnUnit('player', 'transport', 600, 600);
    const deck = game.spawnUnit('player', 'archer', 600, 600), cabin = game.spawnUnit('player', 'worker', 600, 600);
    boardUnit(ship, deck, game.units); boardUnit(ship, cabin, game.units); syncDecks(game.units);
    cabin.cabin = { shipId: ship.id };
    const source = game.spawnUnit('enemy', 'warship', 1200, 600);
    stops.push(observeSimulation(game, { kill: event => kills.push(event), removed: event => removals.push(event) }));
    strikeUnit(game, source, ship, 99999, 'spell'); stepGame(game);
    expect(kills.map(event => [event.unit.id, event.cause]).sort()).toEqual([[ship.id, 'damage'], [deck.id, 'sinking'], [cabin.id, 'sinking']].sort());
    expect(kills.every(event => event.source.id === source.id)).toBe(true);
    expect(removals.map(event => event.unit.id).sort()).toEqual([ship.id, deck.id, cabin.id].sort());
    expect(game.match.stats.unitsLost.player).toBe(3);
  });

  it('separates living expiry, lethal-at-expiry and scripted exits according to native counters', () => {
    const game = battle(), events: SimulationRemovalEvent[] = [];
    const source = game.spawnUnit('enemy', 'archer', 1200, 1200);
    const expired = game.spawnUnit('player', 'spirit', 500, 500), deadExpired = game.spawnUnit('player', 'spirit', 600, 500);
    const extra = game.spawnUnit('player', 'footman', 700, 500);
    expired.expiresTick = 1; deadExpired.expiresTick = 1;
    stops.push(observeSimulation(game, { removed: event => events.push(event) }));
    strikeUnit(game, source, deadExpired, 99999, 'spell'); removeUnit(game, extra.id); stepGame(game);
    expect(events.map(event => [event.unit.id, event.reason, event.countedAsLoss]).sort()).toEqual([
      [extra.id, 'script-exit', false], [expired.id, 'expired', false], [deadExpired.id, 'expired', false],
    ].sort());
    expect(events.find(event => event.unit.id === expired.id)!.unit.hp).toBeGreaterThan(0);
    expect(events.find(event => event.unit.id === deadExpired.id)!.unit.hp).toBeLessThanOrEqual(0);
    expect(game.match.stats.unitsLost.player ?? 0).toBe(0);
  });

  it('copies and freezes nested data, reports subscriber errors, and continues other listeners and simulation', () => {
    vi.stubEnv('VITEST', '');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const game = battle(), source = game.spawnUnit('enemy', 'archer', 900, 900), victim = game.spawnUnit('player', 'worker', 500, 500);
    const errors: unknown[] = [], received: SimulationDamageEvent[] = [];
    stops.push(observeSimulation(game, { label: 'broken-view', damage(event) {
      (event.target.order as { type: string }).type = 'changed';
    }, error: error => errors.push(error) }));
    stops.push(observeSimulation(game, { damage: event => received.push(event) }));
    expect(() => strikeUnit(game, source, victim, 99999, 'spell')).not.toThrow();
    expect(victim.order.type).not.toBe('changed');
    expect(received).toHaveLength(1);
    expect(Object.isFrozen(received[0]!.target.order)).toBe(true);
    expect(errors[0]).toBeInstanceOf(TypeError);
    expect(log.mock.calls[0]![0]).toContain('broken-view / damage');
    expect(log.mock.calls[0]![0]).toContain('TypeError');
    stepGame(game);
    expect(game.units.some(unit => unit.id === victim.id)).toBe(false);
  });

  it('makes callback failures visible to the test runner without interrupting the synchronous simulation', () => {
    vi.stubEnv('VITEST', 'true');
    const deferred: VoidFunction[] = [], log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation(callback => { deferred.push(callback); });
    const game = battle(), victim = game.spawnUnit('player', 'worker', 500, 500), source = game.spawnUnit('enemy', 'archer', 900, 900);
    const failure = new Error('subscriber stack evidence');
    stops.push(observeSimulation(game, { label: 'test-failure', kill() { throw failure; } }));
    expect(() => strikeUnit(game, source, victim, 99999, 'spell')).not.toThrow();
    expect(victim.hp).toBeLessThanOrEqual(0);
    expect(log.mock.calls[0]![0]).toContain(failure.stack);
    expect(deferred).toHaveLength(1);
    expect(deferred[0]).toThrow(failure);
  });

  it('keeps Game shape, snapshots, canonical state and every fixed-command checksum identical', () => {
    const a = battle(), b = battle();
    for (const game of [a, b]) {
      game.spawnUnit('player', 'footman', 500, 500); game.spawnUnit('enemy', 'archer', 900, 500);
    }
    const shape = Object.keys(b), originalActive = simulationObservationActive;
    let calls = 0;
    const stop = observeSimulation(b, { command() { calls++; }, damage() { calls++; }, removed() { calls++; } }); stops.push(stop);
    expect(Object.keys(b)).toEqual(shape);
    expect(b.observer).toBeUndefined();
    expect(simulationObservationActive).toBe(originalActive + 1);
    for (let tick = 0; tick < 120; tick++) {
      if (tick % 30 === 0) for (const game of [a, b]) tryPlayerCommand(game, 'player', { type: 'attackMove', unitIds: [game.units[0]!.id], x: 900, y: 500 });
      stepGame(a); stepGame(b);
      expect(checksumGame(b), `tick ${tick}`).toBe(checksumGame(a));
    }
    expect(calls).toBeGreaterThan(0);
    expect(snapshotGame(b)).toEqual(snapshotGame(a));
    expect(canonicalGameState(b)).toEqual(canonicalGameState(a));
    stop(); stop();
    expect(simulationObservationActive).toBe(originalActive);
    const before = calls;
    tryPlayerCommand(b, 'player', { type: 'forfeit' });
    expect(calls).toBe(before);
  });
});
