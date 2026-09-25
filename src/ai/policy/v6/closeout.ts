import type { V6PolicyMemory } from "../../memory";
import type { Building, GameCommand, GameSnapshot, PlayerId } from "../../../shared/types";
import { units } from "../snapshot";
import { averagePoint, distance } from "../spatial";
import type { AiPolicyContext } from "../types";
import { isV6Policy } from "../versions";
import { isBacklineKind } from "./backline";
import { enemyPowerNear, readV6Intel, type V6Intel } from "./intel";
import { recordPlay, v6Memory } from "./memory";
import { strengthOf, TOWER_STRENGTH } from "./strength";

// @@@v6-closeout - An opponent with no army and no economy still counts until its last building falls, and V6's timeouts
// were games like that: V3 wiped out at minute 10, its farms standing at minute 40 while V6's army leaned on V5. A small
// detachment razes a beaten opponent's buildings one by one while the main army keeps the living opponent busy.

const BEATEN_POWER = 2;
const BEATEN_WORKERS = 2;
const DETACHMENT_MIN = 3;
const DETACHMENT_MAX = 8;
const GUARD_RANGE = 900;

export function v6CloseoutUnitIds(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): ReadonlySet<string> {
  if (!isV6Policy(options)) return new Set();
  return new Set(v6Memory(options).closeout?.unitIds ?? []);
}

export function planV6Closeout(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  if (!isV6Policy(options)) return [];
  const memory = v6Memory(options);
  const intel = readV6Intel(snapshot, owner, options);
  if (intel.enemies.some((enemy) => enemy.state === "pushing")) {
    delete memory.closeout;
    return [];
  }
  const job = memory.closeout;
  const squad = job ? units(snapshot, owner).filter((unit) => job.unitIds.includes(unit.id)) : [];
  if (job && squad.length === 0) delete memory.closeout;
  const buildings = beatenBuildings(intel);
  if (buildings.length === 0) {
    delete memory.closeout;
    return [];
  }
  if (!memory.closeout) return startCloseout(snapshot, intel, memory, buildings);
  const current = memory.closeout;
  const target = buildings.find((building) => building.id === current.targetId) ?? nearest(buildings, averagePoint(squad));
  if (enemyPowerNear(intel, target, GUARD_RANGE) > strengthOf(squad)) {
    delete memory.closeout;
    return [];
  }
  current.targetId = target.id;
  current.unitIds = squad.map((unit) => unit.id);
  const idle = squad.filter((unit) => !(unit.order.type === "attack" && unit.order.targetId === target.id));
  return idle.length > 0 ? [{ type: "attack", unitIds: idle.map((unit) => unit.id), targetId: target.id }] : [];
}

function startCloseout(snapshot: GameSnapshot, intel: V6Intel, memory: V6PolicyMemory, buildings: Building[]): GameCommand[] {
  const origin = intel.armyCenter ?? intel.home;
  const target = nearest(buildings, origin);
  const taken = new Set([...(memory.raid?.unitIds ?? [])]);
  const squad = intel.army
    .filter((unit) => !isBacklineKind(unit) && !taken.has(unit.id) && unit.attackDamage > 0 && unit.hp >= unit.maxHp * 0.5)
    .sort((a, b) => distance(a, target) - distance(b, target))
    .slice(0, DETACHMENT_MAX);
  if (squad.length < DETACHMENT_MIN || enemyPowerNear(intel, target, GUARD_RANGE) * 1.3 >= strengthOf(squad)) return [];
  memory.closeout = { unitIds: squad.map((unit) => unit.id), targetId: target.id, sinceTick: snapshot.tick };
  recordPlay(memory, "closeout");
  return [{ type: "attack", unitIds: squad.map((unit) => unit.id), targetId: target.id }];
}

function beatenBuildings(intel: V6Intel) {
  return intel.enemies.filter((enemy) => enemy.power < BEATEN_POWER && enemy.workers.length <= BEATEN_WORKERS).flatMap((enemy) => enemy.buildings);
}

function nearest<T extends { x: number; y: number }>(candidates: T[], from: { x: number; y: number }): T {
  return candidates.reduce((best, candidate) => (distance(candidate, from) < distance(best, from) ? candidate : best));
}

