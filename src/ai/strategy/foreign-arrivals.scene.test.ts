import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { unitMover } from '../../shared/catalog';
import { setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { createArrivalQuery } from './arrivals';
import { decisionProjection } from './explanations';
import { landIdAt } from './regions';
import type { Target } from './types';

type Frame = { event: string; owner: string; snapshot: GameSnapshot; memory: AiPolicyMemory };
const frames: Frame[] = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/objective-event-frames.json.gz', import.meta.url))).toString()).cases;
function scene(event: string) {
  const frame = structuredClone(frames.find(frame => frame.event === event)!);
  setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot)); return frame;
}
function targets(frame: Frame): Target[] {
  return [...frame.snapshot.resources, ...frame.snapshot.buildings.filter(building => building.kind === 'townHall')]
    .map(entity => ({ entityId: entity.id, point: { x: entity.x, y: entity.y }, landId: landIdAt(frame.snapshot.map, entity) }))
    .filter((target): target is typeof target & { landId: NonNullable<Target['landId']> } => target.landId !== undefined);
}

describe('per-think foreign crossing intent facts', () => {
  it.each(['E05', 'Nd', 'Ne'])('keeps every numerical and explained %s arrival byte while sharing foreign intent by owner and destination land', event => {
    const frame = scene(event), destinations = targets(frame);
    const actors = frame.snapshot.units.filter(unit => unit.hp > 0 && unit.owner !== 'neutral'
      && unitMover(unit.kind) === 'land');
    const expectedPairs = new Set<string>();
    let sharedCalls = 0;
    for (const unit of actors) for (const target of destinations) {
      const origin = landIdAt(frame.snapshot.map, unit);
      if (origin && origin !== target.landId && unit.owner !== frame.owner && !unit.deck && !unit.cabin) {
        expectedPairs.add(`${unit.owner}:${target.landId}`); sharedCalls++;
      }
    }
    expect(expectedPairs.size).toBeGreaterThan(0); expect(sharedCalls).toBeGreaterThan(expectedPairs.size);
    for (const capture of [false, true]) {
      const run = (batched: boolean) => {
        let stats: ReturnType<typeof createArrivalQuery>['stats'] | undefined;
        const result = decisionProjection(() => {
          const query = createArrivalQuery(frame.snapshot, frame.owner, frame.memory); stats = query.stats;
          return { rows: actors.map(unit => destinations.map(target => query.arrival(unit, target,
            batched ? landIdAt(frame.snapshot.map, unit) : undefined))) };
        }, capture);
        return { bytes: JSON.stringify(capture ? result.explain!() : result.facts), stats: stats! };
      };
      const baseline = run(false), batched = run(true);
      expect(batched.bytes).toBe(baseline.bytes);
      expect(batched.stats.foreignUnknownBuilds).toBe(expectedPairs.size);
      expect(batched.stats.foreignUnknownHits).toBe(sharedCalls - expectedPairs.size);
    }
  }, 60000);

  it('re-evaluates an arrived or expiring soldier instead of reusing its former overseas intent fact', () => {
    const frame = scene('Ne');
    const unit = frame.snapshot.units.find(unit => unit.owner !== 'neutral' && unit.owner !== frame.owner
      && unitMover(unit.kind) === 'land' && !unit.deck && !unit.cabin && landIdAt(frame.snapshot.map, unit))!;
    const target = targets(frame).find(target => target.landId !== landIdAt(frame.snapshot.map, unit))!;
    const query = createArrivalQuery(frame.snapshot, frame.owner, frame.memory);
    expect(query.arrival(unit, target, landIdAt(frame.snapshot.map, unit))).toMatchObject({ status: 'unknown',
      reason: { code: 'opponent-transport-plan-unobserved' } });
    unit.x = target.point.x; unit.y = target.point.y;
    expect(query.arrival(unit, target, landIdAt(frame.snapshot.map, unit)).status).toBe('reachable');
    unit.expiresTick = frame.snapshot.tick;
    expect(query.arrival(unit, target, landIdAt(frame.snapshot.map, unit))).toMatchObject({ status: 'unreachable',
      reason: { code: 'expires-before-arrival' } });
    expect(query.stats.foreignUnknownBuilds).toBe(1);
  });
});
