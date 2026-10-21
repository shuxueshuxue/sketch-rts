import type { GoalActionNode, GoalPlan } from '../goal-planner-types';
import { goalValueKey } from '../goal-facts';

type SelectedPlan = Pick<GoalPlan, 'actions' | 'edges'> & {
  goal: Pick<GoalPlan['goal'], 'id'>;
  facts: readonly Pick<GoalPlan['facts'][number], 'id' | 'producerActionIds'>[];
};
type Output = { plans: readonly SelectedPlan[] };

function participants(node: GoalActionNode, indices: ReadonlyMap<string, number>) {
  const result = new Set<string>();
  const visit = (value: unknown, key = ''): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && /^(unitIds|dependentUnitIds|loadedUnitIds|memberIds)$/.test(key)) result.add(`existing:${item}`);
        else visit(item, key);
      }
    } else if (value && typeof value === 'object') {
      const ref = value as Record<string, unknown>;
      if (ref.kind === 'existing') result.add(`existing:${ref.entityId}`);
      else if (ref.kind === 'output') result.add(`output:${indices.get(String(ref.actionId)) ?? 'external'}:${ref.output}`);
      else if (ref.kind === 'pool-member') result.add(`pool:${ref.unitKind}:${ref.slot}`);
      else if (ref.kind === 'binding') result.add(`binding:${ref.name}`);
      for (const [name, item] of Object.entries(ref)) visit(item, name);
    }
  };
  visit(node.declaration.executor.parameters);
  visit(node.declaration.demands);
  return [...result].sort();
}

/** Compare chosen action order, actors and causal/resource predecessors.
 * IDs encode coordinates and times, so use their positions in the selected
 * action list. Fact nodes are collapsed to their selected action producers.
 * Rejected alternatives, publication state, quotes and numeric refinements
 * are observations of a plan, not a different choice of actions. */
function planStructure(plan: SelectedPlan) {
  const indices = new Map(plan.actions.map((node, index) => [node.id, index]));
  const facts = new Map(plan.facts.map(node => [node.id, node]));
  const predecessors = plan.actions.map(node => {
    const ids = new Set(node.dependsOnActionIds);
    for (const factId of node.prerequisiteFactIds) for (const id of facts.get(factId)?.producerActionIds ?? []) ids.add(id);
    for (const edge of plan.edges) {
      if (edge.to === node.id && indices.has(edge.from)) ids.add(edge.from);
      if (edge.to === node.id && facts.has(edge.from)) {
        for (const producer of plan.edges) if (producer.to === edge.from && indices.has(producer.from)) ids.add(producer.from);
      }
    }
    return [...new Set([...ids].filter(id => id !== node.id).map(id => indices.get(id) ?? 'external'))]
      .sort((a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
  });
  return { goal: plan.goal.id, actions: plan.actions.map((node, index) => ({
    kind: node.declaration.kind, executor: node.declaration.executor.executor,
    unitKind: node.declaration.executor.parameters.unitKind,
    buildingKind: node.declaration.executor.parameters.buildingKind,
    participants: participants(node, indices), predecessors: predecessors[index],
  })) };
}

export function puzzlePlanStructure(output: Output) { return output.plans.map(planStructure); }
export function puzzlePlanStructureKey(output: Output) { return goalValueKey(puzzlePlanStructure(output)); }

function numbers(output: Output) {
  const values: Record<string, number> = {};
  const visit = (value: unknown, path: string): void => {
    if (typeof value === 'number' && Number.isFinite(value)) values[path] = value;
    else if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}[${index}]`));
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) visit(item, `${path}.${key}`);
  };
  output.plans.forEach((plan, p) => plan.actions.forEach((node, a) => {
    const path = `plans[${p}].actions[${a}]`;
    visit({ startTick: node.startTick, finishTick: node.finishTick,
      duration: node.declaration.duration, cost: node.declaration.cost,
      successProbability: node.declaration.successProbability,
      parameters: node.declaration.executor.parameters }, path);
  }));
  return values;
}

/** Last-three structural verdict and numeric deltas, derived without facts,
 * geometry queries or simulation. Missing/new numeric fields remain null. */
export function comparePuzzlePlanWindow(outputs: readonly Output[]) {
  const structures = outputs.map(puzzlePlanStructureKey), observations = outputs.map(numbers);
  const paths = [...new Set(observations.flatMap(values => Object.keys(values)))].sort();
  const numericChanges = paths.flatMap(path => {
    const values = observations.map(observation => observation[path] ?? null);
    if (values.every(value => value === values[0])) return [];
    const known = values.filter((value): value is number => value !== null);
    return [{ path, values, range: known.length ? Math.max(...known) - Math.min(...known) : null }];
  });
  return { stable: outputs.length === 3 && structures.every(key => key === structures[0]), structures, numericChanges };
}
