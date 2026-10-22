import type { GoalActionNode, GoalPlan, GoalPlannerOutput } from '../ai/strategy/goal-planner-types';
import { goalFact } from '../ai/strategy/goal-facts';
import { strategyFixture } from './ai-plan-strategy.test-fixture';

/** UI-only artificial graph. It is not a planner result from a real match. */
export function goalDependencyFixture() {
  const fixture = strategyFixture(), target = fixture.strategy.objectives[0]!.target;
  const safe = goalFact({ kind: 'site-safe', site: target, throughTick: 1200 });
  const route = goalFact({ kind: 'route', mover: 'land', from: target,
    to: { ...target, point: { x: target.point.x + 100, y: target.point.y } } });
  const reason = { code: 'fixture-await-route', factIds: [route.id], values: { required: 6 } };
  const action: GoalActionNode = { id: 'defend-node', declaration: { id: 'defend-declaration', kind: 'defend',
    preconditions: [route], effects: [{ fact: safe, operation: 'establish', at: 'finish' }], demands: [], flows: [],
    duration: { state: 'met', value: 80, factIds: [route.id] }, cost: { state: 'met', value: [], factIds: [] },
    successProbability: { state: 'met', value: .9, factIds: [] }, executor: { executor: 'planned-defense', parameters: {} },
    outputs: [], reasons: [reason] }, prerequisiteFactIds: [route.id], dependsOnActionIds: [], startTick: 80, finishTick: 160,
    state: 'waiting-facts', allocation: { objectiveId: 'defense', methodId: 'local-defense', actionId: 'defend-action', generation: 2 }, reasons: [reason] };
  const plan: GoalPlan = { id: 'defense-plan', goal: { id: 'defense', owner: 'player', effects: [safe], rewardGold: 200,
    deadlineTick: 1200, reasons: [reason] }, status: 'waiting-facts', observedTick: fixture.trace.tick,
    facts: [{ id: safe.id, observation: { fact: safe, state: 'unmet', observedTick: 50, revision: 'safe-1', reason, evidence: [] }, producerActionIds: [action.id] },
      { id: route.id, observation: { fact: route, state: 'pending', observedTick: 50, revision: 'route-1', reason, evidence: [],
        requestId: 'route-request', requestedTick: 40 }, producerActionIds: [] }], actions: [action],
    edges: [{ from: action.id, to: safe.id, kind: 'establishes' }, { from: action.id, to: route.id, kind: 'requires' }],
    subgoals: [{ id: 'route-subgoal', factId: route.id, parentGoalId: 'defense', requestedByActionIds: [action.id],
      state: 'pending', chosenActionId: null, alternativeIds: [] }],
    alternatives: [{ id: 'candidate-recall', factId: safe.id, actionId: action.id, status: 'chosen', costGold: 20, finishTick: 160, reason },
      { id: 'candidate-far', factId: safe.id, actionId: 'recall-distant', status: 'rejected', costGold: null, finishTick: null,
        declaration: { ...action.declaration, id: 'far-assembly-declaration', kind: 'assemble',
          executor: { executor: 'distant-assembly', parameters: { origin: 'far-shore' } } },
        reason: { code: '<img src=x onerror=1>', factIds: [], values: { reason: 'route-missing' } } }], readyActionIds: [],
    resourceTimeline: [{ actionId: action.id, tick: 80, resource: { kind: 'gold' }, before: 10, delta: -5, after: 5 }],
    costGold: 20, successProbability: null, valueGold: null, completedTick: null,
    search: { expansions: 4, depth: 3, work: 4, limitReason: 'fact-pending' }, reasons: [reason] };
  const output: GoalPlannerOutput = { plans: [plan], readyActions: [], cache: { version: 1, owner: 'player', entries: [{
    goalKey: 'defense', declarationRevision: 'fixture', dependencies: [{ factId: route.id, revision: 'route-1', state: 'pending' }], plan }] } };
  return { ...fixture, safe, route, action, plan, output, trace: { ...fixture.trace, goalPlanner: output } };
}
