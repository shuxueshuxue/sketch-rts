import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { setBuildingBodies, walkableGoal } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { createArrivalQuery, type FixedVoyage } from './arrivals';
import { decisionProjection } from './explanations';
import { landIdAt, seaIdAt } from './regions';
import type { Target } from './types';

type Frame = { event: string; owner: string; snapshot: GameSnapshot; memory: AiPolicyMemory };
const frames: Frame[] = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/objective-event-frames.json.gz', import.meta.url))).toString()).cases;
function scene(event = 'E02') {
  const frame = structuredClone(frames.find(frame => frame.event === event)!);
  setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot));
  const [shipId, mission] = Object.entries(frame.memory.naval!.ferries!)[0]!;
  const ship = frame.snapshot.units.find(unit => unit.id === shipId)!;
  const unit = frame.snapshot.units.find(unit => unit.id === (mission.payloadIds?.[0] ?? mission.crewIds[0]))!;
  const mine = frame.snapshot.resources.find(mine => mine.id === mission.targetId)!;
  const target: Target = { entityId: mine.id, point: { x: mine.x, y: mine.y }, landId: landIdAt(frame.snapshot.map, mine)! };
  const departure = walkableGoal(frame.snapshot.map, mission.from.x, mission.from.y);
  const landing = walkableGoal(frame.snapshot.map, mission.to.x, mission.to.y);
  const voyage: FixedVoyage = { shipId, seaId: seaIdAt(frame.snapshot.map, ship)!, departure: mission.from, landing: mission.to,
    departureGround: { point: departure, landId: landIdAt(frame.snapshot.map, departure)! },
    landingGround: { point: landing, landId: landIdAt(frame.snapshot.map, landing)! }, phase: mission.phase };
  return { ...frame, ship, unit, target, voyage };
}
const query = (frame: Frame) => createArrivalQuery(frame.snapshot, frame.owner, frame.memory);

describe('retained voyage current arrivals', () => {
  it('uses the actual E02 passenger hull even when an unrelated faster hull is available', () => {
    const frame = scene(), before = query(frame).fixedVoyageArrival(frame.unit, frame.target, frame.voyage);
    expect(before.status).toBe('reachable'); if (!('ticks' in before)) return;
    const ordinary = query(frame).arrival(frame.unit, frame.target);
    expect(ordinary).toMatchObject({ ticks: before.ticks, landTicks: before.landTicks });
    frame.snapshot.units.push({ ...structuredClone(frame.ship), id: 'unrelated-fast-hull', ...frame.voyage.landing,
      speed: frame.ship.speed * 10 });
    expect(query(frame).fixedVoyageArrival(frame.unit, frame.target, frame.voyage)).toEqual(before);
    expect(before.crossings[0]!.shipId).toBe(frame.ship.id);
    // A missing assigned hull must not fall back to the available replacement.
    frame.ship.hp = 0;
    expect(query(frame).fixedVoyageArrival(frame.unit, frame.target, frame.voyage)).toMatchObject({ status: 'unknown',
      reason: { code: 'voyage-hull-unavailable' } });
  });

  it('refreshes the sailing remainder from the current hull position instead of retaining its old duration', () => {
    const frame = scene(), before = query(frame).fixedVoyageArrival(frame.unit, frame.target, frame.voyage);
    expect(before.status).toBe('reachable'); if (!('ticks' in before)) return;
    frame.snapshot.tick += 15;
    Object.assign(frame.ship, frame.voyage.landing);
    const after = query(frame).fixedVoyageArrival(frame.unit, frame.target, frame.voyage);
    expect(after.status).toBe('reachable'); if (!('ticks' in after)) return;
    expect(after.ticks).toBeLessThan(before.ticks);
    expect(after.crossings[0]!.sailingTicks).toBe(0);
    expect(after.landTicks).toBe(before.landTicks);
  });

  it('leaves an unboarded E01 member unknown after departure and a mismatched passenger unknown', () => {
    const frame = scene('E01');
    expect(query(frame).fixedVoyageArrival(frame.unit, frame.target, frame.voyage).status).toBe('reachable');
    expect(query(frame).fixedVoyageArrival(frame.unit, frame.target, { ...frame.voyage, phase: 'sailing' }))
      .toMatchObject({ status: 'unknown', reason: { code: 'voyage-passenger-not-at-loading' } });
    frame.unit.deck = { shipId: 'different-hull', x: 0, y: 0 };
    expect(query(frame).fixedVoyageArrival(frame.unit, frame.target, frame.voyage))
      .toMatchObject({ status: 'unknown', reason: { code: 'voyage-passenger-on-other-hull' } });
  });

  it('uses only the actual remaining walk after unloading, including after the hull is gone', () => {
    const frame = scene();
    delete frame.unit.deck; delete frame.unit.cabin;
    Object.assign(frame.unit, frame.voyage.landingGround.point);
    frame.ship.hp = 0;
    const actual = query(frame).fixedVoyageArrival(frame.unit, frame.target, frame.voyage);
    expect(actual).toEqual(query(frame).arrival(frame.unit, frame.target));
    expect(actual).toMatchObject({ status: 'reachable', crossings: [] });
    frame.unit.expiresTick = frame.snapshot.tick;
    expect(query(frame).fixedVoyageArrival(frame.unit, frame.target, frame.voyage))
      .toMatchObject({ status: 'unreachable', reason: { code: 'expires-before-arrival' } });
  });

  it('keeps numerical and full explanation bytes identical after unrelated queries and serialized fork', () => {
    for (const capture of [false, true]) {
      const frame = scene(), cold = scene();
      const evaluate = (input: ReturnType<typeof scene>, warm: boolean) => {
        const value = decisionProjection(() => {
          const arrival = query(input);
          if (warm) for (const unit of input.snapshot.units.filter(unit => unit.owner === input.owner && !unit.deck && !unit.cabin).slice(0, 4))
            arrival.arrival(unit, input.target);
          return { arrival: arrival.fixedVoyageArrival(input.unit, input.target, input.voyage) };
        }, capture);
        return JSON.stringify(capture ? value.explain!() : value.facts);
      };
      expect(evaluate(frame, true)).toBe(evaluate(cold, false));
      const fork = JSON.parse(JSON.stringify(frame)) as typeof frame;
      expect(evaluate(fork, false)).toBe(evaluate(frame, true));
      const broken = { ...frame.voyage, landingGround: frame.voyage.departureGround };
      expect(query(frame).fixedVoyageArrival(frame.unit, frame.target, broken))
        .toMatchObject({ status: 'unknown', reason: { code: 'voyage-ground-pair-mismatch' } });
    }
  });
});
