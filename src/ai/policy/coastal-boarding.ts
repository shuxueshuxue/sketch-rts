import { unitMover } from '../../shared/catalog';
import { combatCapability } from '../../shared/combat-capabilities';
import { workingWeaponGeometry } from '../../shared/combat-fire-geometry';
import { canReach } from '../../shared/naval';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { shipShorePoints } from '../../shared/connected-decks';
import { isInCabin } from '../../shared/ship-cabin';
import { shipPassengers } from '../../shared/ship-geometry';
import type { GameCommand, GameSnapshot, Unit } from '../../shared/types';
import type { AiPolicyContext } from '../policy';
import { isEnemyOwner } from './ownership';
import { distance, type Point } from './spatial';
import { attackMargin } from './v6/general';
import { effectiveCombatRating } from './v6/strength';
import { coastalRefuge, coastalWithdrawalPassage } from './coastal-risk';
import { coastalLegArrivalSafe } from './coastal-voyage';

function reachableShoreThreats(snapshot: GameSnapshot, ship: Unit, options: AiPolicyContext,
  requests: (foe: Unit) => boolean): Unit[] {
  return snapshot.units.filter(foe => {
    if (foe.hp <= 0 || foe.deck || isInCabin(foe) || unitMover(foe.kind) !== 'land'
      || !isEnemyOwner(snapshot, ship.owner, foe.owner, options) || !combatCapability(snapshot, foe).armed) return false;
    return requests(foe) && canReach(snapshot.map, foe, ship, snapshot.units);
  });
}

/** The opponent's public order requests this deck and native terrain reach
 * admits the hull. This is not a collision-aware walking ETA. A distant
 * island's army or an attack on another target supplies no such intent. */
export function coastalBoardingThreats(snapshot: GameSnapshot, ship: Unit, options: AiPolicyContext): Unit[] {
  return reachableShoreThreats(snapshot, ship, options, foe => {
    const order = foe.order;
    return order.type === 'board' ? order.transportId === ship.id
      : (order.type === 'move' || order.type === 'attackMove') && order.deckShipId === ship.id;
  });
}

/** A normal shore attack on this hull or its exposed crew is pursuit, not a
 * boarding order. The target identity and native ground reach are observed;
 * proximity to an unrelated fight does not supply that information. */
export function coastalPursuitThreats(snapshot: GameSnapshot, ship: Unit, options: AiPolicyContext): Unit[] {
  const targets = new Set([ship.id, ...shipPassengers(snapshot.units, ship)
    .filter(crew => crew.owner === ship.owner && !isInCabin(crew)).map(crew => crew.id)]);
  return reachableShoreThreats(snapshot, ship, options, foe =>
    (foe.order.type === 'attack' || foe.order.type === 'attackMove')
      && targets.has(foe.order.targetId ?? ''));
}

/** Keep the commander's existing odds. Exposed defenders can fight on their
 * own deck; other local support must actually cover an approaching boarder.
 * A mortar facing away or below its minimum range is not a boarding guard. */
function outmatchingShoreThreats(snapshot: GameSnapshot, ship: Unit, threats: Unit[], options: AiPolicyContext): Unit[] {
  if (!threats.length) return [];
  const support = snapshot.units.filter(unit => unit.hp > 0 && unit.owner !== 'neutral' && !isInCabin(unit)
    && !isEnemyOwner(snapshot, ship.owner, unit.owner, options) && combatCapability(snapshot, unit).armed
    && (unit.deck?.shipId === ship.id || distance(unit, ship) < 600
      && threats.some(foe => workingWeaponGeometry(snapshot, unit, foe).some(weapon => weapon.covers)
        && canReach(snapshot.map, unit, foe, snapshot.units, combatCapability(snapshot, unit).range))));
  const power = (army: Unit[]) => army.reduce((sum, unit) => sum + effectiveCombatRating(snapshot, unit), 0);
  return power(threats) * attackMargin(options) > power(support) ? threats : [];
}

export function outmatchingBoarders(snapshot: GameSnapshot, ship: Unit, options: AiPolicyContext): Unit[] {
  return outmatchingShoreThreats(snapshot, ship, coastalBoardingThreats(snapshot, ship, options), options);
}

export function outmatchingCoastalPursuers(snapshot: GameSnapshot, ship: Unit, options: AiPolicyContext): Unit[] {
  return outmatchingShoreThreats(snapshot, ship, coastalPursuitThreats(snapshot, ship, options), options);
}

/** A shore withdrawal keeps its public destination until the native
 * mover actually finishes it. Near a shore, the ordinary 70px combat radius
 * can still leave the deck connected to an approaching enemy's land road. */
export function coastalWithdrawalArrived(ship: Unit, goal: Point): boolean {
  const route = ship.sailing?.route;
  return ship.order.type === 'idle' && route?.partial === false && route.points.length === 0
    && route.goalX === goal.x && route.goalY === goal.y
    && ship.arrivedAt?.x === goal.x && ship.arrivedAt?.y === goal.y
    && distance(ship, goal) <= MOVE_ORDER_ARRIVAL_RANGE;
}

/** Keep the ordinary refuge ordering, but leaving the shore must actually
 * leave the shore at its native arrival pose. The independently queried road
 * is only admission evidence; the naval owner publishes coordinates alone. */
export function coastalOffshoreRefuge(snapshot: GameSnapshot, ship: Unit, threats: Unit[], options: AiPolicyContext): Point | undefined {
  const passages = new Map<string, ReturnType<typeof coastalWithdrawalPassage>>();
  return coastalRefuge(snapshot, ship, threats, goal => {
    if (!coastalLegArrivalSafe(snapshot, ship, goal, options)) return false;
    const key = `${goal.x}:${goal.y}`;
    if (!passages.has(key)) passages.set(key, coastalWithdrawalPassage(snapshot, ship, goal, options));
    const end = passages.get(key)?.points.at(-1);
    if (!end || !coastalLegArrivalSafe(snapshot, ship, end, options)) return false;
    const posed = { ...ship, x: end.x, y: end.y, sailing: { ...ship.sailing!, heading: end.heading } };
    return shipShorePoints(posed, snapshot.map).length === 0;
  });
}

/** A withdrawing battery owns its exposed crew's position too. Holding
 * prevents idle acquisition from pursuing an enemy ashore while preserving
 * work, transfers, queued tasks, and an attack on an intruder already aboard.
 * Native hold still fires in range; it does not anchor a moving deck in world
 * coordinates or prevent the normal damage and boarding rules. */
export function coastalWithdrawalCrewCommands(snapshot: GameSnapshot, ship: Unit): GameCommand[] {
  const hold = shipPassengers(snapshot.units, ship).filter(crew => {
    if (crew.owner !== ship.owner || crew.kind === 'worker' || isInCabin(crew) || crew.orderQueue?.length
      || !combatCapability(snapshot, crew).armed) return false;
    if (crew.order.type === 'idle') return true;
    if (crew.order.type !== 'attack' && crew.order.type !== 'attackMove') return false;
    if (crew.order.type === 'attackMove' && crew.order.deckShipId === ship.id) return false;
    const targetId = 'targetId' in crew.order ? crew.order.targetId : undefined;
    const target = snapshot.units.find(unit => unit.id === targetId && unit.hp > 0);
    return !target || target.deck?.shipId !== ship.id;
  });
  return hold.length ? [{ type: 'holdPosition', unitIds: hold.map(crew => crew.id) }] : [];
}
