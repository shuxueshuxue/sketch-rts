import { GOLD_MINE_RULES } from '../../shared/mining';
import { groundSteeringRoute, nearestByRoute } from '../../shared/route-selection';
import type { Building, GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyMemory, WorkerEvacuation } from '../memory';
import { activeUnitClaim, recordUnitTaskClaim } from '../policy/claims';
import { distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { armedFoes, retreatLandRoad, safeLandTravelTicks } from './safe-land-route';
import { miningJobOrder } from './mining-jobs';
import { workerExposure } from '../situation/worker-exposure';
import { issuedUnitRoad } from '../policy/unit-action';
import { mineClaimedByAlly } from '../policy/mine-claims';

type WorkerSafetyPlan = { worker: Unit; released: boolean; state: WorkerEvacuation; commands: GameCommand[] };
const proposals = new WeakMap<AiPolicyMemory, { tick: number; plans: WorkerSafetyPlan[] }>();
type Threat = Unit | Building;
const ARRIVAL = 80;

function endangered(snapshot: GameSnapshot, worker: Unit, point: { x: number; y: number }, foes: Threat[]) {
  return workerExposure(snapshot, worker, point, { foes }).length > 0;
}

function evacuation(snapshot: GameSnapshot, owner: PlayerId, worker: Unit, foes: Threat[], options: AiPolicyContext) {
  const posts = snapshot.buildings.filter(post => post.owner === owner && post.complete && post.hp >= post.maxHp * .5
    && (post.kind === 'townHall' || post.kind === 'defenseTower'));
  const shelters = posts.flatMap(post => {
    const nearest = foes.slice().sort((a, b) => distance(a, post) - distance(b, post))[0];
    const gap = nearest ? distance(nearest, post) : 0;
    const depth = post.radius + worker.radius + ARRIVAL;
    const goal = gap ? { x: post.x + (post.x - nearest!.x) * depth / gap,
      y: post.y + (post.y - nearest!.y) * depth / gap } : post;
    const points = groundSteeringRoute(snapshot.map, worker, goal), point = points[points.length - 1]!;
    if (distance(point, goal) > ARRIVAL || endangered(snapshot, worker, point, foes)) return [];
    const road = retreatLandRoad(snapshot, worker, point, foes);
    return road ? [{ point, ticks: road.ticks }] : [];
  }).sort((a, b) => a.ticks - b.ticks);
  const shelter = shelters[0]?.point;
  if (!shelter) return undefined;
  const mines = snapshot.resources.filter(mine => mine.amount > 0 && !mineClaimedByAlly(snapshot, owner, mine, options)
    && posts.some(post => post.kind === 'townHall' && distance(post, mine) <= GOLD_MINE_RULES.baseRange)
    && !endangered(snapshot, worker, mine, foes));
  const safeMine = nearestByRoute(snapshot.map, mines.filter(mine =>
    safeLandTravelTicks(snapshot, { ...worker, ...shelter }, mine, foes) !== undefined), shelter, 'land');
  return { shelter, ...(safeMine ? { safeResourceId: safeMine.id } : {}) };
}

/** Workers need a retreat even when their hall stands, their mine is spent, or no soldier can rescue them. */
export function workerSafetyPlans(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): WorkerSafetyPlan[] {
  const foes = armedFoes(snapshot, owner, options).filter(foe => !('order' in foe && foe.deck));
  const workers = snapshot.units.filter(worker => worker.owner === owner && worker.kind === 'worker' && !worker.deck
    && !worker.garrison && worker.order.type !== 'board');
  return workers.flatMap<WorkerSafetyPlan>(worker => {
    const claim = activeUnitClaim(snapshot, owner, worker, options);
    const previous = claim?.kind === 'workerSafety' ? claim.evacuation : undefined;
    // The hauling escort below handles melee interception. Ranged fire needs an immediate withdrawal,
    // even with a standing hall or a friendly army nearby; neither stops a volley hitting the workers.
    const escaping = worker.order.type === 'move' && worker.order.avoidCombat
      || worker.order.type === 'idle' && worker.orderQueue?.[0]?.type === 'move' && worker.orderQueue[0].avoidCombat;
    const exposed = workerExposure(snapshot, worker, escaping ? issuedUnitRoad(snapshot, worker) : worker,
      { foes, starting: !previous, allowDeparture: !!escaping }).length > 0;
    if (!previous && !exposed) return [];
    const job = miningJobOrder(worker);
    const origin = previous?.origin ?? { x: worker.x, y: worker.y };
    const resourceId = previous?.resourceId ?? job?.resourceId;
    const original = snapshot.resources.find(mine => mine.id === resourceId && mine.amount > 0);
    const released = previous && !exposed && !endangered(snapshot, worker, original ?? origin, foes);
    if (released) {
      const commands: GameCommand[] = !claim?.interruption && original && !mineClaimedByAlly(snapshot, owner, original, options)
        ? [{ type: 'mine', unitIds: [worker.id], resourceId: original.id }] : [];
      return [{ worker, released: true, state: previous, commands }];
    }
    const safeMine = snapshot.resources.find(mine => mine.id === previous?.safeResourceId && mine.amount > 0);
    const existing = previous && !endangered(snapshot, worker, previous.shelter, foes)
      && (!previous.safeResourceId || safeMine && !endangered(snapshot, worker, safeMine, foes));
    const destination = existing ? previous : evacuation(snapshot, owner, worker, foes, options);
    if (!destination) return [];
    const state: WorkerEvacuation = { origin, ...(resourceId ? { resourceId } : {}), ...destination };
    const commands: GameCommand[] = [];
    if (!(state.safeResourceId && job?.resourceId === state.safeResourceId && !exposed)) {
      const walking = [worker.order, ...(worker.orderQueue ?? [])].some(order => order.type === 'move' && order.avoidCombat
        && distance(order, state.shelter) <= ARRIVAL / 2);
      if (distance(worker, state.shelter) > ARRIVAL) {
        if (!walking) {
          commands.push({ type: 'move', unitIds: [worker.id], ...state.shelter, avoidCombat: true });
          if (state.safeResourceId) commands.push({ type: 'mine', unitIds: [worker.id], resourceId: state.safeResourceId, queued: true });
        }
      } else if (state.safeResourceId) commands.push({ type: 'mine', unitIds: [worker.id], resourceId: state.safeResourceId });
      else if (worker.order.type !== 'idle' && !walking)
        commands.push({ type: 'move', unitIds: [worker.id], x: worker.x, y: worker.y, avoidCombat: true });
    }
    return [{ worker, released: false, state, commands }];
  });
}

export function planWorkerSafety(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext,
  plans = workerSafetyPlans(snapshot, owner, options)) {
  proposals.set(options.memory, { tick: snapshot.tick, plans });
  return plans.flatMap(plan => plan.commands);
}

export function recordWorkerSafetyAcceptedCommands(snapshot: GameSnapshot, _owner: PlayerId, options: AiPolicyContext, commands: readonly GameCommand[]) {
  const proposal = proposals.get(options.memory);
  if (!proposal || proposal.tick !== snapshot.tick) return;
  const issued = new Set(commands.flatMap(command => 'unitIds' in command ? command.unitIds : []));
  for (const plan of proposal.plans) if (!plan.released && issued.has(plan.worker.id)) {
    recordUnitTaskClaim(snapshot, options.memory, plan.worker.id, { kind: 'workerSafety', targetId: plan.worker.id,
      x: plan.state.shelter.x, y: plan.state.shelter.y, evacuation: plan.state });
  }
}

export function finishWorkerSafetyPlans(snapshot: GameSnapshot, _owner: PlayerId, options: AiPolicyContext) {
  const proposal = proposals.get(options.memory); proposals.delete(options.memory);
  if (!proposal || proposal.tick !== snapshot.tick) return;
  for (const plan of proposal.plans) if (plan.released && options.memory.unitClaims[plan.worker.id]?.kind === 'workerSafety') {
    if (!options.memory.unitClaims[plan.worker.id]?.interruption) delete options.memory.unitClaims[plan.worker.id];
  }
}
