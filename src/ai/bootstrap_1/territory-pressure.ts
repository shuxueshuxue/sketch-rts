import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { routePrefix } from '../../shared/route-selection';
import { walkableGoal, walkingDistance } from '../../shared/terrain';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { resolveAiCommandIntent } from '../policy/commands';
import { averagePoint, distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { availableV6Army, V7_WOUNDED_SHARE, type AttackChoice } from '../policy/v6/general';
import { isBacklineKind } from '../policy/v6/backline';
import type { V6Intel } from '../policy/v6/intel';
import { recordPlay, v6Memory } from '../policy/v6/memory';
import { marchStrength, strengthOf } from '../policy/v6/strength';
import { v6Doctrine } from '../policy/v6/select';
import { groundFrontThreat, groundRespondingPower } from '../policy/ground-threat';
import { THINK_TICKS } from './mounted-micro';
import { armedFoes, nativeLandRoad, safeLandTravelTicks } from './safe-land-route';

export const TERRITORY_IDLE_TICKS = 60 * SIM_TICKS_PER_SECOND;
const POST_STANDOFF = 900;
const POST_ARRIVAL = 240;
const POST_LEG = 600;

function pressureFront(snapshot: GameSnapshot, options: AiPolicyContext, intel: V6Intel) {
  return availableV6Army(snapshot, options, intel).filter(unit => !isBacklineKind(unit) && unit.attackDamage > 0
    && unit.hp >= unit.maxHp * V7_WOUNDED_SHARE);
}

/** Count only observed safe idle intervals; a defense pauses the debt rather than erasing it. */
export function beginTerritoryThink(snapshot: GameSnapshot, options: AiPolicyContext, safe: boolean) {
  const state = options.memory.territory ??= { idleTicks: 0, lastTick: snapshot.tick, idle: false };
  if (safe && state.idle) state.idleTicks = Math.min(TERRITORY_IDLE_TICKS,
    state.idleTicks + Math.max(0, Math.min(THINK_TICKS, snapshot.tick - state.lastTick)));
  state.lastTick = snapshot.tick;
  state.idle = false;
}

export function territoryControlsHold(snapshot: GameSnapshot, options: AiPolicyContext) {
  const state = options.memory.territory;
  return territoryReady(options) && (!!state?.objective || snapshot.tick >= (state?.retryUntil ?? 0));
}

export function territoryReady(options: AiPolicyContext) {
  const state = options.memory.territory;
  return !!state && (state.idleTicks >= TERRITORY_IDLE_TICKS || state.objective !== undefined);
}

/** A limited expansion attack needs a local edge and must also face the army that can actually respond. */
export function localPressureAttack(snapshot: GameSnapshot, options: AiPolicyContext, intel: V6Intel, choices: AttackChoice[]) {
  if (!territoryReady(options) || options.memory.landAttack) return undefined;
  const available = availableV6Army(snapshot, options, intel), front = pressureFront(snapshot, options, intel);
  if (front.length < 3) return undefined;
  const power = marchStrength(available) * (1 + v6Doctrine(snapshot, available[0]!.owner as PlayerId, options).profile.aggression);
  return choices.find(choice => power > choice.defended
    && power >= groundRespondingPower(snapshot, intel, choice.base, front));
}

function choosePost(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel, front: Unit[]) {
  const host = availableV6Army(snapshot, options, intel).filter(unit => unit.expiresTick === undefined && unit.attackDamage > 0);
  const center = averagePoint(host.length >= 3 ? host : front);
  const leader = front.reduce((nearest, unit) => distance(unit, center) < distance(nearest, center) ? unit : nearest);
  const expansions = intel.enemies.flatMap(enemy => enemy.bases.slice(1).map(base => base.hall));
  const targets = expansions.length ? expansions : intel.enemies.flatMap(enemy => enemy.bases.map(base => base.hall));
  const target = [...targets].map(hall => ({ hall, walk: walkingDistance(snapshot.map, leader, hall) ?? Infinity }))
    .sort((a, b) => a.walk - b.walk)[0]?.hall;
  if (!target) return undefined;
  const road = nativeLandRoad(snapshot, leader, target);
  if (!road) return undefined;
  const length = road.points.slice(1).reduce((total, point, i) => total + distance(road.points[i]!, point), 0);
  const advance = Math.min(POST_LEG, length - POST_STANDOFF);
  const foes = armedFoes(snapshot, owner, options);
  // Bound route work: up to six leader candidates, then one set of squad roads.
  // The point lies on the executed steering road, outside known firing lanes.
  for (let attempt = 0; attempt < 6; attempt++) {
    const travel = advance - attempt * 160;
    if (travel < 200) break;
    const point = routePrefix(leader, road.points, travel).at(-1)!;
    if (safeLandTravelTicks(snapshot, leader, point, foes, end => distance(end, point) <= POST_ARRIVAL) !== undefined)
      return { targetId: target.id, point: { x: point.x, y: point.y }, sinceTick: snapshot.tick };
  }
  return undefined;
}

/** The general's unclaimed surplus occupies an actual forward post, retaining its ordinary micro and defenses. */
export function territoryPostCommands(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext,
  intel: V6Intel, safe: boolean): { commands: GameCommand[]; unitIds: string[] } | undefined {
  const state = options.memory.territory;
  if (!state || !safe || !territoryReady(options) || options.memory.landAttack || options.memory.v6?.general?.mode !== 'hold') return undefined;
  const front = pressureFront(snapshot, options, intel);
  // An expansion may temporarily borrow one soldier. Keep the remaining post
  // rather than recalling it merely because the original three become two.
  const minimum = state.objective ? 2 : 3;
  if (front.length < minimum || groundFrontThreat(snapshot, intel, front) > strengthOf(availableV6Army(snapshot, options, intel))) return undefined;
  if (state.objective && !snapshot.buildings.some(building => building.id === state.objective!.targetId)) delete state.objective;
  if (state.objective?.reachedTick !== undefined && snapshot.tick >= (state.objective.nextStepCheck ?? state.objective.reachedTick)) {
    const post = state.objective;
    post.nextStepCheck = snapshot.tick + 5 * SIM_TICKS_PER_SECOND;
    const host = availableV6Army(snapshot, options, intel).filter(unit => unit.expiresTick === undefined && unit.attackDamage > 0);
    const assembled = front.filter(unit => distance(unit, post.point) <= POST_ARRIVAL + 80).length >= Math.ceil(front.length * .6)
      && host.filter(unit => distance(unit, post.point) < 500).length >= Math.ceil(host.length * .6);
    const target = snapshot.buildings.find(building => building.id === post.targetId)!;
    if (assembled && (walkingDistance(snapshot.map, post.point, target) ?? 0) > POST_STANDOFF + POST_ARRIVAL) {
      delete state.objective;
      state.retryUntil = snapshot.tick;
      state.idleTicks = TERRITORY_IDLE_TICKS;
    }
  }
  if (!state.objective) {
    if (snapshot.tick < (state.retryUntil ?? 0)) return undefined;
    state.retryUntil = snapshot.tick + 15 * SIM_TICKS_PER_SECOND;
    state.objective = choosePost(snapshot, owner, options, intel, front);
  }
  const objective = state.objective;
  if (!objective) return undefined;
  const foes = armedFoes(snapshot, owner, options);
  const walking: { unit: Unit; point: { x: number; y: number } }[] = [], holding: Unit[] = [], going: Unit[] = [];
  const target = snapshot.buildings.find(building => building.id === objective.targetId)!;
  const dx = target.x - objective.point.x, dy = target.y - objective.point.y, length = Math.hypot(dx, dy) || 1;
  for (const unit of front) {
    // Stable, small slots keep the first arrivals from blocking the whole post.
    // New recruits do not renumber the troops already marching. Each slot still
    // has to pass the executed steering-road check below.
    const slot = [...unit.id].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % 9;
    const side = (slot % 3 - 1) * 64, back = Math.floor(slot / 3) * 64;
    const point = walkableGoal(snapshot.map, objective.point.x - dy / length * side - dx / length * back,
      objective.point.y + dx / length * side - dy / length * back);
    if (distance(unit, point) <= 60) { holding.push(unit); continue; }
    if ((unit.order.type === 'move' || unit.order.type === 'attackMove') && distance(unit.order, point) < 20) {
      going.push(unit); continue;
    }
    if (safeLandTravelTicks(snapshot, unit, point, foes, end => distance(end, point) <= 60) !== undefined) walking.push({ unit, point });
  }
  if (walking.length + holding.length + going.length < minimum) return undefined;
  if (front.filter(unit => distance(unit, objective.point) <= POST_ARRIVAL).length >= 3) objective.reachedTick ??= snapshot.tick;
  const general = v6Memory(options).general!;
  general.target = { ...objective.point };
  state.idleTicks = 0;
  if (!state.lastAction || state.lastAction.tick < objective.sinceTick) {
    state.lastAction = { tick: snapshot.tick, kind: 'post', targetId: objective.targetId };
    recordPlay(v6Memory(options), 'territory:post');
  }
  const commands: GameCommand[] = [];
  for (const { unit, point } of walking) commands.push(resolveAiCommandIntent(snapshot, owner,
    { type: 'attackMove', unitIds: [unit.id], ...point }, options));
  const waiting = holding.filter(unit => unit.order.type !== 'hold' && unit.order.type !== 'attack');
  if (waiting.length) commands.push({ type: 'holdPosition', unitIds: waiting.map(unit => unit.id) });
  // Suppress old rally commands for the whole current party, including units
  // whose existing order already reaches this post. Membership remains with
  // the general and is recomputed from live claims, never stored a second time.
  return { commands, unitIds: [...walking.map(item => item.unit), ...holding, ...going].map(unit => unit.id) };
}

export function finishTerritoryThink(snapshot: GameSnapshot, options: AiPolicyContext, intel: V6Intel, safe: boolean, assisting: boolean) {
  const state = options.memory.territory!;
  const mode = options.memory.v6?.general?.mode;
  if (mode === 'attack' || mode === 'creep') {
    if (territoryReady(options) && mode === 'attack') state.lastAction = {
      tick: snapshot.tick, kind: 'attack', targetId: options.memory.v6!.general!.targetHallId! };
    state.idleTicks = 0;
    delete state.objective;
  }
  // A summoner host is still idle between summon waves. Its temporary front
  // disappearing must not stop the casters' clock or erase their earlier wait.
  const fighters = availableV6Army(snapshot, options, intel).filter(unit => unit.attackDamage > 0
    && (!isBacklineKind(unit) || unit.kind === 'summoner'));
  state.idle = safe && mode === 'hold' && !state.objective && !assisting && fighters.length >= 3;
}
