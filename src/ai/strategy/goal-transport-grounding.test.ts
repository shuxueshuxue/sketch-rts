import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { withNavigationAudit, withNavigationPhase } from '../../shared/navigation-audit';
import { unitMover } from '../../shared/catalog';
import { bodyMass } from '../../shared/physical-body';
import { GANGWAY_SETUP_TICKS } from '../../shared/ship-gangway';
import { boardingBerth, BOARDING_GAP } from '../../shared/naval';
import { distanceToHull, shareShipProfile } from '../../shared/ship-geometry';
import { hullFits } from '../../shared/ship-navigation';
import type { GameSnapshot, Unit } from '../../shared/types';
import { goalFact } from './goal-facts';
import type { GoalHullCandidate, GoalPublishedValue, GoalShorePair, GoalTransportFactPorts } from './goal-grounding-ports';
import type { GoalNavalMember } from './goal-naval-actions';
import type { GoalCandidates, GoalFactReader } from './goal-planner-types';
import { groundGoalTransportOptions, type GoalTransportGroundingInput } from './goal-transport-grounding';
import { regionIndex, seaIdAt } from './regions';

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
  const regions = regionIndex(snapshot.map);
  // Native placement is an independent fixture oracle, outside the guarded
  // domain invocation. The injected ports contain only its published poses.
  const nativeBerth = (landId: typeof from.landId | typeof to.landId, near: typeof from.point) => {
    const shore = [...regions.shoresByLand.get(landId)!.get('sea:1')!].sort((a, b) =>
      Math.hypot(a.ground.x - near.x, a.ground.y - near.y) - Math.hypot(b.ground.x - near.x, b.ground.y - near.y))[0]!;
    const ship = { ...hull, ...shore.water }; shareShipProfile(hull, ship);
    const native = boardingBerth(snapshot.map, { ...worker, ...shore.ground }, ship)!;
    if (!native.shore || native.heading === undefined) throw Error('fixture requires native shore pose');
    return { landId, seaId: 'sea:1' as const, water: { x: native.x, y: native.y }, ground: native.shore, heading: native.heading };
  };
  const departure = nativeBerth(from.landId, from.point), landing = nativeBerth(to.landId, to.point);
  const pair: GoalShorePair = { id: 'coast-a', seaId: 'sea:1', departure, landing };
  const producerFact = goalFact({ kind: 'transport-in', seaId: 'sea:1', capacity: 1000, byTick: 9000 });
  const candidate: GoalHullCandidate = { id: hull.id, reference: { kind: 'existing', entityId: hull.id }, seaId: 'sea:1',
    assessment: hull, capacity: 1000, cargoUnitIds: cargo.map(unit => unit.id), availableTick: snapshot.tick,
    preconditions: [producerFact], factIds: ['actual-hull'] };
  const readFact: GoalFactReader = fact => ({ fact, state: 'met', observedTick: snapshot.tick, revision: 'route-v1',
    reason: { code: 'published-route', factIds: [fact.id], values: {} }, evidence: [], route: { distance: 10, ticks: 13, points: [] } });
  const ports: GoalTransportFactPorts = {
    shores: vi.fn(() => choices([pair])), hulls: vi.fn(() => choices([candidate])),
    berth: vi.fn((_member, _hull, shore) => met({ water: shore.water, ground: shore.ground,
      heading: shore.landId === from.landId ? departure.heading : landing.heading })),
    seaLeg: vi.fn((_hull, _from, point) => met({ endpoint: point,
      heading: point.x === departure.water.x && point.y === departure.water.y ? departure.heading : landing.heading, ticks: 100 })),
  };
  const input: GoalTransportGroundingInput = { snapshot, owner, tick: snapshot.tick, byTick: 9000, from, to,
    request: { cohort: [member.reference] }, members: met([member]), ports, readFact };
  return { input, member, candidate, pair, hull, worker, cargo, producerFact, departure, landing };
}
function changedPose(snapshot: GameSnapshot, hull: Unit, berth: { water: { x: number; y: number }; ground: { x: number; y: number }; heading: number },
  accept: (distance: number) => boolean) {
  for (const turn of [Math.PI / 2, Math.PI, 0]) for (let step = 1; step <= 128; step++) for (let direction = 0; direction < 8; direction++) {
    const pose = { x: berth.water.x + Math.cos(direction * Math.PI / 4) * step,
      y: berth.water.y + Math.sin(direction * Math.PI / 4) * step, heading: berth.heading + turn };
    const dock = { ...hull, x: pose.x, y: pose.y, sailing: { ...hull.sailing!, heading: pose.heading } };
    shareShipProfile(hull, dock);
    if (seaIdAt(snapshot.map, pose) === 'sea:1' && hullFits(snapshot.map, dock, pose) && accept(distanceToHull(dock, berth.ground)))
      return { endpoint: { x: pose.x, y: pose.y }, heading: pose.heading, ticks: 100 };
  }
  throw Error('native fixture has no requested terminal-pose variation');
}
function strict(input: GoalTransportGroundingInput) {
  return withNavigationAudit(event => {
    if (event.phase === 'strategy-planning' && !event.authorization) throw new Error(event.operation);
  }, () => withNavigationPhase('strategy-planning', () => groundGoalTransportOptions(input)));
}

describe('transport alternatives from shared published ports', () => {
  it('keeps a published berth as the execution target when connectivity supplies only estimated sailing time', () => {
    const { input, departure, landing } = frame();
    const ports: GoalTransportFactPorts = { ...input.ports, seaLeg: vi.fn((_hull, from, to) => met({
      endpoint: to, heading: from.heading + Math.PI, ticks: 100, timeBasis: 'sea-connectivity-estimate' as const,
    })) };
    const result = strict({ ...input, ports });
    expect(result.state).toBe('met'); if (result.state !== 'met') throw Error('no connected transport');
    const option = result.candidates[0]!;
    expect(option.departure).toMatchObject({ water: departure.water, ground: departure.ground, heading: departure.heading });
    expect(option.landing).toEqual({ water: landing.water, ground: landing.ground, heading: landing.heading });
    expect(option.crossing.predicate).toMatchObject({ from: { point: departure.water }, fromHeading: departure.heading });
    expect(ports.seaLeg).toHaveBeenCalledTimes(2); // no terminal-pose retry for an ETA estimate
  });

  it.each(['approach', 'landing'] as const)('does not publish %s when its actual native terminal pose cannot board every member', phase => {
    const { input, member, hull, worker, departure, landing } = frame();
    const larger = input.snapshot.units.find(unit => unit.owner === input.owner && unit.hp > 0 && unit.radius > worker.radius
      && unitMover(unit.kind) === 'land' && !unit.deck && !unit.cabin && unit.expiresTick === undefined)!;
    expect(larger).toBeDefined();
    const extra: GoalNavalMember = { reference: { kind: 'existing', entityId: larger.id }, assessment: larger };
    const members = [extra, member], berth = phase === 'approach' ? departure : landing;
    const bad = changedPose(input.snapshot, hull, berth,
      distance => distance > worker.radius + BOARDING_GAP && distance <= larger.radius + BOARDING_GAP);
    let retry = false;
    const ports: GoalTransportFactPorts = { ...input.ports,
      berth: vi.fn((unit, ship, shore) => retry ? pending(`actual-${phase}-berth-rebind`) : input.ports.berth(unit, ship, shore)),
      seaLeg: vi.fn((ship, from, to, future) => {
        if (to.x === berth.water.x && to.y === berth.water.y) { retry = true; return met(bad); }
        return input.ports.seaLeg(ship, from, to, future);
      }) };
    const before = JSON.stringify(input.snapshot);
    expect(strict({ ...input, ports, members: met(members), request: { cohort: members.map(m => m.reference) } }))
      .toMatchObject({ state: 'pending', requestIds: [`actual-${phase}-berth-rebind`] });
    expect(ports.berth).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ assessment: expect.objectContaining({
      x: bad.endpoint.x, y: bad.endpoint.y, sailing: expect.objectContaining({ heading: bad.heading }) }) }), expect.anything());
    expect(JSON.stringify(input.snapshot)).toBe(before);
  });

  it('retains actual successful native endpoint/heading for both pickup and landing', () => {
    const { input, hull, worker, departure, landing } = frame();
    const pickup = changedPose(input.snapshot, hull, departure, distance => distance <= worker.radius + BOARDING_GAP);
    const delivered = changedPose(input.snapshot, hull, landing, distance => distance <= worker.radius + BOARDING_GAP);
    const ports: GoalTransportFactPorts = { ...input.ports,
      seaLeg: vi.fn((_hull, _from, to) => met(to.x === departure.water.x && to.y === departure.water.y ? pickup : delivered)) };
    const result = strict({ ...input, ports });
    expect(result.state).toBe('met'); if (result.state !== 'met') throw Error('no actual dock');
    const option = result.candidates[0]!;
    expect(option.departure).toMatchObject({ water: pickup.endpoint, heading: pickup.heading, ground: departure.ground });
    expect(option.landing).toEqual({ water: delivered.endpoint, heading: delivered.heading, ground: landing.ground });
    expect(option.crossing.predicate).toMatchObject({ from: { point: pickup.endpoint }, fromHeading: pickup.heading,
      to: { point: delivered.endpoint } });
    expect(ports.seaLeg).toHaveBeenLastCalledWith(expect.anything(), { ...pickup.endpoint, heading: pickup.heading }, landing.water, true);
  });

  it('keeps precise pickup routes and pose, separates approach duration, and never calls native routing', () => {
    const { input, candidate, producerFact, pair } = frame(), before = JSON.stringify(input.snapshot);
    const result = strict(input);
    expect(result.state).toBe('met'); if (result.state !== 'met') throw new Error('no option');
    const option = result.candidates[0]!;
    expect(input.ports.hulls).toHaveBeenCalledWith('sea:1', input.from, bodyMass(input.members.state === 'met' ? input.members.value[0]!.assessment : candidate.assessment), input.request);
    expect(option.duration).toMatchObject({ state: 'met', value: 13 + 100 + 2 * GANGWAY_SETUP_TICKS });
    expect(option.preconditions).toContainEqual(producerFact);
    expect(option.preconditions?.find(fact => fact.predicate.kind === 'route')?.predicate).toMatchObject({ actor: input.request.cohort[0] });
    expect(option.crossing.predicate).toMatchObject({ fromHeading: 'heading' in pair.departure! ? pair.departure.heading : undefined,
      from: { point: pair.departure!.water }, to: { point: pair.landing.water } });
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
    const towardWater = { x: pair.landing.water.x - pair.landing.ground.x, y: pair.landing.water.y - pair.landing.ground.y };
    const length = Math.hypot(towardWater.x, towardWater.y) || 1;
    const alternateGround = { x: pair.landing.ground.x + (towardWater.x || 1) / length * .01,
      y: pair.landing.ground.y + towardWater.y / length * .01 };
    const result = strict({ ...input, ports: { ...input.ports, shores: () => choices([pair,
      { ...pair, id: 'alternative', landing: { ...pair.landing, ground: alternateGround } }]) } });
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
