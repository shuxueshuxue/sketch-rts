import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { setBuildingBodies, walkableGoal } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import type { GameSnapshot } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import type { FixedVoyage } from './arrivals';
import { withAllocationArrivalQuery } from './allocation-arrival-query';
import { landIdAt, seaIdAt } from './regions';

function frame() {
  const input: { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory } = JSON.parse(gunzipSync(readFileSync(
    new URL('./fixtures/objective-event-frames.json.gz', import.meta.url))).toString()).cases.find((frame: { event: string }) => frame.event === 'E02');
  setBuildingBodies(input.snapshot.map, standingBodies(input.snapshot));
  const [shipId, mission] = Object.entries(input.memory.naval!.ferries!)[0]!;
  const ship = input.snapshot.units.find(unit => unit.id === shipId)!;
  const unit = input.snapshot.units.find(unit => unit.deck?.shipId === shipId)!;
  const mine = input.snapshot.resources.find(resource => resource.id === mission.targetId)!;
  const departure = walkableGoal(input.snapshot.map, mission.from.x, mission.from.y);
  const landing = walkableGoal(input.snapshot.map, mission.to.x, mission.to.y);
  const voyage: FixedVoyage = { shipId, seaId: seaIdAt(input.snapshot.map, ship)!, departure: mission.from, landing: mission.to,
    departureGround: { point: departure, landId: landIdAt(input.snapshot.map, departure)! },
    landingGround: { point: landing, landId: landIdAt(input.snapshot.map, landing)! }, phase: 'sailing' };
  return { ...input, unit, voyage, target: { entityId: mine.id, point: { x: mine.x, y: mine.y }, landId: landIdAt(input.snapshot.map, mine)! } };
}

describe('one transaction arrival work allowance', () => {
  it('does not advance geometry again when gross and net ask the same fixed voyage', () => {
    const input = frame();
    withAllocationArrivalQuery(input.snapshot, input.owner, input.memory, read => {
      const first = read(input.unit, input.target, input.voyage), progress = JSON.stringify(input.memory.strategy!.observation);
      expect(first.status).toBe('unknown');
      expect(read(input.unit, input.target, input.voyage)).toEqual(first);
      expect(JSON.stringify(input.memory.strategy!.observation)).toBe(progress);
    }, 0);
  });

  it('restores a serialized query boundary without retaining the prior process evaluator', () => {
    const input = frame(), fork = JSON.parse(JSON.stringify(input)) as typeof input;
    const run = (value: typeof input) => withAllocationArrivalQuery(value.snapshot, value.owner, value.memory,
      read => read(value.unit, value.target, value.voyage), Infinity);
    const a = run(input); expect(a.status).toBe('reachable');
    expect(run(fork)).toEqual(a);
    expect(JSON.stringify(fork.memory)).toBe(JSON.stringify(input.memory));
  });
});
