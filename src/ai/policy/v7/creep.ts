import type { GameCommand, GameSnapshot, PlayerId, Unit } from "../../../shared/types";
import type { V6PolicyMemory } from "../../memory";
import { resolveAiCommandIntent } from "../commands";
import { averagePoint, distance, type Point } from "../spatial";
import type { AiPolicyContext } from "../types";
import { isV7Policy } from "../versions";
import { recordPlay, v6Memory } from "../v6/memory";
import { enemyPowerNear, type V6Intel } from "../v6/intel";
import { combatRating, strengthOf } from "../v6/strength";

// @@@v7-creeping - V7 creeps the way a player does: it picks a camp its gathered group beats, walks there on a route that
// passes no other camp, waits outside the camp until the group stands together, goes in together and stays until the
// camp is cleared, stepping its badly wounded back out while the creeps leash home.
//
// Watched V7 against V7 (verdantCrossroads), V6's creeping sent footmen in one or two at a time and lost them: the general
// counted the whole army wherever it stood, flipped between creeping and holding as its wounded dipped under the bar, the
// wounded-retreat script pulled the same units home every other think, a spread camp was taken for a small one (its
// outermost creep read as a camp of 0.4 on its own, and two ravagers walked into a camp of 4.9), and marches cut
// through other camps.
//
// Measured in isolation (every camp on the gauntlet maps, fought by footmen arriving together): the least force that
// wins is about the camp's rating plus one footman (a 2.0 camp takes 3 footmen and costs one, a 6.9 camp 8), so a group
// goes in with the camp's rating plus FORCE_MARGIN.
//
// @@@v7-creep-force - The group is weighed against a camp by what it fights with (combatRating), not by what it cost.
// Creeps cast their spells too since autocast, and a camp with a glade witch now takes a footman more: an ember group,
// its ravagers 1.2 footmen by price but 0.95 by hit points and damage, took a 6.9 camp on price and lost seven ravagers
// to it (sableRun, 9:20), and under autocast V7 ember fell from 423 to 350 of 500 while grove held. Against enemy armies
// the group is still weighed by price, the currency of every army decision. (Asking more of a camp for its cursers, and
// striking a camp's casters first, were tried beside it and lost games: fewer camps, and riders cut down walking through
// brutes to a healer.)
const CAMP_LINK = 300;
const FORCE_MARGIN = 1.5;
const STAGING_GAP = 230;
const ROUTE_CLEARANCE = 260;
const GATHERED_RANGE = 180;
const GATHERED_SHARE = 0.8;
const GATHER_TICKS = 25 * 20;
const ABORT_SHARE = 0.5;
const WOUNDED_SHARE = 0.35;
const ORDER_SLACK = 140;
const RETRY_TICKS = 30 * 20;
// A group sets out together: every fighter within this of the group's middle (routes are checked from there).
const ASSEMBLED_RANGE = 450;
// A group that reaches the staging point worn below this share of the force the camp calls for does not go in.
const ARRIVAL_SHARE = 0.8;
// An enemy army near the camp worth more than this share of the group ends the creep.
const ENEMY_SHARE = 0.5;
const ENEMY_RANGE = 900;
// The fight spills around the staging point (creeps chase and leash, the wounded step back): no other camp's creep may
// stand this near it. An ember group whose staging point stood 360 from a 6.9 camp lost three of three there. The point
// is looked for around the camp, facing the group first: facing it only, two camps 700 apart blocked each other and V7
// held at home for five minutes beside its natural.
const STAGING_CLEARANCE = 400;
const STAGING_TURNS = [0, 30, -30, 60, -60, 90, -90].map((degrees) => (degrees * Math.PI) / 180);
// "Near home": within this of one of V7's halls. Camps worth creeping for their own sake are the ones near home (a
// natural's guard is cleared wherever the natural is), and a target farther off needs a real army (v7-far-attack).
export const V7_HOME_REACH = 1_500;

export type Camp = { center: Point; creeps: Unit[]; strength: number; reach: number };

type CreepState = NonNullable<V6PolicyMemory["creep"]>;

// Creeps whose homes stand within CAMP_LINK of one another, directly or through other creeps, are one camp.
export function neutralCamps(snapshot: GameSnapshot): Camp[] {
  const creeps = snapshot.units.filter((unit) => unit.owner === "neutral" && unit.attackDamage > 0);
  const home = (unit: Unit): Point => ({ x: unit.homeX ?? unit.x, y: unit.homeY ?? unit.y });
  const unseen = new Set(creeps);
  const camps: Camp[] = [];
  for (const seed of creeps) {
    if (!unseen.has(seed)) continue;
    unseen.delete(seed);
    const members = [seed];
    for (let index = 0; index < members.length; index += 1) {
      for (const other of [...unseen]) {
        if (distance(home(members[index]!), home(other)) > CAMP_LINK) continue;
        unseen.delete(other);
        members.push(other);
      }
    }
    const center = averagePoint(members.map(home));
    camps.push({ center, creeps: members, strength: strengthOf(members), reach: Math.max(0, ...members.map((unit) => distance(home(unit), center))) });
  }
  return camps;
}

function creepForce(units: readonly Unit[]) {
  return units.reduce((total, unit) => total + combatRating(unit), 0);
}

export function forceFor(camp: Camp) {
  return camp.strength + FORCE_MARGIN;
}

// Outside the camp, on the side facing where the group comes from (turned by `turn` radians).
export function stagingPoint(camp: Camp, from: Point, turn = 0): Point {
  const gap = distance(camp.center, from);
  const length = camp.reach + STAGING_GAP;
  const base = gap < 1 ? 0 : Math.atan2(from.y - camp.center.y, from.x - camp.center.x);
  return { x: camp.center.x + Math.cos(base + turn) * length, y: camp.center.y + Math.sin(base + turn) * length };
}

// The first staging point around the camp, facing the group first, that no other camp crowds and that the group reaches
// without passing another camp.
export function clearStaging(camp: Camp, from: Point, camps: Camp[]): Point | undefined {
  return STAGING_TURNS.map((turn) => stagingPoint(camp, from, turn)).find((staging) => stagingClear(staging, camps, camp) && routeClear(from, staging, camps, camp));
}

// No creep of another camp stands within ROUTE_CLEARANCE of the straight walk from `from` to `to`.
export function routeClear(from: Point, to: Point, camps: Camp[], target: Camp): boolean {
  return camps.every((camp) => camp === target || camp.creeps.every((creep) => segmentDistance(creep, from, to) > ROUTE_CLEARANCE));
}

function stagingClear(staging: Point, camps: Camp[], target: Camp) {
  return camps.every((camp) => camp === target || camp.creeps.every((creep) => distance(creep, staging) > STAGING_CLEARANCE));
}

function segmentDistance(point: Point, from: Point, to: Point) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length));
  return distance(point, { x: from.x + dx * t, y: from.y + dy * t });
}

// The camp V7 is in the middle of, or none: a camp is held on to by its remaining creeps (its center moves as they die).
function activeCamp(state: CreepState | undefined, camps: Camp[]): Camp | undefined {
  if (!state) return undefined;
  return camps.find((camp) => camp.creeps.some((creep) => distance({ x: creep.homeX ?? creep.x, y: creep.homeY ?? creep.y }, state.center) <= CAMP_LINK + state.reach));
}

export type CreepChoice = { camp: Camp; why: "expansion" | "creep" };

// Carry on with the camp under way. Returns undefined once it is cleared or given up (memory says which).
export function continueV7Creep(snapshot: GameSnapshot, owner: PlayerId, front: Unit[], camps: Camp[], intel: V6Intel, options: AiPolicyContext): { commands: GameCommand[]; point: Point } | undefined {
  const memory = v6Memory(options);
  const state = memory.creep;
  if (!state) return undefined;
  const camp = activeCamp(state, camps);
  const group = front.filter((unit) => state.group.includes(unit.id));
  if (!camp || group.length === 0) {
    delete memory.creep;
    if (!camp) recordPlay(memory, "creep:cleared");
    return undefined;
  }
  const force = creepForce(group);
  const giveUp = (why: string) => {
    memory.creepRetry = { center: camp.center, until: snapshot.tick + RETRY_TICKS };
    delete memory.creep;
    recordPlay(memory, `creep:${why}`);
    return undefined;
  };
  if (enemyPowerNear(intel, camp.center, ENEMY_RANGE) > strengthOf(group) * ENEMY_SHARE) return giveUp("enemy");
  if (state.stage === "engage" && force < camp.strength * ABORT_SHARE) return giveUp("abort");
  const staging = state.staging;
  if (state.stage === "gather") {
    const gathered = group.filter((unit) => distance(unit, staging) <= GATHERED_RANGE).length;
    if (gathered >= group.length * GATHERED_SHARE || snapshot.tick - state.since >= GATHER_TICKS) {
      // Worn on the way (a camp or an enemy met en route): the group does not go in short of the force the camp calls for.
      if (force < forceFor(camp) * ARRIVAL_SHARE) return giveUp("worn");
      state.stage = "engage";
      state.since = snapshot.tick;
    }
  }
  const commands: GameCommand[] = [];
  if (state.stage === "gather") {
    const walking = group.filter((unit) => distance(unit, staging) > GATHERED_RANGE && !heading(unit, staging, "attackMove"));
    if (walking.length > 0) commands.push(resolveAiCommandIntent(snapshot, owner, { type: "attackMove", unitIds: walking.map((unit) => unit.id), x: staging.x, y: staging.y }, options));
    return { commands, point: staging };
  }
  // In the camp: the badly wounded step back to the staging point (the creeps leash home), the rest fight on.
  const wounded = group.filter((unit) => unit.hp < unit.maxHp * WOUNDED_SHARE && unit.expiresTick === undefined);
  const fighting = group.filter((unit) => !wounded.includes(unit));
  const stepping = wounded.filter((unit) => distance(unit, staging) > GATHERED_RANGE && !heading(unit, staging, "move"));
  if (stepping.length > 0) commands.push(resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: stepping.map((unit) => unit.id), x: staging.x, y: staging.y }, options));
  // A rider in the middle of a charge is fighting already: an order now would only wait for the dash and then undo it.
  const joining = fighting.filter((unit) => unit.order.type !== "attack" && unit.order.type !== "charge" && !heading(unit, camp.center, "attackMove"));
  if (joining.length > 0) commands.push(resolveAiCommandIntent(snapshot, owner, { type: "attackMove", unitIds: joining.map((unit) => unit.id), x: camp.center.x, y: camp.center.y }, options));
  return { commands, point: camp.center };
}

// Start on a camp: the natural's guard when `expansionMine` is given, otherwise the best camp in `candidates`.
export function chooseV7Camp(snapshot: GameSnapshot, front: Unit[], camps: Camp[], candidates: Camp[], options: AiPolicyContext, expansionMine?: Point): CreepChoice | undefined {
  if (front.length === 0) return undefined;
  const memory = v6Memory(options);
  const from = averagePoint(front);
  // Scattered units walk their own routes: the group assembles first (the general holds it at the rally point).
  if (front.some((unit) => distance(unit, from) > ASSEMBLED_RANGE)) return undefined;
  const force = creepForce(front);
  const retry = memory.creepRetry && memory.creepRetry.until > snapshot.tick ? memory.creepRetry : undefined;
  const open = candidates.filter((camp) => forceFor(camp) <= force && (!retry || distance(camp.center, retry.center) > CAMP_LINK) && clearStaging(camp, from, camps) !== undefined);
  if (expansionMine) {
    const guard = open.find((camp) => distance(camp.center, expansionMine) <= 450);
    return guard ? { camp: guard, why: "expansion" } : undefined;
  }
  // The strongest camp the group beats, nearer ones first (V6's order).
  const best = open.sort((a, b) => b.strength - distance(b.center, from) / 500 - (a.strength - distance(a.center, from) / 500))[0];
  return best ? { camp: best, why: "creep" } : undefined;
}

export function startV7Creep(snapshot: GameSnapshot, front: Unit[], choice: CreepChoice, options: AiPolicyContext) {
  const memory = v6Memory(options);
  const from = averagePoint(front);
  memory.creep = { center: choice.camp.center, reach: choice.camp.reach, staging: clearStaging(choice.camp, from, neutralCamps(snapshot)) ?? stagingPoint(choice.camp, from), stage: "gather", since: snapshot.tick, group: front.map((unit) => unit.id) };
  recordPlay(memory, choice.why === "expansion" ? "general:clearExpansion" : "general:creep");
}

// While a camp is under way its group belongs to the general: the wounded-retreat and focus scripts leave it alone.
export function v7CreepGroupIds(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): ReadonlySet<string> {
  if (!isV7Policy(options)) return new Set();
  const group = options.memory.v6?.creep?.group ?? [];
  return new Set(group.filter((id) => snapshot.units.some((unit) => unit.id === id && unit.owner === owner)));
}

function heading(unit: Unit, point: Point, type: "move" | "attackMove") {
  const order = unit.order as { type: string; x?: number; y?: number };
  return order.type === type && order.x !== undefined && order.y !== undefined && distance({ x: order.x, y: order.y }, point) <= ORDER_SLACK;
}
