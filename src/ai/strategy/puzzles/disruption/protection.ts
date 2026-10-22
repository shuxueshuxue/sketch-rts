import { walkingDistance, sameGround } from '../../../../shared/terrain';
import { UNIT_DEFS } from '../../../../shared/catalog';
import { strengthOf } from '../../../policy/v6/strength';
import type { GameSnapshot, Unit } from '../../../../shared/types';
import type { DisruptionWorld } from './scenes';

/** Independent native terrain calculation on a private map copy. It never
 * seeds the AI's path cache, changes its facts or grants, or declares a route safe. */
export function retreatInterception(world: DisruptionWorld) {
  if (!world.road) return null;
  const map = structuredClone(world.game.map), crossing = world.road, workerStart = { x: 1280, y: crossing.y };
  const raiders = world.game.units.filter(u => world.interceptors.includes(u.id));
  const worker = world.workers[0]!;
  const enemyDistance = walkingDistance(map, world.retreat, crossing), workerDistance = walkingDistance(map, workerStart, crossing);
  const enemySpeed = Math.min(...raiders.map(u => u.speed));
  return { crossing, workerStart, retreatPoint: world.retreat, enemyDistance: enemyDistance ?? null,
    workerDistance: workerDistance ?? null, enemySpeed, workerSpeed: worker.speed,
    enemySeconds: enemyDistance === undefined ? null : enemyDistance / enemySpeed,
    workerSeconds: workerDistance === undefined ? null : workerDistance / worker.speed,
    canArriveBeforeWorker: enemyDistance !== undefined && workerDistance !== undefined && enemyDistance / enemySpeed < workerDistance / worker.speed,
    nativeAmbushContract: 'Two original real footmen vs the native worker; actual kill is separately required by mechanics evidence, no invented win probability.',
    environment: 'No fog of war: unchanged native plannerView includes all units; distance never hides an enemy.' };
}
/** Positive physical escort evidence, kept distinct from a formal action/lease.
 * Reaching a region after the raider left it is deliberately insufficient. */
export function departureProtection(snapshot: GameSnapshot, world: Pick<DisruptionWorld, 'owner' | 'interceptors'>, worker: Unit, confirmedDead: ReadonlySet<string>) {
  const threats = snapshot.units.filter(u => world.interceptors.includes(u.id) && u.hp > 0);
  const escorts = snapshot.units.filter(u => u.owner === world.owner && u.kind !== 'worker' && !UNIT_DEFS[u.kind].naval
    && u.hp > 0 && !u.deck && !u.cabin && sameGround(snapshot.map, u, worker) && Math.hypot(u.x - worker.x, u.y - worker.y) <= 240
    && (u.order.type === 'follow' && u.order.targetId === worker.id
      || (u.order.type === 'move' || u.order.type === 'attackMove') && u.order.x >= 1280 && u.order.y >= 704 && u.order.y <= 896));
  const screens = snapshot.units.filter(u => u.owner === world.owner && u.kind !== 'worker' && !UNIT_DEFS[u.kind].naval
    && u.hp > 0 && !u.deck && !u.cabin && sameGround(snapshot.map, u, worker)
    && (u.order.type === 'attack' || u.order.type === 'attackMove') && 'targetId' in u.order
    && threats.some(t => t.id === ('targetId' in u.order ? u.order.targetId : undefined) && Math.hypot(t.x - u.x, t.y - u.y) <= 240));
  const screenPower = strengthOf(screens);
  const confirmedAllDead = world.interceptors.every(id => confirmedDead.has(id));
  const escortPower = strengthOf(escorts), threatPower = strengthOf(threats);
  return { tick: snapshot.tick, workerId: worker.id, positive: confirmedAllDead || escorts.length > 0 && escortPower >= threatPower || screens.length > 0 && screenPower >= threatPower,
    confirmedAllDead, screenIds: screens.map(u => u.id), screenPower,
    actualScreenOrders: screens.map(u => ({ unitId: u.id, order: u.order })), escortIds: escorts.map(u => u.id), escortPower, threatPower,
    actualEscortOrders: escorts.map(u => ({ unitId: u.id, order: u.order })),
    note: 'Existing shared strengthOf, native positions and explicit follow/corridor movement; actual armed screen attacking the observed threat is also counted; no timeout or disappearance proof. Full route safety and losses are separately observed.' };
}
