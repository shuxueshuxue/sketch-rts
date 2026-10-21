import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { createAiPolicyMemory } from '../memory';
import { withGoalPlannerInput } from './goal-planner-input';
import { planGoals } from './goal-planner';
import type { GoalRefinementChange } from './goal-plan-refinement';
import { goalValueKey } from './goal-facts';

const directory = new URL('./__fixtures__/goal-convergence/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8')) as {
  entries: { name: string; owner: string; file: string; gzipSha256: string; snapshotSha256?: string; tick: number }[];
};
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const summarize = (change: GoalRefinementChange) => ({ ...change,
  actionId: { digest: digest(change.actionId), value: change.actionId.slice(0, 160) },
  sourceRevision: change.sourceRevision === undefined ? null : digest(change.sourceRevision),
  currentSourceRevision: change.currentSourceRevision === undefined ? null : digest(change.currentSourceRevision),
  proposalRevision: digest(change.proposalRevision),
  selected: change.selected.map(choice => ({ ...choice, effectId: choice.effectId?.slice(0, 160) })),
});
// Native publications can be consumed one think after the queue publishes
// them. Include the actual stored proof even when no world reader asks for it
// in that same callback (for example selected berth preparation).
function publishedSources(memory: any, sequence: number) {
  const values = new Map<string, string>(), goal = memory.goalPlanning, observation = memory.strategy?.observation;
  const add = (id: string, proof: unknown, readyThink?: number) => values.set(id,
    goalValueKey([proof, readyThink === undefined || readyThink < sequence ? 'available' : 'queued-for-next-think']));
  for (const row of goal?.geometry?.entries ?? []) if (row.readyTick !== null && row.readyTick !== undefined)
    add(`goal-geometry:${goalValueKey([row.key, row.revision])}`, row.value, row.readyThink);
  for (const row of goal?.selectedBerths?.entries ?? []) if (row.answer.state !== 'pending') add(row.id, row.answer);
  for (const row of goal?.voyageRisk?.publications ?? []) add(row.id, [
    goal.voyageRisk.model.entries.find((entry: any) => entry.id === row.id),
    goal.voyageRisk.model.nativeRoutes?.find((entry: any) => entry.id === row.id)], row.readyThink);
  for (const row of observation?.pointRoutes?.entries ?? []) if (row.readyTick !== null && row.readyTick !== undefined)
    add(`point:${row.id}`, [row.key, row.state?.result], row.readyThink);
  for (const mover of ['land', 'sea']) for (const row of observation?.fields?.[mover] ?? [])
    if (row.readyTick !== null && row.readyTick !== undefined) add(`field:${mover}:${goalValueKey(row.goal)}`, row.geometryVersion, row.readyThink);
  return values;
}

/** These are convergence verdicts, not puzzle-solution or SDK execution verdicts.
 * All 20 native scopes share the original world. Actual runtime cases start
 * with the recorded memoryBefore; cold cases start with ordinary fresh memory. */
it.each(manifest.entries.filter(entry => !process.env.SKETCH_GOAL_CONVERGENCE_CASE
  || entry.name === process.env.SKETCH_GOAL_CONVERGENCE_CASE))('frozen revisions converge: $name', entry => {
  const bytes = readFileSync(new URL(entry.file, directory)); expect(digest(bytes)).toBe(entry.gzipSha256);
  const parsed = JSON.parse(gunzipSync(bytes).toString()), snapshot = parsed.snapshot ?? parsed;
  let memory = parsed.memoryBefore ?? createAiPolicyMemory();
  const original = JSON.stringify(snapshot); expect(snapshot.tick).toBe(entry.tick);
  if (entry.snapshotSha256) expect(digest(original)).toBe(entry.snapshotSha256);
  const publications = new Set<string>(), facts = new Set<string>();
  const sourcePublications = new Set([...publishedSources(memory, memory.strategy?.observation?.thinkSequence ?? 0)]
    .map(pair => goalValueKey(pair))), unconsumed = new Map<string, { id: string; state: string; reason: string }>();
  const rows: unknown[] = [], failures: unknown[] = [];
  let previousDeclaration: string | undefined;
  for (let think = 1; think <= 20; think++) {
    const changes: GoalRefinementChange[] = [], newFacts = new Map<string, { id: string; state: string; reason: string }>();
    const sequence = (memory.strategy?.observation?.thinkSequence ?? 0) + 1;
    const capturePublications = () => {
      for (const [id, revision] of publishedSources(memory, sequence)) {
        const key = goalValueKey([id, revision]);
        if (!sourcePublications.has(key)) newFacts.set(key, { id, state: 'published', reason: 'native-stored-proof-published' });
        sourcePublications.add(key);
      }
    };
    capturePublications();
    const before = { refinement: memory.goalPlanning?.refinements?.revision ?? 0,
      berths: memory.goalPlanning?.selectedBerths?.revision ?? 0 };
    const output = withGoalPlannerInput({ snapshot, owner: entry.owner, version: 'v9_knight', memory,
      onRefinementRevision: change => changes.push(change),
      onFactObservation(observed, view) {
        if (observed.state === 'pending') return;
        const key = goalValueKey([view, observed.fact.id, observed.state, observed.revision]);
        if (!facts.has(key)) newFacts.set(key, { id: observed.fact.id, state: observed.state, reason: observed.reason.code });
        facts.add(key);
      },
    }, input => { const output = planGoals(input); memory.goalPlanning!.cache = output.cache; return output; });
    const after = { refinement: memory.goalPlanning!.refinements?.revision ?? 0,
      berths: memory.goalPlanning!.selectedBerths?.revision ?? 0 };
    capturePublications();
    for (const [id, fact] of newFacts) unconsumed.set(id, fact);
    for (const change of changes) if (change.reason === 'exact-quote-published' || change.reason === 'exact-proposal-disproved') {
      const key = goalValueKey([change.reason, change.proposalRevision, change.sourceRevision]);
      if (publications.has(key)) failures.push({ think, reason: 'same-exact-proof-republished', change: summarize(change) });
      publications.add(key);
    }
    if (think > 1 && unconsumed.size === 0 && (before.refinement !== after.refinement || before.berths !== after.berths))
      failures.push({ think, reason: 'revision-changed-without-new-fact-publication', before, after, changes: changes.map(summarize) });
    const declaration = digest(output.cache.declarationRevision ?? '');
    const declarationChanged = previousDeclaration !== undefined && previousDeclaration !== declaration;
    if (think > 1 && unconsumed.size === 0 && previousDeclaration !== declaration)
      failures.push({ think, reason: 'plan-declaration-revision-changed-without-new-fact-publication', before: previousDeclaration, after: declaration });
    previousDeclaration = declaration;
    const work = memory.strategy!.observation!.factWork!;
    expect(work.used).toBeLessThanOrEqual(6144); expect(work.tick).toBe(snapshot.tick);
    expect(JSON.stringify(snapshot)).toBe(original);
    rows.push({ think, before, after, changes: changes.map(summarize), publishedFacts: [...newFacts.values()],
      consumedPublications: (before.refinement !== after.refinement || before.berths !== after.berths || declarationChanged)
        ? [...unconsumed.values()] : [],
      declarationRevision: declaration,
      selected: output.plans.map(plan => ({ goal: plan.goal.id, status: plan.status,
        actions: plan.actions.map(node => ({ kind: node.declaration.kind, state: node.state, precision: node.declaration.precision })) })),
      work: work.used });
    if (before.refinement !== after.refinement || before.berths !== after.berths || declarationChanged) unconsumed.clear();
    memory = JSON.parse(JSON.stringify(memory));
  }
  // The final publication-free think must be a fixed point. Late native facts
  // may update a quote, but every such revision names the newly published fact.
  const last = rows.at(-1) as { before: { refinement: number; berths: number }; after: { refinement: number; berths: number }; publishedFacts: unknown[] };
  if (!last.publishedFacts.length && goalValueKey(last.after) !== goalValueKey(last.before))
    failures.push({ think: 20, reason: 'frozen-revisions-not-at-fixed-point', before: last.before, after: last.after });
  const report = { case: entry.name, snapshotSha256: digest(original), scope: '20 frozen native scopes, JSON memory continuation, no SDK or sim', rows, failures };
  if (process.env.SKETCH_GOAL_CONVERGENCE_EVIDENCE) {
    mkdirSync(process.env.SKETCH_GOAL_CONVERGENCE_EVIDENCE, { recursive: true });
    writeFileSync(`${process.env.SKETCH_GOAL_CONVERGENCE_EVIDENCE}/${entry.name.replaceAll('/', '-')}.json`, JSON.stringify(report));
  }
  expect(failures, JSON.stringify({ case: entry.name, failures, revisions: rows }, null, 2)).toEqual([]);
}, 600_000);
