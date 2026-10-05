import { BUILDING_DEFS } from "../../shared/catalog";
import type { GameCommand, GameSnapshot, PlayerId } from "../../shared/types";
import { createAiPolicyMemory } from "../memory";
import { pruneAiPolicyMemory, recordAiMemoryForCommands } from "./claims";
import type { AiCommandEntry, AiPolicyContext, AiScript, PresetAiPolicyOptions } from "./types";
import { isV5HybridPolicy } from "./versions";
import { navalBudgetReserve } from "./naval";

export type ScriptRunnerOptions = {
  commandConflictBypassScriptIds?: ReadonlySet<string>;
  minimumAttackMoveUnits?: (scriptId: string, command: Extract<GameCommand, { type: "attackMove" }>, snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) => number;
};

export function runAiCommandEntriesFromScripts(snapshot: GameSnapshot, owner: PlayerId, scripts: AiScript[], options: PresetAiPolicyOptions = {}, runnerOptions: ScriptRunnerOptions = {}): AiCommandEntry[] {
  if (!snapshot.players[owner] || snapshot.match.winner) return [];
  const policyOptions: AiPolicyContext = { ...options, memory: options.memory ?? createAiPolicyMemory() };
  const preserveHireCampClaims = isV5HybridPolicy(policyOptions) || policyOptions.version === "v5";
  pruneAiPolicyMemory(snapshot, owner, policyOptions.memory);
  const claims = unitClaims(snapshot, owner, scripts, policyOptions);
  const commands: AiCommandEntry[] = [];
  const movedUnitIds = new Set<string>();
  const economyScripts = policyOptions.policyMode === "combat" ? [] : scripts.filter((candidate) => candidate.phase === "economy");

  // @@@combat-policy-mode - Combat benchmarks exercise shared tactical scripts without economy, base-building, or map-control commands polluting the signal.
  const pendingCost = snapshot.units.reduce((total, unit) => total + (unit.owner === owner && unit.order.type === "build" ? BUILDING_DEFS[unit.order.buildingKind].cost : 0), 0);
  const economySnapshot = pendingCost ? { ...snapshot, players: { ...snapshot.players, [owner]: { ...snapshot.players[owner]!, gold: Math.max(0, snapshot.players[owner]!.gold - pendingCost) } } } : snapshot;
  const navalReserve = navalBudgetReserve(economySnapshot, owner, policyOptions);
  const reservedSnapshot = navalReserve ? { ...economySnapshot, players: { ...economySnapshot.players, [owner]: { ...economySnapshot.players[owner]!, gold: economySnapshot.players[owner]!.gold - navalReserve } } } : economySnapshot;
  for (const script of economyScripts) {
    const budget = script.id === "v6Economy" || script.id === "economy" ? economySnapshot : reservedSnapshot;
    const scriptCommands = withoutUnitsClaimedElsewhere(asCommands(script.run(budget, owner, policyOptions)), claims, script.id);
    if (scriptCommands.length > 0) {
      recordAiMemoryForCommands(snapshot, script.id, scriptCommands, policyOptions.memory, { owner, teams: policyOptions.teams, preserveHireCampClaims });
      commands.push(...scriptCommands.map((command) => ({ scriptId: script.id, command })));
      reserveOrderedUnits(scriptCommands, movedUnitIds);
      if (script.id === "economy") continue;
      break;
    }
  }

  for (const script of scripts.filter((candidate) => candidate.phase === "tactics")) {
    const rawScriptCommands = withoutUnitsClaimedElsewhere(asCommands(script.run(snapshot, owner, policyOptions)), claims, script.id);
    const scriptCommands = runnerOptions.commandConflictBypassScriptIds?.has(script.id)
      ? rawScriptCommands
      : removeOrderedUnitConflicts(rawScriptCommands, movedUnitIds, (command) => runnerOptions.minimumAttackMoveUnits?.(script.id, command, snapshot, owner, policyOptions) ?? 1);
    recordAiMemoryForCommands(snapshot, script.id, scriptCommands, policyOptions.memory, { owner, teams: policyOptions.teams, preserveHireCampClaims });
    reserveOrderedUnits(scriptCommands, movedUnitIds);
    commands.push(...scriptCommands.map((command) => ({ scriptId: script.id, command })));
  }

  return commands;
}

function unitClaims(snapshot: GameSnapshot, owner: PlayerId, scripts: AiScript[], options: AiPolicyContext) {
  const claims = new Map<string, string>();
  for (const script of scripts) for (const unitId of script.claimsUnits?.(snapshot, owner, options) ?? []) claims.set(unitId, script.id);
  return claims;
}

function withoutUnitsClaimedElsewhere(commands: GameCommand[], claims: ReadonlyMap<string, string>, scriptId: string): GameCommand[] {
  if (claims.size === 0) return commands;
  const free = (unitId: string) => (claims.get(unitId) ?? scriptId) === scriptId;
  return commands.flatMap((command): GameCommand[] => {
    if (command.type === "move" || command.type === "attackMove" || command.type === "attack" || command.type === "repair" || command.type === "mine") {
      const unitIds = command.unitIds.filter(free);
      return unitIds.length > 0 ? [{ ...command, unitIds }] : [];
    }
    if (command.type === "pickupItem") return free(command.unitId) ? [command] : [];
    return [command];
  });
}

function asCommands(result: GameCommand | GameCommand[] | undefined): GameCommand[] {
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

function removeOrderedUnitConflicts(commands: GameCommand[], movedUnitIds: Set<string>, minimumAttackMoveUnits: (command: Extract<GameCommand, { type: "attackMove" }>) => number): GameCommand[] {
  const filtered: GameCommand[] = [];
  for (const command of commands) {
    if (command.type === "attack") {
      const unitIds = command.unitIds.filter((unitId) => !movedUnitIds.has(unitId));
      if (unitIds.length > 0) filtered.push({ ...command, unitIds });
    } else if (command.type === "attackMove") {
      const unitIds = command.unitIds.filter((unitId) => !movedUnitIds.has(unitId));
      if (unitIds.length >= minimumAttackMoveUnits(command)) filtered.push({ ...command, unitIds });
    } else if (command.type === "move") {
      const unitIds = command.unitIds.filter((unitId) => !movedUnitIds.has(unitId));
      if (unitIds.length > 0) filtered.push({ ...command, unitIds });
    } else if (command.type === "repair") {
      const unitIds = command.unitIds.filter((unitId) => !movedUnitIds.has(unitId));
      if (unitIds.length > 0) filtered.push({ ...command, unitIds });
    } else {
      filtered.push(command);
    }
  }
  return filtered;
}

function reserveOrderedUnits(commands: GameCommand[], movedUnitIds: Set<string>) {
  for (const command of commands) {
    if (command.type === "move" || command.type === "attackMove" || command.type === "attack" || command.type === "repair" || command.type === "board") for (const unitId of command.unitIds) movedUnitIds.add(unitId);
  }
}
