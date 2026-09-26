import type { V6PolicyMemory } from "../../memory";
import type { GameCommand, GameSnapshot, PlayerId, Unit } from "../../../shared/types";
import { resolveAiCommandIntent } from "../commands";
import { averagePoint, distance, type Point } from "../spatial";
import type { AiPolicyContext } from "../types";
import { isV6Policy, isV7Policy } from "../versions";
import { isBacklineKind } from "./backline";
import { enemyPowerNear, nextExpansionMine, readV6Intel, type V6BaseIntel, type V6Intel } from "./intel";
import { recordPlay, v6Memory } from "./memory";
import { chooseV7Camp, continueV7Creep, neutralCamps, startV7Creep, V7_HOME_REACH } from "../v7/creep";
import { v6Doctrine } from "./select";
import { marchStrength, strengthOf, TOWER_STRENGTH } from "./strength";

// @@@v6-general - One commander for the main army, deciding like AMAI's attack thread (races.eai attack_sequence_all and
// common.eai SingleMeleeAttackAM): an ordered cascade where the first branch that applies wins.
//   1. Defend a base under attack. Out in the open V6 fights only with a clear edge; otherwise it guards the hall they
//      are coming for, under its towers, and fights them there when they come in. Meeting them in the field at three
//      quarters of their strength (the first rule) fed twenty spirits to archers a thousand paces from any tower.
//   2. Keep an attack going while the fight still favors V6 (the retreat line moves with the personality's aggression)
//      and the attack group keeps half its starting strength. An attack is the group that set out, plus spirits and
//      stragglers that reach it; whatever is trained after it left waits at the rally. Sending every new unit after the
//      group walked them across the map one by one, and V6 fed 5000 gold into one base that lost 115.
//   3. Clear the camp on the next expansion mine: the economy waits on it, so it comes before any attack.
//   4. Start an attack when V6 outweighs, by a margin, every enemy army near the target and its towers (AMAI's
//      IsTargetGood), counting the army that will still stand when it arrives (spirits expire on the way). A stricter
//      gate (the owner's whole army wherever it stood, a minimum strength, spirits up) looked wiser on paper and never
//      let V6 punish an opponent that had just broken its army on V6's towers; the loose one won three times as often.
//      An army that has stood at its rally for a minute and a half only needs to match the defenders: V6 once held an
//      even army for sixteen minutes while its starving opponents rebuilt thirty archers, and the game ran out.
//      Strike and fall back: armies within reach of the target count in full, those further out at half, and an attack
//      breaks off as soon as another army closes in rather than when it arrives. Played by hand, V6 wiped V5's army at
//      V5's hall and was gone before V3's came; the same attack kept going lost everything to V3 fifteen seconds later.
//      Against an opponent's main the attack is a pulse: the army gathers out of the towers' and shooters' reach with the
//      casters holding their summons, and goes in once most of them can cast, every spirit at once. Summoners that cast
//      the moment their spell came back fed V5's thirty archers one spirit at a time for twenty-five minutes.
//   5. Otherwise creep the strongest camp it beats with room to spare, far from enemy armies, for stars and items.
//   6. Otherwise hold at a rally in front of the main.

const LOCAL_RANGE = 900;
const TARGET_REGION = 1_800;
// Armies within the local range of the target defend it in full; further out, within the target region, at this share.
const FAR_DEFENDER_SHARE = 0.5;
// Another army closing in within this range of the attack counts against it before it arrives.
const INCOMING_RANGE = 1_500;
const RALLY_STEP = 380;
// The pulse: where the army gathers (from the target hall, toward the army), when it goes, and how long it may wait.
const STAGE_DISTANCE = 850;
const STRIKE_READY_SHARE = 0.75;
const GATHERED_SHARE = 0.8;
const GATHERED_RANGE = 350;
const GATHER_TICKS = 45 * 20;
const ATTACK_MARGIN = 1.3;
const IDLE_TICKS = 90 * 20;
const JOIN_RANGE = 700;
const WORN_SHARE = 0.5;
// After a retreat the army regroups at home before it may set out again (AMAI heals its army between attacks).
const REGROUP_TICKS = 30 * 20;
// The least army (march strength, about eleven summoners with their spirits) that goes for an enemy main.
const MAIN_ATTACK_FLOOR = 18;
const V7_FAR_ATTACK_SHARE = 0.7;
const RETREAT_LINE = 0.8;
// Out in the open the army meets attackers only with this edge; under its towers or at its hall it always fights.
const FIELD_EDGE = 1.15;
const HALL_COVER = 450;
const TOWER_COVER = 60;
const GUARD_STEP = 150;
const GUARD_LEASH = 450;
// Creeps fight above their rating: casters curse, brutes soak, and a hit camp calls its neighbours (AMAI adds a bonus by
// camp color for the same reason). A camp is taken only with a wide margin; the natural's camp, which the whole economy
// waits on, with a slightly narrower one. The first version took the natural's camp at 0.8 and fed it the front, twice.
const CREEP_SHARE = 0.4;
const EXPANSION_CAMP_SHARE = 0.5;
const CAMP_RADIUS = 320;
const CAMP_CLEARANCE = 1_200;
const CAMP_REACH = 2_600;
const ORDER_SLACK = 140;

type Mode = NonNullable<V6PolicyMemory["general"]>["mode"];

export function planV6General(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  if (!isV6Policy(options)) return [];
  const memory = v6Memory(options);
  const intel = readV6Intel(snapshot, owner, options);
  const { profile } = v6Doctrine(snapshot, owner, options);
  const busy = new Set([...(memory.raid?.unitIds ?? []), ...(memory.closeout?.unitIds ?? [])]);
  const front = intel.army.filter((unit) => !busy.has(unit.id) && !isBacklineKind(unit) && unit.attackDamage > 0);
  const rally = rallyPoint(intel);
  if (front.length === 0) {
    // No front left (every spirit gone): a gathering pulse is over, or its casters would hold their summons forever and
    // no front would ever come back (44 pyre callers stood at home without a spirit for twenty minutes).
    if (memory.general?.stage === "gather") memory.general = { mode: "hold", target: rally };
    return [];
  }
  const available = intel.army.filter((unit) => !busy.has(unit.id));
  const strength = strengthOf(available);
  const current = memory.general;

  const defense = defendTarget(intel);
  if (defense) {
    if (isV7Policy(options)) delete memory.creep;
    if (defense.inCover || strength >= defense.threat * FIELD_EDGE) return order(snapshot, owner, memory, "defend", front, defense.point, options);
    if (current?.mode !== "guard") recordPlay(memory, "general:guard");
    return order(snapshot, owner, memory, "guard", front, defense.guard, options);
  }

  if (current?.mode === "attack") {
    const target = findBase(intel, current.targetHallId);
    const group = attackGroup(available, front, current.group ?? []);
    const marching = group.filter((unit) => front.includes(unit));
    const center = marching.length > 0 ? averagePoint(marching) : undefined;
    const facing = center ? enemyPowerNear(intel, center, LOCAL_RANGE) + enemyTowersNear(intel, center, 520) * TOWER_STRENGTH : 0;
    const worn = marchStrength(group) < (current.groupStart ?? 0) * WORN_SHARE;
    const gaps = center ? enemyGaps(intel, center) : {};
    const incoming = center ? closingPower(intel, center, gaps, current.enemyGaps ?? {}) : 0;
    const holds = strengthOf(group) * (1 + profile.aggression) >= facing * RETREAT_LINE;
    const outrun = strengthOf(group) * (1 + profile.aggression) < (facing + incoming) * RETREAT_LINE;
    if (target && center && !worn && holds && !outrun) return attack(snapshot, owner, memory, group, front, target, rally, current.groupStart ?? 0, options, gaps, isMain(intel, target));
    recordPlay(memory, worn ? "general:retreat:worn" : holds && outrun ? "general:retreat:incoming" : "general:retreat");
    memory.retreatedAt = snapshot.tick;
  }

  const camps = creepCamps(snapshot, intel);
  // V7 creeps with its own procedure (see v7-creeping): a camp under way is finished first, the natural's guard next.
  const v7Camps = isV7Policy(options) ? neutralCamps(snapshot) : [];
  const v7Reachable = v7Camps.filter((camp) => distance(camp.center, intel.home) <= CAMP_REACH && enemyPowerNear(intel, camp.center, CAMP_CLEARANCE) === 0);
  const v7NearHome = v7Reachable.filter((camp) => [intel.home, ...intel.ownHalls].some((hall) => distance(hall, camp.center) <= V7_HOME_REACH));
  if (isV7Policy(options)) {
    const under = continueV7Creep(snapshot, owner, front, v7Camps, intel, options);
    if (under) return creepOrders(memory, under);
    const mine = v7WantsBase(snapshot, owner, options) ? nextExpansionMine(snapshot, intel) : undefined;
    const guard = mine ? chooseV7Camp(snapshot, front, v7Camps, v7Reachable, options, mine) : undefined;
    if (guard) {
      startV7Creep(snapshot, front, guard, options);
      const started = continueV7Creep(snapshot, owner, front, v7Camps, intel, options);
      if (started) return creepOrders(memory, started);
    }
  }
  const natural = isV7Policy(options) ? undefined : expansionCamp(snapshot, intel, camps, strength);
  if (natural) {
    if (current?.mode !== "creep" || !current.target || distance(current.target, natural) > CAMP_RADIUS) recordPlay(memory, "general:clearExpansion");
    return order(snapshot, owner, memory, "creep", front, natural, options);
  }

  const target = attackTarget(intel);
  const idle = current?.mode === "hold" && snapshot.tick - (current.holdingSince ?? snapshot.tick) >= IDLE_TICKS;
  const marching = marchStrength(available) * (1 + profile.aggression);
  const regrouped = snapshot.tick - (memory.retreatedAt ?? -REGROUP_TICKS) >= REGROUP_TICKS;
  // A main is a long walk into two armies' reach: V6 marched four summoners at an enemy main 3165 away at 240s because both
  // armies had left it, met them on the way, and came home to lose its own. An expansion needs no such floor.
  const ready = !isMain(intel, target?.base) || marching >= MAIN_ATTACK_FLOOR;
  // @@@v7-far-attack - Against two opponents a march across the map meets both armies on the way: V7 sent five ravagers at
  // an expansion 1650 away at 5:20 because they had idled at the rally, and lost all five before 7:00. A target far from
  // V7's halls waits for an army worth most of the two opponents' together; one near home is still fair game.
  const farOff = isV7Policy(options) && target !== undefined && ![intel.home, ...intel.ownHalls].some((hall) => distance(hall, target.base.hall) <= V7_HOME_REACH);
  const committed = !farOff || marching >= intel.enemies.reduce((total, enemy) => total + enemy.power, 0) * V7_FAR_ATTACK_SHARE;
  if (target && regrouped && ready && committed && (marching >= target.need || (idle && marching >= target.defended))) {
    recordPlay(memory, `general:attack:${marching >= target.need ? target.why : "idleArmy"}`);
    return attack(snapshot, owner, memory, available, front, target.base, rally, marchStrength(available), options, {}, isMain(intel, target.base));
  }

  if (isV7Policy(options)) {
    const dominant = strength >= intel.enemies.reduce((total, enemy) => total + enemy.power, 0);
    const choice = chooseV7Camp(snapshot, front, v7Camps, v7NearHome.filter((candidate) => dominant || onOwnSide(intel, candidate.center)), options);
    if (choice) {
      startV7Creep(snapshot, front, choice, options);
      const started = continueV7Creep(snapshot, owner, front, v7Camps, intel, options);
      if (started) return creepOrders(memory, started);
    }
    return order(snapshot, owner, memory, "hold", front, rally, options);
  }
  const camp = creepCamp(intel, camps, strength, current?.mode === "creep" ? current.target : undefined);
  if (camp) {
    if (current?.mode !== "creep" || !current.target || distance(current.target, camp) > CAMP_RADIUS) recordPlay(memory, "general:creep");
    return order(snapshot, owner, memory, "creep", front, camp, options);
  }
  return order(snapshot, owner, memory, "hold", front, rally, options);
}

// @@@v7-wanted-base - The next expansion's guard is cleared only while the phase wants a base V7 has not started. With its
// natural rising, V7 walked its six footmen 2100 from home to the third mine's camp (duskGrove, 3:45); three ravagers killed
// the natural's five builders and miners meanwhile, and the footmen, hurrying back, met the second army on the way.
function v7WantsBase(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): boolean {
  const phases = v6Doctrine(snapshot, owner, options).strategy.phases;
  const phase = phases[Math.min(v6Memory(options).phase ?? 0, phases.length - 1)];
  const wanted = Math.max(0, ...(phase?.wants ?? []).map((want) => ("bases" in want ? want.bases : 0)));
  return wanted > snapshot.buildings.filter((building) => building.owner === owner && building.kind === "townHall").length;
}

function creepOrders(memory: V6PolicyMemory, under: { commands: GameCommand[]; point: Point }): GameCommand[] {
  memory.general = { mode: "creep", target: { x: under.point.x, y: under.point.y } };
  return under.commands;
}

// The attackers, the hall they are nearest, and whether any of them is already where the towers or the hall's defenders
// reach; the guard point is just in front of that hall, toward them.
function defendTarget(intel: V6Intel) {
  const intrusion = intel.intrusion;
  if (!intrusion) return undefined;
  const point = averagePoint(intrusion.attackers);
  const hall = intel.ownHalls.reduce<Point | undefined>((best, candidate) => (!best || distance(candidate, point) < distance(best, point) ? candidate : best), undefined) ?? intel.home;
  const inCover = intrusion.attackers.some((unit) => distance(unit, hall) <= HALL_COVER || intel.ownTowers.some((tower) => distance(tower, unit) <= tower.attackRange + TOWER_COVER));
  return { point, threat: intrusion.threat, inCover, guard: toward(hall, point, GUARD_STEP) };
}

function toward(from: Point, to: Point, length: number): Point {
  const gap = distance(from, to);
  return gap < 1 ? from : { x: from.x + ((to.x - from.x) / gap) * Math.min(length, gap), y: from.y + ((to.y - from.y) / gap) * Math.min(length, gap) };
}

function attackTarget(intel: V6Intel): { base: V6BaseIntel; need: number; defended: number; why: string } | undefined {
  const choices = intel.enemies.flatMap((enemy) => {
    const main = mainHall(enemy);
    return targetBases(enemy, intel).map((base) => {
      // An expansion is judged by what stands at it: the owner's army back at its main is the fall-back rule's business.
      // Played by hand, killing each new hall as it went up kept both opponents on one base and six workers.
      const expansion = base.hall.id !== main?.id;
      const defenders = intel.enemies.reduce(
        (total, other) =>
          total +
          strengthOf(other.army.filter((unit) => distance(unit, base.hall) <= LOCAL_RANGE)) +
          (expansion ? 0 : strengthOf(other.army.filter((unit) => distance(unit, base.hall) > LOCAL_RANGE && distance(unit, base.hall) <= TARGET_REGION)) * FAR_DEFENDER_SHARE),
        0,
      );
      const why = enemy.power < 2 ? "beaten" : expansion ? "expansion" : enemy.state === "creeping" || enemy.state === "away" ? "armyAway" : "stronger";
      const defended = defenders + base.towers.length * TOWER_STRENGTH;
      return { base, need: defended * ATTACK_MARGIN + 2, defended, why };
    });
  });
  return choices.sort((a, b) => a.need - b.need)[0];
}

// An opponent's main is the hall its other buildings stand around.
function mainHall(enemy: V6Intel["enemies"][number]) {
  return enemy.bases
    .map((base) => ({ hall: base.hall, around: enemy.buildings.filter((building) => distance(building, base.hall) <= 700).length }))
    .sort((a, b) => b.around - a.around)[0]?.hall;
}

type Camp = { center: Point; strength: number };

// A camp is the creeps standing together around one home point.
function creepCamps(snapshot: GameSnapshot, intel: V6Intel): Camp[] {
  const camps: Camp[] = [];
  for (const creep of snapshot.units.filter((unit) => unit.owner === "neutral" && unit.kind !== "spirit" && unit.attackDamage > 0)) {
    const home = { x: creep.homeX ?? creep.x, y: creep.homeY ?? creep.y };
    const camp = camps.find((candidate) => distance(candidate.center, home) <= CAMP_RADIUS);
    if (camp) camp.strength += strengthOf([creep]);
    else camps.push({ center: home, strength: strengthOf([creep]) });
  }
  return camps.filter((camp) => distance(camp.center, intel.home) <= CAMP_REACH && enemyPowerNear(intel, camp.center, CAMP_CLEARANCE) === 0);
}

function expansionCamp(snapshot: GameSnapshot, intel: V6Intel, camps: Camp[], strength: number): Point | undefined {
  const mine = nextExpansionMine(snapshot, intel);
  if (!mine) return undefined;
  return camps.find((camp) => distance(camp.center, mine) <= 450 && camp.strength <= strength * EXPANSION_CAMP_SHARE)?.center;
}

// The strongest camp V6 beats with room to spare, nearer ones first; it sticks with the camp it chose until it is cleared.
// Only camps on V6's side of the map (nearer its halls than any enemy hall) unless V6 outweighs every enemy army together:
// V6 went creeping 2150 from home beside V5's natural, and V5's army, 1900 away when it set out, caught it at the camp.
function creepCamp(intel: V6Intel, camps: Camp[], strength: number, chosen: Point | undefined): Point | undefined {
  const dominant = strength >= intel.enemies.reduce((total, enemy) => total + enemy.power, 0);
  const beatable = camps.filter((camp) => camp.strength <= strength * CREEP_SHARE && (dominant || onOwnSide(intel, camp.center)));
  const kept = chosen && beatable.find((camp) => distance(camp.center, chosen) <= CAMP_RADIUS);
  if (kept) return kept.center;
  return beatable.sort((a, b) => b.strength - distance(b.center, intel.home) / 500 - (a.strength - distance(a.center, intel.home) / 500))[0]?.center;
}

function onOwnSide(intel: V6Intel, point: Point) {
  const own = Math.min(...[intel.home, ...intel.ownHalls].map((hall) => distance(hall, point)));
  const enemy = Math.min(Infinity, ...intel.enemies.flatMap((enemy) => enemy.bases.map((base) => distance(base.hall, point))));
  return own < enemy;
}

// The group that set out, and any of V6's units that have reached it since (spirits cast on the way, stragglers).
function attackGroup(available: Unit[], front: Unit[], ids: string[]): Unit[] {
  const members = available.filter((unit) => ids.includes(unit.id));
  const marching = members.filter((unit) => front.includes(unit));
  if (marching.length === 0) return members;
  const center = averagePoint(marching);
  return available.filter((unit) => ids.includes(unit.id) || distance(unit, center) <= JOIN_RANGE);
}

function attack(snapshot: GameSnapshot, owner: PlayerId, memory: V6PolicyMemory, group: Unit[], front: Unit[], target: V6BaseIntel, rally: Point, groupStart: number, options: AiPolicyContext, gaps: Record<string, number> = {}, main = false): GameCommand[] {
  const marching = front.filter((unit) => group.includes(unit));
  const waiting = front.filter((unit) => !group.includes(unit));
  const pulse = main ? pulseStage(snapshot, memory, group, marching, target) : undefined;
  memory.general = {
    mode: "attack",
    target: { x: target.hall.x, y: target.hall.y },
    targetHallId: target.hall.id,
    group: group.map((unit) => unit.id),
    groupStart,
    enemyGaps: gaps,
    ...(pulse ? { stage: pulse.stage, stageSince: pulse.since } : {}),
  };
  const goal = pulse?.stage === "gather" ? pulse.point : target.hall;
  return [...orderUnits(snapshot, owner, "attack", marching, goal, options), ...orderUnits(snapshot, owner, "hold", waiting, rally, options)];
}

// Gather out of reach until most casters can summon (or the wait runs out), then strike; a new attack gathers again.
function pulseStage(snapshot: GameSnapshot, memory: V6PolicyMemory, group: Unit[], marching: Unit[], target: V6BaseIntel) {
  const current = memory.general?.mode === "attack" && memory.general.targetHallId === target.hall.id ? memory.general : undefined;
  const center = marching.length > 0 ? averagePoint(marching) : target.hall;
  const point = toward(target.hall, center, STAGE_DISTANCE);
  if (current?.stage === "strike") return { stage: "strike" as const, since: current.stageSince ?? snapshot.tick, point };
  const since = current?.stage === "gather" ? (current.stageSince ?? snapshot.tick) : snapshot.tick;
  const casters = group.filter(isSummoner);
  const ready = casters.filter((unit) => unit.cooldown === 0).length >= casters.length * STRIKE_READY_SHARE;
  const gathered = marching.filter((unit) => distance(unit, point) <= GATHERED_RANGE).length >= marching.length * GATHERED_SHARE;
  if ((ready && gathered) || snapshot.tick - since >= GATHER_TICKS) {
    recordPlay(memory, "general:pulse");
    return { stage: "strike" as const, since: snapshot.tick, point };
  }
  return { stage: "gather" as const, since, point };
}

function isSummoner(unit: Unit) {
  return unit.kind === "summoner" || unit.kind === "pyreCaller";
}

function isMain(intel: V6Intel, base: V6BaseIntel | undefined) {
  if (!base) return false;
  const enemy = intel.enemies.find((candidate) => candidate.owner === base.owner);
  return Boolean(enemy && mainHall(enemy)?.id === base.hall.id);
}

function order(snapshot: GameSnapshot, owner: PlayerId, memory: V6PolicyMemory, mode: Mode, front: Unit[], point: Point, options: AiPolicyContext): GameCommand[] {
  const holdingSince = mode === "hold" ? (memory.general?.mode === "hold" ? (memory.general.holdingSince ?? snapshot.tick) : snapshot.tick) : undefined;
  memory.general = { mode, target: { x: point.x, y: point.y }, ...(holdingSince !== undefined ? { holdingSince } : {}) };
  return orderUnits(snapshot, owner, mode, front, point, options);
}

function orderUnits(snapshot: GameSnapshot, owner: PlayerId, mode: Mode, front: Unit[], point: Point, options: AiPolicyContext): GameCommand[] {
  // Holding and guarding keep the army on a short leash: a unit chasing a retreating enemy out past the towers is called
  // back (spirits chased V5's raiders from the rally to 1400 paces from home, and died there to the archers behind them).
  const leash = mode === "guard" || mode === "hold" ? GUARD_LEASH : LOCAL_RANGE;
  const straying = front.filter((unit) => {
    if ((mode === "hold" || mode === "guard") && distance(unit, point) <= 350 && (unit.order.type === "idle" || unit.order.type === "attack")) return false;
    const going = unit.order.type === "attackMove" && distance(unit.order, point) <= ORDER_SLACK;
    const fighting = unit.order.type === "attack" && distance(unit, point) <= leash;
    return !going && !fighting;
  });
  if (straying.length === 0) return [];
  return [resolveAiCommandIntent(snapshot, owner, { type: "attackMove", unitIds: straying.map((unit) => unit.id), x: point.x, y: point.y }, options)];
}

// How far each enemy army's center stands from the attack.
function enemyGaps(intel: V6Intel, center: Point): Record<string, number> {
  return Object.fromEntries(intel.enemies.filter((enemy) => enemy.center).map((enemy) => [enemy.owner, distance(enemy.center!, center)]));
}

// The armies not yet in the fight that are within reach and nearer than at the last look: what arrives next.
function closingPower(intel: V6Intel, center: Point, gaps: Record<string, number>, before: Record<string, number>) {
  return intel.enemies.reduce((total, enemy) => {
    const gap = gaps[enemy.owner];
    const was = before[enemy.owner];
    if (gap === undefined || was === undefined || gap > INCOMING_RANGE || gap >= was) return total;
    return total + strengthOf(enemy.army.filter((unit) => distance(unit, center) > LOCAL_RANGE));
  }, 0);
}

function rallyPoint(intel: V6Intel): Point {
  const enemies = intel.enemies.flatMap((enemy) => enemy.bases.map((base) => base.hall));
  if (enemies.length === 0) return intel.home;
  const toward = averagePoint(enemies);
  const gap = distance(intel.home, toward);
  return gap < 1 ? intel.home : { x: intel.home.x + ((toward.x - intel.home.x) / gap) * RALLY_STEP, y: intel.home.y + ((toward.y - intel.home.y) / gap) * RALLY_STEP };
}

function findBase(intel: V6Intel, hallId: string | undefined) {
  return intel.enemies.flatMap((enemy) => targetBases(enemy, intel)).find((base) => base.hall.id === hallId);
}

// What V6 attacks of an opponent: its halls, or, once no hall is left, the building nearest V6's home. An opponent down
// to one farm and one unit still counts; the general only ever looked for halls, and V6 stood at home with 124 units
// for twenty-four minutes while the closeout's spirits expired on the way to the farm.
function targetBases(enemy: V6Intel["enemies"][number], intel: V6Intel): V6BaseIntel[] {
  if (enemy.bases.length > 0 || enemy.buildings.length === 0) return enemy.bases;
  const building = enemy.buildings.reduce((best, candidate) => (distance(candidate, intel.home) < distance(best, intel.home) ? candidate : best));
  const defenders = enemy.army.filter((unit) => distance(unit, building) <= 700);
  return [{ hall: building, owner: enemy.owner, workers: [], towers: [], defenders, defense: strengthOf(defenders) }];
}

function enemyTowersNear(intel: V6Intel, point: Point, range: number) {
  return intel.enemies.reduce((total, enemy) => total + enemy.buildings.filter((building) => building.kind === "defenseTower" && building.complete && distance(building, point) <= range).length, 0);
}
