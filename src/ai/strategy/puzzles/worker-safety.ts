import { NEUTRAL_DAMAGE_RESPONSE_RANGE, NEUTRAL_LEASH_RANGE, NEUTRAL_RETURN_STOP_RANGE, unitAutoAcquireRadius } from '../../../shared/combat-acquisition';
import { strikeGap, strikeReach } from '../../../shared/combat-geometry';
import { automaticTargetAllowed } from '../../../shared/combat-target';
import { canReach } from '../../../shared/naval';
import { isInCabin } from '../../../shared/ship-cabin';
import { observeSimulation, type Game } from '../../../shared/sim';
import type { SimulationDamageEvent, SimulationRemovalEvent } from '../../../shared/sim/observation';
import type { GameSnapshot } from '../../../shared/types';
import { readGoalIntent } from '../goal-authority-references';
import type { PuzzleExecutionObservation } from './planner-binding';

type Exposure = { tick: number; workerId: string; campMemberId: string;
  mode: 'idle-alert' | 'active-pursuit'; gap: number; radius: number; worker: { x: number; y: number } };
const canonical = (value: unknown): string => JSON.stringify(value, (_, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);

/** Consume only the original same-think trace. The logical mine and exact
 * construction site are distinct obligations; neither a safe beach nor a
 * future met observation proves them. A missing proof remains a failure. */
export function readAcceptedHallSafety(snapshot: GameSnapshot, observation: PuzzleExecutionObservation) {
  const rows = [];
  for (const admission of observation.allocation.commandAdmissions ?? []) {
    if (admission.status !== 'accepted' || admission.executor !== 'goal.build' || !admission.action) continue;
    const execution = observation.allocation.executions.find(e => e.token.actionId === admission.action!.actionId
      && e.token.generation === admission.action!.generation);
    if (!execution || execution.intent.kind !== 'goal-action') throw Error('Accepted build has no original goal execution');
    const intent = readGoalIntent(observation.allocation, execution.intent);
    if (intent.parameters.buildingKind !== 'townHall') continue;
    const candidates = observation.output.plans.filter(p => p.goal.id === intent.goalId);
    const plan = candidates.find(p => p.actions.some(a => a.declaration.kind === 'build'
      && canonical(a.declaration.executor.parameters) === canonical(intent.parameters)));
    const node = plan?.actions.find(a => a.declaration.kind === 'build'
      && canonical(a.declaration.executor.parameters) === canonical(intent.parameters));
    const logical = plan?.goal.effects.find(f => f.predicate.kind === 'hall-complete')?.predicate;
    const targets = [logical?.kind === 'hall-complete' ? logical.at : undefined, intent.parameters.at];
    const proofs = targets.map((target, index) => {
      const fact = target === undefined ? undefined : node?.declaration.preconditions.find(f => f.predicate.kind === 'site-safe'
        && canonical(f.predicate.site) === canonical(target));
      const predicate = fact?.predicate;
      const observed = fact ? plan?.facts.find(f => f.id === fact.id)?.observation : undefined;
      const window = fact ? node?.declaration.preconditionWindows?.find(w => w.factId === fact.id) : undefined;
      return { role: index === 0 ? 'logical-mine' : 'exact-build-site', target, fact, observation: observed, window,
        passed: !!fact && predicate?.kind === 'site-safe' && window?.through === 'finish'
          && predicate.throughTick === node?.finishTick && observed?.state === 'met'
          && observed.observedTick === snapshot.tick && typeof observed.availableTick === 'number'
          && observed.availableTick <= snapshot.tick };
    });
    rows.push({ tick: snapshot.tick, token: execution.token, command: admission.command,
      passed: proofs.every(p => p.passed), proofs });
  }
  return rows;
}

/** A test observer, never a planner fact or a command producer. The pursuit
 * zone is a conservative protection requirement, not a claim that native
 * target selection will switch to the worker. Returning creeps do not acquire
 * throughout a 650-radius disk; the native reset branch runs first. */
export function observePuzzleWorkerSafety(game: Game, owner: string) {
  const campIds = new Set(game.units.filter(u => u.owner === 'neutral').map(u => u.id));
  const workerIds = new Set<string>();
  const damage: SimulationDamageEvent[] = [], deaths: SimulationRemovalEvent[] = [];
  const firstExposures = new Map<string, Exposure>();
  let samples = 0, exposedSamples = 0;
  const dispose = observeSimulation(game, {
    damage(event) {
      if (event.target.owner === owner && event.target.kind === 'worker' && event.damage > 0
        && (campIds.has(event.source.id) || event.source.owner === 'neutral')) damage.push(event);
    },
    removed(event) {
      if (event.unit.owner === owner && event.unit.kind === 'worker' && event.reason === 'death') deaths.push(event);
    },
  });
  function sample() {
    samples++;
    const workers = game.units.filter(u => u.owner === owner && u.kind === 'worker' && u.hp > 0);
    for (const worker of workers) workerIds.add(worker.id);
    const exposed: Exposure[] = [];
    for (const guard of game.units.filter(u => u.owner === 'neutral' && u.hp > 0 && u.attackDamage > 0)) {
      campIds.add(guard.id);
      const home = { x: guard.homeX ?? guard.x, y: guard.homeY ?? guard.y }, order = guard.order;
      const returning = order.type === 'move' && Math.hypot(order.x - home.x, order.y - home.y) <= NEUTRAL_RETURN_STOP_RANGE;
      if (returning || order.type !== 'idle' && order.type !== 'attack') continue;
      const origin = order.type === 'attack' ? { x: order.leashX ?? home.x, y: order.leashY ?? home.y } : guard;
      for (const worker of workers) {
        if (isInCabin(worker) || !automaticTargetAllowed(game.units, guard.owner, worker)) continue;
        const active = order.type === 'attack';
        const gap = active ? Math.hypot(worker.x - origin.x, worker.y - origin.y) : strikeGap(guard, worker);
        const radius = active ? NEUTRAL_DAMAGE_RESPONSE_RANGE : strikeReach(guard, worker, unitAutoAcquireRadius(game, guard, 'idle'));
        if (gap > radius || active && Math.hypot(guard.x - home.x, guard.y - home.y) > NEUTRAL_LEASH_RANGE
          || !canReach(game.map, guard, worker, game.units)) continue;
        const row = { tick: game.tick, workerId: worker.id, campMemberId: guard.id,
          mode: active ? 'active-pursuit' as const : 'idle-alert' as const, gap, radius, worker: { x: worker.x, y: worker.y } };
        exposed.push(row);
        const key = `${worker.id}:${guard.id}:${row.mode}`;
        if (!firstExposures.has(key)) firstExposures.set(key, row);
      }
    }
    if (exposed.length) exposedSamples++;
    return { tick: game.tick, workers: workers.map(u => ({ id: u.id, hp: u.hp, x: u.x, y: u.y,
      carrier: u.deck?.shipId ?? u.cabin?.shipId ?? null })), exposed };
  }
  return { sample, dispose, finish() {
    return { passed: exposedSamples === 0 && damage.length === 0 && deaths.length === 0,
      samples, exposedSamples, workerIds: [...workerIds].sort(), campMemberIds: [...campIds].sort(),
      firstExposures: [...firstExposures.values()], campDamage: damage, workerDeaths: deaths,
      scope: 'Every sampled native tick. Idle native alert/reach and active native leash/response envelope; returning is not idle. All positive neutral-source damage, including residual sources, and all worker deaths are separate native events. This observer does not supply planner safety facts.' };
  } };
}
