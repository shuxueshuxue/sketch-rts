import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { unitMover } from '../../shared/catalog';
import { bodyMass } from '../../shared/physical-body';
import { GANGWAY_SETUP_TICKS } from '../../shared/ship-gangway';
import type { GameSnapshot } from '../../shared/types';
import { goalFact } from './goal-facts';
import type { GoalHullCandidate, GoalPublishedValue, GoalShorePair, GoalTransportFactPorts } from './goal-grounding-ports';
import type { GoalNavalMember } from './goal-naval-actions';
import type { GoalCandidates, GoalFactReader } from './goal-planner-types';
import { groundGoalTransportOptions, type GoalTransportGroundingInput } from './goal-transport-grounding';

const met = <T>(value: T): GoalPublishedValue<T> => ({ state: 'met', value, factIds: ['published-physical-fact'] });
const choices = <T>(candidates: readonly T[]): GoalCandidates<T> => ({ state: 'met', candidates, factIds: ['published-domain'] });
const pending = (id: string) => ({ state: 'pending' as const, requestIds: [id], reason: { code: 'pending', factIds: [id], values: {} } });
function frame() {
  const { snapshot, owner }: { snapshot: GameSnapshot; owner: string } = JSON.parse(gunzipSync(readFileSync(
    new URL('./fixtures/sapphire-control-p4-4180.json.gz', import.meta.url))).toString());
  const hull = snapshot.units.find(unit => unit.id === 'unit-p4-transport-1151')!;
  const worker = snapshot.units.find(unit => unit.id === 'unit-p4-worker-2')!;
  const cargo = snapshot.units.filter(unit => (unit.deck?.shipId ?? unit.cabin?.shipId) === hull.id);
  const from = { landId: 'land:2' as const, point: { x: 1584, y: 2448 } }, to = { landId: 'land:3' as const, point: { x: 2864, y: 4208 } };
  const member: GoalNavalMember = { reference: { kind: 'existing', entityId: worker.id }, assessment: worker };
  const pair: GoalShorePair = { id: 'coast-a', seaId: 'sea:1',
    departure: { landId: from.landId, seaId: 'sea:1', water: from.point, ground: from.point },
    landing: { landId: to.landId, seaId: 'sea:1', water: { x: 2800, y: 4208 }, ground: to.point } };
  const producerFact = goalFact({ kind: 'transport-in', seaId: 'sea:1', capacity: 1000, byTick: 9000 });
  const candidate: GoalHullCandidate = { id: hull.id, reference: { kind: 'existing', entityId: hull.id }, seaId: 'sea:1',
    assessment: hull, capacity: 1000, cargoUnitIds: cargo.map(unit => unit.id), availableTick: snapshot.tick,
    preconditions: [producerFact], factIds: ['actual-hull'] };
  const readFact: GoalFactReader = fact => ({ fact, state: 'met', observedTick: snapshot.tick, revision: 'route-v1',
    reason: { code: 'published-route', factIds: [fact.id], values: {} }, evidence: [], route: { distance: 10, ticks: 13, points: [] } });
  const ports: GoalTransportFactPorts = {
    shores: vi.fn(() => choices([pair])), hulls: vi.fn(() => choices([candidate])),
    berth: vi.fn((_member, _hull, shore) => met({ water: shore.water, ground: shore.ground, heading: 1 })),
    seaLeg: vi.fn((_hull, _from, point) => met({ endpoint: point, heading: 2, ticks: 100 })),
  };
  const input: GoalTransportGroundingInput = { snapshot, owner, tick: snapshot.tick, byTick: 9000, from, to,
    request: { cohort: [member.reference] }, members: met([member]), ports, readFact };
  return { input, member, candidate, pair, hull, worker, cargo, producerFact };
}
function strict(input: GoalTransportGroundingInput) {
  return withNavigationAudit(event => {
    if (event.phase === 'strategy-planning' && !event.authorization) throw new Error(event.operation);
  }, () => withNavigationPhase('strategy-planning', () => groundGoalTransportOptions(input)));
}

describe('transport alternatives from shared published ports', () => {
  it('keeps precise pickup routes and pose, separates approach duration, and never calls native routing', () => {
    const { input, candidate, producerFact } = frame(), before = JSON.stringify(input.snapshot);
    const result = strict(input);
    expect(result.state).toBe('met'); if (result.state !== 'met') throw new Error('no option');
    const option = result.candidates[0]!;
    expect(input.ports.hulls).toHaveBeenCalledWith('sea:1', input.from, bodyMass(input.members.state === 'met' ? input.members.value[0]!.assessment : candidate.assessment), input.request);
    expect(option.duration).toMatchObject({ state: 'met', value: 13 + 100 + 2 * GANGWAY_SETUP_TICKS });
    expect(option.preconditions).toContainEqual(producerFact);
    expect(option.preconditions?.find(fact => fact.predicate.kind === 'route')?.predicate).toMatchObject({ actor: input.request.cohort[0] });
    expect(option.crossing.predicate).toMatchObject({ fromHeading: 2, from: { point: input.from.point }, to: { point: { x: 2800, y: 4208 } } });
    expect(JSON.stringify(input.snapshot)).toBe(before);
    expect(strict({ ...input, snapshot: JSON.parse(before) })).toEqual(result);
  });

  it('keeps existing and output hull alternatives and exact future members without exposing assessment IDs', () => {
    const { input, candidate, member } = frame();
    const future = { ...candidate, id: 'future-prototype', reference: { kind: 'output' as const, actionId: 'train-ship', output: 'unit-0' },
      cargoUnitIds: [], availableTick: 8000 };
    const soldier: GoalNavalMember = { reference: { kind: 'output', actionId: 'train-land', output: 'unit-0' },
      assessment: { ...member.assessment, id: 'private-evaluation-only', kind: 'knight', deck: undefined, cabin: undefined } };
    const members = [member, soldier];
    const ports = { ...input.ports, hulls: vi.fn<GoalTransportFactPorts['hulls']>(() => choices([future, candidate])) };
    const result = strict({ ...input, members: met(members), request: { cohort: members.map(item => item.reference) }, ports });
    expect(result.state).toBe('met'); if (result.state !== 'met') throw new Error('no option');
    expect(result.candidates).toHaveLength(2);
    const expectedMass = members.reduce((sum, item) => sum + bodyMass(item.assessment), 0);
    expect(ports.hulls.mock.calls[0]?.[2]).toBe(expectedMass);
    expect(input.ports.berth).toHaveBeenCalledWith(soldier.assessment, expect.anything(), expect.anything());
    expect(JSON.stringify(result)).not.toContain('private-evaluation-only');
    expect(result.candidates.some(option => option.transport.kind === 'output')).toBe(true);
  });

  it('does not charge the fighter assembly walk again, while preserving mixed cargo worker walking', () => {
    const { input, member } = frame();
    const actual = input.snapshot.units.find(unit => unit.owner === input.owner && unit.kind !== 'worker'
      && unitMover(unit.kind) === 'land' && !unit.deck && !unit.cabin && unit.attackDamage > 0)!;
    const fighter: GoalNavalMember = { reference: { kind: 'existing', entityId: actual.id },
      assessment: { ...actual, x: input.from.point.x, y: input.from.point.y, deck: undefined, cabin: undefined } };
    const readFact = vi.fn(input.readFact);
    const onlyFighter = strict({ ...input, members: met([fighter]), request: { cohort: [fighter.reference] }, readFact });
    expect(onlyFighter.state).toBe('met');
    if (onlyFighter.state !== 'met') throw Error('no fighter option');
    expect(onlyFighter.candidates[0]!.duration).toMatchObject({ state: 'met', value: 100 + 2 * GANGWAY_SETUP_TICKS });
    expect(readFact).not.toHaveBeenCalled();
    const mixed = strict({ ...input, members: met([fighter, member]), request: { cohort: [fighter.reference, member.reference] }, readFact });
    expect(mixed.state).toBe('met'); if (mixed.state !== 'met') throw Error('no mixed option');
    expect(mixed.candidates[0]!.duration).toMatchObject({ state: 'met', value: 13 + 100 + 2 * GANGWAY_SETUP_TICKS });
    expect(readFact.mock.calls.map(([fact]) => fact.predicate.kind === 'route' ? fact.predicate.actor : null))
      .toEqual([member.reference]);
  });

  it('starts aboard at the real hull pose, requires no invented shore, and retains all native cargo dependencies', () => {
    const { input, cargo, candidate, pair, hull } = frame();
    const selected = cargo.filter(unit => unit.kind !== 'worker').map(unit => ({ reference: { kind: 'existing' as const, entityId: unit.id }, assessment: unit }));
    const ports = { ...input.ports, shores: () => choices([{ id: pair.id, seaId: pair.seaId, landing: pair.landing }]), hulls: vi.fn<GoalTransportFactPorts['hulls']>(() => choices([candidate])) };
    const result = strict({ ...input, from: { seaId: 'sea:1', point: { x: hull.x, y: hull.y } },
      members: met(selected), request: { cohort: selected.map(item => item.reference) }, ports });
    expect(result.state).toBe('met'); if (result.state !== 'met') throw new Error('no option');
    const option = result.candidates[0]!;
    expect(option.origin).toBe('aboard'); expect(option.departure).not.toHaveProperty('ground'); expect(option).not.toHaveProperty('approach');
    expect(option.departure.water).toEqual({ x: hull.x, y: hull.y });
    expect(option.loadedUnitIds).toEqual(candidate.cargoUnitIds.slice().sort());
    expect(option.duration).toMatchObject({ value: 100 + GANGWAY_SETUP_TICKS });
    expect(ports.hulls.mock.calls[0]?.[2]).toBe(0);
    expect(input.ports.seaLeg).toHaveBeenCalledTimes(1);
  });

  it('keeps a usable alternative alongside stable deferred facts instead of stalling or declaring them unreachable', () => {
    const { input, pair } = frame();
    const later = { ...pair, id: 'coast-later', seaId: 'sea:2' as const };
    const hulls = input.ports.hulls;
    const result = strict({ ...input, ports: { ...input.ports, shores: () => choices([later, pair]),
      hulls: (sea, from, mass, request) => sea === 'sea:2' ? pending('geometry:sea2') : hulls(sea, from, mass, request) } });
    expect(result.state).toBe('met'); if (result.state !== 'met') throw new Error('no option');
    expect(result.candidates).toHaveLength(1);
    expect(result.deferred).toEqual([{ id: 'coast-later', requestIds: ['geometry:sea2'], reason: pending('geometry:sea2').reason }]);
    const allPending = strict({ ...input, ports: { ...input.ports, seaLeg: () => pending('route:stable') } });
    expect(allPending).toMatchObject({ state: 'pending', requestIds: ['route:stable'] });
  });

  it('retains unsafe shores as world prerequisites and checks each passenger instead of substituting equal mass', () => {
    const { input, member, pair } = frame();
    const another: GoalNavalMember = { reference: { kind: 'output', actionId: 'train-more', output: 'unit-1' }, assessment: { ...member.assessment, id: 'other' } };
    const berth = vi.fn((unit, _hull, shore) => met({ water: unit.id === 'other' ? { x: input.from.point.x + 200, y: input.from.point.y } : input.from.point,
      ground: shore.ground, heading: 0 }));
    const unmatched = strict({ ...input, request: { cohort: [member.reference, another.reference] }, members: met([member, another]), ports: { ...input.ports, berth } });
    expect(unmatched).toMatchObject({ state: 'unmet', reason: { code: 'transport-cohort-has-no-common-berth' } });
    const result = strict({ ...input, ports: { ...input.ports, shores: () => choices([pair, { ...pair, id: 'alternative', landing: { ...pair.landing, ground: { x: 2800, y: 4250 } } }]) } });
    expect(result.state).toBe('met'); if (result.state !== 'met') throw new Error('no option');
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every(option => option.shoreSafe.predicate.kind === 'shore-safe')).toBe(true);
    expect(new Set(result.candidates.map(option => option.shoreSafe.id)).size).toBe(2);
  });

  it('leaves unpublished routes and invalid measured legs pending, and separates incompatible actual hulls', () => {
    const { input, cargo, candidate } = frame();
    const routePending: GoalFactReader = fact => ({ fact, state: 'pending', requestId: 'walk:stable', requestedTick: 4100,
      observedTick: 4180, revision: 'pending', reason: pending('walk:stable').reason, evidence: [] });
    expect(strict({ ...input, readFact: routePending })).toMatchObject({ state: 'pending', requestIds: ['walk:stable'] });
    expect(strict({ ...input, ports: { ...input.ports, seaLeg: () => met({ ticks: NaN, endpoint: input.from.point, heading: 0 }) } }))
      .toMatchObject({ state: 'pending', reason: { code: 'transport-alternatives-pending' } });
    const selected = cargo.map(unit => ({ reference: { kind: 'existing' as const, entityId: unit.id }, assessment: unit }));
    const snapshot = JSON.parse(JSON.stringify(input.snapshot)) as GameSnapshot;
    snapshot.units.find(unit => unit.id === selected[1]!.assessment.id)!.deck = { ...selected[1]!.assessment.deck!, shipId: 'other-hull' };
    expect(strict({ ...input, snapshot, members: met(selected), request: { cohort: selected.map(item => item.reference) } }))
      .toMatchObject({ state: 'unmet', reason: { code: 'transport-cohort-needs-separate-voyages' } });
    expect(strict({ ...input, ports: { ...input.ports, hulls: () => choices([{ ...candidate, cargoUnitIds: [] }]) } }))
      .toMatchObject({ state: 'pending', reason: { code: 'transport-alternatives-pending' } });
  });
});
