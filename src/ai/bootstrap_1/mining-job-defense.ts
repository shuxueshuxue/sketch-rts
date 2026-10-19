import { GOLD_MINE_RULES } from '../../shared/mining';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { unitMover } from '../../shared/catalog';
import { nearestByRoute, routeArrivals, routeTravelTicks } from '../../shared/route-selection';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { sameGround } from '../../shared/terrain';
import { groundThreatWithin } from '../policy/ground-threat';
import { isEnemyOwner } from '../policy/ownership';
import { mineClaimedByAlly } from '../policy/mine-claims';
import { averagePoint, distance } from '../policy/spatial';
import { availableV6Army, V7_WOUNDED_SHARE, type ArmyDefense } from '../policy/v6/general';
import { readV6Intel, type V6Intel } from '../policy/v6/intel';
import { strengthOf, TOWER_STRENGTH } from '../policy/v6/strength';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { isBacklineKind } from '../policy/v6/backline';
import { armedFoes, earliestThreatContactTicks, retreatLandRoad } from './safe-land-route';
import { miningJobOrder } from './mining-jobs';
import { planWorkerSafety, workerSafetyPlans } from './worker-safety';

/** A hauling job remains real income after its mine's hall has fallen. */
export function miningJobDefenseTarget(snapshot: GameSnapshot, owner: PlayerId, intel: V6Intel, options: AiPolicyContext): ArmyDefense | undefined {
  const workers = snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'worker' && !unit.deck);
  const foes = snapshot.units.filter(unit => unit.hp > 0 && unit.attackDamage > 0 && !unit.deck
    && unitMover(unit.kind) === 'land' && isEnemyOwner(snapshot, owner, unit.owner, options));
  for (const mine of snapshot.resources.filter(resource => resource.amount > 0
    && sameGround(snapshot.map, intel.home, resource)
    && !intel.ownHalls.some(hall => hall.complete && distance(hall, resource) <= GOLD_MINE_RULES.baseRange)
    && !mineClaimedByAlly(snapshot, owner, resource, options))) {
    const miners = workers.filter(worker => miningJobOrder(worker)?.resourceId === mine.id);
    const attackers = foes.filter(foe => miners.some(worker => {
      const order = foe.order;
      const aimed = (order.type === 'attack' || order.type === 'attackMove') && order.targetId === worker.id
        || order.type === 'attackMove' && distance(order, worker) <= 650;
      return groundThreatWithin(snapshot, foe, worker, foe.attackRange)
        || aimed && groundThreatWithin(snapshot, foe, worker, 1300);
    }));
    if (attackers.length === 0) continue;
    const field = averagePoint(attackers), post = nearestByRoute(snapshot.map, miners, field, 'land');
    const hall = nearestByRoute(snapshot.map, intel.ownHalls, field, 'land');
    if (!post || !hall) continue;
    const cover = intel.ownTowers.filter(tower => tower.complete && distance(tower, post) + 80 <= tower.attackRange)
      .reduce((power, tower) => power + TOWER_STRENGTH * tower.hp / tower.maxHp, 0);
    return { point: post, field, hall, threat: strengthOf(attackers), cover, inCover: cover > 0,
      waitingPoint: post, waitingCover: cover, edge: .9, stay: .6, leash: 450, guard: hall };
  }
  return undefined;
}

function exposedMiners(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const intel = readV6Intel(snapshot, owner, options), defense = miningJobDefenseTarget(snapshot, owner, intel, options);
  if (!defense) return [];
  const fighters = availableV6Army(snapshot, options, intel).filter(unit => !unit.deck && !isBacklineKind(unit)
    && unit.attackDamage > 0 && unit.hp >= unit.maxHp * V7_WOUNDED_SHARE);
  const foes = armedFoes(snapshot, owner, options);
  return snapshot.units.filter(unit => unit.owner === owner && unit.kind === 'worker' && !unit.deck)
    .flatMap(worker => {
      const job = miningJobOrder(worker);
      if (!job) return [];
      const mine = snapshot.resources.find(resource => resource.id === job.resourceId)!;
      if (mine.amount === 0 || mineClaimedByAlly(snapshot, owner, mine, options)
        || intel.ownHalls.some(hall => hall.complete && distance(hall, mine) <= GOLD_MINE_RULES.baseRange)) return [];
      const enemies = foes.filter((foe): foe is Unit => 'order' in foe)
        .filter(foe => groundThreatWithin(snapshot, foe, worker, 1300));
      const threatened = enemies.some(foe => {
        const contact = earliestThreatContactTicks(snapshot, foe, worker);
        return fighters.every(fighter => {
          if (groundThreatWithin(snapshot, fighter, foe, fighter.attackRange)) return false;
          const protect = routeTravelTicks(snapshot.map, fighter, worker, 'land', fighter.speed);
          const intercept = routeTravelTicks(snapshot.map, fighter, foe, 'land', fighter.speed);
          if (protect !== undefined && protect <= contact
            && (fighter.expiresTick === undefined || fighter.expiresTick > snapshot.tick + protect)) return false;
          if (intercept !== undefined && intercept <= contact
            && (fighter.expiresTick === undefined || fighter.expiresTick > snapshot.tick + intercept)) return false;
          return true;
        });
      });
      if (!threatened) return [];
      const shelter = routeArrivals(snapshot.map, fighters, worker, 'land').flatMap(({ unit }) => {
        const gap = distance(unit, worker), clearance = unit.radius + worker.radius + MOVE_ORDER_ARRIVAL_RANGE;
        if (gap <= unit.radius + worker.radius) return [];
        const point = { x: unit.x + (worker.x - unit.x) * clearance / gap,
          y: unit.y + (worker.y - unit.y) * clearance / gap };
        const road = retreatLandRoad(snapshot, worker, point, foes);
        return road && distance(road.points[road.points.length - 1]!, point) <= MOVE_ORDER_ARRIVAL_RANGE
          && (unit.expiresTick === undefined || unit.expiresTick > snapshot.tick + road.ticks) ? [{ point, road }] : [];
      }).sort((a, b) => a.road.ticks - b.road.ticks)[0];
      return shelter ? [{ worker, job, shelter }] : [];
    });
}

export const miningJobSafety: AiScript = {
  id: 'miningJobSafety', phase: 'tactics', redirects: 'local',
  claimsUnits: (snapshot, owner, options) => new Set([
    ...workerSafetyPlans(snapshot, owner, options).map(task => task.worker.id),
    ...exposedMiners(snapshot, owner, options).map(task => task.worker.id),
  ]),
  run(snapshot, owner, options): GameCommand[] {
    const safety = workerSafetyPlans(snapshot, owner, options), claimed = new Set(safety.map(task => task.worker.id));
    return [...planWorkerSafety(snapshot, owner, options, safety), ...exposedMiners(snapshot, owner, options)
      .filter(task => !claimed.has(task.worker.id)).flatMap(({ worker, job, shelter }): GameCommand[] => {
      if (worker.order.type === 'move' && worker.order.avoidCombat && worker.orderQueue?.some(order => order.type === 'mine')) return [];
      return [{ type: 'move', unitIds: [worker.id], ...shelter.point, avoidCombat: true },
        { type: 'mine', unitIds: [worker.id], resourceId: job.resourceId, queued: true }];
    })];
  },
};
