import { GOLD_MINE_RULES } from '../../shared/mining';
import { groundSteeringRoute, nearestByRoute } from '../../shared/route-selection';
import type { Building, GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { armedFoes, retreatLandRoad, retreatThreatReach, safeLandTravelTicks } from './safe-land-route';
import { miningJobOrder } from './mining-jobs';
import { THINK_TICKS } from './mounted-micro';
import { mineClaimedByAlly } from '../policy/mine-claims';

type Evacuation = NonNullable<AiPolicyMemory['workerSafety']>[string];
type Threat = Unit | Building;
// Start before the next volley, with enough room for a worker to leave the firing lane.
const CLEARANCE = 160;
const ARRIVAL = 80;

function endangered(snapshot: GameSnapshot, worker: Unit, point: { x: number; y: number }, foes: Threat[]) {
  const patient = { ...worker, ...point };
  return foes.some(foe => {
    const reach = retreatThreatReach(snapshot, foe, patient, THINK_TICKS);
    return reach > 0 && distance(foe, point) <= reach + CLEARANCE;
  });
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
export function workerSafetyPlans(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const foes = armedFoes(snapshot, owner, options).filter(foe => !('order' in foe && foe.deck));
  const workers = snapshot.units.filter(worker => worker.owner === owner && worker.kind === 'worker' && !worker.deck
    && !worker.garrison && worker.order.type !== 'board');
  return workers.flatMap(worker => {
    const previous = options.memory.workerSafety?.[worker.id];
    // The hauling escort below handles melee interception. Ranged fire needs an immediate withdrawal,
    // even with a standing hall or a friendly army nearby; neither stops a volley hitting the workers.
    const exposed = endangered(snapshot, worker, worker, previous ? foes : foes.filter(foe => foe.attackRange > 80));
    if (!previous && !exposed) return [];
    const job = miningJobOrder(worker);
    const origin = previous?.origin ?? { x: worker.x, y: worker.y };
    const resourceId = previous?.resourceId ?? job?.resourceId;
    const original = snapshot.resources.find(mine => mine.id === resourceId && mine.amount > 0);
    const released = previous && !exposed && !endangered(snapshot, worker, original ?? origin, foes);
    if (released) {
      const commands: GameCommand[] = original && !mineClaimedByAlly(snapshot, owner, original, options)
        ? [{ type: 'mine', unitIds: [worker.id], resourceId: original.id }] : [];
      return [{ worker, released: true, state: previous, commands }];
    }
    const safeMine = snapshot.resources.find(mine => mine.id === previous?.safeResourceId && mine.amount > 0);
    const existing = previous && !endangered(snapshot, worker, previous.shelter, foes)
      && (!previous.safeResourceId || safeMine && !endangered(snapshot, worker, safeMine, foes));
    const destination = existing ? previous : evacuation(snapshot, owner, worker, foes, options);
    if (!destination) return [];
    const state: Evacuation = { origin, ...(resourceId ? { resourceId } : {}), ...destination };
    const commands: GameCommand[] = [];
    if (!(state.safeResourceId && job?.resourceId === state.safeResourceId && !exposed)) {
      const walking = worker.order.type === 'move' && worker.order.avoidCombat
        && distance(worker.order, state.shelter) <= ARRIVAL / 2;
      if (distance(worker, state.shelter) > ARRIVAL) {
        if (!walking) {
          commands.push({ type: 'move', unitIds: [worker.id], ...state.shelter, avoidCombat: true });
          if (state.safeResourceId) commands.push({ type: 'mine', unitIds: [worker.id], resourceId: state.safeResourceId, queued: true });
        }
      } else if (state.safeResourceId) commands.push({ type: 'mine', unitIds: [worker.id], resourceId: state.safeResourceId });
      else if (worker.order.type !== 'hold') commands.push({ type: 'holdPosition', unitIds: [worker.id] });
    }
    return [{ worker, released: false, state, commands }];
  });
}

export function planWorkerSafety(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext,
  plans = workerSafetyPlans(snapshot, owner, options)) {
  if (plans.length === 0 && !options.memory.workerSafety) return [];
  const memory = options.memory.workerSafety ??= {};
  const living = new Set(snapshot.units.filter(unit => unit.owner === owner).map(unit => unit.id));
  for (const id of Object.keys(memory)) if (!living.has(id)) delete memory[id];
  for (const plan of plans) {
    if (plan.released) delete memory[plan.worker.id];
    else memory[plan.worker.id] = plan.state;
  }
  return plans.flatMap(plan => plan.commands);
}
