import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { createArrivalQuery, type FixedVoyage } from './arrivals';
import { createPlanningDistanceQuery } from './distance-fields';
import { observationMemory } from './observation-memory';
import { FactWorkQueue, withFactWork } from './fact-work';

function scene() {
  const frame: { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory } = JSON.parse(gunzipSync(readFileSync(
    new URL('./fixtures/sapphire-control-p4-4180.json.gz', import.meta.url))).toString());
  const voyage: FixedVoyage = { shipId: 'unit-p4-transport-1151', seaId: 'sea:1', phase: 'loading',
    departure: { x: 1584, y: 2448 }, landing: { x: 5872, y: 4656 },
    departureGround: { landId: 'land:2', point: { x: 1584, y: 2448 } },
    landingGround: { landId: 'land:6', point: { x: 5872, y: 4656 } } };
  return { ...frame, voyage, worker: frame.snapshot.units.find(unit => unit.id === 'unit-p4-worker-2')! };
}

it('forecasts the serial hull-first loading stage from the real 4180 geometry without requiring its later sailing leg', () => {
  const frame = scene(), memory: AiPolicyMemory = { jobs: [], unitClaims: {} }, before = JSON.stringify(frame.snapshot);
  let forecast: ReturnType<ReturnType<typeof createArrivalQuery>['fixedVoyageLoading']> | undefined;
  for (let step = 0; step < 8; step++) {
    const snapshot = { ...frame.snapshot, tick: frame.snapshot.tick + step * 15 };
    setBuildingBodies(snapshot.map, standingBodies(snapshot));
    const preparation = observationMemory(snapshot, frame.owner, memory), work = new FactWorkQueue(snapshot.tick);
    withFactWork(work, () => {
      const query = createArrivalQuery(snapshot, frame.owner, memory,
        createPlanningDistanceQuery(snapshot, 1, 'land', preparation), 1, undefined, preparation);
      forecast = query.fixedVoyageLoading(frame.worker, frame.voyage);
      expect(work.flush().used).toBeLessThanOrEqual(6144);
    });
    if (forecast?.status === 'known') break;
  }
  expect(forecast?.status).toBe('known');
  if (forecast?.status !== 'known') throw new Error('No loading-stage facts were published');
  expect(forecast.walkTicks).toBeGreaterThan(0);
  expect(forecast.approachTicks).toBeGreaterThan(0);
  expect(forecast.expectedLoadedTick).toBe(forecast.forecastTick + forecast.approachTicks + forecast.walkTicks + forecast.boardingTicks);
  expect(forecast.expectedLoadedTick).toBeGreaterThan(forecast.forecastTick
    + Math.max(forecast.approachTicks, forecast.walkTicks) + forecast.boardingTicks);
  expect(JSON.stringify(frame.snapshot)).toBe(before);
});

it('does not manufacture a historical loading forecast for an already embarked member', () => {
  const frame = scene();
  const embarked = frame.snapshot.units.find(unit => unit.deck?.shipId === frame.voyage.shipId)!;
  expect(embarked).toBeDefined();
  setBuildingBodies(frame.snapshot.map, standingBodies(frame.snapshot));
  expect(createArrivalQuery(frame.snapshot, frame.owner, frame.memory).fixedVoyageLoading(embarked, frame.voyage))
    .toEqual({ status: 'already-loaded' });
});
