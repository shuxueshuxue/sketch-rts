import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import { shipPassengers } from '../../shared/ship-geometry';
import { setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import type { AiPolicyMemory } from '../memory';
import type { ExecutableMethod } from './allocation-types';
import { prepareAllocationVoyageRisks } from './allocation-voyage-risk';
import { FactWorkQueue, withFactWork } from './fact-work';
import { regionIndex } from './regions';
import { nativeVoyageBerth } from './voyage-berth';

// Exact 4180 world, with a manual manifest to exercise the shared risk port.
// This fixture does not claim that the allocator naturally selected the voyage.
function scene() {
  const frame: { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory } = JSON.parse(gunzipSync(readFileSync(
    new URL('./fixtures/sapphire-control-p4-4180.json.gz', import.meta.url))).toString());
  const { snapshot, owner } = frame;
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const boat = snapshot.units.find(unit => unit.id === 'unit-p4-transport-1151')!;
  const worker = snapshot.units.find(unit => unit.id === 'unit-p4-worker-2')!;
  const candidate = regionIndex(snapshot.map).shores.find(shore => shore.water.x === 1648 && shore.water.y === 2480)!;
  const berth = nativeVoyageBerth(snapshot, worker, boat, candidate);
  if (berth.status !== 'known') throw new Error(berth.reasonCode);
  const landing = regionIndex(snapshot.map).shores.find(shore => shore.landId === 'land:4' && shore.seaId === candidate.seaId)!;
  const crew = [...shipPassengers(snapshot.units, boat), worker];
  const departure = { point: berth.shore.water, seaId: candidate.seaId };
  const destination = { point: landing.water, landId: landing.landId };
  const plan = { id: 'partial-load', actionId: 'deliver', ship: { kind: 'existing' as const, unitId: boat.id },
    unitIds: crew.map(unit => unit.id), departure, destination,
    departureGround: { point: berth.shore.ground, landId: candidate.landId },
    landingGround: { point: landing.ground, landId: landing.landId },
    // Durations are unused by this risk boundary; no economic quote is injected.
    crossing: { seaId: candidate.seaId, shipId: boat.id, departure: departure.point, landing: destination.point,
      departureHeading: berth.heading, waitTicks: 0, boardingTicks: 0, sailingTicks: 0, unloadingTicks: 0, requiresNewShip: false }, required: true };
  const method: ExecutableMethod = { id: 'manual-risk-port', objectiveId: 'manual-risk-port', providerId: 'manual-risk-port',
    kind: 'staged-beachhead', preference: 0, spends: [], demands: [], preconditions: [], subgoals: [], actions: [],
    estimatedTicks: null, status: 'candidate', reasons: [], voyagePlans: [plan] };
  return { snapshot, owner, memory: structuredClone(frame.memory), boat, worker, plan, method };
}
function evaluate(frame: ReturnType<typeof scene>) {
  setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot));
  const work = new FactWorkQueue(frame.snapshot.tick);
  const risk = withFactWork(work, () => {
    const result = prepareAllocationVoyageRisks(frame.snapshot, frame.owner, frame.memory, [frame.method]).get(frame.plan.id)!;
    expect(work.flush().used).toBeLessThanOrEqual(6144);
    return result;
  });
  return { risk, routes: frame.memory.strategy!.observation!.pointRoutes!.entries.map(entry => JSON.parse(entry.key) as unknown[]) };
}

it('keeps the real partial manifest approach and starts the loaded leg at its native pickup endpoint', () => {
  const frame = scene(), before = JSON.stringify(frame.snapshot);
  expect(shipPassengers(frame.snapshot.units, frame.boat)).toHaveLength(2);
  expect(Math.hypot(frame.boat.x - frame.plan.departure.point.x, frame.boat.y - frame.plan.departure.point.y)).toBeGreaterThan(frame.boat.radius);
  const first = evaluate(frame);
  expect(first.risk.approach).not.toMatchObject({ basis: 'completed-before-evaluation' });
  expect(first.routes.some(route => JSON.stringify(route[3]) === JSON.stringify(Object.values(frame.plan.departure.point)))).toBe(true);
  let loaded: unknown[] | undefined;
  for (let step = 1; step < 5 && !loaded; step++) {
    frame.snapshot.tick += 15;
    loaded = evaluate(frame).routes.find(route => JSON.stringify(route[3]) === JSON.stringify(Object.values(frame.plan.destination.point)));
  }
  expect(loaded?.[2]).toEqual(Object.values(frame.plan.departure.point));
  // Frozen geometry progression is a route-boundary test, not elapsed-world ETA validation.
  expect(JSON.stringify({ ...frame.snapshot, tick: 4180 })).toBe(before);
});

it('uses the observed pickup pose when a partially loaded hull has already arrived', () => {
  const frame = scene(); Object.assign(frame.boat, frame.plan.departure.point);
  const result = evaluate(frame);
  expect(result.risk.approach).toMatchObject({ status: 'known', basis: 'completed-before-evaluation' });
  expect(result.routes.some(route => JSON.stringify(route[2]) === JSON.stringify(Object.values(frame.plan.departure.point))
    && JSON.stringify(route[3]) === JSON.stringify(Object.values(frame.plan.destination.point)))).toBe(true);
});

it('starts from the current hull when everyone is actually aboard and no pickup remains', () => {
  const frame = scene(); frame.worker.deck = { shipId: frame.boat.id, x: 0, y: 0 };
  const result = evaluate(frame);
  expect(result.risk.approach).toMatchObject({ status: 'known', basis: 'completed-before-evaluation' });
  expect(result.routes.some(route => JSON.stringify(route[2]) === JSON.stringify([frame.boat.x, frame.boat.y])
    && JSON.stringify(route[3]) === JSON.stringify(Object.values(frame.plan.destination.point)))).toBe(true);
});

it('does not turn an already unloaded member into another pickup on a retained manifest', () => {
  const frame = scene(); frame.worker.deck = { shipId: frame.boat.id, x: 0, y: 0 };
  const delivered = shipPassengers(frame.snapshot.units, frame.boat).find(unit => unit.id !== frame.worker.id)!;
  delete delivered.deck; delete delivered.cabin; Object.assign(delivered, frame.plan.landingGround.point);
  const result = evaluate(frame);
  expect(result.risk.approach).toMatchObject({ status: 'known', basis: 'completed-before-evaluation' });
  expect(result.routes.some(route => JSON.stringify(route[2]) === JSON.stringify([frame.boat.x, frame.boat.y])
    && JSON.stringify(route[3]) === JSON.stringify(Object.values(frame.plan.destination.point)))).toBe(true);
});
