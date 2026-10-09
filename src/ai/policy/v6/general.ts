import { SIM_TICKS_PER_SECOND } from "../../../shared/time";
import { canCast } from "../../../shared/ability-cooldowns";
import { HIGH_UPKEEP_SUPPLY, constructionStartHp, unitMover } from "../../../shared/catalog";
import { constructionWorkers } from "../../../shared/construction";
import { walkingDistance } from "../../../shared/terrain";
import type { V6PolicyMemory } from "../../memory";
import type { GameCommand, GameSnapshot, PlayerId, Unit } from "../../../shared/types";
import { resolveAiCommandIntent } from "../commands";
import { sameGroundAs } from "../ground";
import { enemyUnits } from "../snapshot";
import { averagePoint, distance, type Point } from "../spatial";
import type { AiPolicyContext } from "../types";
import { isV6Policy, isV7Policy, isV8Policy, isV9Policy } from "../versions";
import { isBacklineKind } from "./backline";
import { enemyPowerNear, mineGuards, nextExpansionMine, readV6Intel, v9ExpansionMine, v9ExpansionTolerance, v9Fleeing, type V6BaseIntel, type V6Intel } from "./intel";
import { activeMiningBaseCount } from "../expansion-model";
import { recordPlay, v6Memory } from "./memory";
import { chooseV7Camp, continueV7Creep, neutralCamps, startV7Creep, V7_HOME_REACH } from "../v7/creep";
import { v6Doctrine } from "./select";
import { v9FrontPoint } from "../v9/front";
import { marchArrived, marchHeading } from "../v9/march";
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
// @@@v8-attack-margin - V8 sets out only against a base it outweighs 1.6 times (the rest 1.3): in V8's lost games its army
// went down attacking enemy bases between minutes 6 and 14, and the push that followed took its home. With the wider edge
// V8 won 1168 of 2000 games against 1120 (and 972 against 940 before it fielded knights).
const V8_ATTACK_MARGIN = 1.6;

// The edge the general sets out with against a base: what its army must outweigh the base's defence by. A transport's
// crossing to a base on other ground asks the same edge (see @@@transport-attack).
export function attackMargin(options: AiPolicyContext) {
  return isV8Policy(options) ? V8_ATTACK_MARGIN : ATTACK_MARGIN;
}
const IDLE_TICKS = 90 * 20;
const JOIN_RANGE = 700;
const WORN_SHARE = 0.5;
// After a retreat the army regroups at home before it may set out again (AMAI heals its army between attacks).
const REGROUP_TICKS = 30 * 20;
// The least army (march strength, about eleven summoners with their spirits) that goes for an enemy main.
const MAIN_ATTACK_FLOOR = 18;
// @@@v9-strike-from-fortress - Once its towers stand (see v9-fortress), V9 goes for an opponent's main with far less: its
// home is the towers' to hold, and the one opponent it can finish is the weak one. By hand, eleven lancers razed a rival
// main's tower, archers and workers at 9:40 (ladder-39, v5-extra-11) and that rival never mined again, while the AI held
// them at home for want of an army of 18.
const V9_MAIN_ATTACK_FLOOR = 8;
const V9_FORTRESS_TOWERS = 5;
const V7_FAR_ATTACK_SHARE = 0.7;
// @@@v9-far-attack - V9 goes after a far base only outweighing what can reach it first: at 0.7 of it, five ravagers set out
// for V8's natural against V8's five nearer it (5.0 to 4.8), met them under two towers raised while they walked, and all
// five died for three of V8's (cobaltVale, generated, 4:45); V9 trailed for the rest of the game. Of 8000 nudged duels
// against V8 V9 won 5866 at 0.7, 6424 at 1.2, 6536 at 1.5 and 6332 at 2 (on forty unseen seeds 6307 at 1.2, 6493 at 1.5).
const V9_FAR_ATTACK_SHARE = 1.5;
const V9_STALE_TICKS = 3 * 90 * 20;
// @@@v9-home-first - V9 does not go creeping while an enemy army worth half its own pushes at its bases: at 8:00 V8's army
// of 11 walked at V9's natural, 1165 from it, while V9's army of 9 set out for camps 1000 the other way; V8 reached the
// natural at 8:40, V9 came back to it in pieces and lost six of eight (marbleGrove, generated). Without the creeping V9
// won 6591 of 8000 nudged duels against V8 against 6536, and 6536 against 6493 on forty unseen seeds.
const V9_PUSHED_SHARE = 0.5;
// @@@v9-fall-back - Outweighed by the armies pushing at it (worth more than V9_FALL_BACK_SHARE times its own), V9 holds at
// home, under its main's towers, not at its front: met at the front, 650 out, 800 gold of V9's against 1600 struck at its
// main lost 0.34 of what they traded and its two towers never fired, where V8, holding at home, lost 0.12 and beat twelve
// ravagers outright (the V9 exam's S8, 24 cells of 24). Even (S1, the whole army), the front holds better than home: V9
// gained 0.07 on V8 there. Against three, 267 of 500 games won against 271 without it.
const V9_FALL_BACK_SHARE = 1.2;
// @@@v9-fortress-creep - With its towers standing V9 creeps (and so expands) though an enemy army is about its bases: against
// three, one nearly always is, and V9 never took a third mine while it waited for none (1000 games on ladder maps).
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
// A shooter reaches past arm's length (melee reach is under 80, casters' and shooters' over 200); in its reach plus a margin
// a fighter is under its fire.
const SHOOTER_REACH = 100;
const FIRE_MARGIN = 20;

type Mode = NonNullable<V6PolicyMemory["general"]>["mode"];

export function planV6General(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  if (!isV6Policy(options)) return [];
  return planV6Army(snapshot, owner, options, readV6Intel(snapshot, owner, options), {
    reinforcements: "rally", expansionBasis: "halls", pursue: () => true,
  });
}

export function availableV6Army(snapshot: GameSnapshot, options: AiPolicyContext, intel: V6Intel): Unit[] {
  const memory = v6Memory(options);
  const busy = new Set([...(memory.raid?.unitIds ?? []), ...(memory.closeout?.unitIds ?? []), ...(options.memory.support?.unitIds ?? []), ...Object.values(options.memory.naval?.ferries ?? {}).flatMap((ferry) => ferry.crewIds)]);
  return intel.army.filter((unit) => !busy.has(unit.id) && unit.order.type !== "board" && sameGroundAs(snapshot, intel.home, unit));
}

type ArmyPlan = {
  reinforcements: "rally" | "siege";
  expansionBasis: "halls" | "mines";
  pursue: (defense: { hall: Point; field: Point; leash: number | undefined }) => boolean;
};

export function planV6Army(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel, plan: ArmyPlan): GameCommand[] {
  const { reinforcements, expansionBasis, pursue } = plan;
  const memory = v6Memory(options);
  const { profile, strategy } = v6Doctrine(snapshot, owner, options);
  const available = availableV6Army(snapshot, options, intel);
  const front = available.filter((unit) => !isBacklineKind(unit) && unit.attackDamage > 0);
  const strength = strengthOf(available);
  // V9 holds at its front (see v9-front), by the mine of the base it wants next while that mine is clear (see v9-escort),
  // and at home under its towers while the armies closing on it outweigh it (see v9-fall-back).
  const outweighed = isV9Policy(options) && intel.enemies.filter((enemy) => enemy.state === "pushing").reduce((total, enemy) => total + enemy.power, 0) > strength * V9_FALL_BACK_SHARE;
  const rally = isV9Policy(options) && !outweighed ? (v9EscortPoint(snapshot, owner, intel, options) ?? v9FrontPoint(snapshot, owner, intel)) : rallyPoint(intel);
  if (front.length === 0) {
    // No front left (every spirit gone): a gathering pulse is over, or its casters would hold their summons forever and
    // no front would ever come back (44 pyre callers stood at home without a spirit for twenty minutes).
    if (memory.general?.stage === "gather") memory.general = { mode: "hold", target: rally };
    return [];
  }
  const current = memory.general;

  const defense = isV7Policy(options) ? v7DefendTarget(intel, options) : defendTarget(intel);
  if (defense && isV7Policy(options) && current?.mode === "attack") {
    const target = findBase(intel, current.targetHallId);
    const group = attackGroup(available, front, current.group ?? []);
    if (target && canTradeBases(intel, group, target)) {
      if (!current.baseTrade) recordPlay(memory, "general:baseTrade");
      const commands = attack(snapshot, owner, memory, group, front, target, rally, current.groupStart ?? marchStrength(group), options, reinforcements, {}, isMain(intel, target));
      memory.general!.baseTrade = true;
      return commands;
    }
  }
  if (defense) {
    if (isV7Policy(options)) delete memory.creep;
    const edge = current?.mode === "defend" ? defense.stay : defense.edge;
    // V7's badly wounded step back to the hall behind the line (see v7-one-voice); the rest hold it.
    const wounded = isV7Policy(options) ? front.filter((unit) => unit.hp < unit.maxHp * V7_WOUNDED_SHARE && unit.expiresTick === undefined) : [];
    const line = front.filter((unit) => !wounded.includes(unit));
    if (isV8Policy(options) && waitsForTowers(intel, defense, strength, line)) return towerWait(snapshot, owner, memory, line, defense, options);
    // With a clear edge V7 meets the attackers where they stand and destroys them (see v7-defend).
    if (isV7Policy(options) && strength >= defense.threat * FIELD_EDGE && pursue(defense)) return [...order(snapshot, owner, memory, "defend", line, defense.field, options), ...stepBack(snapshot, owner, wounded, defense.hall, options)];
    if (defense.inCover || strength + defense.cover >= defense.threat * edge) return [...order(snapshot, owner, memory, "defend", line, defense.point, options, defense.leash), ...stepBack(snapshot, owner, wounded, defense.hall, options)];
    if (current?.mode !== "guard") recordPlay(memory, "general:guard");
    return [...order(snapshot, owner, memory, "guard", line, defense.guard, options), ...stepBack(snapshot, owner, wounded, intel.home, options)];
  }
  // @@@v9-pursue - Intruders V9 has beaten are chased while they run, with the field edge it defends with, until they are
  // back by their own halls: V7's five summoners, their footmen dead, walked home from V9's natural and sent their spirits
  // at it from there while V9 held, 19 of 24 times to the end (the V9 exam's S2, the whole army).
  const fleeing = isV9Policy(options) && current?.mode === "defend" ? v9Fleeing(intel, averagePoint(front)) : [];
  if (fleeing.length > 0 && strength >= strengthOf(fleeing) * FIELD_EDGE) return order(snapshot, owner, memory, "defend", front, averagePoint(fleeing), options);

  // With a single working mine, secure the requested replacement before continuing a distant assault.
  const miningFirst = expansionBasis === "mines" && activeMiningBaseCount(snapshot, owner) <= 1;
  if (!miningFirst) {
    const continued = continueArmyAttack(snapshot, owner, options, intel, available, front, rally, reinforcements, profile.aggression);
    if (continued) return continued;
  }

  if (isV8Policy(options) && strategy.risingStrike) {
    const rising = risingHallAttack(snapshot, owner, memory, intel, available, front, rally, profile.aggression, options);
    if (rising) return rising;
  }

  const camps = creepCamps(snapshot, intel);
  // V7 creeps with its own procedure (see v7-creeping): a camp under way is finished first, the natural's guard next.
  const v7Camps = isV7Policy(options) ? neutralCamps(snapshot).filter((camp) => camp.creeps.some((creep) => sameGroundAs(snapshot, intel.home, { x: creep.homeX ?? creep.x, y: creep.homeY ?? creep.y }))) : [];
  // V9 takes on a camp with enemies about, if they are worth under half its army (see v9-contested-creep).
  const tolerance = isV9Policy(options) ? v9ExpansionTolerance(intel) : 0;
  const v7Uncontested = v7Camps.filter((camp) => enemyPowerNear(intel, camp.center, CAMP_CLEARANCE) <= tolerance);
  const v7Reachable = v7Uncontested.filter((camp) => distance(camp.center, intel.home) <= CAMP_REACH);
  const v7NearHome = v7Reachable.filter((camp) => [intel.home, ...intel.ownHalls].some((hall) => distance(hall, camp.center) <= V7_HOME_REACH));
  // V9 creeps nothing while an enemy army worth half its own pushes at its bases (see v9-home-first).
  // Its towers standing (see v9-fortress), V9 leaves home to them and creeps on (see v9-fortress-creep).
  const fortified = isV9Policy(options) && intel.ownTowers.length >= V9_FORTRESS_TOWERS;
  const pushed = isV9Policy(options) && !fortified && intel.enemies.some((enemy) => enemy.state === "pushing" && enemy.power >= strength * V9_PUSHED_SHARE);
  if (isV7Policy(options) && !pushed) {
    const under = continueV7Creep(snapshot, owner, front, v7Camps, intel, options);
    if (under) return creepOrders(memory, under);
    const mine = !v7WantsBase(snapshot, owner, options, expansionBasis) ? undefined : isV9Policy(options) ? v9ExpansionMine(snapshot, intel) : nextExpansionMine(snapshot, intel);
    const guard = mine ? chooseV7Camp(snapshot, front, v7Camps, expansionBasis === "mines" ? v7Uncontested : v7Reachable, options, mine) : undefined;
    if (guard) {
      startV7Creep(snapshot, front, guard, options);
      const started = continueV7Creep(snapshot, owner, front, v7Camps, intel, options);
      if (started) return creepOrders(memory, started);
    }
  }
  if (miningFirst) {
    const continued = continueArmyAttack(snapshot, owner, options, intel, available, front, rally, reinforcements, profile.aggression);
    if (continued) return continued;
  }
  const natural = isV7Policy(options) ? undefined : expansionCamp(snapshot, intel, camps, strength);
  if (natural) {
    if (current?.mode !== "creep" || !current.target || distance(current.target, natural) > CAMP_RADIUS) recordPlay(memory, "general:clearExpansion");
    return order(snapshot, owner, memory, "creep", front, natural, options);
  }

  const target = attackTarget(intel, attackMargin(options));
  const idle = current?.mode === "hold" && snapshot.tick - (current.holdingSince ?? snapshot.tick) >= IDLE_TICKS;
  const marching = marchStrength(available) * (1 + profile.aggression);
  const regrouped = snapshot.tick - (memory.retreatedAt ?? -REGROUP_TICKS) >= REGROUP_TICKS;
  // A main is a long walk into two armies' reach: V6 marched four summoners at an enemy main 3165 away at 240s because both
  // armies had left it, met them on the way, and came home to lose its own. An expansion needs no such floor.
  const mainFloor = isV9Policy(options) && intel.ownTowers.length >= V9_FORTRESS_TOWERS ? V9_MAIN_ATTACK_FLOOR : MAIN_ATTACK_FLOOR;
  const exposed = target && intel.enemies.find((enemy) => enemy.owner === target.base.owner)!.power < marching * 0.5;
  const ready = !isMain(intel, target?.base) || marching >= mainFloor || (isV7Policy(options) && exposed && marching >= target!.need);
  // @@@v7-far-attack - Against two opponents a march across the map meets both armies on the way: V7 sent five ravagers at
  // an expansion 1650 away at 5:20 because they had idled at the rally, and lost all five before 7:00. A target far from
  // V7's halls waits for an army worth most of the two opponents' together; one near home is still fair game.
  const farOff = isV7Policy(options) && target !== undefined && ![intel.home, ...intel.ownHalls].some((hall) => distance(hall, target.base.hall) <= V7_HOME_REACH);
  const opposing = isV7Policy(options) && target ? respondingPower(intel, target.base, front) : intel.enemies.reduce((total, enemy) => total + enemy.power, 0);
  // @@@v9-stale-front - Two V9s (or two pairs of them) each waiting for an army worth half again the other's never moved:
  // both stood at their rallies with thirty soldiers for half an hour and the game ran out (base-sides-2,
  // pool-turtleLake-1). An army that has held V9_STALE_TICKS goes for a far target too, if it can break the base's own
  // defense (the idle army's test below). Held that long at high upkeep, where its gold comes in at 40% and its army grows
  // by a soldier a minute, it goes whatever stands at the target: two such pairs stood at 83 to 101 supply from 7:21 to the
  // end, each army's middle 1600 from the other's natural (base-sides-2).
  const stale = isV9Policy(options) && current?.mode === "hold" && snapshot.tick - (current.holdingSince ?? snapshot.tick) >= V9_STALE_TICKS;
  const maxed = stale && (snapshot.players[owner]?.supplyUsed ?? 0) >= HIGH_UPKEEP_SUPPLY;
  const committed = !farOff || stale || marching >= opposing * (isV9Policy(options) ? V9_FAR_ATTACK_SHARE : V7_FAR_ATTACK_SHARE);
  if (target && regrouped && ready && (maxed || (committed && (marching >= target.need || (idle && marching >= target.defended))))) {
    recordPlay(memory, `general:attack:${marching >= target.need ? target.why : maxed && marching < target.defended ? "maxed" : "idleArmy"}`);
    return rememberCenters(memory, intel, options, attack(snapshot, owner, memory, available, front, target.base, rally, marchStrength(available), options, reinforcements, {}, isMain(intel, target.base)));
  }

  if (isV7Policy(options)) {
    const dominant = strength >= intel.enemies.reduce((total, enemy) => total + enemy.power, 0);
    const choice = pushed ? undefined : chooseV7Camp(snapshot, front, v7Camps, v7NearHome.filter((candidate) => dominant || onOwnSide(intel, candidate.center)), options);
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

function continueArmyAttack(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel, available: Unit[], front: Unit[], rally: Point, reinforcements: "rally" | "siege", aggression: number): GameCommand[] | undefined {
  const memory = v6Memory(options), current = memory.general;
  if (current?.mode === "attack" && current.quick) {
    const target = findBase(intel, current.targetHallId);
    const strikers = front.filter((unit) => (current.group ?? []).includes(unit.id));
    if (target && !target.hall.complete && strikers.length > 0 && quickStrikeHolds(snapshot, intel, strikers, target, aggression)) return quickStrike(snapshot, owner, memory, strikers, available, target, rally, options);
    recordPlay(memory, !target || target.hall.complete ? "general:quick:done" : "general:retreat:quick");
    memory.retreatedAt = snapshot.tick;
  } else if (current?.mode === "attack") {
    const target = findBase(intel, current.targetHallId);
    const group = attackGroup(available, front, current.group ?? []);
    const marching = group.filter((unit) => front.includes(unit));
    const center = marching.length > 0 ? averagePoint(marching) : undefined;
    const facing = center ? enemyPowerNear(intel, center, LOCAL_RANGE) + enemyTowersNear(intel, center, 520) * TOWER_STRENGTH : 0;
    const worn = marchStrength(group) < (current.groupStart ?? 0) * WORN_SHARE;
    const gaps = center ? enemyGaps(intel, center) : {};
    const incoming = !center ? 0 : isV7Policy(options) ? approachingPower(intel, center, current.enemyCenters ?? {}) : closingPower(intel, center, gaps, current.enemyGaps ?? {});
    const holds = strengthOf(group) * (1 + aggression) >= facing * RETREAT_LINE;
    const outrun = strengthOf(group) * (1 + aggression) < (facing + incoming) * RETREAT_LINE;
    if (target && center && !worn && holds && !outrun) return rememberCenters(memory, intel, options, attack(snapshot, owner, memory, group, front, target, rally, current.groupStart ?? 0, options, reinforcements, gaps, isMain(intel, target)));
    recordPlay(memory, worn ? "general:retreat:worn" : holds && outrun ? "general:retreat:incoming" : "general:retreat");
    memory.retreatedAt = snapshot.tick;
  }

  return undefined;
}

// Calling an army all the way home after its hall will already have fallen throws away both sides of a base trade.
// Finish a weak enemy base only with another safe own hall, a favorable local fight, and a target already within reach.
function canTradeBases(intel: V6Intel, group: Unit[], target: V6BaseIntel): boolean {
  const intrusion = intel.intrusion;
  if (!intrusion || !group.length || target.hall.hp > target.hall.maxHp * 0.5) return false;
  const center = averagePoint(group);
  if (distance(center, target.hall) > 650 || strengthOf(group) < enemyPowerNear(intel, center, LOCAL_RANGE) + enemyTowersNear(intel, center, 520) * TOWER_STRENGTH) return false;
  const fallback = intel.ownHalls.some(hall => hall.id !== intrusion.building.id && enemyPowerNear(intel, hall, 750) === 0);
  if (!fallback) return false;
  const dps = intrusion.attackers.reduce((total, unit) => total + unit.attackDamage * 20 / Math.max(1, unit.attackCooldown), 0);
  const arrival = distance(center, intrusion.building) / Math.max(1, Math.min(...group.map(unit => unit.speed)));
  return arrival > intrusion.building.hp / Math.max(1, dps);
}

// @@@v7-wanted-base - The next expansion's guard is cleared only while the phase wants a base V7 has not started. With its
// natural rising, V7 walked its six footmen 2100 from home to the third mine's camp (duskGrove, 3:45); three ravagers killed
// the natural's five builders and miners meanwhile, and the footmen, hurrying back, met the second army on the way.
function v7WantsBase(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, basis: "halls" | "mines"): boolean {
  const phases = v6Doctrine(snapshot, owner, options).strategy.phases;
  const phase = phases[Math.min(v6Memory(options).phase ?? 0, phases.length - 1)];
  const wanted = Math.max(0, ...(phase?.wants ?? []).map((want) => ("bases" in want ? want.bases : 0)));
  const halls = snapshot.buildings.filter((building) => building.owner === owner && building.kind === "townHall");
  // Expansion purchases count working mines; their camp-clearing request must count the same bases.
  return wanted > (basis === "mines" ? activeMiningBaseCount(snapshot, owner) + halls.filter((hall) => !hall.complete).length : halls.length);
}

// @@@v9-escort - While V9 wants another base (its phase wants more than it has halls mining) and the mine it takes next
// stands clear of creeps, its front is by that mine, V9_ESCORT_STEP from it toward the front it would hold: a hall rises
// only with the army or a tower by its mine (see v9-front), and the army held at its front left the third mine bare. On
// the open ladder maps 192 of 314 looks at a missing third base found its mine cleared and unguarded by V9's own army (96
// of 231 on the old maps), and V9 had its third by 9:00 in 7 of 16 games (11 of 16).
const V9_ESCORT_STEP = 260;

function v9EscortPoint(snapshot: GameSnapshot, owner: PlayerId, intel: V6Intel, options: AiPolicyContext): Point | undefined {
  const phases = v6Doctrine(snapshot, owner, options).strategy.phases;
  const phase = phases[Math.min(v6Memory(options).phase ?? 0, phases.length - 1)];
  const wanted = Math.max(0, ...(phase?.wants ?? []).map((want) => ("bases" in want ? want.bases : 0)));
  const rising = snapshot.buildings.some((building) => building.owner === owner && building.kind === "townHall" && !building.complete);
  if (rising || wanted <= activeMiningBaseCount(snapshot, owner)) return undefined;
  const mine = v9ExpansionMine(snapshot, intel);
  if (!mine || mineGuards(snapshot, mine).length > 0) return undefined;
  return toward(mine, v9FrontPoint(snapshot, owner, intel), V9_ESCORT_STEP);
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
  return { point, field: point, threat: intrusion.threat, inCover, cover: 0, edge: FIELD_EDGE, stay: FIELD_EDGE, guard: toward(hall, point, GUARD_STEP), leash: undefined, hall };
}

// @@@v7-defend - With a clear edge (FIELD_EDGE) V7 marches at the attackers' middle as V6 does and destroys them there:
// held at its hall instead, it let V3's summoners walk away whole (cedarPass, 8:10) where marching out had cut 23 units
// to 7. Short of that edge V7 defends a base at the base, since the attackers' middle can stand a thousand paces out:
// V7's five ravagers chased spark archers and a medic 700 from their main and died one by one (wispQuarry, 4:50), and four
// footmen swung between that middle and a guard point behind the hall, walking 700 paces under seven archers' fire
// (mapleCircuit, 4:20). So the army stands just in front of the threatened hall, on the attackers' side, and fights what
// comes within its leash there, under the hall's towers and beside its workers. The main is always fought for; an
// outlying hall only with the army and the towers covering it worth most of the threat, else the army falls back to the
// main (against two armies V7 met them at a towerless natural, five against thirteen, and lost the army and the workers).
// Once it fights there it stays until the fight turns well against it: at a single bar, nine footmen swung between the
// natural and the main every second as the count wavered around it (duskGrove, 6:50). And a unit that has chased past the
// leash walks back: sent back fighting, it took up the chase again on the way (the last of them died 920 out).
const V7_DEFEND_EDGE = 0.9;
const V7_DEFEND_STAY = 0.6;
export const V7_WOUNDED_SHARE = 0.35;
const V7_DEFEND_STEP = 200;
const V7_DEFEND_LEASH = 450;

// @@@v9-defend-rising - V9 defends a hall still rising like one standing: counting only standing halls, V9's army stood in
// front of its main while V8's four ravagers razed its natural 600 paces away, rising since 3:08 (emberFen, generated,
// 3:50), with four ravagers of its own to meet them.
function v7DefendTarget(intel: V6Intel, options: AiPolicyContext) {
  const intrusion = intel.intrusion;
  if (!intrusion) return undefined;
  const attackers = averagePoint(intrusion.attackers);
  const rising = intrusion.building.kind === "townHall" && !intrusion.building.complete;
  const halls = rising ? [...intel.ownHalls, intrusion.building] : intel.ownHalls;
  const hall = halls.reduce<Point | undefined>((best, candidate) => (!best || distance(candidate, attackers) < distance(best, attackers) ? candidate : best), undefined) ?? intel.home;
  const towers = intel.ownTowers.filter((tower) => distance(tower, hall) <= tower.attackRange + TOWER_COVER);
  const main = distance(hall, intel.home) < 1;
  return { point: toward(hall, attackers, V7_DEFEND_STEP), field: attackers, threat: intrusion.threat, inCover: main, cover: towers.length * TOWER_STRENGTH, edge: V7_DEFEND_EDGE, stay: V7_DEFEND_STAY, guard: toward(intel.home, attackers, V7_DEFEND_STEP), leash: V7_DEFEND_LEASH, hall };
}

// @@@v8-in-time - What can meet V8 at a far target is the enemy army nearer that target than V8's own is: the rest arrives
// after the fight. Weighed against both opponents' whole armies, V8 never went for V7's fresh north-ridge hall while V7's
// footmen stood 1200 from it and V5's archers 2000 (cloverRun, 5:00; briarToll, 5:20). Played by hand, six and seven
// ravagers took the hall, its tower and its workers both times, and on cloverRun the AI, playing on, won the game it had
// lost. Counting only those, V8 won 1321 of 2000 games against 1225 (342 of 500 on unseen seeds against 297).
function respondingPower(intel: V6Intel, target: V6BaseIntel, front: Unit[]): number {
  const march = front.length > 0 ? distance(averagePoint(front), target.hall) : 0;
  return intel.enemies.reduce((total, enemy) => total + strengthOf(enemy.army.filter((unit) => distance(unit, target.hall) <= march)), 0);
}

// @@@v8-tower-wait - Shooters raiding a hall that a tower guards are the tower's work. V8's melee stood in front of its
// towers, took the first arrows, and chased the archers out past the towers' reach: the towers' hits called it too (a hit
// building calls idle soldiers within 330). Played by hand with the army 400 behind the hall, out of both calls, the towers
// killed eight of V5's spark archers and its medic while V8 lost nothing, and the ravagers finished the rest (runeMeadow,
// graniteBloom, hollowFord). V8 waits there until the raid is worth less than half its army, then defends as ever.
// One tower is enough since V8 raises one per hall (v8-towers-first): asking for two, the rule no longer fired at the
// main, and in the games settled between 2:00 and 4:00 (nudged replays) the lost ones had lost 1.7 fighters to V5 at home
// by 5:30 against 0.1 in the won ones. With one tower: 6466 -> 6522 of 8000 nudged tune games, losses to V5 -49.
const V8_TOWER_WAIT_TOWERS = 1;
const V8_TOWER_WAIT_STEP = 400;
const V8_TOWER_WAIT_SHARE = 0.5;
const V8_SHOOTER_SHARE = 0.6;

function waitsForTowers(intel: V6Intel, defense: { cover: number; threat: number }, strength: number, line: Unit[]): boolean {
  // Shooters can answer the raid from tower coverage; the rear waiting post is for a melee line.
  if (strengthOf(line.filter(unit => unit.attackRange > SHOOTER_REACH)) >= strengthOf(line) * V8_SHOOTER_SHARE) return false;
  const attackers = intel.intrusion?.attackers ?? [];
  const total = strengthOf(attackers);
  const shooters = strengthOf(attackers.filter((unit) => unit.attackRange > SHOOTER_REACH));
  return total > 0 && shooters >= total * V8_SHOOTER_SHARE && defense.cover >= V8_TOWER_WAIT_TOWERS * TOWER_STRENGTH && defense.threat > strength * V8_TOWER_WAIT_SHARE;
}

function towerWait(snapshot: GameSnapshot, owner: PlayerId, memory: V6PolicyMemory, line: Unit[], defense: { hall: Point; field: Point }, options: AiPolicyContext): GameCommand[] {
  const point = toward(defense.hall, defense.field, -V8_TOWER_WAIT_STEP);
  memory.general = { mode: "guard", target: { x: point.x, y: point.y } };
  const walking = line.filter((unit) => distance(unit, point) > ORDER_SLACK && !(unit.order.type === "move" && distance(unit.order, point) <= ORDER_SLACK));
  return walking.length > 0 ? [resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: walking.map((unit) => unit.id), x: point.x, y: point.y }, options)] : [];
}

// @@@v8-rising-first - An enemy hall still rising is V8's first business, ahead of the camp it is creeping, in the lines
// whose doctrine takes it (risingStrike). V7's second hall standing at 5:00 is the first split between V8's wins and
// losses (77% against 47%). Played by hand on the games V8 loses whatever small thing changes (none of six nudged
// replays won at 2, 4, 6 or 8 minutes), killing that hall by 5:10 won all four such games (runeMeadow, celadonPass,
// frostMeadow and sundialReach, the last on an unseen seed), each over every nudged replay of the hand-off, and every
// one where it stood was lost. A finished hall waits for the ordinary order of things: struck finished, V7 raised a tower
// beside it within seconds and its army and V5's arrived before it fell (quietMire, auricDelta).
// @@@v8-quick-strike - It is a quick strike, weighed against the defenders that can reach the hall before it falls, not
// against every army in the region: an army answers once the strike is at the hall, and has as long as the hall's hit
// points last to arrive. Every think the strike weighs this again with the armies where they stand, and turns back once
// one would arrive in time. Weighed like an ordinary attack, V8 set out 30 seconds late and turned back when V7's
// footmen, 1000 away, started toward it (marbleGrove, 4:36); by hand the same five lancers walked straight at the hall
// at 3:50 and razed it by 4:30 while those footmen stood at home. The strikers walk (a fight on the way is lost time)
// and strike the hall itself; the rest of the army holds the rally.
function risingHallAttack(snapshot: GameSnapshot, owner: PlayerId, memory: V6PolicyMemory, intel: V6Intel, available: Unit[], front: Unit[], rally: Point, aggression: number, options: AiPolicyContext): GameCommand[] | undefined {
  const regrouped = snapshot.tick - (memory.retreatedAt ?? -REGROUP_TICKS) >= REGROUP_TICKS;
  if (!regrouped || front.length < QUICK_MIN) return undefined;
  const center = averagePoint(front);
  const target = intel.enemies
    .flatMap((enemy) => enemy.bases)
    .filter((base) => !base.hall.complete && !isMain(intel, base) && quickStrikeHolds(snapshot, intel, front, base, aggression))
    .sort((a, b) => distance(center, a.hall) - distance(center, b.hall))[0];
  if (!target) return undefined;
  recordPlay(memory, "general:attack:rising");
  delete memory.creep;
  return quickStrike(snapshot, owner, memory, front, available, target, rally, options);
}

const QUICK_MIN = 3;
const QUICK_STRIKE_RANGE = 300;

// Whether the strikers outweigh (by V8's attack margin) the towers at the hall and every enemy fighter that can walk to it
// before the strikers bring it down.
function quickStrikeHolds(snapshot: GameSnapshot, intel: V6Intel, strikers: Unit[], target: V6BaseIntel, aggression: number) {
  const hall = target.hall;
  let arrival = 0;
  for (const unit of strikers) {
    const path = walkingDistance(snapshot.map, unit, hall, unitMover(unit.kind));
    if (path === undefined) return false;
    arrival = Math.max(arrival, Math.max(0, path - unit.attackRange - hall.radius) / unit.speed);
  }
  const builders = constructionWorkers(snapshot, hall).length;
  const growth = builders * SIM_TICKS_PER_SECOND * (hall.maxHp - constructionStartHp(hall.maxHp)) / hall.buildTime;
  const damagePerSecond = strikers.reduce((total, unit) => total + unit.attackDamage * SIM_TICKS_PER_SECOND / unit.attackCooldown, 0);
  if (damagePerSecond <= growth) return false;
  // The hall keeps gaining health while the army travels and fights. A quick strike
  // must finish before construction, and defenders have this whole window to respond.
  const window = arrival + (hall.hp + growth * arrival) / (damagePerSecond - growth);
  if (builders > 0 && window * SIM_TICKS_PER_SECOND * builders >= hall.buildTime - hall.buildProgress) return false;
  const inTime = intel.enemies.flatMap((enemy) => enemy.army).filter((unit) => Math.max(0, distance(unit, hall) - unit.attackRange) / unit.speed <= window);
  return marchStrength(strikers) * (1 + aggression) >= (strengthOf(inTime) + target.towers.length * TOWER_STRENGTH) * V8_ATTACK_MARGIN;
}

function quickStrike(snapshot: GameSnapshot, owner: PlayerId, memory: V6PolicyMemory, strikers: Unit[], available: Unit[], target: V6BaseIntel, rally: Point, options: AiPolicyContext): GameCommand[] {
  memory.general = { mode: "attack", target: { x: target.hall.x, y: target.hall.y }, targetHallId: target.hall.id, group: strikers.map((unit) => unit.id), groupStart: marchStrength(strikers), quick: true };
  const hall = target.hall;
  const near = strikers.filter((unit) => distance(unit, hall) <= QUICK_STRIKE_RANGE && !(unit.order.type === "attack" && unit.order.targetId === hall.id));
  const far = strikers.filter((unit) => distance(unit, hall) > QUICK_STRIKE_RANGE && !(unit.order.type === "move" && distance(unit.order, hall) <= ORDER_SLACK));
  const rest = available.filter((unit) => !strikers.includes(unit));
  return [
    ...(near.length > 0 ? [{ type: "attack", unitIds: near.map((unit) => unit.id), targetId: hall.id } satisfies GameCommand] : []),
    ...(far.length > 0 ? [resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: far.map((unit) => unit.id), x: hall.x, y: hall.y }, options)] : []),
    ...orderUnits(snapshot, owner, "hold", rest, rally, options),
  ];
}

function stepBack(snapshot: GameSnapshot, owner: PlayerId, wounded: Unit[], hall: Point, options: AiPolicyContext): GameCommand[] {
  const walking = wounded.filter((unit) => distance(unit, hall) > ORDER_SLACK && !(unit.order.type === "move" && distance(unit.order, hall) <= ORDER_SLACK));
  return walking.length > 0 ? [resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: walking.map((unit) => unit.id), x: hall.x, y: hall.y }, options)] : [];
}

function toward(from: Point, to: Point, length: number): Point {
  const gap = distance(from, to);
  return gap < 1 ? from : { x: from.x + ((to.x - from.x) / gap) * Math.min(length, gap), y: from.y + ((to.y - from.y) / gap) * Math.min(length, gap) };
}

function attackTarget(intel: V6Intel, margin: number): { base: V6BaseIntel; need: number; defended: number; why: string } | undefined {
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
      return { base, need: defended * margin + 2, defended, why };
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
  return camps.filter((camp) => distance(camp.center, intel.home) <= CAMP_REACH && enemyPowerNear(intel, camp.center, CAMP_CLEARANCE) === 0 && sameGroundAs(snapshot, intel.home, camp.center));
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

function isArtillery(unit: Unit) {
  return unit.kind === "ballista" || unit.kind === "catapult";
}

function attack(snapshot: GameSnapshot, owner: PlayerId, memory: V6PolicyMemory, group: Unit[], front: Unit[], target: V6BaseIntel, rally: Point, groupStart: number, options: AiPolicyContext, reinforcements: "rally" | "siege", gaps: Record<string, number> = {}, main = false): GameCommand[] {
  const marching = front.filter((unit) => group.includes(unit));
  const waiting = front.filter((unit) => !group.includes(unit));
  const waitingOrders = reinforcements === "siege"
    ? [...orderUnits(snapshot, owner, "hold", waiting.filter(isArtillery), averagePoint(group), options),
      ...orderUnits(snapshot, owner, "hold", waiting.filter(unit => !isArtillery(unit)), rally, options)]
    : orderUnits(snapshot, owner, "hold", waiting, rally, options);
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
  const goal = pulse?.stage === "gather" ? pulse.point : isV8Policy(options) ? (guardingTower(target) ?? target.hall) : target.hall;
  const siege = marching.filter(isArtillery);
  if (isV9Policy(options) && siege.length) {
    // The faster screen advances with the guns instead of fighting an entire
    // base while its artillery is still crossing the map.
    const screen = marching.filter(unit => !siege.includes(unit));
    const screenGoal = toward(averagePoint(siege), goal, GATHERED_RANGE);
    return [...orderUnits(snapshot, owner, "attack", siege, goal, options),
      ...orderUnits(snapshot, owner, "hold", screen, screenGoal, options, GATHERED_RANGE),
      ...waitingOrders];
  }
  return [...orderUnits(snapshot, owner, "attack", marching, goal, options), ...waitingOrders];
}

// Gather out of reach until most casters can summon (or the wait runs out), then strike; a new attack gathers again.
function pulseStage(snapshot: GameSnapshot, memory: V6PolicyMemory, group: Unit[], marching: Unit[], target: V6BaseIntel) {
  const current = memory.general?.mode === "attack" && memory.general.targetHallId === target.hall.id ? memory.general : undefined;
  const center = marching.length > 0 ? averagePoint(marching) : target.hall;
  const point = toward(target.hall, center, STAGE_DISTANCE);
  if (current?.stage === "strike") return { stage: "strike" as const, since: current.stageSince ?? snapshot.tick, point };
  const since = current?.stage === "gather" ? (current.stageSince ?? snapshot.tick) : snapshot.tick;
  const casters = group.filter(isSummoner);
  const ready = casters.filter(canCast).length >= casters.length * STRIKE_READY_SHARE;
  const gathered = marching.filter((unit) => distance(unit, point) <= GATHERED_RANGE).length >= marching.length * GATHERED_SHARE;
  if ((ready && gathered) || snapshot.tick - since >= GATHER_TICKS) {
    recordPlay(memory, "general:pulse");
    return { stage: "strike" as const, since: snapshot.tick, point };
  }
  return { stage: "gather" as const, since, point };
}

// The tower guarding a base, nearest its hall: V8 takes it before the hall (see v8-one-voice).
function guardingTower(base: V6BaseIntel) {
  return base.towers.filter((tower) => tower.complete).sort((a, b) => distance(a, base.hall) - distance(b, base.hall))[0];
}

function isSummoner(unit: Unit) {
  return unit.kind === "summoner" || unit.kind === "pyreCaller";
}

function isMain(intel: V6Intel, base: V6BaseIntel | undefined) {
  if (!base) return false;
  const enemy = intel.enemies.find((candidate) => candidate.owner === base.owner);
  return Boolean(enemy && mainHall(enemy)?.id === base.hall.id);
}

function order(snapshot: GameSnapshot, owner: PlayerId, memory: V6PolicyMemory, mode: Mode, front: Unit[], point: Point, options: AiPolicyContext, leash?: number): GameCommand[] {
  const holdingSince = mode === "hold" ? (memory.general?.mode === "hold" ? (memory.general.holdingSince ?? snapshot.tick) : snapshot.tick) : undefined;
  memory.general = { mode, target: { x: point.x, y: point.y }, ...(holdingSince !== undefined ? { holdingSince } : {}), ...(leash !== undefined ? { leash } : {}) };
  return orderUnits(snapshot, owner, mode, front, point, options, leash, mode === "hold" || mode === "guard");
}

function orderUnits(snapshot: GameSnapshot, owner: PlayerId, mode: Mode, front: Unit[], point: Point, options: AiPolicyContext, leashOverride?: number, returnToPost = false): GameCommand[] {
  // Holding and guarding keep the army on a short leash: a unit chasing a retreating enemy out past the towers is called
  // back (spirits chased V5's raiders from the rally to 1400 paces from home, and died there to the archers behind them).
  const leash = leashOverride ?? (mode === "guard" || mode === "hold" ? GUARD_LEASH : LOCAL_RANGE);
  // @@@v8-no-back-to-shooters - A V8 fighter inside an enemy shooter's reach is never walked back by the leash: it keeps the
  // fight it is in. Walked back under a move order it cannot answer, and the shooters it turned from follow and shoot it:
  // eight ravagers chasing ten archers 700 paces from their hall were walked home and died without a kill (mirrorHeath,
  // 7:40). Over V8's two hundred worst fights it traded 1.10 of what it lost instead of 1.05, and it won 1195 of 2000
  // games against 1173.
  const shooters = isV8Policy(options) && leashOverride !== undefined ? enemyUnits(snapshot, owner, options.teams).filter((enemy) => enemy.attackRange > SHOOTER_REACH) : [];
  const underFire = (unit: Unit) => shooters.some((enemy) => distance(enemy, unit) <= enemy.attackRange + FIRE_MARGIN);
  // V9's units still on the way walk round the camps in it (see v9-march-round-camps); every other unit heads for the point.
  const heading = isV9Policy(options) ? marchHeading(snapshot, front, point) : point;
  const aim = (unit: Unit) => (heading === point || marchArrived(unit, point) ? point : heading);
  const regrouping = isV9Policy(options) && returnToPost;
  const straying = front.filter((unit) => {
    if ((mode === "hold" || mode === "guard") && distance(unit, point) <= 350 && (unit.order.type === "idle" || unit.order.type === "attack")) return false;
    const going = (unit.order.type === "attackMove" || regrouping && unit.order.type === "move")
      && distance(unit.order, aim(unit)) <= ORDER_SLACK
      && !(regrouping && unit.order.type === "attackMove" && distance(unit, point) > leash);
    const fighting = (unit.order.type === "attack" && distance(unit, point) <= leash) || (underFire(unit) && (unit.order.type === "attack" || (unit.order.type === "attackMove" && unit.order.targetId !== undefined)));
    return !going && !fighting;
  });
  // Past an explicit leash a unit breaks off and walks back; inside it, it fights its way back to the point.
  const breaking = straying.filter((unit) => (leashOverride !== undefined && distance(unit, point) > leashOverride
    || regrouping && distance(unit, point) > leash) && !underFire(unit));
  const returning = straying.filter((unit) => !breaking.includes(unit));
  const walking = breaking.filter((unit) => !(unit.order.type === "move" && distance(unit.order, aim(unit)) <= ORDER_SLACK));
  // Units bound for the same point share one order.
  const send = (type: "move" | "attackMove", units: Unit[]) => {
    const bound = new Map<Point, string[]>();
    for (const unit of units) bound.set(aim(unit), [...(bound.get(aim(unit)) ?? []), unit.id]);
    return [...bound].map(([target, ids]) => resolveAiCommandIntent(snapshot, owner, { type, unitIds: ids, x: target.x, y: target.y }, options));
  };
  return [...send("move", walking), ...send("attackMove", returning)];
}

// How far each enemy army's center stands from the attack.
function enemyGaps(intel: V6Intel, center: Point): Record<string, number> {
  return Object.fromEntries(intel.enemies.filter((enemy) => enemy.center).map((enemy) => [enemy.owner, distance(enemy.center!, center)]));
}

// @@@v8-approach - For V8 an army is incoming when it has itself walked toward V8's army since the last look, not when the
// gap shrank: marching at an enemy base shrinks the gap to every army standing beyond it, so an army that stood still read
// as one coming and V8 turned back from targets it could have taken. Counting only armies that walk toward it, V8 won 1342
// of 2000 games against 1321 (351 of 500 on unseen seeds against 342).
const APPROACH_SLACK = 15;

function approachingPower(intel: V6Intel, center: Point, before: Record<string, Point>) {
  return intel.enemies.reduce((total, enemy) => {
    const was = before[enemy.owner];
    if (!enemy.center || !was) return total;
    const gap = distance(enemy.center, center);
    if (gap > INCOMING_RANGE || gap >= distance(was, center) - APPROACH_SLACK) return total;
    return total + strengthOf(enemy.army.filter((unit) => distance(unit, center) > LOCAL_RANGE));
  }, 0);
}

function rememberCenters(memory: V6PolicyMemory, intel: V6Intel, options: AiPolicyContext, commands: GameCommand[]): GameCommand[] {
  if (isV7Policy(options) && memory.general) memory.general.enemyCenters = Object.fromEntries(intel.enemies.filter((enemy) => enemy.center).map((enemy) => [enemy.owner, { x: enemy.center!.x, y: enemy.center!.y }]));
  return commands;
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
