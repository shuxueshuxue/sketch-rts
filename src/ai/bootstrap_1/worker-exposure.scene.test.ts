import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import type { GameSnapshot, Unit } from '../../shared/types';
import { nativeLandRoad } from '../policy/land-road';
import { workerExposure } from '../situation/worker-exposure';
import { planCampTravel } from './camp-travel';
import { workerSafetyPlans } from './worker-safety';

it('admits a real construction road only when the worker safety veto agrees along its native steering legs', () => {
  const frame = JSON.parse(gunzipSync(readFileSync(new URL('../fixtures/camp-worker-summoner-main-12232.json.gz', import.meta.url))).toString());
  const snapshot: GameSnapshot = frame.snapshot;
  const worker = snapshot.units.find(unit => unit.id === 'unit-v9_summoner-worker-1256')!;
  const command = frame.entries.find((entry: { command: { type: string; unitId?: string } }) =>
    entry.command.type === 'build' && entry.command.unitId === worker.id)!.command;
  const direct = nativeLandRoad(snapshot, worker, command)!;
  expect(workerExposure(snapshot, worker, direct.points).some(exposure => exposure.foe.id === 'creep-gen-9-3')).toBe(true);
  const plan = planCampTravel(snapshot, worker, command, { parentId: 'real-town-hall', valueGoldPerTick: .05 });
  expect(plan.kind).toBe('detour');
  expect(plan.goal).toEqual({ x: 3024, y: 2128 });
  // Re-run native steering for every emitted waypoint, then ask the actual
  // veto along each segment under the same world facts, not another radius.
  let start = worker;
  for (const waypoint of plan.road!.points.slice(1)) {
    const road = nativeLandRoad(snapshot, start, waypoint)!;
    expect(workerExposure(snapshot, worker, road.points)).toEqual([]);
    for (let index = 1; index < road.points.length; index++) {
      const a = road.points[index - 1]!, b = road.points[index]!;
      const steps = Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) / worker.speed * 20 / 15);
      for (let at = 0; at <= steps; at++) {
        const fraction = steps ? at / steps : 1;
        const patient: Unit = { ...worker, x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
        const posed = { ...snapshot, units: snapshot.units.map(unit => unit.id === patient.id ? patient : unit) };
        expect(workerSafetyPlans(posed, frame.owner, { memory: structuredClone(frame.memory) })
          .some(task => task.worker.id === worker.id && !task.released)).toBe(false);
      }
    }
    start = { ...worker, ...waypoint };
  }
});
