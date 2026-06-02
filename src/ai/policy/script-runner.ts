import type { GameCommand, GameSnapshot, PlayerId } from "../../shared/types";
import { createAiPolicyMemory } from "../memory";
import { pruneAiPolicyMemory, recordAiMemoryForCommands } from "./claims";
import type { AiCommandEntry, AiPolicyContext, AiScript, PresetAiPolicyOptions } from "./types";

export type ScriptRunnerOptions = {
  commandConflictBypassScriptIds?: ReadonlySet<string>;
  minimumAttackMoveUnits?: (scriptId: string, snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) => number;
};

export function runAiCommandEntriesFromScripts(snapshot: GameSnapshot, owner: PlayerId, scripts: AiScript[], options: PresetAiPolicyOptions = {}, runnerOptions: ScriptRunnerOptions = {}): AiCommandEntry[] {
  if (!snapshot.players[owner] || snapshot.match.winner) return [];
  const policyOptions: AiPolicyContext = { ...options, memory: options.memory ?? createAiPolicyMemory() };
  pruneAiPolicyMemory(snapshot, owner, policyOptions.memory);
  const commands: AiCommandEntry[] = [];
  const movedUnitIds = new Set<string>();
  const economyScripts = policyOptions.policyMode === "combat" ? [] : scripts.filter((candidate) => candidate.phase === "economy");

  // @@@combat-policy-mode - Combat benchmarks exercise shared tactical scripts without economy, base-building, or map-control commands polluting the signal.
  for (const script of economyScripts) {
    const scriptCommands = asCommands(script.run(snapshot, owner, policyOptions));
    if (scriptCommands.length > 0) {
      recordAiMemoryForCommands(snapshot, script.id, scriptCommands, policyOptions.memory);
      commands.push(...scriptCommands.map((command) => ({ scriptId: script.id, command })));
      reserveOrderedUnits(scriptCommands, movedUnitIds);
      if (script.id === "economy") continue;
      break;
    }
  }

  for (const script of scripts.filter((candidate) => candidate.phase === "tactics")) {
    const rawScriptCommands = asCommands(script.run(snapshot, owner, policyOptions));
    const scriptCommands = runnerOptions.commandConflictBypassScriptIds?.has(script.id)
      ? rawScriptCommands
      : removeOrderedUnitConflicts(rawScriptCommands, movedUnitIds, runnerOptions.minimumAttackMoveUnits?.(script.id, snapshot, owner, policyOptions) ?? 1);
    recordAiMemoryForCommands(snapshot, script.id, scriptCommands, policyOptions.memory);
    reserveOrderedUnits(scriptCommands, movedUnitIds);
    commands.push(...scriptCommands.map((command) => ({ scriptId: script.id, command })));
  }

  return commands;
}

function asCommands(result: GameCommand | GameCommand[] | undefined): GameCommand[] {
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

function removeOrderedUnitConflicts(commands: GameCommand[], movedUnitIds: Set<string>, minimumAttackMoveUnits: number): GameCommand[] {
  if (movedUnitIds.size === 0) return commands;
  const filtered: GameCommand[] = [];
  for (const command of commands) {
    if (command.type === "attack") {
      const unitIds = command.unitIds.filter((unitId) => !movedUnitIds.has(unitId));
      if (unitIds.length > 0) filtered.push({ ...command, unitIds });
    } else if (command.type === "attackMove") {
      const unitIds = command.unitIds.filter((unitId) => !movedUnitIds.has(unitId));
      if (unitIds.length >= minimumAttackMoveUnits) filtered.push({ ...command, unitIds });
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
    if (command.type === "move" || command.type === "attackMove" || command.type === "attack" || command.type === "repair") for (const unitId of command.unitIds) movedUnitIds.add(unitId);
  }
}
