import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { shipPassengers } from '../../../shared/ship-geometry';
import { sameGround, setBuildingBodies, walkableGoal } from '../../../shared/terrain';
import { standingBodies } from '../../../shared/structure-bodies';
import type { GameSnapshot } from '../../../shared/types';
import type { AiPolicyMemory } from '../../memory';
import type { AllocationLocation, ExecutorInput, FormalAssignment, VoyageAllocation } from '../allocation-types';
import { unitRoles } from '../commitments';
import { landIdAt, unitLocation } from '../regions';
import { transportExecutor } from './transport';

function parallel(): ExecutorInput {
  const frame: { snapshot: GameSnapshot; owner: string; memory: AiPolicyMemory } = JSON.parse(gunzipSync(readFileSync(
    new URL('../../bootstrap_1/fixtures/strategy-allocation-frames.json.gz', import.meta.url))).toString()).frames['Nd-ringwater-enemy-14010'];
  const { snapshot, owner } = frame;
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const mine = snapshot.resources.find(mine => mine.id === 'gold-gen-6')!, target = { entityId: mine.id,
    landId: landIdAt(snapshot.map, mine)!, point: { x: mine.x, y: mine.y } };
  const objectiveId = `ConquerIsland:${owner}:${mine.id}`, methodId = `${objectiveId}/parallel-delivery`;
  const token = { actionId: `${methodId}/deliver`, generation: 1 };
  const actors = new Map(snapshot.units.map(unit => [unit.id, unit]));
  const assignments: FormalAssignment[] = [], voyages: VoyageAllocation[] = [];
  const to = frame.memory.naval!.ferries!['unit-enemy-transport-6029']!.to;
  for (const shipId of ['unit-enemy-transport-2302', 'unit-enemy-transport-6029']) {
    const boat = actors.get(shipId)!, previous = frame.memory.naval!.ferries![shipId]!;
    const source = walkableGoal(snapshot.map, previous.from.x, previous.from.y);
    const aboard = shipPassengers(snapshot.units, boat);
    const crew = aboard.length ? aboard : snapshot.units.filter(unit => unit.owner === owner && !unit.deck && !unit.cabin
      && unit.kind !== 'worker' && unit.attackDamage > 0 && sameGround(snapshot.map, unit, source)).slice(0, 1);
    expect(crew.length).toBeGreaterThan(0);
    for (const unit of [boat, ...crew]) {
      const location = unitLocation(snapshot.map, unit, actors, snapshot.tick);
      const lastLocation: AllocationLocation = location.kind === 'unknown' ? { ...location,
        reason: { code: location.reason.code, factIds: [unit.id], values: {} } } : location;
      assignments.push({ authority: 'committed', id: `assignment:${unit.id}`, leaseId: `lease:${unit.id}`, unitId: unit.id,
        role: unitRoles(unit)[0]!, objectiveId, methodId, action: token, target, stage: unit.deck ? 'en-route' : 'assigned',
        eta: { status: 'known', forecastTick: snapshot.tick, arrivalTick: snapshot.tick + 100 }, lastLocation, interruption: null });
    }
    voyages.push({ id: `voyage:${shipId}`, objectiveId, action: token, shipAssignmentId: `assignment:${shipId}`,
      crewAssignmentIds: crew.map(unit => `assignment:${unit.id}`), passengerIds: aboard.map(unit => unit.id),
      departure: { point: previous.from, landId: landIdAt(snapshot.map, source)! }, destination: { ...target, point: to },
      departureGround: { point: source, landId: landIdAt(snapshot.map, source)! },
      landingGround: { point: walkableGoal(snapshot.map, to.x, to.y), landId: target.landId },
      phase: previous.phase, startedTick: previous.sinceTick, expectedFreeTick: null, decision: 'continue' });
  }
  return { snapshot, owner,
    objective: { id: objectiveId, owner, kind: 'ConquerIsland', target, effects: [], utility: { horizonTicks: 2400,
      benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0 }, status: 'active', sinceTick: snapshot.tick,
      rank: 1, reasons: [], methodIds: [methodId], stability: { minimumStayUntilTick: snapshot.tick, challengerId: null, challengerThinks: 0 } },
    method: { id: methodId, objectiveId, kind: 'staged-beachhead', preconditions: [], subgoals: [], demands: [],
      estimatedTicks: null, status: 'selected', reasons: [] },
    execution: { token, objectiveId, methodId, executor: 'strategy.transport', intent: { kind: 'deliver-force' }, target,
      dependsOn: [], completionEffects: [], status: 'active', phase: 'loading', sinceTick: snapshot.tick, lastProgressTick: snapshot.tick, state: {} },
    grant: { revision: 1, action: token, objectiveId, methodId, assignments, voyages,
      leases: assignments.map(assignment => ({ id: assignment.leaseId, resourceKey: `unit:${assignment.unitId}`,
        objectiveId, methodId, action: token, sinceTick: snapshot.tick, minimumStayUntilTick: snapshot.tick, origin: 'allocator', incumbentTask: null })),
      budgets: [], orders: [], commands: [], orderOverrides: [] }, events: [] };
}

describe('parallel granted voyages in the real ringwater frame', () => {
  it('executes both manifests while recording only the seven passengers actually aboard', () => {
    const request = parallel(), before = JSON.stringify(request), result = transportExecutor.execute(request);
    expect(result.status).toBe('active');
    expect(Object.keys(result.state.voyages!)).toHaveLength(2);
    expect(result.state.pendingVoyageIds).toEqual(request.grant.voyages.map(voyage => voyage.id));
    const commanded = result.commands.flatMap(entry => 'unitIds' in entry.command ? entry.command.unitIds : []);
    expect(commanded).toContain('unit-enemy-transport-2302');
    expect(result.commands.some(entry => entry.command.type === 'board' && entry.command.transportId === 'unit-enemy-transport-6029')).toBe(false);
    // Its already accepted move still targets the grant: do not reset that
    // native route or board before the hull reaches the quoted berth.
    expect(result.commands.some(entry => entry.command.type === 'move' && entry.command.unitIds.includes('unit-enemy-transport-6029'))).toBe(false);
    expect(result.state.voyages).toMatchObject({ 'voyage:unit-enemy-transport-6029': { status: 'active', phase: 'rendezvous' } });
    expect(result.progress.filter(event => event.kind === 'loaded').flatMap(event => event.unitIds)).toHaveLength(7);
    expect(result.progress.some(event => event.kind === 'sailed' || event.kind === 'unloaded')).toBe(false);
    expect(JSON.stringify(request)).toBe(before);
    const cold: ExecutorInput = JSON.parse(JSON.stringify(request));
    setBuildingBodies(cold.snapshot.map, standingBodies(cold.snapshot));
    expect(transportExecutor.execute(cold)).toEqual(result);
  });

  it('rejects duplicate manifests before proposing orders for either voyage', () => {
    const request = parallel(), first = request.grant.voyages[0]!, second = request.grant.voyages[1]!;
    const result = transportExecutor.execute({ ...request, grant: { ...request.grant,
      voyages: [first, { ...second, crewAssignmentIds: [...second.crewAssignmentIds, first.crewAssignmentIds[0]!] }] } });
    expect(result.status).toBe('blocked');
    expect(result.reasons[0]?.reason).toBe('duplicate-unit-in-parallel-voyages');
    expect(result.commands).toEqual([]);
  });

  it('propagates a failed boarding berth alongside another active voyage', () => {
    const request = parallel(), voyage = request.grant.voyages[1]!;
    const boatId = request.grant.assignments.find(assignment => assignment.id === voyage.shipAssignmentId)!.unitId;
    const crewId = request.grant.assignments.find(assignment => assignment.id === voyage.crewAssignmentIds[0])!.unitId;
    const boat = request.snapshot.units.find(unit => unit.id === boatId)!, person = request.snapshot.units.find(unit => unit.id === crewId)!;
    Object.assign(boat, { x: voyage.departure.point.x + boat.radius * 4, y: voyage.departure.point.y }); boat.order = { type: 'idle' };
    Object.assign(person, voyage.departureGround.point);
    const interrupted = { ...request, execution: { ...request.execution, state: { voyages: { [voyage.id]: { rendezvousEstablished: true } } } } };
    const before = JSON.stringify(interrupted), result = transportExecutor.execute(interrupted);
    expect(result.status).toBe('failed');
    expect(result.reasons.some(reason => reason.reason === 'berth-mismatch')).toBe(true);
    expect(result.commands).toEqual([]);
    expect(result.state.voyages).toMatchObject({ [voyage.id]: { status: 'failed', phase: 'berth-mismatch' },
      [request.grant.voyages[0]!.id]: { status: 'active' } });
    expect(JSON.stringify(interrupted)).toBe(before);
    const cold: ExecutorInput = JSON.parse(JSON.stringify(interrupted));
    setBuildingBodies(cold.snapshot.map, standingBodies(cold.snapshot));
    expect(transportExecutor.execute(cold)).toEqual(result);
  });
});
