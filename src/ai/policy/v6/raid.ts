import type { V6PolicyMemory } from "../../memory";
import type { GameCommand, GameSnapshot, PlayerId, Unit } from "../../../shared/types";
import { resolveAiCommandIntent } from "../commands";
import { units } from "../snapshot";
import { averagePoint, distance, type Point } from "../spatial";
import type { AiPolicyContext, PresetAiPolicyOptions } from "../types";
import { isV6Policy } from "../versions";
import { enemyPowerNear, readV6Intel, type V6BaseIntel, type V6Intel } from "./intel";
import { recordPlay, v6Memory } from "./memory";
import { gameRng } from "./rng";
import { v6Doctrine } from "./select";
import { strengthOf } from "./strength";

// @@@v6-raid - Hit the workers when the enemy army is looking the other way: while it fights a creep camp far from home,
// when the front has gone quiet, or simply when a rich mining line stands far from its owner's army. The strategy says
// which units raid, how many, from when and how often (AMAI's harass groups); the personality says how eager it is. A few
// fast units walk to the richest weakly held mining line, kill workers, and come home before the defenders arrive. The
// raid squad is claimed so the army scripts do not pull it back into the ball.
//
// It goes home, as AMAI's harass groups do (Jobs/HARASS.eai), the moment a tower sees it, when it has lost half its
// starting strength, when what stands near it outweighs it, or when time runs out; and a raider hurt below a third
// goes home alone before it dies for nothing.

const RAID_MIN = 3;
const RAID_HEALTHY = 0.7;
const STALEMATE_TICKS = 40 * 20;
const EARLIEST_STALEMATE_RAID_TICK = 300 * 20;
const RAID_TIMEOUT_TICKS = 80 * 20;
const HOME_RELEASE_RANGE = 700;
const STRIKE_RANGE = 650;
const TARGET_CLEARANCE = 1_300;
const TOWER_SIGHT = 60;
const FLEE_SHARE = 0.5;
const WOUNDED = 0.33;

export function v6RaidUnitIds(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): ReadonlySet<string> {
  if (!isV6Policy(options)) return new Set();
  return new Set(v6Memory(options).raid?.unitIds ?? []);
}

export function planV6Raid(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  if (!isV6Policy(options)) return [];
  const memory = v6Memory(options);
  trackCasualties(snapshot, memory);
  const intel = readV6Intel(snapshot, owner, options);
  const raid = memory.raid;
  if (!raid) return startRaid(snapshot, owner, intel, memory, options);
  const squad = units(snapshot, owner).filter((unit) => raid.unitIds.includes(unit.id));
  if (squad.length === 0) {
    delete memory.raid;
    return [];
  }
  raid.unitIds = squad.map((unit) => unit.id);
  const center = averagePoint(squad);
  if (raid.phase === "home") {
    if (distance(center, intel.home) <= HOME_RELEASE_RANGE || snapshot.tick - raid.sinceTick > RAID_TIMEOUT_TICKS + 30 * 20) {
      delete memory.raid;
      return [];
    }
    return [move(snapshot, owner, squad, intel.home, options)];
  }
  const target = intel.enemies.flatMap((enemy) => enemy.bases).find((base) => base.hall.id === raid.targetHallId);
  const threat = enemyPowerNear(intel, center, 550);
  const spotted = towerSees(intel, squad);
  const worn = strengthOf(squad) < (raid.startStrength ?? 0) * FLEE_SHARE;
  if (!target || spotted || threat > strengthOf(squad) || worn || snapshot.tick - raid.sinceTick > RAID_TIMEOUT_TICKS) {
    recordPlay(memory, `raid:abort:${!target ? "gone" : spotted ? "tower" : worn ? "worn" : threat > strengthOf(squad) ? "outweighed" : "timeout"}`);
    return goHome(snapshot, owner, squad, intel, raid, options);
  }
  const wounded = squad.filter((unit) => unit.hp < unit.maxHp * WOUNDED);
  if (wounded.length > 0) {
    raid.unitIds = raid.unitIds.filter((id) => !wounded.some((unit) => unit.id === id));
    return [move(snapshot, owner, wounded, intel.home, options), ...planV6Raid(snapshot, owner, options)];
  }
  const workers = intel.enemies.flatMap((enemy) => enemy.workers).filter((worker) => distance(worker, center) <= STRIKE_RANGE);
  if (workers.length === 0) {
    if (raid.phase === "strike" && distance(center, target.hall) <= STRIKE_RANGE) return goHome(snapshot, owner, squad, intel, raid, options);
    return [move(snapshot, owner, squad, target.hall, options)];
  }
  raid.phase = "strike";
  return squad.map((unit) => {
    const worker = workers.reduce((best, candidate) => (distance(candidate, unit) < distance(best, unit) ? candidate : best));
    return { type: "attack", unitIds: [unit.id], targetId: worker.id } satisfies GameCommand;
  });
}

function startRaid(snapshot: GameSnapshot, owner: PlayerId, intel: V6Intel, memory: V6PolicyMemory, options: AiPolicyContext): GameCommand[] {
  const { profile, strategy } = v6Doctrine(snapshot, owner, options);
  const plan = strategy.raids[0];
  if (!plan || snapshot.tick < plan.minSecond * 20 || snapshot.tick < (memory.raidCooldownUntil ?? 0)) return [];
  if (intel.enemies.some((enemy) => enemy.state === "pushing")) return [];
  const trigger = raidTrigger(snapshot, intel, memory);
  if (!trigger) return [];
  const busy = new Set(memory.closeout?.unitIds ?? []);
  const squad = intel.army
    .filter((unit) => plan.kinds.includes(unit.kind as never) && !busy.has(unit.id) && unit.hp >= unit.maxHp * RAID_HEALTHY)
    .sort((a, b) => distance(a, trigger.base.hall) - distance(b, trigger.base.hall))
    .slice(0, plan.size);
  if (squad.length < Math.min(RAID_MIN, plan.size) || strengthOf(squad) < trigger.base.defense * 1.5 + 1) return [];
  // Each window rolls once against the personality's appetite; a refused window waits for the next cooldown.
  memory.raidCooldownUntil = snapshot.tick + plan.cooldownSeconds * 20;
  if (gameRng(snapshot, owner, `raid|${snapshot.tick}`).next() >= profile.raidAppetite) return [];
  memory.raid = { unitIds: squad.map((unit) => unit.id), startStrength: strengthOf(squad), targetHallId: trigger.base.hall.id, targetOwner: trigger.base.owner, reason: trigger.reason, sinceTick: snapshot.tick, phase: "travel" };
  recordPlay(memory, `raid:${trigger.reason}`);
  return [move(snapshot, owner, squad, trigger.base.hall, options)];
}

function raidTrigger(snapshot: GameSnapshot, intel: V6Intel, memory: V6PolicyMemory): { base: V6BaseIntel; reason: string } | undefined {
  const creeping = intel.enemies.filter((enemy) => enemy.state === "creeping");
  for (const enemy of creeping) {
    const base = richestOpenBase(enemy.bases, intel);
    if (base) return { base, reason: "creepPunish" };
  }
  const open = richestOpenBase(
    intel.enemies.flatMap((enemy) => enemy.bases),
    intel,
  );
  if (!open) return undefined;
  const quiet = snapshot.tick >= EARLIEST_STALEMATE_RAID_TICK && snapshot.tick - (memory.casualties?.lastChangeTick ?? 0) >= STALEMATE_TICKS;
  return { base: open, reason: quiet ? "stalemate" : "openLine" };
}

// The richest mining line whose owner's army is far away; ties go to the weaker defense.
function richestOpenBase(bases: V6BaseIntel[], intel: V6Intel) {
  return bases
    .filter((base) => base.workers.length >= 3 && base.towers.length === 0)
    .filter((base) => intel.enemies.every((enemy) => !enemy.center || distance(enemy.center, base.hall) >= TARGET_CLEARANCE))
    .sort((a, b) => b.workers.length - b.defense * 2 - (a.workers.length - a.defense * 2))[0];
}

function goHome(snapshot: GameSnapshot, owner: PlayerId, squad: Unit[], intel: V6Intel, raid: NonNullable<V6PolicyMemory["raid"]>, options: PresetAiPolicyOptions) {
  raid.phase = "home";
  return [move(snapshot, owner, squad, intel.home, options)];
}

function move(snapshot: GameSnapshot, owner: PlayerId, squad: Unit[], point: Point, options: PresetAiPolicyOptions): GameCommand {
  return resolveAiCommandIntent(snapshot, owner, { type: "move", unitIds: squad.map((unit) => unit.id), x: point.x, y: point.y }, options);
}

function towerSees(intel: V6Intel, squad: Unit[]) {
  return intel.enemies.some((enemy) => enemy.buildings.some((building) => building.kind === "defenseTower" && building.complete && squad.some((unit) => distance(building, unit) <= building.attackRange + TOWER_SIGHT)));
}

function trackCasualties(snapshot: GameSnapshot, memory: V6PolicyMemory) {
  const count = Object.values(snapshot.match.stats.unitsLost).reduce((total, lost) => total + lost, 0);
  if (!memory.casualties || memory.casualties.count !== count) memory.casualties = { count, lastChangeTick: snapshot.tick };
}
