import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { GameSnapshot } from '../../shared/types';
import { shipLaunchPose, shipLaunchPrototype } from '../../shared/ship-launch';
import { setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import type { AiPolicyMemory } from '../memory';
import { FactWorkQueue, STRATEGY_FACT_WORK_PER_THINK, withFactWork } from './fact-work';
import { observationMemory } from './observation-memory';
import { pointRoute } from './point-routes';
import { createPlanningDistanceQuery } from './distance-fields';
import { assessVoyageRisks } from './voyage-risk';

function scene() {
  const frame: { snapshot: GameSnapshot; owner: string } = JSON.parse(gunzipSync(readFileSync(
    new URL('./fixtures/sapphire-control-p4-4180.json.gz', import.meta.url))).toString());
  setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot));
  const yard = frame.snapshot.buildings.filter(building => building.owner === frame.owner && building.kind === 'shipyard')
    .sort((a, b) => Math.hypot(a.x - 1648, a.y - 2480) - Math.hypot(b.x - 1648, b.y - 2480))[0]!;
  const prototype = shipLaunchPrototype(yard, 'transport'), launch = shipLaunchPose({ ...frame.snapshot, units: [] }, yard, prototype)!;
  const ship = { ...prototype, ...launch, sailing: { heading: launch.heading, speed: 0, load: 0, balance: 0 } };
  return { ...frame, ship };
}

it('publishes a legal native point route, while an endpoint inside the real yard remains statically infeasible', () => {
  const frame = scene(), memory: AiPolicyMemory = { jobs: [], unitClaims: {} }, before = JSON.stringify(frame.snapshot);
  const legal = { x: 1584, y: 2448 }, solid = { x: 1648, y: 2480 };
  let known = false, impossible = false;
  for (let step = 0; step < 32 && !(known && impossible); step++) {
    const snapshot = { ...frame.snapshot, tick: frame.snapshot.tick + step * 15 };
    const preparation = observationMemory(snapshot, frame.owner, memory), work = new FactWorkQueue(snapshot.tick);
    withFactWork(work, () => {
      const a = pointRoute(snapshot, preparation, frame.ship, frame.ship, legal, true);
      const b = pointRoute(snapshot, preparation, frame.ship, frame.ship, solid, true);
      if (a.status === 'complete') { known = true; expect(a.route.partial).toBe(false); expect(a.ticks).toBeGreaterThan(0); }
      impossible ||= b.status === 'static-infeasible';
      const receipt = work.flush();
      expect(receipt.used).toBeLessThanOrEqual(STRATEGY_FACT_WORK_PER_THINK);
      expect(receipt.services.reduce((sum, service) => sum + service.work, 0)).toBe(receipt.used);
    });
  }
  expect({ known, impossible }).toEqual({ known: true, impossible: true });
  expect(JSON.stringify(frame.snapshot)).toBe(before);
});

it('shares one allowance across route and independent distance-query phases and resumes a JSON fork identically', () => {
  const frame = scene(), a: AiPolicyMemory = { jobs: [], unitClaims: {} };
  const run = (snapshot: GameSnapshot, memory: AiPolicyMemory) => {
    setBuildingBodies(snapshot.map, standingBodies(snapshot));
    const preparation = observationMemory(snapshot, frame.owner, memory), work = new FactWorkQueue(snapshot.tick);
    return withFactWork(work, () => {
      work.prioritizePoints([{ x: 1584, y: 2448 }]);
      const result = pointRoute(snapshot, preparation, frame.ship, frame.ship, { x: 1584, y: 2448 }, true);
      // Separate callers, including repeated requests, consume one task key.
      for (let phase = 0; phase < 3; phase++) {
        const land = createPlanningDistanceQuery(snapshot, 1, 'land', preparation);
        for (const resource of snapshot.resources.slice(0, 3)) land.field(resource);
      }
      const receipt = work.flush();
      expect(receipt.used).toBeLessThanOrEqual(6144);
      if (result.status === 'pending') expect(receipt.services[0]?.tier).toBe('critical-route');
      return { result, receipt };
    });
  };
  const first = run(frame.snapshot, a);
  expect(first.result.status).toBe('pending');
  const b: AiPolicyMemory = JSON.parse(JSON.stringify(a));
  const next = { ...frame.snapshot, tick: frame.snapshot.tick + 15 };
  expect(run(next, a)).toEqual(run(JSON.parse(JSON.stringify(next)), b));
  expect(a).toEqual(b);
});

it('publishes numeric exposure for the real legal launch leg without waiting for an entire sea field', () => {
  const frame = scene(), memory: AiPolicyMemory = { jobs: [], unitClaims: {} };
  const yard = frame.snapshot.buildings.filter(building => building.owner === frame.owner && building.kind === 'shipyard')
    .sort((a, b) => Math.hypot(a.x - 1648, a.y - 2480) - Math.hypot(b.x - 1648, b.y - 2480))[0]!;
  let published = false;
  for (let step = 0; step < 8 && !published; step++) {
    const snapshot = { ...frame.snapshot, tick: frame.snapshot.tick + step * 15 };
    const preparation = observationMemory(snapshot, frame.owner, memory), work = new FactWorkQueue(snapshot.tick);
    const riskMemory = preparation.voyageRisks ??= { version: 1, owner: frame.owner, tick: snapshot.tick - 1, routeIds: [], entries: [] };
    withFactWork(work, () => {
      work.prioritizePoints([{ x: 1584, y: 2448 }]);
      const risk = assessVoyageRisks(snapshot, frame.owner, [{ id: 'real-launch-leg', seaId: 'sea:1',
        productionBuildingId: yard.id, destination: { x: 1584, y: 2448 } }], riskMemory, preparation).results.get('real-launch-leg')!;
      if (risk.status === 'known') {
        published = true;
        // There ARE capable weapons in this basin, but none cover this short
        // native launch leg. This is sampled zero damage, not a default P=1.
        expect(risk.basis).toBe('native-route-exposure');
        expect(risk.threatIds.length).toBeGreaterThan(0);
        expect(risk.expectedDamage).toBe(0);
        expect(risk.survivalProbability).toBe(1);
      }
      expect(work.flush().used).toBeLessThanOrEqual(6144);
    });
    expect(preparation.fields.sea).toHaveLength(0);
  }
  expect(published).toBe(true);
});

it('publishes native sea routes on a frozen snapshot after the owner-think boundary', () => {
  const frame = scene(), before = JSON.stringify(frame.snapshot);
  let memory: AiPolicyMemory = { jobs: [], unitClaims: {} }, known = false, impossible = false;
  for (let sequence = 1; sequence <= 32 && !(known && impossible); sequence++) {
    const preparation = observationMemory(frame.snapshot, frame.owner, memory);
    const work = new FactWorkQueue(frame.snapshot.tick, 6144, preparation.factWork, sequence);
    withFactWork(work, () => {
      const a = pointRoute(frame.snapshot, preparation, frame.ship, frame.ship, { x: 1584, y: 2448 }, true);
      const b = pointRoute(frame.snapshot, preparation, frame.ship, frame.ship, { x: 1648, y: 2480 }, true);
      known ||= a.status === 'complete'; impossible ||= b.status === 'static-infeasible';
      preparation.factWork = structuredClone(work.flush());
      expect(work.receipt.used).toBeLessThanOrEqual(6144);
    });
    memory = JSON.parse(JSON.stringify(memory));
  }
  expect({ known, impossible }).toEqual({ known: true, impossible: true });
  expect(JSON.stringify(frame.snapshot)).toBe(before);
});
