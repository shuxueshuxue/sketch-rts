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

type RecordAiMemoryOptions = {
  owner?: PlayerId;
  teams?: Partial<Record<PlayerId, string>> | undefined;
};

type AttackWaveCommand = Extract<GameCommand, { type: "attack" }> | Extract<GameCommand, { type: "attackMove" }>;

const ATTACK_MOVE_REDIRECT_DISTANCE = 240;
// @@@claim-ttl-window - Long objective walks need a longer memory window than local tactical claims, or squads get re-tasked mid-route.
const UNIT_CLAIM_TTL_TICKS = 900;
const OBJECTIVE_CLAIM_TTL_TICKS = 3600;
const OBJECTIVE_ABANDON_GRACE_TICKS = 300;

export function pruneAiPolicyMemory(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory) {
  const query = createSnapshotQuery(snapshot);
  for (const [unitId, claim] of Object.entries(memory.unitClaims)) {
    const unit = query.unitById(unitId);
    if (!unit || unit.owner !== owner || claim.expiresTick < snapshot.tick || objectiveClaimAbandoned(unit, claim, snapshot.tick) || !claimTargetExists(query, owner, claim)) delete memory.unitClaims[unitId];
  }
  pruneStrategicExpansionClaim(query, owner, memory);
}

export function recordAiMemoryForCommands(snapshot: GameSnapshot, scriptId: string, commands: GameCommand[], memory: AiPolicyMemory, options: RecordAiMemoryOptions = {}) {
  const query = createSnapshotQuery(snapshot, options.teams ? { teams: options.teams } : {});
  for (const command of commands) {
    if ((scriptId === "expansion" || scriptId === "economicCatchUp") && command.type === "build" && command.buildingKind === "townHall") {
      memory.strategicPlan = { ...memory.strategicPlan, expansionAttemptTick: snapshot.tick };
    }
    if (command.type === "build") {
      memory.unitClaims[command.unitId] = {
        kind: "build",
        targetId: buildTargetId(command.buildingKind, command.x, command.y),
        x: command.x,
        y: command.y,
        sinceTick: snapshot.tick,
        expiresTick: snapshot.tick + UNIT_CLAIM_TTL_TICKS,
      };
      continue;
    }
    if (command.type === "hire") {
      clearUnitClaimsForTarget(memory, command.campId);
      continue;
    }
    if (scriptId === "attackWave" && (command.type === "attack" || command.type === "attackMove")) {
      recordAttackWaveMemory(snapshot, query, command, memory, options.owner);
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
          expiresTick: snapshot.tick + OBJECTIVE_CLAIM_TTL_TICKS,
        };
      }
      continue;
    }
    if (scriptId === "expansion" && command.type === "attackMove") {
      const mine = nearestEntity(query.resources(), command);
      if (!mine || distance(mine, command) > ATTACK_MOVE_REDIRECT_DISTANCE) continue;
      memory.strategicPlan = { ...memory.strategicPlan, expansionClaimTargetId: mine.id, expansionClaimTick: snapshot.tick };
      for (const unitId of command.unitIds) {
        memory.unitClaims[unitId] = {
          kind: "expansion",
          targetId: mine.id,
          x: mine.x,
          y: mine.y,
          sinceTick: snapshot.tick,
          expiresTick: snapshot.tick + OBJECTIVE_CLAIM_TTL_TICKS,
        };
      }
      continue;
    }
    if (scriptId === "objectiveControl" && command.type === "attackMove") {
      const camp = nearestEntity(query.mercenaryCamps(), command);
      if (camp && distance(camp, command) <= ATTACK_MOVE_REDIRECT_DISTANCE) {
        for (const unitId of command.unitIds) {
          memory.unitClaims[unitId] = {
            kind: "mercenary",
            targetId: camp.id,
            x: camp.x,
            y: camp.y,
            sinceTick: snapshot.tick,
            expiresTick: snapshot.tick + OBJECTIVE_CLAIM_TTL_TICKS,
          };
        }
        continue;
      }
      const guard = nearestEntity(query.neutralUnitsNear(command, ATTACK_MOVE_REDIRECT_DISTANCE), command);
      if (!guard) continue;
      for (const unitId of command.unitIds) {
        memory.unitClaims[unitId] = {
          kind: "creep",
          targetId: guard.id,
          x: guard.x,
          y: guard.y,
          sinceTick: snapshot.tick,
          expiresTick: snapshot.tick + OBJECTIVE_CLAIM_TTL_TICKS,
        };
      }
      continue;
    }
    if (scriptId === "objectiveControl" && command.type === "move") {
      for (const unitId of command.unitIds) {
        // @@@objective-move-retreat-claim - Objective recalls are still objective-owned; record the move as recovery so the next pass does not reclaim the same camp.
        memory.unitClaims[unitId] = {
          kind: "retreat",
          targetId: "retreat",
          x: command.x,
          y: command.y,
          sinceTick: snapshot.tick,
          expiresTick: snapshot.tick + UNIT_CLAIM_TTL_TICKS,
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
          expiresTick: snapshot.tick + UNIT_CLAIM_TTL_TICKS,
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
          expiresTick: snapshot.tick + UNIT_CLAIM_TTL_TICKS,
        };
      }
      continue;
    }
    clearUnitClaimsForCommand(memory, command);
  }
}

function recordAttackWaveMemory(snapshot: GameSnapshot, query: ReturnType<typeof createSnapshotQuery>, command: AttackWaveCommand, memory: AiPolicyMemory, owner: PlayerId | undefined) {
  const commandOwner = owner ?? commandUnitOwner(query, command);
  if (!commandOwner) return;
  const targetOwner = attackWaveTargetOwner(query, commandOwner, command);
  if (!targetOwner) return;
  const target = attackWaveClaimTarget(query, commandOwner, command);
  const targetId = target ? target.id : `attackWave:${targetOwner}`;
  const targetPoint = target ?? attackWaveCommandPoint(command);
  const previousPlan = memory.strategicPlan;
  const explicitFocusTargetId = command.type === "attack" && target ? target.id : undefined;
  const previousSince =
    explicitFocusTargetId !== undefined
      ? previousPlan?.focusTargetId === explicitFocusTargetId
        ? previousPlan.focusTargetSinceTick
        : undefined
      : previousPlan?.focusTargetOwner === targetOwner
        ? previousPlan.focusTargetSinceTick
        : undefined;
  const nextPlan = {
    ...previousPlan,
    focusTargetOwner: targetOwner,
    focusTargetSinceTick: previousSince ?? snapshot.tick,
    focusTargetUpdatedTick: snapshot.tick,
  };
  if (explicitFocusTargetId !== undefined) nextPlan.focusTargetId = explicitFocusTargetId;
  else if (previousPlan?.focusTargetOwner !== targetOwner) delete nextPlan.focusTargetId;
  memory.strategicPlan = nextPlan;
  upsertMemoryJob(memory, `attackWave:${targetOwner}`, "attackWave", snapshot.tick);
  for (const unitId of command.unitIds) {
    memory.unitClaims[unitId] = {
      kind: "attack",
      targetId,
      x: targetPoint.x,
      y: targetPoint.y,
      sinceTick: snapshot.tick,
      expiresTick: snapshot.tick + UNIT_CLAIM_TTL_TICKS,
    };
  }
}

function commandUnitOwner(query: ReturnType<typeof createSnapshotQuery>, command: AttackWaveCommand): PlayerId | undefined {
  return query.unitById(command.unitIds[0] ?? "")?.owner as PlayerId | undefined;
}

function attackWaveTargetOwner(query: ReturnType<typeof createSnapshotQuery>, owner: PlayerId, command: AttackWaveCommand): PlayerId | undefined {
  const target = attackWaveClaimTarget(query, owner, command);
  if (!target || !("owner" in target) || target.owner === "neutral" || !query.isOpponent(owner, target.owner)) return undefined;
  return target.owner;
}

function attackWaveClaimTarget(query: ReturnType<typeof createSnapshotQuery>, owner: PlayerId, command: AttackWaveCommand) {
  if (command.type === "attack") return query.targetById(command.targetId);
  return nearestEntity([...query.opponentBuildingsNear(owner, command, 620), ...query.opponentUnitsNear(owner, command, 420)], command);
}

function attackWaveCommandPoint(command: AttackWaveCommand): Point {
  if (command.type === "attackMove") return command;
  return { x: 0, y: 0 };
}

function upsertMemoryJob(memory: AiPolicyMemory, id: string, kind: string, tick: number) {
  const job = memory.jobs.find((candidate) => candidate.id === id);
  if (job) {
    job.updatedTick = tick;
    return;
  }
  memory.jobs.push({ id, kind, createdTick: tick, updatedTick: tick });
}

export function activeUnitClaim(snapshot: GameSnapshot, owner: PlayerId, unit: Unit, options: ClaimPolicyOptions) {
  const claim = options.memory?.unitClaims[unit.id];
  if (!claim || claim.expiresTick < snapshot.tick || unit.owner !== owner) return undefined;
  if (objectiveClaimAbandoned(unit, claim, snapshot.tick)) return undefined;
  return claimTargetExists(createSnapshotQuery(snapshot), owner, claim) ? claim : undefined;
}

function objectiveClaimAbandoned(unit: Unit, claim: AiPolicyUnitClaim, currentTick: number) {
  if (claim.kind !== "creep" && claim.kind !== "mercenary" && claim.kind !== "expansion") return false;
  if (currentTick < claim.sinceTick + OBJECTIVE_ABANDON_GRACE_TICKS) return false;
  if (unit.order.type !== "idle") return false;
  // @@@abandoned-objective-claim - Long objective claims keep squads stable while walking; once a unit has stopped far from the point, the old claim is stale ownership.
  return distance(unit, claim) > 260;
}

function claimTargetExists(query: ReturnType<typeof createSnapshotQuery>, owner: PlayerId, claim: AiPolicyUnitClaim) {
  if (claim.kind === "mercenary") return Boolean(query.mercenaryCampById(claim.targetId));
  if (claim.kind === "expansion") return expansionClaimStillNeedsArmy(query, owner, claim);
  if (claim.kind === "creep") return Boolean(query.unitById(claim.targetId));
  if (claim.kind === "harass") return Boolean(query.targetById(claim.targetId));
  if (claim.kind === "build") return claim.sinceTick >= query.snapshot.tick || query.buildings().some((building) => !building.complete && distance(building, claim) <= 80);
  return true;
}

function expansionClaimStillNeedsArmy(query: ReturnType<typeof createSnapshotQuery>, owner: PlayerId, claim: AiPolicyUnitClaim) {
  const resource = query.resourceById(claim.targetId);
  if (!resource) return false;
  // @@@expansion-claim-complete - Once the town hall exists at the claimed mine, army ownership of the clearing task is done.
  return !query.buildings().some((building) => building.owner === owner && building.kind === "townHall" && distance(building, resource) <= 260);
}

function pruneStrategicExpansionClaim(query: ReturnType<typeof createSnapshotQuery>, owner: PlayerId, memory: AiPolicyMemory) {
  const plan = memory.strategicPlan;
  if (!plan?.expansionClaimTargetId) return;
  const resource = query.resourceById(plan.expansionClaimTargetId);
  const expired = plan.expansionClaimTick !== undefined && plan.expansionClaimTick + OBJECTIVE_CLAIM_TTL_TICKS < query.snapshot.tick;
  if (resource && !expired && !query.buildings().some((building) => building.owner === owner && building.kind === "townHall" && distance(building, resource) <= 260)) return;
  delete plan.expansionClaimTargetId;
  delete plan.expansionClaimTick;
}

function buildTargetId(buildingKind: string, x: number, y: number) {
  return `build:${buildingKind}:${Math.round(x)}:${Math.round(y)}`;
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
