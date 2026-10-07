import { ABILITY_DEFS, BUILDING_DEFS, UNIT_DEFS, UPGRADE_DEFS } from "../../shared/catalog";
import type { GameCommand, GameSnapshot, PlayerId } from "../../shared/types";
import { createAiPolicyMemory } from "../memory";
import { pruneAiPolicyMemory, recordAiMemoryForCommands } from "./claims";
import type { AiCommandEntry, AiPolicyContext, AiScript, PresetAiPolicyOptions } from "./types";
import { isV5HybridPolicy, isV6Policy } from "./versions";
import { navalBudgetReserve } from "./naval";
import { shopErrandCost } from "./v9/shop";
import { SHIP_WEAPONS } from "../../shared/ship-equipment";

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
  const movedUnitIds = new Set(snapshot.units.filter(unit => unit.owner === owner && unit.order.type === "board").map(unit => unit.id));
  const economyScripts = policyOptions.policyMode === "combat" ? [] : scripts.filter((candidate) => candidate.phase === "economy");

  // @@@combat-policy-mode - Combat benchmarks exercise shared tactical scripts without economy, base-building, or map-control commands polluting the signal.
  const pendingCost = snapshot.units.reduce((total, unit) => total + (unit.owner === owner && unit.order.type === "build" ? BUILDING_DEFS[unit.order.buildingKind].cost : 0), 0);
  const economySnapshot = pendingCost ? { ...snapshot, players: { ...snapshot.players, [owner]: { ...snapshot.players[owner]!, gold: Math.max(0, snapshot.players[owner]!.gold - pendingCost) } } } : snapshot;
  const navalReserve = navalBudgetReserve(economySnapshot, owner, policyOptions);
  const shopReserve = shopErrandCost(economySnapshot, owner, policyOptions) ?? 0;
  let spent = 0;
  const budgetAfter = (reserve: number) => ({ ...economySnapshot, players: { ...economySnapshot.players, [owner]: { ...economySnapshot.players[owner]!, gold: Math.max(0, economySnapshot.players[owner]!.gold - spent) - reserve } } });
  for (const script of economyScripts) {
    const reserve = script.id === "v6Economy" || script.id === "economy" && isV6Policy(policyOptions) ? 0 : script.id === "economy" || script.id === "navalEconomy" ? shopReserve : navalReserve + shopReserve;
    const budget = budgetAfter(reserve);
    const scriptCommands = withoutUnitsClaimedElsewhere(asCommands(script.run(budget, owner, policyOptions)), claims, script.id);
    if (scriptCommands.length > 0) {
      recordAiMemoryForCommands(snapshot, script.id, scriptCommands, policyOptions.memory, { owner, teams: policyOptions.teams, preserveHireCampClaims });
      commands.push(...scriptCommands.map((command) => ({ scriptId: script.id, command })));
      spent += scriptCommands.reduce((total, command) => total + purchaseCost(snapshot, owner, command), 0);
      reserveOrderedUnits(scriptCommands, movedUnitIds, snapshot);
      if (script.id === "economy") continue;
      break;
    }
  }

  for (const script of scripts.filter((candidate) => candidate.phase === "tactics")) {
    const rawScriptCommands = withoutUnitsClaimedElsewhere(asCommands(script.run(script.id === "shopping" ? budgetAfter(0) : snapshot, owner, policyOptions)), claims, script.id);
    const scriptCommands = runnerOptions.commandConflictBypassScriptIds?.has(script.id)
      ? rawScriptCommands
      : removeOrderedUnitConflicts(rawScriptCommands, movedUnitIds, (command) => runnerOptions.minimumAttackMoveUnits?.(script.id, command, snapshot, owner, policyOptions) ?? 1);
    recordAiMemoryForCommands(snapshot, script.id, scriptCommands, policyOptions.memory, { owner, teams: policyOptions.teams, preserveHireCampClaims });
    reserveOrderedUnits(scriptCommands, movedUnitIds, snapshot);
    commands.push(...scriptCommands.map((command) => ({ scriptId: script.id, command })));
  }

  return commands;
}

function purchaseCost(snapshot: GameSnapshot, owner: PlayerId, command: GameCommand): number {
  if (command.type === "build") return BUILDING_DEFS[command.buildingKind].cost;
  if (command.type === "train") return UNIT_DEFS[command.unitKind].cost;
  if (command.type === "research") return UPGRADE_DEFS[command.upgradeKind].levels[snapshot.players[owner]!.upgrades[command.upgradeKind] ?? 0]?.cost ?? 0;
  if (command.type === "hire") return snapshot.mercenaryCamps.find(camp => camp.id === command.campId)?.cost ?? 0;
  if (command.type === "buy") return snapshot.shops?.find(shop => shop.id === command.shopId)?.goods.find(good => good.kind === command.item)?.cost ?? 0;
  if (command.type === "buyShipEquipment") return SHIP_WEAPONS[command.item].cost;
  return 0;
}

function unitClaims(snapshot: GameSnapshot, owner: PlayerId, scripts: AiScript[], options: AiPolicyContext) {
  const claims = new Map<string, string>();
  // Earlier scripts own higher-priority assignments: a ferry or rescue cannot be stolen by a later army module.
  for (const script of scripts) for (const unitId of script.claimsUnits?.(snapshot, owner, options) ?? []) if (!claims.has(unitId)) claims.set(unitId, script.id);
  return claims;
}

function withoutUnitsClaimedElsewhere(commands: GameCommand[], claims: ReadonlyMap<string, string>, scriptId: string): GameCommand[] {
  if (claims.size === 0) return commands;
  const free = (unitId: string) => (claims.get(unitId) ?? scriptId) === scriptId;
  return commands.flatMap((command): GameCommand[] => {
    if (command.type === "move" || command.type === "attackMove" || command.type === "attack" || command.type === "aim" || command.type === "setStance" || (command.type === "repair" || command.type === "repairShip") || command.type === "mine") {
      const unitIds = command.unitIds.filter(free);
      return unitIds.length > 0 ? [{ ...command, unitIds }] : [];
    }
    if (command.type === "pickupItem" || command.type === "build") return free(command.unitId) ? [command] : [];
    if (command.type === "cast" && ABILITY_DEFS[command.ability].behavior === "charge") return free(command.unitId) ? [command] : [];
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
    } else if (command.type === "move" || command.type === "aim") {
      const unitIds = command.unitIds.filter((unitId) => !movedUnitIds.has(unitId));
      if (unitIds.length > 0) filtered.push({ ...command, unitIds });
    } else if ((command.type === "repair" || command.type === "repairShip")) {
      const unitIds = command.unitIds.filter((unitId) => !movedUnitIds.has(unitId));
      if (unitIds.length > 0) filtered.push({ ...command, unitIds });
    } else if (command.type === "cast") {
      if (!movedUnitIds.has(command.unitId)) filtered.push(command);
    } else {
      filtered.push(command);
    }
  }
  return filtered;
}

function reserveOrderedUnits(commands: GameCommand[], movedUnitIds: Set<string>, snapshot: GameSnapshot) {
  for (const command of commands) {
    if (command.type === "move" || command.type === "attackMove" || command.type === "attack" || command.type === "aim" || (command.type === "repair" || command.type === "repairShip") || command.type === "board") for (const unitId of command.unitIds) movedUnitIds.add(unitId);
    if (command.type !== "cast") continue;
    const def = ABILITY_DEFS[command.ability];
    const caster = snapshot.units.find((unit) => unit.id === command.unitId);
    const target = command.targetId ? [...snapshot.units, ...snapshot.buildings].find((entity) => entity.id === command.targetId) : command;
    // Instant spells leave movement alone. A charge or a walk-to-cast owns the order until it finishes.
    const radius = target && !("order" in target) && "radius" in target ? target.radius : 0;
    if (def.behavior === "charge" || (caster && target && target.x !== undefined && target.y !== undefined && Math.hypot(caster.x - target.x, caster.y - target.y) > def.range + radius)) movedUnitIds.add(command.unitId);
  }
}
