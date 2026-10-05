import { abilityCooldown } from "../../shared/ability-cooldowns";
import { isEnemyOwner } from "./ownership";
import { canCast } from "../../shared/ability-cooldowns";
import { ABILITY_DEFS, UNIT_DEFS } from "../../shared/catalog";
import type { GameCommand, GameSnapshot, PlayerId, Unit } from "../../shared/types";
import { armyPower } from "./combat-math";
import { resolveAiCommandIntent } from "./commands";
import { activeUnitClaim } from "./claims";
import { activeMiningBaseCount } from "./expansion-model";
import { enemyCombatUnits, enemyUnitsNear, neutralUnitsNear, units } from "./snapshot";
import { anyWithinRangeOf, averagePoint, distance, type Point } from "./spatial";
import { nearestEnemyUnit } from "./threats";
import type { PresetAiPolicyOptions } from "./types";
import { unitStrength } from "./v6/strength";
import { isV5HybridPolicy, isV6Policy, isV7Policy, isV8Policy, isV9Policy } from "./versions";

export function planAbilityCommands(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand[] {
  const commands: GameCommand[] = [];
  // Whether an enemy stands within 620 of a healer's regroup point: every wounded group of every healer asks, and testing
  // the whole enemy army each time grew with healers x groups x enemies. One grid serves the think (@@@range-grid).
  let enemyWithin620: ((point: Point) => boolean) | undefined;
  const regroupPointHasEnemy = (point: Point) => (enemyWithin620 ??= anyWithinRangeOf(enemyCombatUnits(snapshot, owner, options.teams), 620))(point);
  for (const caster of units(snapshot, owner).filter(canCast)) {
    if (caster.order.type === "board") continue;
    const abilities = UNIT_DEFS[caster.kind].abilities;
    for (const ability of abilities) {
      const def=ABILITY_DEFS[ability];
      if(def.behavior!=="weapon" || abilityCooldown(caster,ability)>0)continue;
      const targets=[...snapshot.units,...snapshot.buildings].filter(target=>isEnemyOwner(snapshot,owner,target.owner,options)&&distance(caster,target)<=def.range+target.radius && distance(caster,target)>=(def.weapon.minRange??0) && (ability!=="ramBreach" || !("order" in target)));
      const target=targets.sort((a,b)=> {
        const score=(target:typeof a)=>targets.filter(other=>distance(other,target)<(def.weapon.radius??80)).length + (!("order" in target)?(def.weapon.buildingMultiplier??1)*2:target.attackDamage/15);
        return score(b)-score(a)||distance(caster,a)-distance(caster,b);
      })[0];
      if(target) commands.push(def.target==="point"?{type:"cast",unitId:caster.id,ability,x:target.x,y:target.y}:{type:"cast",unitId:caster.id,ability,targetId:target.id});
    }
    const healAbility = abilities.find((ability) => ABILITY_DEFS[ability].behavior === "heal");
    if (healAbility) {
      const def = ABILITY_DEFS[healAbility];
      const target = (isV8Policy(options) && def.behavior === "heal" ? v8HealTarget(snapshot, owner, caster, def) : undefined) ?? healTarget(snapshot, owner, caster, def.plannerRange);
      if (target) {
        commands.push(resolveAiCommandIntent(snapshot, owner, { type: "cast", unitId: caster.id, ability: healAbility, targetId: target.id }, options));
        continue;
      }
      const regroup = healerRegroupCommand(snapshot, owner, caster, def.plannerRange, regroupPointHasEnemy, options);
      if (regroup) {
        commands.push(regroup);
        continue;
      }
    }
    const summonAbility = abilities.find((ability) => ABILITY_DEFS[ability].behavior === "summon");
    if (summonAbility) {
      const def = ABILITY_DEFS[summonAbility];
      const target = nearestEnemyUnit(snapshot, owner, caster, def.plannerRange, options);
      const hasSpirit = units(snapshot, owner).some((unit) => unit.kind === "spirit" && distance(unit, caster) < 320);
      // @@@v6-standing-spirits - A summon costs only the summoner's time: a spirit lasts 60s and the spell is back in 40s, so a
      // summoner that casts whenever it can keeps one or two spirits up, free of gold and supply. The shared rule waits for an enemy
      // inside 240 and stops at one spirit nearby.
      // V6 gathering for a pulse holds its summons until the strike, unless an enemy is already on the caster.
      const holding = isV6Policy(options) && options.memory?.v6?.general?.stage === "gather" && options.memory.v6.general.mode === "attack" && !nearestEnemyUnit(snapshot, owner, caster, 400, options);
      if (!holding && (isV6Policy(options) || (target && !hasSpirit))) {
        const point = isV6Policy(options) ? v6SummonPoint(snapshot, owner, caster, def.plannerRange, options) : { x: caster.x + 54, y: caster.y + 28 };
        commands.push(resolveAiCommandIntent(snapshot, owner, { type: "cast", unitId: caster.id, ability: summonAbility, x: point.x, y: point.y }, options));
        continue;
      }
    }
    const curseAbility = abilities.find((ability) => ABILITY_DEFS[ability].behavior === "curse");
    if (curseAbility) {
      const def = ABILITY_DEFS[curseAbility];
      if (def.behavior !== "curse") continue;
      const target = curseTarget(snapshot, owner, caster, def, options);
      if (target) commands.push(resolveAiCommandIntent(snapshot, owner, { type: "cast", unitId: caster.id, ability: curseAbility, targetId: target.id }, options));
    }
  }
  return commands;
}

function healTarget(snapshot: GameSnapshot, owner: PlayerId, caster: Unit, healRange: number) {
  return units(snapshot, owner)
    .filter((unit) => unit.hp < unit.maxHp * 0.7 && distance(unit, caster) <= healRange)
    .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || b.maxHp - b.hp - (a.maxHp - a.hp) || distance(a, caster) - distance(b, caster))[0];
}

// @@@v8-heal-worth - V8 heals the soldier it would miss most: its worth at full health (price and stars, the v6-strength
// currency) times the share of its health it has lost, among soldiers missing half a heal or more (less would waste
// most of it). The shared rule heals the lowest share under 70% whoever it is, and the engine's autocast whoever misses the
// most health, so a three-star veteran and a rookie that both stand at half health were one to them. Workers only get the
// shared rule's heal, when no soldier wants one. Over nudged replays V8 won 6301 of 8000 tune games against 6270, 6267 of
// 8000 on 40 unseen seeds against 6240, and 1582 of 2000 on the final seeds against 1559.
function v8HealTarget(snapshot: GameSnapshot, owner: PlayerId, caster: Unit, def: { plannerRange: number; healAmount: number }) {
  let best: Unit | undefined;
  let bestPriority = 0;
  for (const unit of units(snapshot, owner)) {
    if (unit.kind === "worker" || unit.maxHp - unit.hp < def.healAmount / 2 || distance(unit, caster) > def.plannerRange) continue;
    const priority = unitStrength({ ...unit, hp: unit.maxHp }) * (1 - unit.hp / unit.maxHp);
    if (priority > bestPriority) {
      best = unit;
      bestPriority = priority;
    }
  }
  return best;
}

// enemyNear: whether some enemy combat unit is within 620 of a point (not every one beyond it).
function healerRegroupCommand(snapshot: GameSnapshot, owner: PlayerId, caster: Unit, healRange: number, enemyNear: (point: Point) => boolean, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (options.version !== "v2" || activeUnitClaim(snapshot, owner, caster, options)) return undefined;
  const wounded = units(snapshot, owner).filter((unit) => unit.id !== caster.id && unit.kind !== "worker" && unit.hp < unit.maxHp * 0.7 && distance(unit, caster) > healRange && distance(unit, caster) <= 1400);
  const groups = wounded
    .map((anchor) => wounded.filter((unit) => distance(unit, anchor) <= 260))
    .filter((group) => group.length >= 2)
    .map((group) => ({ group, point: averagePoint(group) }))
    .filter(({ point }) => !enemyNear(point) && neutralUnitsNear(snapshot, point, 420).length === 0)
    .sort((a, b) => b.group.length - a.group.length || distance(caster, a.point) - distance(caster, b.point));
  const target = groups[0]?.point;
  // @@@healer-regroup - Healers that cannot cast yet should walk to a safe wounded cluster instead of idling at the last hired camp.
  if (!target || !healerRegroupOrderCanMove(caster, target)) return undefined;
  return resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: [caster.id], x: target.x, y: target.y }, options);
}

function healerRegroupOrderCanMove(caster: Unit, target: { x: number; y: number }) {
  if (caster.order.type === "idle") return true;
  return caster.order.type === "move" && distance(caster.order, target) > 180;
}

function curseTarget(snapshot: GameSnapshot, owner: PlayerId, caster: Unit, def: Extract<(typeof ABILITY_DEFS)[keyof typeof ABILITY_DEFS], { behavior: "curse" }>, options: PresetAiPolicyOptions) {
  const candidates = [...enemyUnitsNear(snapshot, owner, caster, def.plannerRange, options.teams), ...neutralUnitsNear(snapshot, caster, def.plannerRange)].filter((target) => !target.effects.some((effect) => effect.type === def.statusType));
  // @@@v7-curse-summoned - The witch's curse also deals 100 damage to a summoned unit, which kills an 85 hp spirit outright:
  // one spirit less for the rest of its minute beats taking 60% off a soldier's damage for 18s.
  const summoned = def.summonedDamage && isV7Policy(options) ? candidates.filter((target) => target.expiresTick !== undefined).sort((a, b) => distance(a, caster) - distance(b, caster))[0] : undefined;
  if (summoned) return summoned;
  // A curse takes 55-60% off one unit's damage for 18s: spend it on the hardest hitter in reach, not the nearest body.
  if (isV6Policy(options)) return candidates.sort((a, b) => damagePerSecond(b) - damagePerSecond(a) || distance(a, caster) - distance(b, caster))[0];
  if (def.scorchedDamageMultiplier !== undefined) {
    const scorched = candidates.filter((target) => target.effects.some((effect) => effect.type === "scorch")).sort((a, b) => distance(a, caster) - distance(b, caster))[0];
    if (scorched) return scorched;
  }
  return candidates.sort((a, b) => distance(a, caster) - distance(b, caster))[0];
}

export function planFocusFireCommand(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): GameCommand | undefined {
  if (options.version !== "v2") return undefined;
  const fighters = units(snapshot, owner).filter((unit) => unit.kind !== "worker" && unit.hp >= unit.maxHp * 0.36 && focusFireReadyUnit(snapshot, owner, unit, options));
  if (fighters.length === 1) {
    const target = soloFinisherTarget(fighters[0]!, enemyCombatUnits(snapshot, owner, options.teams));
    return target ? resolveAiCommandIntent(snapshot, owner, { type: "focusFire", unitIds: [fighters[0]!.id], targetId: target.id }, options) : undefined;
  }
  if (fighters.length < 2) return undefined;
  const enemies = enemyCombatUnits(snapshot, owner, options.teams);
  const canJoin = focusFireJoinIndex(snapshot, owner, fighters, options);
  const candidates = enemies.filter((enemy) => canJoin(enemy));
  const rememberedTarget = options.memory?.strategicPlan?.focusTargetId ? candidates.find((candidate) => candidate.id === options.memory?.strategicPlan?.focusTargetId) : undefined;
  const anchoredRememberedTarget = rememberedTarget && rememberedFocusStillAnchored(snapshot, owner, rememberedTarget, fighters, options) ? rememberedTarget : undefined;
  const finisherCanInterruptMemory = anchoredRememberedTarget && (options.policyMode !== "combat" || anchoredRememberedTarget.hp <= anchoredRememberedTarget.maxHp * 0.4);
  const center = averagePoint(fighters);
  const finisherTarget = finisherCanInterruptMemory ? singleHitFinisherTarget(candidates, canJoin, center) : undefined;
  const freshCandidates = rememberedTarget && !anchoredRememberedTarget ? candidates.filter((candidate) => candidate.id !== rememberedTarget.id) : candidates;
  const target = finisherTarget ?? anchoredRememberedTarget ?? freshCandidates.sort((a, b) => focusFireTargetScore(b, center) - focusFireTargetScore(a, center))[0];
  if (!target) return undefined;
  const attackers = focusFireAttackers(snapshot, owner, fighters, target, options);
  const localEnemies = enemies.filter((enemy) => distance(enemy, target) <= 520);
  // @@@focus-fire-local-odds - Focus fire is a commitment; do not pin a small squad in place when the target is protected by a stronger local group.
  const canPickOffWoundedTarget = focusFireCanPickOffWoundedTarget(attackers, target);
  if (!canPickOffWoundedTarget && partialTailFocusIsSupportedByStrongerEnemy(fighters, attackers, target, enemies)) return undefined;
  if (options.policyMode === "combat" && attackers.length < 4 && localEnemies.length > attackers.length && casterTargetBonus(target) === 0 && target.hp > target.maxHp * 0.18) return undefined;
  if (!canPickOffWoundedTarget && attackers.length < 12 && localEnemies.length > attackers.length) return undefined;
  if (!canPickOffWoundedTarget && localEnemies.length >= 2 && armyPower(localEnemies) > armyPower(attackers) * 1.1) return undefined;
  if (options.memory) {
    options.memory.strategicPlan = {
      ...options.memory.strategicPlan,
      focusTargetOwner: target.owner,
      focusTargetId: target.id,
      focusTargetSinceTick: anchoredRememberedTarget ? (options.memory.strategicPlan?.focusTargetSinceTick ?? snapshot.tick) : snapshot.tick,
      focusTargetUpdatedTick: snapshot.tick,
    };
  }
  return attackers.length >= 2 ? resolveAiCommandIntent(snapshot, owner, { type: "focusFire", unitIds: attackers.map((unit) => unit.id), targetId: target.id }, options) : undefined;
}

function partialTailFocusIsSupportedByStrongerEnemy(fighters: Unit[], attackers: Unit[], target: Unit, enemies: Unit[]) {
  if (!UNIT_DEFS[target.kind].abilities.some((ability) => ABILITY_DEFS[ability].behavior === "heal") || target.hp < target.maxHp * 0.82) return false;
  if (attackers.length >= Math.max(5, Math.ceil(fighters.length * 0.65))) return false;
  const support = enemies.filter((enemy) => distance(enemy, target) <= 900);
  if (support.length <= attackers.length + 1) return false;
  // @@@supported-caster-tail - A healer/caster bonus is not a license for a partial tail to start a fight the main group cannot join.
  return armyPower(support) > armyPower(attackers) * 1.12;
}

function rememberedFocusStillAnchored(snapshot: GameSnapshot, owner: PlayerId, target: Unit, fighters: Unit[], options: PresetAiPolicyOptions) {
  if (options.policyMode !== "combat" || fighters.length < 6) return true;
  const attackers = focusFireAttackers(snapshot, owner, fighters, target, options);
  if (rememberedWoundedTargetCanBeFinished(target, attackers)) return true;
  // @@@focus-tail-release - Combat focus memory should stabilize a fight, not let a tiny tail drag the main army out of formation.
  return attackers.length >= Math.max(3, Math.ceil(fighters.length * 0.45));
}

function focusFireAttackers(snapshot: GameSnapshot, owner: PlayerId, fighters: Unit[], target: Unit, options: PresetAiPolicyOptions) {
  return fighters.filter((fighter) => focusFireCanJoinTarget(snapshot, owner, fighter, target, options));
}

// @@@v9-melee-focus - A V9 melee fighter joins a focus only standing at the target already: sent at it from its whole join
// range, twelve footmen closed on one man at a time, the ones that found no room round him walked round the crowd, and all
// twelve fell having killed 829 gold's worth, where twelve left to their own blows lost 563 and killed every enemy (the V9
// exam's S1, against V8's ember).
function focusFireCanJoinTarget(snapshot: GameSnapshot, owner: PlayerId, fighter: Unit, target: Unit, options: PresetAiPolicyOptions) {
  if (isV9Policy(options) && fighter.attackRange <= 100 && distance(fighter, target) > fighter.attackRange + fighter.radius + target.radius) return false;
  if (distance(fighter, target) <= focusFireJoinRange(fighter)) return true;
  return v5ArrivedMercenaryClaimCanCounterFocus(snapshot, owner, fighter, target, options);
}

// @@@focus-join-index - Whether some fighter can join a target (focusFireCanJoinTarget), and passes an extra test, without
// testing every fighter: in a big fight, testing every enemy against every fighter was most of a think. The fighters sit in
// a grid of cells as wide as the longest join range (plus 1, so rounding cannot drop a pair the full test takes), and a
// target tests only the fighters in the 3x3 cells around it; any other fighter is out of its join range. The v5
// arrived-mercenary exception is not a matter of range, so the fighters that may take it are tested against every target,
// as before. Every test is the same pure one, so the answer is the same; only the fighters that cannot pass go untested.
function focusFireJoinIndex(snapshot: GameSnapshot, owner: PlayerId, fighters: Unit[], options: PresetAiPolicyOptions) {
  const cell = Math.max(...fighters.map(focusFireJoinRange)) + 1;
  const cells = new Map<number, Unit[]>();
  for (const fighter of fighters) {
    const key = focusFireCellKey(Math.floor(fighter.x / cell), Math.floor(fighter.y / cell));
    const bucket = cells.get(key);
    if (bucket) bucket.push(fighter);
    else cells.set(key, [fighter]);
  }
  const counterFocusers = fighters.filter((fighter) => v5ArrivedMercenaryCounterFocuser(snapshot, owner, fighter, options));
  return (target: Unit, test?: (fighter: Unit) => boolean) => {
    const cx = Math.floor(target.x / cell);
    const cy = Math.floor(target.y / cell);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return fighters.some((fighter) => focusFireCanJoinTarget(snapshot, owner, fighter, target, options) && (!test || test(fighter)));
    for (let x = cx - 1; x <= cx + 1; x += 1) {
      for (let y = cy - 1; y <= cy + 1; y += 1) {
        const bucket = cells.get(focusFireCellKey(x, y));
        if (bucket?.some((fighter) => distance(fighter, target) <= focusFireJoinRange(fighter) && (!test || test(fighter)))) return true;
      }
    }
    return counterFocusers.some((fighter) => v5ArrivedMercenaryClaimCanCounterFocus(snapshot, owner, fighter, target, options) && (!test || test(fighter)));
  };
}

function focusFireCellKey(x: number, y: number) {
  return x * 4096 + y;
}

function singleHitFinisherTarget(candidates: Unit[], canJoin: ReturnType<typeof focusFireJoinIndex>, center: Point) {
  return candidates
    .filter((target) => canJoin(target, (attacker) => target.hp <= attacker.attackDamage))
    .sort((a, b) => a.hp - b.hp || focusFireTargetScore(b, center) - focusFireTargetScore(a, center))[0];
}

function focusFireReadyUnit(snapshot: GameSnapshot, owner: PlayerId, unit: Unit, options: PresetAiPolicyOptions) {
  const claim = activeUnitClaim(snapshot, owner, unit, options);
  return !claim || claim.kind === "attack" || v5ArrivedMercenaryClaimCanFight(snapshot, owner, unit, claim, options);
}

// The part of v5ArrivedMercenaryClaimCanCounterFocus that depends on the fighter alone.
function v5ArrivedMercenaryCounterFocuser(snapshot: GameSnapshot, owner: PlayerId, fighter: Unit, options: PresetAiPolicyOptions) {
  const claim = activeUnitClaim(snapshot, owner, fighter, options);
  return !!claim && v5ArrivedMercenaryClaimCanFight(snapshot, owner, fighter, claim, options);
}

function v5ArrivedMercenaryClaimCanCounterFocus(snapshot: GameSnapshot, owner: PlayerId, fighter: Unit, target: Unit, options: PresetAiPolicyOptions) {
  const claim = activeUnitClaim(snapshot, owner, fighter, options);
  if (!claim || !v5ArrivedMercenaryClaimCanFight(snapshot, owner, fighter, claim, options)) return false;
  if (distance(fighter, target) > 760) return false;
  if (target.order.type !== "attack") return false;
  const attackedTargetId = target.order.targetId;
  const attackedAlly = units(snapshot, owner).find((unit) => unit.id === attackedTargetId);
  if (!attackedAlly) return false;
  const attackedClaim = activeUnitClaim(snapshot, owner, attackedAlly, options);
  // @@@v5-camp-counterfocus - An arrived mercenary claim is still objective ownership, except when ranged attackers are already shooting that exact parked group.
  return attackedClaim?.kind === "mercenary" && attackedClaim.targetId === claim.targetId && distance(attackedAlly, claim) <= 260;
}

function v5ArrivedMercenaryClaimCanFight(snapshot: GameSnapshot, owner: PlayerId, unit: Unit, claim: { kind: string; x: number; y: number }, options: PresetAiPolicyOptions) {
  if (!isV5HybridPolicy(options) || activeMiningBaseCount(snapshot, owner) < 2) return false;
  return claim.kind === "mercenary" && unit.order.type === "attackMove" && distance(unit, claim) <= 220 && distance(unit.order, claim) <= 220;
}

function soloFinisherTarget(fighter: Unit, enemies: Unit[]) {
  return enemies
    .filter((enemy) => distance(fighter, enemy) <= fighter.attackRange)
    .filter((enemy) => enemy.hp <= fighter.attackDamage)
    .sort((a, b) => soloFinisherScore(b) - soloFinisherScore(a))[0];
}

function soloFinisherScore(unit: Unit) {
  // @@@solo-finisher - A lone survivor may take a free last hit, but only without chasing into the enemy group.
  return casterTargetBonus(unit) + (unit.maxHp - unit.hp) * 3 + unit.attackDamage * 4 + (unit.attackRange > 100 ? 35 : 0);
}

function focusFireCanPickOffWoundedTarget(attackers: Unit[], target: Unit) {
  if (attackers.length >= 5 && target.hp <= target.maxHp * 0.6) return true;
  const volleyDamage = attackers.reduce((total, unit) => total + unit.attackDamage, 0);
  if (attackers.length >= 2 && target.hp <= target.maxHp * 0.34 && volleyDamage >= target.hp * 1.35) return true;
  // @@@critical-pickoff - A tiny group may finish a near-dead target, but ordinary wounded targets still respect local odds.
  return attackers.length >= 2 && target.hp <= target.maxHp * 0.18 && volleyDamage >= target.hp * 2;
}

function rememberedWoundedTargetCanBeFinished(target: Unit, attackers: Unit[]) {
  return attackers.length >= 4 && target.hp <= target.maxHp * 0.4 && attackers.reduce((total, unit) => total + unit.attackDamage, 0) >= target.hp * 1.35;
}

function focusFireJoinRange(unit: Unit) {
  return unit.attackRange + (unit.attackRange > 100 ? 80 : 95);
}

// center: the fighters' averagePoint, taken once per think rather than once per comparison of a sort.
function focusFireTargetScore(unit: Unit, center: Point) {
  const missingHp = Math.max(0, unit.maxHp - unit.hp);
  const threat = unit.attackDamage * 5 + (unit.attackRange > 100 ? 28 : 0);
  return casterTargetBonus(unit) + missingHp * 2.4 + threat - distance(unit, center) * 0.18;
}

function casterTargetBonus(unit: Unit) {
  const abilities = UNIT_DEFS[unit.kind].abilities;
  let score = 0;
  if (abilities.some((ability) => ABILITY_DEFS[ability].behavior === "summon")) score += 130;
  if (abilities.some((ability) => ABILITY_DEFS[ability].behavior === "heal")) score += 115;
  if (abilities.some((ability) => ABILITY_DEFS[ability].behavior === "curse")) score += 95;
  return score;
}

// Spirits appear toward the fight (the nearest enemy, else the spirits already up), so they do not walk past their summoner.
function v6SummonPoint(snapshot: GameSnapshot, owner: PlayerId, caster: Unit, reach: number, options: PresetAiPolicyOptions) {
  const spirits = units(snapshot, owner).filter((unit) => unit.kind === "spirit" && distance(unit, caster) <= 700);
  const toward = nearestEnemyUnit(snapshot, owner, caster, 900, options) ?? (spirits.length > 0 ? averagePoint(spirits) : undefined);
  const gap = toward ? distance(caster, toward) : 0;
  if (!toward || gap < 1) return { x: caster.x + 54, y: caster.y + 28 };
  const length = Math.min(reach, gap);
  return { x: caster.x + ((toward.x - caster.x) / gap) * length, y: caster.y + ((toward.y - caster.y) / gap) * length };
}

function damagePerSecond(unit: Unit) {
  return unit.attackDamage / Math.max(1, unit.attackCooldown);
}
