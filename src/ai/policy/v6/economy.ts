import { BUILDING_DEFS, RACE_DEFS, UNIT_DEFS, UPGRADE_DEFS, requiredSupplyCap } from "../../../shared/catalog";
import type { Building, BuildingKind, GameCommand, GameSnapshot, PlayerId, TrainableUnitKind, Unit, UpgradeKind } from "../../../shared/types";
import { legalBuildPointNear, safeMainBuildPoint, towerPointFor } from "../build-layout";
import { resolveAiCommandIntent } from "../commands";
import { activeMiningBaseCount } from "../expansion-model";
import { buildings, units } from "../snapshot";
import { distance, type Point } from "../spatial";
import type { AiPolicyContext } from "../types";
import { isV6Policy } from "../versions";
import { canSupply, expansionOffset, isCoreProductionBuilding, isReservedBuilder, nearOwnIncompleteBuilding, playerState, projectedSupplyUsed, soldiersWorth, tierUnlocked } from "../world-model";
import type { V6Phase, V6Strategy, V6Want } from "./doctrine";
import { mineGuards, nextExpansionMine, readV6Intel, type V6Intel } from "./intel";
import { recordPlay, v6Memory } from "./memory";
import { v6Doctrine } from "./select";

// @@@v6-economy - One place spends V6's gold, the way AMAI's builder does (common.eai OneBuildLoopAM). Workers and farms
// come first, as in AMAI. Then the current phase of the strategy states its wants; each want that is not met becomes a
// goal with a priority, missing production buildings are queued ahead of the units that need them, and a goal that keeps
// waiting slowly gains priority so nothing starves. The executor buys top-down and stops at the first goal it cannot
// afford, which is how it saves. No other V6 script spends gold.

type Goal = { id: string; priority: number; cost: number; save: boolean; issue: (builders: Set<string>) => GameCommand | undefined };

type Economy = {
  snapshot: GameSnapshot;
  owner: PlayerId;
  options: AiPolicyContext;
  intel: V6Intel;
  strategy: V6Strategy;
  phase: V6Phase;
  own: Building[];
  workers: Unit[];
  bases: Building[];
  threatened?: { hall: Building; threat: number };
};

const WORKER_CAP = 26;
const MIN_WORKERS = 6;
const WORKERS_PER_MINE = 5;
const FARM_LIMIT = 15;
const MAX_PRODUCERS_PER_KIND = 3;
// Gold piling past this many basic soldiers' worth buys another producer (see capacityGoals).
const FLOAT_SOLDIERS = 3.5;
const MAX_TOWERS_AT_HALL = 3;
const TOWER_REACH_FROM_HALL = 520;
const HALL_THREAT_RANGE = 800;
const CREEP_CLEARANCE = BUILDING_DEFS.defenseTower.attackRange + 60;
const PREREQUISITE_BONUS = 5;
const THREAT_BONUS = 20;
const AGE_SECONDS_PER_POINT = 6;
const MAX_AGE_BONUS = 20;
// A goal can drop out for a moment (an enemy walks near the mine, a building finishes): it keeps its waiting time unless it
// stays gone this long. Resetting on every flicker kept the natural at the bottom for a whole game.
const AGE_MEMORY_TICKS = 10 * 20;

export function planV6Economy(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  if (!isV6Policy(options)) return [];
  const goals = rankV6Goals(snapshot, owner, options);
  let gold = playerState(snapshot, owner).gold;
  const builders = new Set<string>();
  const commands: GameCommand[] = [];
  const bought = new Set<string>();
  for (const goal of goals) {
    if (goal.cost > gold) {
      if (goal.save) break;
      continue;
    }
    const command = goal.issue(builders);
    if (!command) continue;
    commands.push(command);
    bought.add(goal.id);
    gold -= goal.cost;
  }
  const ages = v6Memory(options).goalAges ?? {};
  for (const id of bought) delete ages[id];
  return commands;
}

// Everything V6 wants to spend on right now, best first (exported so a watched game can show what the gold waits for).
export function rankV6Goals(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): Goal[] {
  const economy = readEconomy(snapshot, owner, options);
  return aged(economy, [...supplyGoals(economy), ...workerGoals(economy), ...threatGoals(economy), ...wantGoals(economy), ...capacityGoals(economy)]);
}

function readEconomy(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): Economy {
  const { strategy } = v6Doctrine(snapshot, owner, options);
  const intel = readV6Intel(snapshot, owner, options);
  const own = buildings(snapshot, owner);
  const bases = intel.ownHalls;
  const threatened = threatenedHall(intel);
  const economy: Omit<Economy, "phase"> = {
    snapshot,
    owner,
    options,
    intel,
    strategy,
    own,
    workers: units(snapshot, owner).filter((unit) => unit.kind === "worker"),
    bases,
    ...(threatened ? { threatened } : {}),
  };
  return { ...economy, phase: currentPhase(economy) };
}

// The hall nearest the buildings enemies are at, when that is close enough to be the hall's fight.
function threatenedHall(intel: V6Intel): { hall: Building; threat: number } | undefined {
  const intrusion = intel.intrusion;
  if (!intrusion) return undefined;
  const hall = intel.ownHalls.filter((candidate) => distance(candidate, intrusion.building) <= HALL_THREAT_RANGE).sort((a, b) => distance(a, intrusion.building) - distance(b, intrusion.building))[0];
  return hall ? { hall, threat: intrusion.threat } : undefined;
}

// Phases only move forward: once a phase's army mostly stands, or supply passes its bar, the next one opens.
function currentPhase(economy: Omit<Economy, "phase">): V6Phase {
  const memory = v6Memory(economy.options);
  const phases = economy.strategy.phases;
  let index = Math.min(memory.phase ?? 0, phases.length - 1);
  while (index < phases.length - 1) {
    const phase = phases[index]!;
    const supply = playerState(economy.snapshot, economy.owner).supplyUsed;
    if (unitShare(economy, phase) < phase.advanceShare && supply < phase.advanceSupply) break;
    index += 1;
    recordPlay(memory, `phase:${index + 1}`);
  }
  memory.phase = index;
  return phases[index]!;
}

function unitShare(economy: Omit<Economy, "phase">, phase: V6Phase) {
  const targets = new Map<TrainableUnitKind, number>();
  for (const want of phase.wants) {
    for (const [kind, count] of unitTargets(want)) targets.set(kind, Math.max(targets.get(kind) ?? 0, count));
  }
  const total = [...targets.values()].reduce((sum, count) => sum + count, 0);
  if (total === 0) return 1;
  return [...targets].reduce((sum, [kind, count]) => sum + Math.min(count, have(economy, kind)), 0) / total;
}

function unitTargets(want: V6Want): [TrainableUnitKind, number][] {
  return "unit" in want ? [[want.unit, want.count]] : [];
}

function have(economy: Omit<Economy, "phase">, kind: TrainableUnitKind) {
  return economy.intel.army.filter((unit) => unit.kind === kind).length + economy.own.reduce((total, building) => total + building.queue.filter((job) => job.unitKind === kind).length, 0);
}

function supplyGoals(economy: Economy): Goal[] {
  const player = playerState(economy.snapshot, economy.owner);
  const farms = economy.own.filter((building) => building.kind === "farm");
  if (farms.some((farm) => !farm.complete) || farms.length >= FARM_LIMIT) return [];
  const producers = economy.own.filter((building) => building.complete && (building.kind === "townHall" || isCoreProductionBuilding(building))).length;
  if (player.supplyCap - projectedSupplyUsed(economy.snapshot, economy.owner) > producers * 2) return [];
  const point = safeMainBuildPoint(economy.snapshot, economy.owner, farms.length + 4, "farm");
  return [goal("farm", 95, BUILDING_DEFS.farm.cost, true, (used) => build(economy, "farm", point, used))];
}

// Five workers fill a mine and one more builds. The next base's five are trained ahead of it, like AMAI's pre-queued
// peons, whenever the phase wants another base; past the first six, workers keep pace with the army (six plus one per
// soldier) so neither eats the other. Training only for halls already rising left V6 on six workers until minute six,
// and its hall waited on gold six workers could not bring in.
function workerGoals(economy: Economy): Goal[] {
  const queued = economy.own.reduce((total, building) => total + building.queue.filter((job) => job.unitKind === "worker").length, 0);
  const halls = economy.own.filter((building) => building.kind === "townHall").length;
  const rising = economy.own.filter((building) => building.kind === "townHall" && !building.complete).length;
  const next = economy.phase.wants.some((want) => "bases" in want && want.bases > halls) ? 1 : 0;
  const soldiers = economy.intel.army.filter((unit) => unit.kind !== "spirit").length;
  const target = Math.min(WORKER_CAP, Math.max(MIN_WORKERS, (activeMiningBaseCount(economy.snapshot, economy.owner) + rising + next) * WORKERS_PER_MINE + 1), MIN_WORKERS + soldiers);
  if (economy.workers.length + queued >= target) return [];
  const early = economy.workers.length < MIN_WORKERS;
  return economy.bases
    .filter((hall) => hall.queue.length === 0)
    .map((hall) => goal(`worker@${hall.id}`, early ? 85 : 70, UNIT_DEFS.worker.cost, false, () => train(economy, hall, "worker")));
}

// A base under attack gets another tower while the fight is on, ahead of everything but farms.
function threatGoals(economy: Economy): Goal[] {
  const threatened = economy.threatened;
  if (!threatened || towersAt(economy, threatened.hall) >= MAX_TOWERS_AT_HALL || towerRising(economy)) return [];
  return towerGoal(economy, threatened.hall, 92, "tower:underFire");
}

function wantGoals(economy: Economy): Goal[] {
  const goals: Goal[] = [];
  const claimed = new Set<string>();
  const wants = [...economy.phase.wants].sort((a, b) => b.priority - a.priority);
  for (const want of wants) {
    const priority = want.priority + (economy.threatened && "unit" in want ? THREAT_BONUS : 0);
    if ("unit" in want) {
      goals.push(...unitGoals(economy, want.unit, want.count - have(economy, want.unit), priority, claimed));
    } else if ("building" in want) {
      if (economy.own.filter((building) => building.kind === want.building).length < want.count) goals.push(...buildingGoal(economy, want.building, priority));
    } else if ("towers" in want) {
      goals.push(...towerWantGoals(economy, want.towers, want.count, priority));
    } else if ("bases" in want) {
      goals.push(...baseGoal(economy, want.bases, priority));
    } else {
      goals.push(...upgradeGoal(economy, want.upgrade, want.level, priority));
    }
  }
  // Two wants can ask for the same building (both need the stables); the first, highest one stands.
  const seen = new Set<string>();
  return goals.filter((candidate) => candidate.id.startsWith("unit:") || (!seen.has(candidate.id) && Boolean(seen.add(candidate.id))));
}

// Missing units are trained from idle buildings that can make them; with no such building at all, the building is queued
// ahead of them (AMAI's RefreshNeeded).
function unitGoals(economy: Economy, kind: TrainableUnitKind, missing: number, priority: number, claimed: Set<string>): Goal[] {
  if (missing <= 0) return [];
  if (!tierUnlocked(economy.snapshot, economy.owner, kind)) return lockedUnitGoals(economy, kind, missing, priority, claimed);
  const makers = economy.own.filter((building) => BUILDING_DEFS[building.kind].trains.includes(kind));
  if (makers.length === 0) {
    const maker = producerFor(economy, kind);
    return maker ? buildingGoal(economy, maker, priority + PREREQUISITE_BONUS) : [];
  }
  return makers
    .filter((building) => building.complete && building.queue.length === 0 && !claimed.has(building.id))
    .slice(0, missing)
    .flatMap((building) => {
      if (!canSupply(economy.snapshot, economy.owner, kind)) return [];
      claimed.add(building.id);
      return [goal(`unit:${kind}`, priority, UNIT_DEFS[kind].cost, true, () => train(economy, building, kind))];
    });
}

// @@@v6-tech-up - A want whose tier is still locked is met two ways at once: farms ahead of need until the supply cap
// reaches the bar (the tech V6 buys), and the strategy's basic soldier in the missing units' place meanwhile, so the
// opening still has an army. The units' own building goes up once one more farm would reach the bar.
function lockedUnitGoals(economy: Economy, kind: TrainableUnitKind, missing: number, priority: number, claimed: Set<string>): Goal[] {
  const bar = requiredSupplyCap(kind);
  const cap = playerState(economy.snapshot, economy.owner).supplyCap;
  const maker = producerFor(economy, kind);
  const makerGoals = maker && cap + BUILDING_DEFS.farm.supplyProvided >= bar && !economy.own.some((building) => building.kind === maker) ? buildingGoal(economy, maker, priority) : [];
  const standIn = economy.strategy.standIn;
  return [...techFarmGoal(economy, priority), ...makerGoals, ...unitGoals(economy, standIn, missing - have(economy, standIn), priority - 1, claimed)];
}

function techFarmGoal(economy: Economy, priority: number): Goal[] {
  const farms = economy.own.filter((building) => building.kind === "farm");
  if (farms.some((farm) => !farm.complete) || farms.length >= FARM_LIMIT) return [];
  const point = safeMainBuildPoint(economy.snapshot, economy.owner, farms.length + 4, "farm");
  return [goal("farm:tier", priority, BUILDING_DEFS.farm.cost, true, (used) => build(economy, "farm", point, used))];
}

function producerFor(economy: Economy, kind: TrainableUnitKind): BuildingKind | undefined {
  const race = playerState(economy.snapshot, economy.owner).race;
  return RACE_DEFS[race].buildableBuildings.find((building) => BUILDING_DEFS[building].trains.includes(kind));
}

function buildingGoal(economy: Economy, kind: BuildingKind, priority: number): Goal[] {
  if (economy.own.some((building) => building.kind === kind && !building.complete)) return [];
  const slot = economy.own.filter((building) => isCoreProductionBuilding(building)).length;
  const point = safeMainBuildPoint(economy.snapshot, economy.owner, slot, kind);
  return [goal(`build:${kind}`, priority, BUILDING_DEFS[kind].cost, true, (used) => build(economy, kind, point, used))];
}

function towerWantGoals(economy: Economy, where: "main" | "outposts", count: number, priority: number): Goal[] {
  if (towerRising(economy)) return [];
  const main = economy.bases[0];
  if (!main) return [];
  if (where === "main") return towersAt(economy, main) < count ? towerGoal(economy, main, priority, "tower:main") : [];
  const outpost = economy.bases.slice(1).find((hall) => towersAt(economy, hall) < count);
  return outpost ? towerGoal(economy, outpost, priority, "tower:outpost") : [];
}

function towersAt(economy: Economy, hall: Building) {
  return economy.own.filter((building) => building.kind === "defenseTower" && distance(building, hall) <= TOWER_REACH_FROM_HALL).length;
}

function towerRising(economy: Economy) {
  return economy.own.some((building) => building.kind === "defenseTower" && !building.complete);
}

function towerGoal(economy: Economy, hall: Building, priority: number, play: string): Goal[] {
  const facing = economy.intel.enemies.flatMap((enemy) => enemy.bases.map((base) => base.hall))[0];
  const point = towerPoint(economy.snapshot, economy.owner, hall, facing);
  if (!point) return [];
  return [goal(play, priority, BUILDING_DEFS.defenseTower.cost, true, (used) => build(economy, "defenseTower", point, used, play))];
}

// Towers face the enemy, and never go where they would reach a creep camp that still stands (it would wake the camp).
function towerPoint(snapshot: GameSnapshot, owner: PlayerId, hall: Building, facing: Point | undefined): Point | undefined {
  const creeps = snapshot.units.filter((unit) => unit.owner === "neutral");
  const ring = Array.from({ length: 8 }, (_, index) => ({ x: hall.x + Math.cos((index / 8) * Math.PI * 2) * 180, y: hall.y + Math.sin((index / 8) * Math.PI * 2) * 180 }));
  return [towerPointFor(snapshot, owner, hall, facing), ...ring]
    .map((candidate) => legalBuildPointNear(snapshot, "defenseTower", candidate))
    .find((candidate) => distance(candidate, hall) <= TOWER_REACH_FROM_HALL && creeps.every((creep) => distance(creep, candidate) > CREEP_CLEARANCE));
}

// The next expansion goes to the nearest free mine once its camp is cleared (the general clears it) and no enemy is near.
function baseGoal(economy: Economy, target: number, priority: number): Goal[] {
  // A hall on a mined-out mine is no base: counting it left eleven workers idle when V6's main ran dry.
  const halls = economy.own.filter((building) => building.kind === "townHall");
  if (activeMiningBaseCount(economy.snapshot, economy.owner) >= target || halls.some((hall) => !hall.complete) || economy.threatened) return [];
  const mine = nextExpansionMine(economy.snapshot, economy.intel);
  if (!mine || mineGuards(economy.snapshot, mine).length > 0) return [];
  const offset = expansionOffset(economy.snapshot, economy.owner);
  const point = legalBuildPointNear(economy.snapshot, "townHall", { x: mine.x + offset.x, y: mine.y + offset.y });
  return [goal(`bases:${target}`, priority, BUILDING_DEFS.townHall.cost, true, (used) => build(economy, "townHall", point, used, "expand"))];
}

function upgradeGoal(economy: Economy, kind: UpgradeKind, level: number, priority: number): Goal[] {
  const current = playerState(economy.snapshot, economy.owner).upgrades[kind] ?? 0;
  const next = UPGRADE_DEFS[kind].levels[current];
  if (current >= level || !next || economy.own.some((building) => building.researchQueue.some((job) => job.upgradeKind === kind))) return [];
  const lab = economy.own.find((building) => building.complete && building.researchQueue.length === 0 && BUILDING_DEFS[building.kind].researches.includes(kind));
  if (!lab) return [];
  return [goal(`upgrade:${kind}`, priority, next.cost, true, () => research(economy, lab, kind))];
}

// Gold piling up while every producer is busy buys another producer of whatever the phase still waits on most (AMAI's
// factory count follows income the same way).
function capacityGoals(economy: Economy): Goal[] {
  if (playerState(economy.snapshot, economy.owner).gold < soldiersWorth(FLOAT_SOLDIERS)) return [];
  const producers = economy.own.filter((building) => isCoreProductionBuilding(building));
  if (producers.length === 0 || producers.some((building) => !building.complete || building.queue.length === 0)) return [];
  const waiting = [...economy.phase.wants]
    .sort((a, b) => b.priority - a.priority)
    .flatMap((want) => unitTargets(want))
    .find(([kind, count]) => have(economy, kind) < count && tierUnlocked(economy.snapshot, economy.owner, kind));
  const kind = waiting && producerFor(economy, waiting[0]);
  if (!kind || economy.own.filter((building) => building.kind === kind).length >= MAX_PRODUCERS_PER_KIND) return [];
  return buildingGoal(economy, kind, 30).map((candidate) => ({ ...candidate, id: `capacity:${kind}`, save: false }));
}

// A goal that keeps waiting gains a point every few seconds, so a cheap stream of higher goals cannot starve it forever.
function aged(economy: Economy, goals: Goal[]): Goal[] {
  const memory = v6Memory(economy.options);
  const ages = (memory.goalAges ??= {});
  const tick = economy.snapshot.tick;
  for (const [id, age] of Object.entries(ages)) if (tick - age.seen > AGE_MEMORY_TICKS) delete ages[id];
  return goals
    .map((candidate) => {
      const age = (ages[candidate.id] ??= { since: tick, seen: tick });
      age.seen = tick;
      const bonus = Math.min(MAX_AGE_BONUS, Math.floor((tick - age.since) / 20 / AGE_SECONDS_PER_POINT));
      return { ...candidate, priority: candidate.priority + bonus };
    })
    .sort((a, b) => b.priority - a.priority);
}

function goal(id: string, priority: number, cost: number, save: boolean, issue: Goal["issue"]): Goal {
  return { id, priority, cost, save, issue };
}

function build(economy: Economy, kind: BuildingKind, point: Point, used: Set<string>, play?: string): GameCommand | undefined {
  const builder = economy.workers
    .filter((worker) => !used.has(worker.id) && !isReservedBuilder(economy.snapshot, economy.owner, worker) && !nearOwnIncompleteBuilding(economy.snapshot, economy.owner, worker))
    .sort((a, b) => distance(a, point) - distance(b, point))[0];
  if (!builder) return undefined;
  used.add(builder.id);
  if (play) recordPlay(v6Memory(economy.options), play);
  return resolveAiCommandIntent(economy.snapshot, economy.owner, { type: "build", unitId: builder.id, buildingKind: kind, x: point.x, y: point.y }, economy.options);
}

function train(economy: Economy, building: Building, kind: TrainableUnitKind): GameCommand {
  return resolveAiCommandIntent(economy.snapshot, economy.owner, { type: "train", buildingId: building.id, unitKind: kind }, economy.options);
}

function research(economy: Economy, lab: Building, kind: UpgradeKind): GameCommand {
  return resolveAiCommandIntent(economy.snapshot, economy.owner, { type: "research", buildingId: lab.id, upgradeKind: kind }, economy.options);
}
