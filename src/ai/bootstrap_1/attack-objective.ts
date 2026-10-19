import { constructionWorkers } from '../../shared/construction';
import { groundTravelCost, walkingDistance } from '../../shared/terrain';
import { routeClearsDisks } from '../../shared/route-selection';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import type { Building, GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyMemory, V6PolicyMemory } from '../memory';
import { distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { availableV6Army, type AttackChoice } from '../policy/v6/general';
import { marchStrength } from '../policy/v6/strength';
import { isBacklineKind } from '../policy/v6/backline';
import type { V6Intel } from '../policy/v6/intel';
import { recordPlay, v6Memory } from '../policy/v6/memory';
import { activeCamp, campContested, continueV7Creep, neutralCamps, CREEP_ROUTE_CLEARANCE } from '../policy/v7/creep';
import { chooseBootstrapCamp, startBootstrapCamp } from './camp-geometry';
import { assaultCampRouter } from './assault-camp-roads';
import { nativeLandRoad } from './safe-land-route';

type General = NonNullable<V6PolicyMemory['general']>;
type Pause = NonNullable<AiPolicyMemory['landAttack']>['paused'];

/** First contact follows the executed steering road, stopping at weapon range, rather than a different approach route. */
export function attackArrivalTicks(snapshot: GameSnapshot, unit: Unit, hall: Building) {
  const road = nativeLandRoad(snapshot, unit, hall);
  if (!road) return Infinity;
  const reach = hall.radius + unit.radius + unit.attackRange;
  let cost = 0;
  for (let i = 1; i < road.points.length; i++) {
    const from = road.points[i - 1]!, to = road.points[i]!;
    if (distance(from, hall) <= reach) return Math.ceil(cost / unit.speed * SIM_TICKS_PER_SECOND);
    const dx = to.x - from.x, dy = to.y - from.y, ox = from.x - hall.x, oy = from.y - hall.y;
    const length2 = dx * dx + dy * dy, dot = ox * dx + oy * dy;
    const discriminant = dot * dot - length2 * (ox * ox + oy * oy - reach * reach);
    const entry = length2 > 0 && discriminant >= 0 ? (-dot - Math.sqrt(discriminant)) / length2 : Infinity;
    const end = entry >= 0 && entry <= 1 ? { x: from.x + dx * entry, y: from.y + dy * entry } : to;
    const segment = groundTravelCost(snapshot.map, from, end);
    if (segment === undefined || !Number.isFinite(segment)) throw new Error(`Invalid attack arrival for ${unit.id}: (${from.x},${from.y}) -> (${end.x},${end.y}), ${segment}`);
    cost += segment;
    if (end !== to) return Math.ceil(cost / unit.speed * SIM_TICKS_PER_SECOND);
  }
  return distance(road.points.at(-1)!, hall) <= reach ? Math.ceil(cost / unit.speed * SIM_TICKS_PER_SECOND) : Infinity;
}

/** Among attacks admitted by the existing combat test, pressure the nearest expansion before a distant main. */
export function chooseRoomAttack(snapshot: GameSnapshot, options: AiPolicyContext, intel: V6Intel,
  choices: AttackChoice[], eligible: (choice: AttackChoice) => boolean) {
  const front = availableV6Army(snapshot, options, intel).filter(unit => !isBacklineKind(unit) && unit.attackDamage > 0);
  const center = intel.armyCenter ?? intel.home;
  const leader = [...front].sort((a, b) => distance(a, center) - distance(b, center))[0];
  if (!leader) return undefined;
  const admitted = new Map<AttackChoice, boolean>();
  const canAttack = (choice: AttackChoice) => {
    if (!admitted.has(choice)) admitted.set(choice, eligible(choice));
    return admitted.get(choice)!;
  };
  const committed = choices.find(choice => choice.base.hall.id === options.memory.landAttack?.targetId);
  if (options.memory.landAttack) return committed && canAttack(committed) ? committed : undefined;
  // Buildings remain in creation order. Use the first surviving hall, as the
  // army's own home selector does: adding towers at a natural must not turn the
  // birth hall into an "expansion" and send the first wave past that natural.
  const main = (choice: AttackChoice) => intel.enemies.find(enemy => enemy.owner === choice.base.owner)
    ?.bases[0]?.hall.id === choice.base.hall.id;
  const expansions = choices.filter(choice => !main(choice));
  const walk = (choice: AttackChoice) => walkingDistance(snapshot.map, leader, choice.base.hall) ?? Infinity;
  expansions.sort((a, b) => walk(a) - walk(b));
  const rising = expansions.find(choice => {
    const hall = choice.base.hall;
    if (hall.complete || !canAttack(choice)) return false;
    const builders = constructionWorkers(snapshot, hall).length;
    const remaining = builders ? (hall.buildTime - hall.buildProgress) / builders : Infinity;
    // Reject a claimed construction intercept when even its straight-line lower bound is too late.
    if (front.some(unit => Math.max(0, distance(unit, hall) - hall.radius - unit.radius - unit.attackRange)
      / unit.speed * SIM_TICKS_PER_SECOND >= remaining)) return false;
    return front.every(unit => attackArrivalTicks(snapshot, unit, hall) < remaining);
  });
  const expansion = rising ?? expansions.find(canAttack);
  // The first wave dismantles an income, rather than bypassing a defended
  // expansion to march around it at the distant main. Build the needed force.
  if (expansion || expansions.length && !options.memory.v6?.plays?.['attack:result:destroyed']) return expansion;
  return choices.find(choice => main(choice) && canAttack(choice));
}

function finish(snapshot: GameSnapshot, options: AiPolicyContext,
  result: NonNullable<AiPolicyMemory['landAttackResult']>['result'], reason: string) {
  const task = options.memory.landAttack;
  if (!task) return;
  options.memory.landAttackResult = { targetId: task.targetId, tick: snapshot.tick, result, reason };
  recordPlay(v6Memory(options), `attack:result:${result}`);
  delete options.memory.landAttack;
}

function saveAttack(snapshot: GameSnapshot, options: AiPolicyContext, general: General | undefined) {
  if (general?.mode !== 'attack' || !general.targetHallId
    || !snapshot.units.some(unit => general.group?.includes(unit.id))) return;
  let task = options.memory.landAttack;
  if (task && task.targetId !== general.targetHallId) return;
  task = options.memory.landAttack ??= { targetId: general.targetHallId, sinceTick: snapshot.tick, general: structuredClone(general) };
  task.general = structuredClone(general);
  delete task.paused; delete task.pausedAt;
}

/** A temporary mining or defense job pauses an assault; only a physical result ends it. */
export function prepareLandAttack(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext,
  intel: V6Intel, beforePriority: General | undefined, pause: Pause) {
  saveAttack(snapshot, options, beforePriority);
  const task = options.memory.landAttack, memory = v6Memory(options);
  if (!task) return;
  const target = snapshot.buildings.find(building => building.id === task.targetId);
  const survivors = snapshot.units.filter(unit => task.general.group?.includes(unit.id));
  const end = !target ? 'destroyed' : !survivors.some(unit => unit.kind === 'summoner'
    || !isBacklineKind(unit) && unit.attackDamage > 0) ? 'army-lost' : undefined;
  if (end) {
    if (memory.general?.mode === 'attack' && memory.general.targetHallId === task.targetId)
      memory.general = { mode: 'hold', target: intel.armyCenter ?? intel.home, holdingSince: snapshot.tick };
    if (!pause && task.camp) delete memory.creep;
    finish(snapshot, options, end, !target ? 'target-gone' : 'no-fighters-left');
    return;
  }
  if (pause) {
    task.paused = pause;
    task.pausedAt ??= snapshot.tick;
    return;
  }
  if (task.pausedAt !== undefined) {
    const elapsed = snapshot.tick - task.pausedAt;
    if (task.general.stageSince !== undefined) task.general.stageSince += elapsed;
    if (task.camp) task.camp.since += elapsed;
  }
  delete task.paused;
  delete task.pausedAt;
  // A local medic, garrison or courier assignment may borrow part of the wave.
  // Keep the remaining wave on its objective. Remove only living borrowed force
  // from the departure budget; actual deaths still count toward the old worn test.
  const available = new Set(availableV6Army(snapshot, options, intel).map(unit => unit.id));
  const borrowed = survivors.filter(unit => !available.has(unit.id));
  if (borrowed.length) {
    const ids = new Set(borrowed.map(unit => unit.id));
    task.general.group = task.general.group?.filter(id => !ids.has(id));
    task.general.groupStart = Math.max(0, (task.general.groupStart ?? 0) - marchStrength(borrowed));
  }
  memory.general = structuredClone(task.general);
  if (task.camp) memory.creep = structuredClone(task.camp);
}

/** Preserve the old retreat decisions, and record their result rather than calling a dispatched order a success. */
export function observeLandAttack(snapshot: GameSnapshot, options: AiPolicyContext, retreatBefore: Record<string, number>) {
  const memory = v6Memory(options), task = options.memory.landAttack;
  if (task && memory.retreatedAt === snapshot.tick) {
    const reason = Object.keys(memory.plays ?? {}).find(key => key.startsWith('general:retreat')
      && memory.plays![key]! > (retreatBefore[key] ?? 0)) ?? 'missed-construction-window';
    finish(snapshot, options, 'withdrew', reason);
    saveAttack(snapshot, options, memory.general);
    return;
  }
  saveAttack(snapshot, options, memory.general);
}

/** A camp that blocks the actual assault road is part of that assault, with the enemy base retained as its goal. */
export function attackRoadCampCommands(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext,
  intel: V6Intel, start: boolean): GameCommand[] | undefined {
  const task = options.memory.landAttack, memory = v6Memory(options);
  if (!task || task.paused) return undefined;
  const front = availableV6Army(snapshot, options, intel).filter(unit => !isBacklineKind(unit) && unit.attackDamage > 0);
  const camps = neutralCamps(snapshot);
  if (task.camp) {
    if (!activeCamp(task.camp, camps)) {
      delete task.camp;
      delete memory.creep;
      memory.general = structuredClone(task.general);
      return undefined;
    }
    const under = continueV7Creep(snapshot, owner, front, camps, intel, options);
    if (under) {
      task.camp = structuredClone(memory.creep!);
      memory.general = { mode: 'creep', target: under.point };
      return under.commands;
    }
    finish(snapshot, options, 'withdrew', 'road-camp-aborted');
    memory.retreatedAt = snapshot.tick;
    memory.general = { mode: 'hold', target: intel.home, holdingSince: snapshot.tick };
    return undefined;
  }
  if (!start || memory.general?.mode !== 'attack' || memory.general.stage === 'gather') return undefined;
  const group = front.filter(unit => task.general.group?.includes(unit.id));
  const leader = group[0], goal = task.general.target;
  if (!leader || !goal || group.some(unit => unit.kind === 'ballista' || unit.kind === 'catapult')
    || campContested(intel, leader, group)) return undefined;
  if (assaultCampRouter(snapshot, goal, camps, true)(leader).kind !== 'blocked') return undefined;
  const road = nativeLandRoad(snapshot, leader, goal);
  if (!road) return undefined;
  const blocked = camps.map(camp => ({ camp, at: road.points.findIndex((point, i) => i > 0
    && !routeClearsDisks([road.points[i - 1]!, point], camp.creeps.map(creep =>
      ({ x: creep.x, y: creep.y, radius: CREEP_ROUTE_CLEARANCE })))) }))
    .filter(item => item.at >= 0).sort((a, b) => a.at - b.at);
  const camp = blocked[0]?.camp;
  if (!camp || campContested(intel, camp.center, group)) return undefined;
  const choice = chooseBootstrapCamp(intel.home, snapshot, group, camps, [camp], options, camp.center);
  if (!choice) return undefined;
  startBootstrapCamp(snapshot, group, { ...choice, why: 'creep' }, options);
  task.camp = structuredClone(memory.creep!);
  recordPlay(memory, 'attack:clearRoad');
  return attackRoadCampCommands(snapshot, owner, options, intel, false);
}
