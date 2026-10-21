import { describe, expect, it, vi } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { setBuildingBodies } from '../../shared/terrain';
import * as terrain from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import { strengthOf } from '../policy/v6/strength';
import type { AllocationMethodQuoteInput } from './allocation-types';
import { defenseMethodProvider } from './defense-methods';
import { defenseCoverPostFacts } from './executors/defend-site';
import { landIdAt } from './regions';
import type { Objective, Situation } from './types';
import { withAllocationLandRoutes, currentAllocationLandRouteReader } from './allocation-arrival-query';
import type { AllocationLandRouteReader } from './allocation-arrival-query';

function defendedPost(): AllocationMethodQuoteInput {
  const scene = sketchScene('defense-value-counterfactual').map('bareDuel').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' })
    .building('us', 'townHall', 1400, 1400, { id: 'hall' })
    .building('us', 'defenseTower', 1500, 1000)
    .unit('foe', 'footman', 1700, 1400);
  for (let i = 0; i < 6; i++) scene.unit('us', 'emberRavager', 1600, 1400 + i * 3);
  const snapshot = snapshotGame(scene.build().createGame());
  setBuildingBodies(snapshot.map, standingBodies(snapshot));
  const hall = snapshot.buildings.find(building => building.id === 'hall')!;
  const target = { entityId: hall.id, landId: landIdAt(snapshot.map, hall)!, point: { x: hall.x, y: hall.y } };
  const enemy = snapshot.units.find(unit => unit.owner === 'foe')!, party = snapshot.units.filter(unit => unit.owner === 'us');
  const arrival = { status: 'reachable' as const, ticks: 0, landTicks: 0, crossings: [] as const, evidence: [] };
  const situation: Situation = { tick: snapshot.tick, owner: 'us', horizonTicks: 2400, seas: [], opportunities: [], limitations: [],
    economy: { cashGold: 1000, predictedIncomeGold: 0, horizonTicks: 2400, ledger: [] },
    units: party.map(unit => ({ id: unit.id, owner: unit.owner, kind: unit.kind, hp: unit.hp, maxHp: unit.maxHp,
      location: { kind: 'land', landId: target.landId, point: unit }, strength: strengthOf([unit]),
      roles: ['frontline'], expiresTick: null, commitments: [], arrivals: [] })),
    assets: [{ id: hall.id, owner: 'us', kind: 'hall', target, hp: hall.hp, complete: true,
      replacementGold: 400, remainingGold: 0, incomeGoldPerTick: 0, discountedValueGold: 400 }],
    lands: [{ id: target.landId, anchor: target.point, assetIds: [hall.id], unitIds: party.map(unit => unit.id), adjacentSeaIds: [],
      threats: [{ siteId: hall.id, horizonTicks: 900, attackers: [{ unitId: enemy.id, arrival, strength: 1,
        intent: { kind: 'actual-intrusion', actualSiteId: hall.id, redirectGroupId: 'native-enemy', basis: 'native-target' } }],
        arrivedStrength: 1, incomingStrength: 0, friendlyOnStationStrength: strengthOf(party), firstArrivalTicks: 0,
        lossProbability: .01, evidence: [] }] }] };
  const objective: Objective = { id: 'defend-hall', kind: 'DefendSite', owner: 'us', target,
    effects: [{ kind: 'force-present', landId: target.landId, minimumStrength: 1, throughTick: snapshot.tick + 900 }],
    utility: { horizonTicks: 2400, benefit: [], cost: [], successProbability: 1, persistenceBonus: 0, score: 0, evidence: [] },
    status: 'active', sinceTick: snapshot.tick, rank: 1, reasons: [], methodIds: [],
    stability: { minimumStayUntilTick: snapshot.tick, challengerId: null, challengerThinks: 0 } };
  const method = defenseMethodProvider.buildMethods({ snapshot, situation, objective, previous: null, executions: [], blocked: [] })
    .find(method => method.kind === 'local-squad')!;
  return { snapshot, situation, objective, method, unitIds: party.map(unit => unit.id), executions: [], budgets: [] };
}

describe('defense cover planning route facts', () => {
  it('preserves a pending cover road as an unknown prerequisite and never invokes native distance', () => {
    const input = defendedPost(), before = JSON.stringify(input.snapshot);
    const native = vi.spyOn(terrain, 'walkingDistance');
    const read = vi.fn<AllocationLandRouteReader>(() => ({ status: 'unknown', reasonCode: 'cover-field-pending' }));
    try {
      const methods = withAllocationLandRoutes(read, () => defenseMethodProvider.buildMethods({ ...input, previous: null, blocked: [] }));
      const method = methods.find(method => method.kind === 'wait-in-cover')!;
      expect(read).toHaveBeenCalled(); expect(native).not.toHaveBeenCalled();
      expect(method.preconditions).toMatchObject([{ kind: 'route', status: 'unknown', reason: { code: 'defense-cover-route-pending' } }]);
      const quote = defenseMethodProvider.quote({ ...input, method });
      expect(quote.status).toBe('blocked'); expect(quote.missingPreconditions.some(item => item.reason.code === 'defense-cover-route-pending' && item.status === 'unknown')).toBe(true);
      expect(quote.missingPreconditions.some(item => item.reason.code === 'no-reachable-tower-cover' && item.status === 'unmet')).toBe(false);
      expect(JSON.stringify(input.snapshot)).toBe(before);
    } finally { vi.restoreAllMocks(); }
  });

  it('uses the same known post, distinguishes unreachable, and restores the native default', () => {
    const input = defendedPost(), field = input.snapshot.units.find(unit => unit.owner === 'foe')!;
    const args = { snapshot: input.snapshot, owner: input.situation.owner };
    const nativePost = defenseCoverPostFacts(args, input.objective.target.point, field);
    expect(nativePost.post).toBeDefined(); expect(nativePost.pending).toEqual([]);
    const native = vi.spyOn(terrain, 'walkingDistance');
    try {
      const known = withAllocationLandRoutes((_from, goal) => ({ status: 'known', points: [goal], distance: 100 }),
        () => defenseCoverPostFacts(args, input.objective.target.point, field));
      expect(known).toEqual(nativePost); expect(native).not.toHaveBeenCalled();
      const impossible = withAllocationLandRoutes(() => ({ status: 'unreachable', reasonCode: 'cover-unreachable' }),
        () => defenseCoverPostFacts(args, input.objective.target.point, field));
      expect(impossible).toEqual({ post: undefined, pending: [] }); expect(native).not.toHaveBeenCalled();
      expect(currentAllocationLandRouteReader()).toBeUndefined();
      expect(defenseCoverPostFacts(args, input.objective.target.point, field)).toEqual(nativePost); expect(native).toHaveBeenCalled();
    } finally { vi.restoreAllMocks(); }
  });
});
