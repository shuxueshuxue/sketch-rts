import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../sdk/scene';
import { snapshotGame } from '../../shared/sim';
import { setBuildingBodies } from '../../shared/terrain';
import { standingBodies } from '../../shared/structure-bodies';
import { strengthOf } from '../policy/v6/strength';
import type { AllocationMethodQuoteInput } from './allocation-types';
import { defenseMethodProvider } from './defense-methods';
import type { DecisionFacts } from './decision';
import { landIdAt } from './regions';
import type { Objective, Situation } from './types';
import { forceSuccessProbability, quoteOpportunityCost } from './utility';

function defendedPost(): AllocationMethodQuoteInput {
  const scene = sketchScene('defense-value-counterfactual').map('bareDuel').replaceDefaults()
    .player('us', { team: 'a' }).player('foe', { team: 'b' })
    .building('us', 'townHall', 1400, 1400, { id: 'hall' })
    .building('us', 'defenseTower', 1500, 1400)
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

describe('defense protection and whole-bundle valuation', () => {
  it('does not charge a second site the full enemy army or invent intent for older captures', () => {
    const input = defendedPost();
    const potential = { ...input.situation, lands: input.situation.lands.map(land => ({ ...land, threats: land.threats.map(threat => ({ ...threat,
      attackers: threat.attackers.map(attacker => ({ ...attacker, arrival: { ...attacker.arrival, ticks: 100 }, intent: { kind: 'potential-redirect' as const,
        actualSiteId: 'other-front-mine', redirectGroupId: 'native-enemy', basis: 'native-target' as const } })) })) })) };
    const redirect = defenseMethodProvider.quote({ ...input, situation: potential });
    expect(redirect.status).toBe('feasible');
    expect(redirect.reason.values.actualIntrusionCount).toBe(0);
    expect(redirect.reason.values.potentialRedirectCount).toBe(1);
    // The remaining real tower is enough to respond even with this entire
    // quoted cohort removed. Its protection cannot be sold a second time.
    expect(redirect.reason.values.otherResponseTicks).toBe(0);
    expect(redirect.utility!.score).toBe(0);
    const oldCapture = { ...input.situation, lands: input.situation.lands.map(land => ({ ...land, threats: land.threats.map(threat => ({ ...threat,
      attackers: threat.attackers.map(({ intent: _intent, ...attacker }) => attacker) })) })) };
    const unknown = defenseMethodProvider.quote({ ...input, situation: oldCapture });
    expect(unknown.status).toBe('blocked');
    expect(unknown.reason.code).toBe('defense-response-or-intent-unknown');
    expect(unknown.utility).toBeNull();
  });

  it('prices actual opposition once and subtracts the static-only counterfactual exactly', () => {
    const input = defendedPost(), before = JSON.stringify(input), quote = defenseMethodProvider.quote(input);
    expect(quote.status).toBe('feasible');
    const utility = quote.utility!;
    expect(quote.reason.values.actualOpposition).toBe(1);
    expect(utility.successProbability).toBe(forceSuccessProbability(quote.force!.effectiveForce + 1.3, 1));
    expect(quote.force!.requiredForce).toBe(0);
    expect(utility.cost.find(term => term.code === 'static-protection-baseline')!.value)
      .toBeCloseTo(utility.benefit[0]!.value * forceSuccessProbability(1.3, 1));
    expect(utility.cost.some(term => term.code === 'force-time')).toBe(false);
    const zero = defenseMethodProvider.quote({ ...input, unitIds: [] });
    expect(zero.status).toBe('feasible');
    expect(zero.utility!.score).toBeCloseTo(0);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('does not reuse an incumbent risk discount and charges only the collector actual alternative', () => {
    const input = defendedPost(), original = defenseMethodProvider.quote(input);
    const changed: DecisionFacts<Situation> = { ...input.situation, lands: input.situation.lands.map(land => ({ ...land,
      threats: land.threats.map(threat => ({ ...threat, lossProbability: .99, friendlyOnStationStrength: 1000 })) })) };
    expect(defenseMethodProvider.quote({ ...input, situation: changed }).utility).toEqual(original.utility);
    const free = defenseMethodProvider.quote({ ...input, valuation: { phase: 'net',
      opportunity: request => quoteOpportunityCost(request.window, []) } });
    const busy = defenseMethodProvider.quote({ ...input, valuation: { phase: 'net',
      opportunity: request => quoteOpportunityCost(request.window, [{ objectiveId: 'other-post', unitIds: input.unitIds,
        withResourcesGold: 1000, withoutResourcesGold: null, withoutResourcesStatus: 'not-runnable', committed: false }]) } });
    expect(free.status).toBe('feasible');
    expect(busy.status).toBe('feasible');
    expect(free.utility!.score - busy.utility!.score).toBeCloseTo(1000);
    expect(busy.utility!.score).toBeLessThan(0);
  });
});
