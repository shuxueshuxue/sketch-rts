import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { combatCapability } from './combat-capabilities';
import { canReach } from './naval';
import { withNavigationAudit } from './navigation-audit';
import { walkingDistance } from './terrain';
import { SIM_TICKS_PER_SECOND } from './time';
import type { GameSnapshot } from './types';
import { advanceThreatEnvelope, beginThreatEnvelope, type EnvelopeEnemy, type ThreatEnvelopeInput } from './threat-envelope';

const root = new URL('./fixtures/threat-envelope/', import.meta.url);
const bytes = (name: string) => readFileSync(new URL(name, root));
const read = (name: string) => JSON.parse((name.endsWith('.gz') ? gunzipSync(bytes(name)) : bytes(name)).toString());
const manifest = read('manifest.json') as { payloads: { file: string; sha256: string; plainSha256?: string }[] };
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
function base(snapshot: GameSnapshot, targetId: string): ThreatEnvelopeInput {
  const binding = { declarationId: 'native-fixture-exposure', declarationVersion: 'v1', scheduleEpoch: snapshot.tick };
  return { ownerId: 'planner', observedTick: snapshot.tick, navigationVersion: 'original-map', exposure: { binding,
    actors: { binding, version: 'original-actor', members: [{ id: targetId, physicalVersion: 'original-body' }] },
    route: { binding, version: 'r1', segments: [] }, passage: { binding, routeVersion: 'r1', version: 'p1', segments: [] },
    resistance: { binding, version: 'unprotected', force: 0 } }, enemies: [], arrivals: [], qByKind: { raider: .4 } };
}
const enemy = (snapshot: GameSnapshot): EnvelopeEnemy[] => snapshot.units.filter(u => u.owner === 'pressure').map(unit => {
  const native = combatCapability(snapshot, unit);
  return { unit, physicalVersion: 'original-equipment', evidenceVersion: 'original-row-v1', capability: { armed: native.armed,
    maxSpeed: unit.speed, reach: native.range, interruptForce: 0 } };
});
const evaluate = (input: ThreatEnvelopeInput) => {
  const result = withNavigationAudit(() => { throw Error('Pure envelope started a native route'); },
    () => advanceThreatEnvelope(input, beginThreatEnvelope(), 6144));
  expect(result.residentBytes).toBe(Buffer.byteLength(JSON.stringify(result.cursor)));
  expect(result.residentBytes).toBeLessThanOrEqual(32768);
  return result;
};

describe('original puzzle 8/9 native facts, not new AI games', () => {
  it('keeps all copied original gzip bytes and decompressed payloads identical to the exporter manifest', () => {
    for (const row of manifest.payloads) {
      expect(hash(bytes(row.file))).toBe(row.sha256);
      if (row.plainSha256) expect(hash(gunzipSync(bytes(row.file)))).toBe(row.plainSha256);
    }
  });

  it.each(['loaded', 'poor', 'empty'])('puzzle 8 %s is a pre-sinking prefix; unknown sea interception never becomes safety', variant => {
    const snapshot = read(`q8/${variant}/initial.json.gz`) as GameSnapshot;
    const hull = snapshot.units.find(u => u.kind === 'transport')!, f = base(snapshot, hull.id);
    const input = { ...f, enemies: enemy(snapshot), exposure: { ...f.exposure,
      route: { ...f.exposure.route, segments: [{ id: 'future-sea-leg', from: hull, to: hull }] },
      passage: { ...f.exposure.passage, segments: [{ id: 'future-sea-leg', fromTick: snapshot.tick, throughTick: snapshot.tick + 12000 }] } } };
    const result = evaluate(input);
    expect(result).toMatchObject({ state: 'pending', probability: null, evaluatedPairs: 1 });
    expect(result.unknownPairs[0]!.reason).toBe('envelope-native-arrival-pending');
    // No original sinking occurred in any of these three main trajectories.
  });

  it('reproduces the stored native retreat-distance witness without manufacturing an event-time snapshot or route', () => {
    const witness = read('retreat-interception-witness.json');
    const initial = read('q9-fast/initial.json.gz') as GameSnapshot, w = witness.originalInterception;
    // These independent native path calls are contract setup, OUTSIDE the pure module/its work counter.
    expect(walkingDistance(initial.map, w.retreatPoint, w.crossing)).toBe(w.enemyDistance);
    expect(walkingDistance(initial.map, w.workerStart, w.crossing)).toBe(w.workerDistance);
    expect(w.enemyDistance / w.enemySpeed).toBeCloseTo(12.097560975609756, 12);
    expect(w.workerDistance / w.workerSpeed).toBe(19.2);
    expect(w.pathScope ?? witness.pathScope).toContain('No full route polyline');
    expect(witness.exactEvents.find((e: { kind: string }) => e.kind === 'actual-retreat-arrival').value.tick).toBe(2056);
    expect(witness.exactEvents.find((e: { kind: string }) => e.kind === 'actual-worker-road-departure').value.tick).toBe(3994);
  });

  it.each([3990, 4005])('puzzle 9 original observer %s: a true retreat/attack order does not remove the crossing from the envelope', tick => {
    const { snapshot } = read(`q9-fast/observers/tick-${tick}.jsonl.gz`) as { snapshot: GameSnapshot };
    const worker = snapshot.units.find(u => u.id.endsWith('planner-worker-1'))!, crossing = { x: 2432, y: 800 };
    const workerDistance = walkingDistance(snapshot.map, worker, crossing)!;
    const f = base(snapshot, worker.id), foes = enemy(snapshot);
    const passage = tick + workerDistance / worker.speed * SIM_TICKS_PER_SECOND;
    const input: ThreatEnvelopeInput = { ...f, enemies: foes, exposure: { ...f.exposure,
      // A proposed POINT exposure at the crossing, not an invented original full path.
      route: { ...f.exposure.route, segments: [{ id: 'crossing', from: crossing, to: crossing }] },
      passage: { ...f.exposure.passage, segments: [{ id: 'crossing', fromTick: passage, throughTick: passage }] } },
      arrivals: foes.map(foe => {
        const distance = walkingDistance(snapshot.map, foe.unit, crossing)!;
        const targetAtCrossing = { ...worker, ...crossing };
        return { enemyId: foe.unit.id, segmentId: 'crossing', binding: f.exposure.binding,
          routeVersion: 'r1', passageVersion: 'p1', navigationVersion: f.navigationVersion,
          actorVersion: f.exposure.actors.version, physicalVersion: foe.physicalVersion, origin: foe.unit,
          proof: { kind: 'native-interception', point: crossing, travelTicks: distance / foe.unit.speed * SIM_TICKS_PER_SECOND,
            targetId: worker.id, canAttack: canReach(snapshot.map, foe.unit, targetAtCrossing, snapshot.units) } };
      }) };
    const result = evaluate(input);
    expect(result).toMatchObject({ state: 'known', probability: .36 });
    expect(result.envelope).toEqual(foes.map(foe => foe.unit.id));
    for (const witness of result.witnesses) expect(witness.enemyArrivalTick).toBeLessThan(witness.passageTick);
    // q=.4 is a test constant, not a fit to the three actual deaths in the original game.
  });
});
