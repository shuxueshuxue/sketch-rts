import { buildAiPlanTrace } from '../ai/plan-trace';
import { createGame, snapshotGame } from '../shared/sim';
import type { AiPlanTrace } from '../ai/plan-trace';
import type { AllocationEvent, AllocationReason, StrategyAllocationTrace } from '../ai/strategy/allocation-types';
import type { Method, Objective, StrategyPlanTrace } from '../ai/strategy/types';

/** Synthetic contract fixture, not evidence of an allocator making these decisions in a match. */
export function strategyFixture() {
  const game = createGame('bareDuel', { aiPlayers: ['player'] }), snapshot = snapshotGame(game);
  const base = buildAiPlanTrace(snapshot, 'player', { jobs: [], unitClaims: {} }, 'v9_archer');
  const owned = snapshot.units.filter(unit => unit.owner === 'player'), first = owned[0]!, second = owned[1]!;
  const reason: AllocationReason = { code: 'fixture-defense-urgent', factIds: ['threat-1'], values: { incoming: 12 } };
  const action = { actionId: 'defend-action', generation: 1 };
  const target = { entityId: snapshot.buildings.find(building => building.owner === 'player')!.id,
    point: { x: first.x + 100, y: first.y + 100 }, landId: 'land:1' as const };
  const utility = { benefit: [{ code: 'avoid-loss', value: 200, explanation: 'Protect the recorded site' }],
    cost: [{ code: 'travel', value: 20, explanation: 'Travel opportunity cost' }], successProbability: .8,
    persistenceBonus: 4, score: 144, horizonTicks: 1200, evidence: [] };
  const quote: Objective = { id: 'defense', kind: 'DefendSite', owner: 'player', target, effects: [
    { kind: 'site-safe', siteId: target.entityId, throughTick: 1200 }], utility, status: 'active', sinceTick: 0, rank: 1,
    reasons: [{ code: reason.code, detail: '据点有入侵威胁', evidence: [] }], methodIds: ['local-defense'],
    stability: { minimumStayUntilTick: 100, challengerId: null, challengerThinks: 0 } };
  const method: Method = { id: 'local-defense', objectiveId: quote.id, kind: 'local-squad', preconditions: [],
    subgoals: [], demands: [], estimatedTicks: 100, status: 'selected', reasons: [] };
  const events: AllocationEvent[] = [
    { id: 'event-1', tick: 10, revision: 1, objectiveId: 'defense', methodId: method.id, action, reason,
      kind: 'progress', progress: 'garrison-arrived', unitIds: [first.id], entityIds: [target.entityId] },
    { id: 'event-2', tick: 20, revision: 2, objectiveId: 'defense', methodId: method.id, action, reason,
      kind: 'preempted', quotation: { fromObjectiveId: 'island', toObjectiveId: 'defense',
        resourceKeys: [`unit:${first.id}`], marginalBenefitGold: 60, displacedLossGold: 25, switchingCostGold: 8, reason }, handoff: 'pause' },
    { id: 'event-3', tick: 30, revision: 3, objectiveId: 'defense', methodId: method.id, action, reason,
      kind: 'assignment-stage', assignmentId: 'defender', from: 'en-route', to: 'on-station' },
    { id: 'event-4', tick: 40, revision: 4, objectiveId: 'defense', methodId: method.id, action, reason,
      kind: 'interrupted', assignmentId: 'defender', vacancyId: 'replacement' },
  ];
  const allocation: StrategyAllocationTrace = {
    revision: 4, objectives: [{ objectiveId: quote.id, methodId: method.id, target, effectKeys: ['site-safe'], status: 'active',
      actionIds: [action.actionId], assignmentIds: ['defender'], budgetIds: ['hall-spend'], sinceTick: 0,
      minimumStayUntilTick: 100, challengerId: null, challengerThinks: 0, committedUtilityGold: 120, force: null },
    { objectiveId: 'island', methodId: 'island-method', target: { point: { x: target.point.x + 500, y: target.point.y } },
      effectKeys: [], status: 'paused', actionIds: [], assignmentIds: [], budgetIds: [], sinceTick: 0,
      minimumStayUntilTick: 100, challengerId: 'defense', challengerThinks: 1, committedUtilityGold: 25, force: null }],
    assignments: [{ authority: 'committed', id: 'defender', leaseId: 'lease-one', unitId: first.id, role: 'worker',
      objectiveId: quote.id, methodId: method.id, action, target, stage: 'on-station',
      eta: { status: 'known', forecastTick: 0, arrivalTick: 25 }, lastLocation: { kind: 'land', landId: 'land:1', point: { x: first.x, y: first.y } },
      interruption: { kind: 'worker-safety', executor: 'workerSafety', sinceTick: 40, resumeStage: 'on-station', vacancyId: 'replacement' } }],
    executions: [{ token: action, objectiveId: quote.id, methodId: method.id, executor: 'fixture-defense',
      intent: { kind: 'defend-site' }, target, dependsOn: [], completionEffects: quote.effects,
      status: 'blocked', phase: 'gather', sinceTick: 0, lastProgressTick: 30, state: {} }],
    budget: [{ id: 'hall-spend', spendId: 'one-site', objectiveId: quote.id, methodId: method.id, action,
      amountGold: 200, paidGold: 50, state: 'reserved', sinceTick: 0, releasedTick: null, includedUtilityTermCodes: ['travel'], externalReservationIds: [] }],
    voyages: [], vacancies: [{ id: 'replacement', objectiveId: quote.id, action, assignmentId: 'defender', sinceTick: 40,
      demand: { kind: 'workers', count: 1, at: target }, replacementAssignmentIds: [], reason }],
    unmet: [{ id: 'unmet-gold', objectiveId: quote.id, methodId: method.id, action, demand: { kind: 'gold', amount: 80 }, reason }],
    blocked: [{ id: 'blocked-parent', parent: action, objectiveId: quote.id, methodId: method.id,
      interruptedCommandId: 'command-1', interruptedExecutor: 'workerSafety', interruptedTick: 40, interruptedUnitId: first.id,
      actualInterruptedOrder: { type: 'move', x: first.x, y: first.y }, heldLeaseIds: ['lease-one'], unpaidBudgetIds: ['hall-spend'],
      obstacles: [{ kind: 'camp', memberIds: ['creep-1'], point: target }],
      missingPreconditions: [{ id: 'shore-safe', kind: 'shore-safe', status: 'unmet', reason,
        demand: { kind: 'workers', count: 1, at: target }, subgoalIds: [] }],
      potentialUtility: null, alternatives: [], reason: { executor: 'workerSafety', outcome: 'blocked', reason: 'fixture-camp-blocked' } }],
    events, budgetProjection: [],
  };
  const strategy: StrategyPlanTrace = {
    schemaVersion: 1, tick: 50, owner: 'player', mode: 'control', allocation,
    situation: { tick: 50, owner: 'player', horizonTicks: 1200, lands: [], seas: [], assets: [], units: [], opportunities: [],
      economy: { cashGold: base.bank.gold, predictedIncomeGold: 0, horizonTicks: 1200, ledger: [] }, limitations: [] },
    objectives: [quote, { ...quote, id: 'island', kind: 'ConquerIsland' },
      { ...quote, id: 'candidate-only', status: 'candidate', utility: { ...utility, score: null } }],
    feasibleObjectiveIds: [quote.id], blockedObjectives: [], methods: [method],
    assignments: [{ id: 'observed-task', objectiveId: 'candidate-only', methodId: null, unitId: second.id, role: 'worker', target,
      sinceTick: 0, minimumStayUntilTick: 0, arrival: { status: 'unknown', reason: { code: 'fixture-unknown', detail: '路线未记录', evidence: [] } },
      authority: 'observed', evidence: [], stage: 'assigned' }],
    preemptions: [], budget: [], idleForces: [], limitations: [],
  };
  const trace: AiPlanTrace = { ...base, tick: 50, strategy };
  return { game, snapshot, trace, strategy, allocation, events, first, second };
}
