import { afterEach, describe, expect, it } from 'vitest';
import { boardUnit } from '../shared/decks';
import { createBuilding } from '../shared/map';
import { createGame, removeUnit, stepGame, strikeUnit, tryPlayerCommand } from '../shared/sim';
import { checksumGame } from '../shared/sim/checksum';
import type { Unit } from '../shared/types';
import { AiDeathLedger } from './death-ledger';
import { createAiPolicyMemory, type AiPolicyMemory } from './memory';
import { planAiOwnerCommandEntriesWithTrace } from './plan-trace-planner';
import { planAiOwnerCommandEntries } from './planner-context';

function battle() {
  const game = createGame('bareDuel', { aiPlayers: [] });
  game.units = []; game.buildings = []; game.items = []; game.scriptedVictory = true;
  delete game.map.terrain;
  return game;
}
const ledgers: AiDeathLedger[] = [];
afterEach(() => { for (const ledger of ledgers.splice(0)) { ledger.dispose(); expect(ledger.errors).toEqual([]); } });
function observe(game: ReturnType<typeof battle>) {
  const ledger = new AiDeathLedger(game, { owners: ['player'] }); ledgers.push(ledger); return ledger;
}
function claim(memory: AiPolicyMemory, unit: Unit, kind: 'mineRally' | 'mineLeash' | 'workerSafety', targetId: string, tick = 0) {
  memory.unitClaims[unit.id] = { kind, targetId, x: 500, y: 500, sinceTick: tick, expiresTick: 99999, arrived: true };
}

describe('read-only AI death ledger', () => {
  it('records exact killer, profile, HP history, task and issued executor while distinguishing cleanup time', () => {
    const game = battle(), memory = createAiPolicyMemory();
    const unit = game.spawnUnit('player', 'footman', 500, 500), enemy = game.spawnUnit('enemy', 'footman', 600, 500);
    const hall = createBuilding('hall', 'player', 'townHall', 500, 500, true); game.buildings.push(hall);
    claim(memory, unit, 'mineRally', hall.id);
    const ledger = observe(game); ledger.recordThink(game, 'player', memory);
    const cmd = { type: 'holdPosition' as const, unitIds: [unit.id] };
    tryPlayerCommand(game, 'player', cmd); ledger.recordIssuedCommand(0, 'player', cmd, 'miningRally', 'external-agent');
    strikeUnit(game, enemy, unit, 99999, 'spell'); stepGame(game);
    const [record] = ledger.records();
    expect(record).toMatchObject({ tick: 0, removedTick: 1, killer: { id: enemy.id, kind: 'footman', owner: 'enemy' },
      cause: 'damage', fatalDamageProfile: { delivery: 'effect' },
      assignment: { task: { id: 'defense:hall', attribution: 'inferred', utility: null }, plannedBalanceRange: null },
      lastIssuedOrder: { executor: 'miningRally', tick: 0, attribution: 'recorded-issued-command' },
      classification: { disposition: 'normal', primary: 'accepted-engagement', attribution: 'inferred' } });
    expect(record!.damageWindow.sources).toHaveLength(1);
    expect(record!.health.map(point => point.source)).toEqual(['think', 'damage-before', 'damage-after', 'removal']);
    expect(record!.health.at(-1)!.hp).toBeLessThanOrEqual(0);
    // A lethal hit outside step at tick 0 is first published in the tick 1 cleanup frame.
    expect(ledger.frame('player', 0).records).toEqual([]);
    expect(ledger.frame('player', 0).summary.events).toBe(0);
    expect(ledger.frame('player', 1, 0).records).toHaveLength(1);
    expect(ledger.frame('player', 2, 1).records).toEqual([]);
  });

  it('uses actual position for the defense perimeter and does not count rally→leash as a new objective', () => {
    const game = battle(), memory = createAiPolicyMemory(), unit = game.spawnUnit('player', 'footman', 1400, 500);
    const enemy = game.spawnUnit('enemy', 'footman', 1450, 500);
    game.buildings.push(createBuilding('hall', 'player', 'townHall', 500, 500, true));
    claim(memory, unit, 'mineRally', 'hall');
    const ledger = observe(game); ledger.recordThink(game, 'player', memory);
    game.tick = 15; claim(memory, unit, 'mineLeash', 'hall', 15); ledger.recordThink(game, 'player', memory);
    strikeUnit(game, enemy, unit, 99999, 'spell'); stepGame(game);
    const record = ledger.records()[0]!;
    expect(record.context.switches).toEqual([]);
    expect(record.context.outsidePerimeter).toBe(true);
    expect(record.assignment.state).not.toBe('on-station');
    expect(record.classification.tags).toContain('out-of-bounds');
  });

  it('marks a real recent goal change separately from its unproven causal role', () => {
    const game = battle(), unit = game.spawnUnit('player', 'footman', 500, 500), enemy = game.spawnUnit('enemy', 'footman', 600, 500);
    game.buildings.push(createBuilding('a', 'player', 'townHall', 500, 500, true), createBuilding('b', 'player', 'townHall', 650, 500, true));
    const ledger = observe(game), memory = createAiPolicyMemory(); claim(memory, unit, 'mineRally', 'a'); ledger.recordThink(game, 'player', memory);
    game.tick = 15; claim(memory, unit, 'mineRally', 'b', 15); ledger.recordThink(game, 'player', memory);
    strikeUnit(game, enemy, unit, 99999, 'spell'); stepGame(game);
    expect(ledger.records()[0]).toMatchObject({ context: { switches: [{ tick: 15, from: 'defense:a', to: 'defense:b', attribution: 'inferred' }] },
      classification: { disposition: 'abnormal', primary: 'recent-reassignment' } });
  });

  it('records endangered workers and retreat/treatment without pretending that claims prove arrival', () => {
    const game = battle(), worker = game.spawnUnit('player', 'worker', 500, 500), enemy = game.spawnUnit('enemy', 'archer', 650, 500);
    const ledger = observe(game), memory = createAiPolicyMemory(); claim(memory, worker, 'workerSafety', 'shelter');
    ledger.recordThink(game, 'player', memory);
    const command = { type: 'move' as const, unitIds: [worker.id], x: 300, y: 300, avoidCombat: true };
    tryPlayerCommand(game, 'player', command); ledger.recordIssuedCommand(0, 'player', command, 'mobileCare');
    strikeUnit(game, enemy, worker, 99999, 'spell'); stepGame(game);
    const record = ledger.records()[0]!;
    expect(record.assignment.state).toBe('emergency-interruption');
    expect(record.context).toMatchObject({ retreating: true, treatment: true });
    expect(record.classification.tags).toEqual(expect.arrayContaining(['retreat-or-treatment', 'exposed-worker']));
    expect(record.lastIssuedOrder!.executor).toBe('mobileCare');
  });

  it('attributes transport passengers, including indirect sinking damage, and counts each native loss once', () => {
    const game = battle(), ship = game.spawnUnit('player', 'transport', 500, 500), crew = game.spawnUnit('player', 'archer', 500, 500);
    expect(boardUnit(ship, crew, game.units)).toBe(true);
    const enemy = game.spawnUnit('enemy', 'warship', 900, 500), ledger = observe(game), memory = createAiPolicyMemory();
    memory.naval = { ferries: { [ship.id]: { purpose: 'reinforce', targetId: 'island-mine', phase: 'sailing', sinceTick: 0,
      crewIds: [crew.id], from: { x: 500, y: 500 }, to: { x: 1500, y: 500 } } } };
    ledger.recordThink(game, 'player', memory);
    strikeUnit(game, enemy, ship, 99999, 'spell'); stepGame(game);
    expect(ledger.records()).toHaveLength(2);
    const passenger = ledger.records().find(row => row.unit.id === crew.id)!;
    expect(passenger).toMatchObject({ cause: 'sinking', killer: { id: enemy.id }, location: { space: 'deck', carrierId: ship.id },
      fatalDamageProfile: { delivery: 'effect' }, assignment: { task: { kind: 'transport' } } });
    expect(passenger.classification.tags).toContain('logistics-transit');
    expect(ledger.summary().nativeLosses).toBe(game.match.stats.unitsLost.player);
  });

  it('keeps lifecycle expiry separate, including a real death excluded by the native expiry counter', () => {
    const game = battle(), living = game.spawnUnit('player', 'spirit', 500, 500), dead = game.spawnUnit('player', 'spirit', 550, 500);
    const extra = game.spawnUnit('player', 'footman', 700, 500), enemy = game.spawnUnit('enemy', 'archer', 900, 500), ledger = observe(game);
    living.expiresTick = 1; dead.expiresTick = 1;
    strikeUnit(game, enemy, dead, 99999, 'spell'); removeUnit(game, extra.id); stepGame(game);
    const summary = ledger.summary();
    expect(summary).toMatchObject({ events: 3, deaths: 1, nativeLosses: 0, aliveExpirations: 1, scriptedExits: 1,
      abnormal: { count: 1 }, lifecycle: { count: 2, catalogGold: 0 } });
    expect(ledger.records().find(row => row.unit.id === living.id)!.classification.primary).toBe('summon-expired');
    expect(Object.values(summary.byCategory).reduce((sum, value) => sum + value.count, 0)).toBe(summary.events);
  });

  it('restores a previously seen dead projectile source and leaves never-seen synthetic sources unresolved', () => {
    const game = battle(), enemy = game.spawnUnit('enemy', 'archer', 900, 500), ledger = observe(game);
    removeUnit(game, enemy.id);
    for (const source of [{ id: enemy.id, owner: 'enemy', x: 900, y: 500 }, { id: 'unknown-poisoner', owner: 'enemy', x: 900, y: 500 }]) {
      const victim = game.spawnUnit('player', 'worker', 500, 500);
      strikeUnit(game, source, victim, 99999, 'spell'); stepGame(game);
    }
    expect(ledger.records()[0]).toMatchObject({ killer: { kind: 'archer', present: false }, killerKindAttribution: 'previously-observed-entity' });
    expect(ledger.records()[1]).toMatchObject({ killerKindAttribution: 'unresolved-source' });
    expect(ledger.records()[1]!.limitations).toContain('original-source-kind-unresolved');
  });

  it('records neutral deaths outside clearing, idle deaths and administration without misusing the previous hit as killer', () => {
    const game = battle(), unit = game.spawnUnit('player', 'footman', 500, 500), neutral = game.spawnUnit('neutral', 'footman', 600, 500);
    const ledger = observe(game); ledger.recordThink(game, 'player', createAiPolicyMemory());
    strikeUnit(game, neutral, unit, 99999, 'spell'); stepGame(game);
    expect(ledger.records()[0]!.classification.tags).toContain('neutral-outside-clearing');
    expect(ledger.records()[0]!.classification.tags).toContain('idle');
    const second = game.spawnUnit('player', 'footman', 500, 500);
    strikeUnit(game, neutral, second, 1, 'spell');
    tryPlayerCommand(game, 'player', { type: 'forfeit' }); stepGame(game);
    expect(ledger.records()[1]).toMatchObject({ cause: 'forfeit', killer: null, classification: { disposition: 'lifecycle', primary: 'forfeit' } });
  });

  it('distinguishes abandoned permanent attackers and isolated island losses from mere absence of a rescue route calculation', () => {
    const game = battle(), unit = game.spawnUnit('player', 'footman', 144, 48), enemy = game.spawnUnit('enemy', 'footman', 155, 48);
    game.map.terrain = { cell: 32, cols: 6, rows: 3, cells: ['..~~..', '..~~..', '..~~..'].join('') };
    game.buildings.push(createBuilding('home', 'player', 'townHall', 16, 48, true));
    const memory = createAiPolicyMemory();
    memory.landAttack = { targetId: 'enemy-hall', sinceTick: 0, general: { mode: 'attack', group: [unit.id] } };
    const ledger = observe(game); ledger.recordThink(game, 'player', memory);
    game.tick = 15; delete memory.landAttack;
    memory.landAttackResult = { targetId: 'enemy-hall', tick: 15, result: 'withdrew', reason: 'general:retreat:worn' };
    ledger.recordThink(game, 'player', memory);
    strikeUnit(game, enemy, unit, 99999, 'spell'); stepGame(game);
    const record = ledger.records()[0]!;
    expect(record.context).toMatchObject({ onHomeGround: false, safeOwnSitesOnGround: [], escapeRoute: 'not-evaluated', wornRetreatTick: 15 });
    expect(record.classification.tags).toEqual(expect.arrayContaining(['isolated-without-evacuation-plan', 'post-worn-abandonment']));
    expect(record.location.landId).toMatch(/^land:[1-9]/);
  });

  it('integrates trace observation without changing planner commands, policy memory, canonical state or opposite seats', () => {
    const a = createGame('bareDuel', { aiPlayers: [] }), b = createGame('bareDuel', { aiPlayers: [] });
    const ma = createAiPolicyMemory(), mb = createAiPolicyMemory(), ledger = observe(b);
    const before = checksumGame(b);
    const request = { playerId: 'player', source: 'external-agent', version: 'v9_knight' as const };
    const ordinary = planAiOwnerCommandEntries(a, request, { memory: ma });
    const result = planAiOwnerCommandEntriesWithTrace(b, request, { memory: mb, deathLedger: ledger });
    expect(JSON.stringify(result.commands)).toBe(JSON.stringify(ordinary));
    expect(mb).toEqual(ma);
    expect(checksumGame(b)).toBe(before);
    expect(result.trace.deathLedger).toMatchObject({ owner: 'player', summary: { events: 0 } });
    const enemy = b.units.find(unit => unit.owner === 'enemy')!, own = b.units.find(unit => unit.owner === 'player')!;
    strikeUnit(b, own, enemy, 99999, 'spell'); stepGame(b);
    expect(ledger.records()).toEqual([]);
    const copy = ledger.withPlanTrace(result.trace);
    copy.deathLedger.summary.events = -1;
    expect(ledger.summary().events).toBe(0);
  });
});
