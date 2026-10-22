import { describe, expect, it } from 'vitest';
import { createUnit } from './map';
import { advanceThreatEnvelope, beginThreatEnvelope, type EnvelopeArrival, type EnvelopeEnemy, type ThreatEnvelopeInput, THREAT_ENVELOPE_RESIDENT_BYTES } from './threat-envelope';

function input(): ThreatEnvelopeInput {
  const binding = { declarationId: 'action', declarationVersion: 'd1', scheduleEpoch: 0 };
  const unit = createUnit('foe', 'enemy', 'footman', 0, 0);
  const enemy: EnvelopeEnemy = { unit, physicalVersion: 'native-stats-v1', evidenceVersion: 'reach1',
    capability: { armed: true, reach: unit.attackRange, maxSpeed: unit.speed, interruptForce: 1 } };
  const arrival: EnvelopeArrival = { enemyId: unit.id, segmentId: 'leg', binding, routeVersion: 'r1', passageVersion: 'p1',
    navigationVersion: 'terrain1', physicalVersion: enemy.physicalVersion, actorVersion: 'actors1', origin: { x: 0, y: 0 },
    proof: { kind: 'native-interception', point: { x: 100, y: 0 }, travelTicks: 20, targetId: 'worker', canAttack: true } };
  return { ownerId: 'planner', observedTick: 0, navigationVersion: 'terrain1', exposure: { binding,
    route: { binding, version: 'r1', segments: [{ id: 'leg', from: { x: 100, y: 0 }, to: { x: 100, y: 0 } }] },
    passage: { binding, routeVersion: 'r1', version: 'p1', segments: [{ id: 'leg', fromTick: 0, throughTick: 100 }] },
    actors: { binding, version: 'actors1', members: [{ id: 'worker', physicalVersion: 'worker-v1' }] },
    resistance: { binding, version: 'protection1', force: 0 } }, enemies: [enemy], arrivals: [arrival], qByKind: { footman: .2 } };
}
const run = (f: ThreatEnvelopeInput, allowance = 6144) => advanceThreatEnvelope(f, beginThreatEnvelope(), allowance);
type Mutable<T> = { -readonly [P in keyof T]: T[P] extends object ? Mutable<T[P]> : T[P] };
const copy = <T>(x: T): Mutable<T> => JSON.parse(JSON.stringify(x));
function secondEnemy(f: ThreatEnvelopeInput): ThreatEnvelopeInput {
  const b = copy(f.enemies[0]!); b.unit.id = 'foe2'; b.unit.kind = 'knight';
  return { ...f, enemies: [...f.enemies, b], arrivals: [...f.arrivals, { ...f.arrivals[0]!, enemyId: b.unit.id }],
    qByKind: { footman: .2, knight: .3 } };
}
function twoSegments(f: ThreatEnvelopeInput): ThreatEnvelopeInput {
  return { ...f, exposure: { ...f.exposure,
    route: { ...f.exposure.route, segments: [...f.exposure.route.segments, { ...f.exposure.route.segments[0]!, id: 'leg2' }] },
    passage: { ...f.exposure.passage, segments: [...f.exposure.passage.segments, { ...f.exposure.passage.segments[0]!, id: 'leg2' }] } },
    arrivals: f.arrivals.flatMap(a => [a, { ...a, segmentId: 'leg2' }]) };
}

describe('pure action threat envelope', () => {
  it('multiplies kind priors for named interceptors and counts one enemy only once over several segments', () => {
    const f = twoSegments(secondEnemy(input())), result = run(f);
    expect(result.state).toBe('known'); expect(result.envelope).toEqual(['foe', 'foe2']);
    expect(result.probability).toBeCloseTo(.8 * .7, 14); expect(result.factors).toHaveLength(2);
    expect(result.witnesses).toHaveLength(2); expect(result.work).toBeLessThanOrEqual(6144);
  });

  it.each(['route-declaration', 'passage-declaration', 'epoch', 'route-version', 'resistance-declaration', 'actors-declaration'])('rejects a mixed %s before reusing any old result', mismatch => {
    const f = copy(input()), first = run(f), e = f.exposure;
    if (mismatch === 'route-declaration') e.route.binding.declarationVersion = 'd2';
    if (mismatch === 'passage-declaration') e.passage.binding.declarationVersion = 'd2';
    if (mismatch === 'epoch') e.passage.binding.scheduleEpoch++;
    if (mismatch === 'route-version') e.passage.routeVersion = 'other-route';
    if (mismatch === 'actors-declaration') e.actors.binding.declarationVersion = 'd2';
    if (mismatch === 'resistance-declaration') e.resistance.binding.declarationVersion = 'd2';
    // JSON copy deliberately breaks shared object identity: equality is by data.
    const result = advanceThreatEnvelope(f, first.cursor, 6144);
    expect(result).toMatchObject({ state: 'invalid', probability: null, evaluatedPairs: 0 });
  });

  it('does not turn a straight possible corridor into a native interception or an empty sample into safety', () => {
    const f = input(), unresolved = run({ ...f, arrivals: [] });
    expect(unresolved).toMatchObject({ state: 'pending', probability: null });
    const late = { ...f, arrivals: [{ ...f.arrivals[0]!, proof: { kind: 'native-interception' as const, point: { x: 100, y: 0 }, travelTicks: 101, targetId: 'worker', canAttack: true } }] };
    expect(run(late)).toMatchObject({ state: 'pending', probability: null });
    const impossible = copy(f); impossible.enemies[0]!.unit.x = -10000;
    expect(run({ ...impossible, arrivals: [] })).toMatchObject({ state: 'known', probability: 1, envelope: [] });
    const offSegment = { ...f, arrivals: [{ ...f.arrivals[0]!, proof: { kind: 'native-interception' as const, point: { x: 100, y: 1 }, travelTicks: 1, targetId: 'worker', canAttack: true } }] };
    expect(run(offSegment).state).toBe('pending');
  });

  it('invalidates only the moved enemy row; idle/retreat order wording alone does not hide a reachable enemy', () => {
    const f = twoSegments(secondEnemy(input())), first = run(f), changed = copy(f);
    changed.enemies[0]!.unit.x = 5;
    changed.enemies[1]!.unit.order = { type: 'move', x: 1000, y: 0, avoidCombat: true };
    const stale = advanceThreatEnvelope(changed, first.cursor, 6144);
    expect(stale.state).toBe('pending'); expect(stale.evaluatedPairs).toBe(2); expect(stale.reusedPairs).toBe(1);
    const rebound = { ...changed, enemies: changed.enemies.map(e => e.unit.id === 'foe' ? { ...e, evidenceVersion: 'reach2' } : e), arrivals: changed.arrivals.map(a => a.enemyId === 'foe' ? { ...a, origin: { x: 5, y: 0 } } : a) };
    const next = advanceThreatEnvelope(rebound, stale.cursor, 6144);
    expect(next).toMatchObject({ state: 'known', envelope: ['foe', 'foe2'], evaluatedPairs: 1, reusedPairs: 1 });
    expect(next.probability).toBe(first.probability);
  });

  it('a coherent new declaration with one changed passage retains byte-equivalent physical results for other segments', () => {
    const f = twoSegments(input()), first = run(f), nextBinding = { ...f.exposure.binding, declarationVersion: 'd2' };
    const next: ThreatEnvelopeInput = { ...f, exposure: { ...f.exposure, binding: nextBinding,
      route: { ...f.exposure.route, binding: nextBinding, version: 'r2' },
      passage: { ...f.exposure.passage, binding: nextBinding, routeVersion: 'r2', version: 'p2',
        segments: f.exposure.passage.segments.map(s => s.id === 'leg2' ? { ...s, throughTick: 120 } : s) },
      actors: { ...f.exposure.actors, binding: nextBinding },
      resistance: { ...f.exposure.resistance, binding: nextBinding } },
      arrivals: f.arrivals.map(a => ({ ...a, binding: nextBinding, routeVersion: 'r2', passageVersion: 'p2' })) };
    expect(advanceThreatEnvelope(next, first.cursor, 6144)).toMatchObject({ state: 'known', evaluatedPairs: 0, reusedPairs: 1 });
    const mixed = { ...next, arrivals: f.arrivals };
    expect(advanceThreatEnvelope(mixed, first.cursor, 6144).state).toBe('pending');
  });

  it('continues an incomplete grid across JSON calls without redoing earlier pending work', () => {
    const f = { ...twoSegments(secondEnemy(input())), arrivals: [] }, full = run(f);
    let cursor = beginThreatEnvelope(), evaluated = 0;
    for (let n = 0; n < 4; n++) {
      const result = advanceThreatEnvelope(f, cursor, full.minimumWork + 1);
      expect(result.work).toBeLessThanOrEqual(full.minimumWork + 1); expect(result.evaluatedPairs).toBe(1);
      evaluated += result.evaluatedPairs; cursor = copy(result.cursor);
    }
    const complete = advanceThreatEnvelope(f, cursor, 6144);
    expect(evaluated).toBe(4); expect(complete.evaluatedPairs).toBe(0); expect(complete.reusedPairs).toBe(4);
    expect(complete.probability).toBeNull(); // no native proof was invented
  });

  it('tests the joint interruption threshold instead of discarding each individually weak attacker', () => {
    const f = secondEnemy(input()), protectedInput = { ...f, exposure: { ...f.exposure,
      resistance: { ...f.exposure.resistance, force: 1.5 } } };
    expect(run(protectedInput).envelope).toEqual(['foe', 'foe2']);
    expect(run({ ...protectedInput, enemies: [f.enemies[0]!], arrivals: [f.arrivals[0]!] }))
      .toMatchObject({ state: 'known', envelope: [], probability: 1 });
    expect(run({ ...f, exposure: { ...f.exposure, resistance: { ...f.exposure.resistance, force: null } } }).state).toBe('pending');
    expect(run({ ...f, enemies: [], arrivals: [], exposure: { ...f.exposure, resistance: { ...f.exposure.resistance, force: null } } }).probability).toBe(1);
  });

  it('reuses geometric reach at a later observation, but never reuses a witness past its latest valid arrival', () => {
    const f = input(), first = run(f);
    const later = advanceThreatEnvelope({ ...f, observedTick: 20 }, first.cursor, 6144);
    expect(later).toMatchObject({ state: 'known', evaluatedPairs: 0, reusedPairs: 1 });
    expect(later.witnesses[0]!.enemyArrivalTick).toBe(40);
    const late = advanceThreatEnvelope({ ...f, observedTick: 81 }, later.cursor, 6144);
    expect(late.evaluatedPairs).toBe(1); expect(late.probability).toBeNull();
  });

  it('keeps a stationary exposure interruptible before enemy expiry without extending an expired moving interception', () => {
    const f = copy(input()); f.enemies[0]!.unit.expiresTick = 50;
    expect(run(f)).toMatchObject({ state: 'known', envelope: ['foe'] });
    const moving = { ...f, exposure: { ...f.exposure, route: { ...f.exposure.route,
      segments: [{ id: 'leg', from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }] } } };
    expect(run(moving).state).toBe('pending');
    expect(run({ ...f, observedTick: 50 })).toMatchObject({ state: 'known', probability: 1 });
  });

  it('rejects old terrain/origin/ability proofs and excludes dead or sheltered enemies', () => {
    const f = input();
    for (const arrival of [{ ...f.arrivals[0]!, navigationVersion: 'old' }, { ...f.arrivals[0]!, physicalVersion: 'old' },
      { ...f.arrivals[0]!, origin: { x: 4, y: 5 } }]) expect(run({ ...f, arrivals: [arrival] }).state).toBe('pending');
    const dead = copy(f); dead.enemies[0]!.unit.hp = 0; expect(run(dead).probability).toBe(1);
    const cabin = copy(f); cabin.enemies[0]!.unit.cabin = { shipId: 'hull' }; expect(run(cabin).probability).toBe(1);
    const unreachable = { ...f.arrivals[0]!, proof: { kind: 'native-whole-segment-unreachable' as const } };
    expect(run({ ...f, arrivals: [unreachable] })).toMatchObject({ state: 'known', probability: 1 });
  });

  it('uses explicit unsupported-kind prior1, rejects invalid q, and never mutates an input or cursor', () => {
    const f = input(), cursor = beginThreatEnvelope(), before = JSON.stringify({ f, cursor });
    expect(advanceThreatEnvelope(f, cursor, 0)).toMatchObject({ state: 'pending', work: 0, cursor });
    expect(run({ ...f, qByKind: {} })).toMatchObject({ probability: 0, unsupportedKinds: ['footman'] });
    expect(run({ ...f, qByKind: { footman: NaN } })).toMatchObject({ state: 'invalid', probability: null });
    const first = advanceThreatEnvelope(f, cursor, 6144), qChanged = advanceThreatEnvelope({ ...f, qByKind: { footman: .4 } }, first.cursor, 6144);
    expect(qChanged).toMatchObject({ probability: .6, evaluatedPairs: 0, reusedPairs: 1 });
    expect(JSON.stringify({ f, cursor })).toBe(before);
  });
});

describe('selective continuation and accounting boundaries', () => {
  it('charges dependency/reuse and aggregation, and advances an E×L grid within the supplied 6144', () => {
    const f = input();
    const segments = Array.from({ length: 80 }, (_, n) => ({ ...f.exposure.route.segments[0]!, id: `s${n}` }));
    const enemies = Array.from({ length: 40 }, (_, n) => ({ ...f.enemies[0]!, unit: { ...f.enemies[0]!.unit, id: `e${n}` } }));
    const grid = { ...f, enemies, arrivals: [], exposure: { ...f.exposure,
      route: { ...f.exposure.route, segments }, passage: { ...f.exposure.passage,
        segments: segments.map(s => ({ id: s.id, fromTick: 0, throughTick: 100 })) } } };
    let cursor = beginThreatEnvelope(), count = 0, last = run(grid, 0);
    for (let n = 0; n < 4; n++) {
      last = advanceThreatEnvelope(grid, cursor, 6144); count += last.evaluatedPairs; cursor = copy(last.cursor);
      expect(last.work).toBe(last.inspectionWork + last.dependencyWork + last.aggregationWork + last.retentionWork + last.evaluatedPairs);
      expect(last.work).toBeLessThanOrEqual(6144);
      expect(last.residentBytes).toBe(Buffer.byteLength(JSON.stringify(last.cursor)));
      expect(last.residentBytes).toBeLessThanOrEqual(THREAT_ENVELOPE_RESIDENT_BYTES);
      if (!last.deferredPairs) break;
    }
    expect(count).toBe(3200); expect(last.deferredPairs).toBe(0); expect(last.probability).toBeNull();
    const warm = advanceThreatEnvelope(grid, cursor, 6144);
    expect(warm).toMatchObject({ evaluatedPairs: 0, reusedPairs: 3200 });
    expect(warm.unknownPairs).toHaveLength(40); expect(warm.unresolvedPairs).toBe(3200);
    expect(warm.dependencyWork).toBe(40); expect(warm.aggregationWork).toBe(40); expect(warm.work).toBeGreaterThan(0);
    const moved = copy(grid); moved.enemies[7]!.unit.x++;
    const selective = advanceThreatEnvelope(moved, copy(warm.cursor), 6144);
    expect(selective).toMatchObject({ evaluatedPairs: 80, reusedPairs: 39 * 80, probability: null });
  });

  it('keeps native path existence separate from attack legality and exposed-actor identity', () => {
    const f = input(), arrival = f.arrivals[0]!;
    if (arrival.proof.kind !== 'native-interception') throw Error('fixture');
    for (const canAttack of [null, false]) {
      expect(run({ ...f, arrivals: [{ ...arrival, proof: { ...arrival.proof, canAttack } }] }))
        .toMatchObject({ state: 'pending', probability: null });
    }
    const wrong = { ...f, arrivals: [{ ...arrival, proof: { ...arrival.proof, targetId: 'another-hull' } }] };
    expect(run(wrong).state).toBe('pending');
    const changed = { ...f, exposure: { ...f.exposure, actors: { ...f.exposure.actors, version: 'worker-boarded' } } };
    expect(advanceThreatEnvelope(changed, run(f).cursor, 6144).state).toBe('pending');
  });

  it('preserves an untouched enemy’s incomplete row when a different enemy moves', () => {
    const f = { ...twoSegments(secondEnemy(input())), arrivals: [] }, min = run(f).minimumWork + 1;
    const first = run(f, min), second = advanceThreatEnvelope(f, copy(first.cursor), min);
    expect(second.cursor.actions.action!.rows.foe!.next).toBe(1); expect(second.cursor.actions.action!.rows.foe2!.next).toBe(1);
    const moved = copy(f); moved.enemies[1]!.unit.y++;
    const third = advanceThreatEnvelope(moved, copy(second.cursor), min);
    expect(third.cursor.actions.action!.rows.foe!.done).toBe(true); expect(third.cursor.actions.action!.rows.foe2!.next).toBe(0);
    expect(third).toMatchObject({ evaluatedPairs: 1, reusedPairs: 1, probability: null });
  });
});


it('does not use unknown speed/weapon-body bounds as an impossibility proof', () => {
  const f = copy(input()); f.enemies[0]!.unit.x = -10000;
  const enemy = f.enemies[0]!;
  const unbounded: ThreatEnvelopeInput = { ...f, enemies: [{ ...enemy, capability: { ...enemy.capability, maxSpeed: null, reach: null } }], arrivals: [] };
  expect(run(unbounded)).toMatchObject({ state: 'pending', probability: null });
});

it('never mutates even a recursively frozen cursor while reusing a completed row', () => {
  const f = input(), first = run(f);
  const freeze = (value: unknown): void => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  };
  freeze(f); freeze(first.cursor);
  expect(advanceThreatEnvelope(f, first.cursor, 6144)).toMatchObject({ state: 'known', evaluatedPairs: 0 });
});

it('rotates unfinished enemies so one moving row cannot monopolize the supplied allowance', () => {
  const f = { ...twoSegments(secondEnemy(input())), arrivals: [] }, minimum = run(f).minimumWork + 1;
  const first = run(f, minimum), moved = copy(f); moved.enemies[0]!.unit.x++;
  const next = advanceThreatEnvelope(moved, copy(first.cursor), minimum);
  expect(next.cursor.actions.action!.rows.foe2!.next).toBe(1); expect(next.cursor.actions.action!.rows.foe!.next).toBe(0);
  expect(next.evaluatedPairs).toBe(1);
});

it('rescans a changed row from published certificates instead of retaining a cell grid', () => {
  const f = twoSegments(input());
  const noArrival = { ...f, arrivals: [] }, first = run(noArrival), next = copy(noArrival);
  next.exposure.passage.segments[1]!.throughTick = 120;
  const changed = advanceThreatEnvelope(next, copy(first.cursor), 6144);
  expect(changed).toMatchObject({ state: 'pending', probability: null, evaluatedPairs: 2, reusedPairs: 0 });
});

function forAction(f: ThreatEnvelopeInput, declarationId: string): ThreatEnvelopeInput {
  const binding = { ...f.exposure.binding, declarationId };
  return { ...f, exposure: { ...f.exposure, binding, route: { ...f.exposure.route, binding },
    passage: { ...f.exposure.passage, binding }, actors: { ...f.exposure.actors, binding },
    resistance: { ...f.exposure.resistance, binding } }, arrivals: f.arrivals.map(a => ({ ...a, binding })) };
}
it('enforces one 32KiB UTF8 resident pool across all of an owner’s actions, never one pool per action', () => {
  const f = { ...twoSegments(secondEnemy(input())), ownerId: '玩家', arrivals: [] };
  let cursor = beginThreatEnvelope(), evicted = 0;
  for (let n = 0; n < 80; n++) {
    const result = advanceThreatEnvelope(forAction(f, `动作-${n}`), copy(cursor), 6144);
    expect(result).toMatchObject({ state: 'pending', probability: null });
    expect(result.residentBytes).toBe(Buffer.byteLength(JSON.stringify(result.cursor)));
    expect(result.residentBytes).toBeLessThanOrEqual(32768);
    evicted += result.evictedActions; cursor = result.cursor;
  }
  expect(evicted).toBeGreaterThan(0); expect(Object.keys(cursor.actions).length).toBeLessThan(80);
  expect(advanceThreatEnvelope({ ...f, ownerId: 'another-owner' }, cursor, 6144).state).toBe('invalid');
});
it('scopes evidence versions to enemy × action and preserves a different action’s cached conclusions', () => {
  const f = { ...twoSegments(secondEnemy(input())), arrivals: [] };
  const first = run(f), b = advanceThreatEnvelope(forAction(f, 'B'), first.cursor, 6144);
  const originalB = JSON.stringify(b.cursor.actions.B), changed = copy(f);
  changed.enemies[0]!.evidenceVersion = 'new-publication-for-action-A-only';
  const a = advanceThreatEnvelope(changed, copy(b.cursor), 6144);
  expect(a).toMatchObject({ evaluatedPairs: 2, reusedPairs: 2, probability: null });
  expect(JSON.stringify(a.cursor.actions.B)).toBe(originalB);
  const reused = advanceThreatEnvelope(forAction(f, 'B'), copy(a.cursor), 6144);
  expect(reused).toMatchObject({ evaluatedPairs: 0, reusedPairs: 4, probability: null });
});
it('invalidates a completed reach conclusion when that enemy-action publication changes', () => {
  const f = input(), first = run(f), changed = copy(f);
  changed.enemies[0]!.evidenceVersion = 'reach2';
  const proof = changed.arrivals[0]!.proof;
  if (proof.kind !== 'native-interception') throw Error('fixture');
  proof.travelTicks = 101;
  expect(advanceThreatEnvelope(changed, first.cursor, 6144)).toMatchObject({ state: 'pending', probability: null, evaluatedPairs: 1 });
});
