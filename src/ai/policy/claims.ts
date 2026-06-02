import type { GameCommand, GameSnapshot, PlayerId, Unit } from "../../shared/types";
import { createSnapshotQuery } from "../../sdk/snapshot-query";
import type { AiPolicyMemory, AiPolicyUnitClaim } from "../memory";

type Point = {
  x: number;
  y: number;
};

type ClaimPolicyOptions = {
  memory?: AiPolicyMemory;
};

const ATTACK_MOVE_REDIRECT_DISTANCE = 240;
const MERCENARY_CLAIM_TTL_TICKS = 180;

export function pruneAiPolicyMemory(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory) {
  const query = createSnapshotQuery(snapshot);
  for (const [unitId, claim] of Object.entries(memory.unitClaims)) {
    const unit = query.unitById(unitId);
    if (!unit || unit.owner !== owner || claim.expiresTick < snapshot.tick || !claimTargetExists(query, claim)) delete memory.unitClaims[unitId];
  }
}

export function recordAiMemoryForCommands(snapshot: GameSnapshot, scriptId: string, commands: GameCommand[], memory: AiPolicyMemory) {
  const query = createSnapshotQuery(snapshot);
  for (const command of commands) {
    if ((scriptId === "expansion" || scriptId === "economicCatchUp") && command.type === "build" && command.buildingKind === "townHall") {
      memory.strategicPlan = { ...memory.strategicPlan, expansionAttemptTick: snapshot.tick };
      continue;
    }
    if (command.type === "hire") {
      clearUnitClaimsForTarget(memory, command.campId);
      continue;
    }
    if (scriptId === "mercenary" && command.type === "attackMove") {
      const camp = nearestEntity(query.mercenaryCamps(), command);
      if (!camp || distance(camp, command) > ATTACK_MOVE_REDIRECT_DISTANCE) continue;
      for (const unitId of command.unitIds) {
        memory.unitClaims[unitId] = {
          kind: "mercenary",
          targetId: camp.id,
          x: camp.x,
          y: camp.y,
          sinceTick: snapshot.tick,
          expiresTick: snapshot.tick + MERCENARY_CLAIM_TTL_TICKS,
        };
      }
      continue;
    }
    if (scriptId === "expansion" && command.type === "attackMove") {
      const mine = nearestEntity(query.resources(), command);
      if (!mine || distance(mine, command) > ATTACK_MOVE_REDIRECT_DISTANCE) continue;
      for (const unitId of command.unitIds) {
        memory.unitClaims[unitId] = {
          kind: "expansion",
          targetId: mine.id,
          x: mine.x,
          y: mine.y,
          sinceTick: snapshot.tick,
          expiresTick: snapshot.tick + MERCENARY_CLAIM_TTL_TICKS,
        };
      }
      continue;
    }
    if (scriptId === "objectiveControl" && command.type === "attackMove") {
      const guard = nearestEntity(query.neutralUnitsNear(command, ATTACK_MOVE_REDIRECT_DISTANCE), command);
      if (!guard) continue;
      for (const unitId of command.unitIds) {
        memory.unitClaims[unitId] = {
          kind: "creep",
          targetId: guard.id,
          x: guard.x,
          y: guard.y,
          sinceTick: snapshot.tick,
          expiresTick: snapshot.tick + MERCENARY_CLAIM_TTL_TICKS,
        };
      }
      continue;
    }
    if (scriptId.startsWith("workerPressure") && command.type === "attack") {
      const target = query.targetById(command.targetId);
      if (!target) continue;
      for (const unitId of command.unitIds) {
        memory.unitClaims[unitId] = {
          kind: "harass",
          targetId: command.targetId,
          x: target.x,
          y: target.y,
          sinceTick: snapshot.tick,
          expiresTick: snapshot.tick + MERCENARY_CLAIM_TTL_TICKS,
        };
      }
      continue;
    }
    if (scriptId === "skirmishPreservation" && command.type === "move") {
      for (const unitId of command.unitIds) {
        memory.unitClaims[unitId] = {
          kind: "retreat",
          targetId: "retreat",
          x: command.x,
          y: command.y,
          sinceTick: snapshot.tick,
          expiresTick: snapshot.tick + MERCENARY_CLAIM_TTL_TICKS,
        };
      }
      continue;
    }
    clearUnitClaimsForCommand(memory, command);
  }
}

export function activeUnitClaim(snapshot: GameSnapshot, owner: PlayerId, unit: Unit, options: ClaimPolicyOptions) {
  const claim = options.memory?.unitClaims[unit.id];
  if (!claim || claim.expiresTick < snapshot.tick || unit.owner !== owner) return undefined;
  return claimTargetExists(createSnapshotQuery(snapshot), claim) ? claim : undefined;
}

function claimTargetExists(query: ReturnType<typeof createSnapshotQuery>, claim: AiPolicyUnitClaim) {
  if (claim.kind === "mercenary") return Boolean(query.mercenaryCampById(claim.targetId));
  if (claim.kind === "expansion") return Boolean(query.resourceById(claim.targetId));
  if (claim.kind === "creep") return Boolean(query.unitById(claim.targetId));
  if (claim.kind === "harass") return Boolean(query.targetById(claim.targetId));
  return true;
}

function clearUnitClaimsForTarget(memory: AiPolicyMemory, targetId: string) {
  for (const [unitId, claim] of Object.entries(memory.unitClaims)) if (claim.targetId === targetId) delete memory.unitClaims[unitId];
}

function clearUnitClaimsForCommand(memory: AiPolicyMemory, command: GameCommand) {
  if (command.type !== "move" && command.type !== "attackMove" && command.type !== "attack") return;
  for (const unitId of command.unitIds) delete memory.unitClaims[unitId];
}

function nearestEntity<T extends Point>(entities: T[], from: Point): T | undefined {
  return entities.sort((a, b) => distance(a, from) - distance(b, from))[0];
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
