import { issuePlayerCommand, snapshotGame, stepGame, type Game } from "../sim";
import type { CommandEnvelope, CommandFrame } from "../net/types";
import { checksumGame } from "./checksum";
import { buildingPlacementBlocker } from "../build-placement";
import { BUILDING_DEFS, MERCENARY_HIRE_RANGE, RACE_DEFS, UNIT_DEFS, UPGRADE_DEFS, maxUpgradeLevel } from "../catalog";
import type { GameCommand, GameSnapshot, Owner, PlayerId, RallyTarget, UnitKind } from "../types";

export type FrameResult = {
  tick: number;
  checksum: string;
  snapshot?: GameSnapshot;
};

export type CommandFrameApplyHooks = {
  beforeApply?: (entry: CommandEnvelope) => void;
  afterApply?: (entry: CommandEnvelope) => void;
};

export function applyCommandFrame(game: Game, frame: CommandFrame, hooks: CommandFrameApplyHooks = {}): void {
  if (frame.tick !== game.tick) throw new Error(`Command frame ${frame.sequence} targets tick ${frame.tick} but game is at tick ${game.tick}`);
  for (const entry of frame.commands) {
    hooks.beforeApply?.(entry);
    issueFrameCommand(game, entry.playerId, entry.command);
    hooks.afterApply?.(entry);
  }
}

export function stepCommandFrame(game: Game, frame: CommandFrame, options: { includeSnapshot?: boolean } = {}): FrameResult {
  applyCommandFrame(game, frame);
  stepGame(game);
  return {
    tick: game.tick,
    checksum: checksumGame(game),
    ...(options.includeSnapshot ? { snapshot: snapshotGame(game) } : {}),
  };
}

function issueFrameCommand(game: Game, owner: PlayerId, command: GameCommand): void {
  // @@@frame-issuer-subset - Network frames carry accepted intent; units/buildings that died before this tick are no longer issuers, not sim-corrupt ids.
  const currentCommand = commandWithCurrentIssuers(game, owner, command);
  if (!currentCommand) return;
  issuePlayerCommand(game, owner, currentCommand);
}

export function commandWithCurrentIssuers(game: Game, owner: PlayerId, command: GameCommand): GameCommand | undefined {
  if (!game.players[owner]) return command;
  if (command.type === "startMap") return command;
  if (command.type === "move" || command.type === "attackMove") {
    const unitIds = currentUnitIds(game, owner, command.unitIds);
    return unitIds.length > 0 ? { ...command, unitIds } : undefined;
  }
  if (command.type === "attack") {
    const unitIds = currentUnitIds(game, owner, command.unitIds);
    if (unitIds.length === 0 || !findCurrentTarget(game, command.targetId)) return undefined;
    return { ...command, unitIds };
  }
  if (command.type === "mine") {
    const unitIds = currentUnitIds(game, owner, command.unitIds).filter((unitId) => currentUnit(game, owner, unitId)?.kind === "worker");
    if (unitIds.length === 0 || !game.resources.some((resource) => resource.id === command.resourceId)) return undefined;
    return { ...command, unitIds };
  }
  if (command.type === "repair") {
    const unitIds = currentUnitIds(game, owner, command.unitIds).filter((unitId) => currentUnit(game, owner, unitId)?.kind === "worker");
    const building = currentBuilding(game, owner, command.buildingId);
    if (unitIds.length === 0 || !building || building.hp >= building.maxHp) return undefined;
    return { ...command, unitIds };
  }
  if (command.type === "build") {
    if (currentUnit(game, owner, command.unitId)?.kind !== "worker") return undefined;
    if (!RACE_DEFS[game.players[owner].race].buildableBuildings.includes(command.buildingKind)) return command;
    if (buildingPlacementBlocker(game, command.buildingKind, command)) return undefined;
    if (!canSpendGold(game, owner, BUILDING_DEFS[command.buildingKind].cost)) return undefined;
    return command;
  }
  if (command.type === "setRally") {
    const buildingIds = currentBuildingIds(game, owner, command.buildingIds);
    if (buildingIds.length === 0 || isStaleRallyTarget(game, owner, command.target)) return undefined;
    return { ...command, buildingIds };
  }
  if (command.type === "train") {
    const building = currentBuilding(game, owner, command.buildingId);
    if (!building) return undefined;
    if (!building.complete || !BUILDING_DEFS[building.kind].trains.includes(command.unitKind) || !RACE_DEFS[game.players[owner].race].trainableUnits.includes(command.unitKind)) return command;
    if (!canSupply(game, owner, command.unitKind) || !canSpendGold(game, owner, UNIT_DEFS[command.unitKind].cost)) return undefined;
    return command;
  }
  if (command.type === "research") {
    const building = currentBuilding(game, owner, command.buildingId);
    if (!building) return undefined;
    const upgrade = UPGRADE_DEFS[command.upgradeKind];
    if (!building.complete || !upgrade || upgrade.buildingKind !== building.kind || !BUILDING_DEFS[building.kind].researches.includes(command.upgradeKind) || !RACE_DEFS[game.players[owner].race].upgrades.includes(command.upgradeKind)) return command;
    const currentLevel = game.players[owner].upgrades[command.upgradeKind] ?? 0;
    if (currentLevel >= maxUpgradeLevel(command.upgradeKind) || building.researchQueue.some((job) => job.upgradeKind === command.upgradeKind)) return undefined;
    const nextLevel = upgrade.levels[currentLevel];
    if (!nextLevel) return command;
    if (!canSpendGold(game, owner, nextLevel.cost)) return undefined;
    return command;
  }
  if (command.type === "cast") {
    const caster = currentUnit(game, owner, command.unitId);
    if (!caster) return undefined;
    if (!UNIT_DEFS[caster.kind].abilities.includes(command.ability)) return command;
    if (caster.cooldown > 0) return undefined;
    if (command.ability === "heal" && (!command.targetId || !game.units.some((unit) => unit.id === command.targetId && !areEnemyOwners(game, unit.owner, owner)))) return undefined;
    if (command.ability === "curse" && (!command.targetId || !game.units.some((unit) => unit.id === command.targetId && areEnemyOwners(game, unit.owner, owner)))) return undefined;
    return command;
  }
  if (command.type === "pickupItem") {
    if (!hasCurrentUnit(game, owner, command.unitId)) return undefined;
    const item = game.items.find((candidate) => candidate.id === command.itemId);
    return item && !item.carrierId ? command : undefined;
  }
  if (command.type === "dropItem" || command.type === "useItem") {
    if (!hasCurrentUnit(game, owner, command.unitId)) return undefined;
    return isCarryingItem(game, command.unitId, command.itemId) ? command : undefined;
  }
  if (command.type === "hire") {
    const camp = game.mercenaryCamps.find((candidate) => candidate.id === command.campId);
    if (!camp) return command;
    if (camp.stock <= 0 || camp.cooldownRemaining > 0 || !canSupply(game, owner, camp.hireKind) || !canSpendGold(game, owner, camp.cost) || !hasFriendlyUnitAtCamp(game, owner, camp)) return undefined;
    return command;
  }
  return command satisfies never;
}

function currentUnitIds(game: Game, owner: PlayerId, unitIds: string[]) {
  return unitIds.filter((id) => hasCurrentUnit(game, owner, id));
}

function currentBuildingIds(game: Game, owner: PlayerId, buildingIds: string[]) {
  return buildingIds.filter((id) => hasCurrentBuilding(game, owner, id));
}

function currentUnit(game: Game, owner: PlayerId, unitId: string) {
  return game.units.find((unit) => unit.id === unitId && unit.owner === owner);
}

function currentBuilding(game: Game, owner: PlayerId, buildingId: string) {
  return game.buildings.find((building) => building.id === buildingId && building.owner === owner);
}

function hasCurrentUnit(game: Game, owner: PlayerId, unitId: string) {
  return !!currentUnit(game, owner, unitId);
}

function hasCurrentBuilding(game: Game, owner: PlayerId, buildingId: string) {
  return !!currentBuilding(game, owner, buildingId);
}

function findCurrentTarget(game: Game, targetId: string) {
  return game.units.some((unit) => unit.id === targetId) || game.buildings.some((building) => building.id === targetId);
}

function isStaleRallyTarget(game: Game, owner: PlayerId, target: RallyTarget | undefined) {
  if (!target || target.type === "point") return false;
  if (target.type === "resource") return !game.resources.some((resource) => resource.id === target.resourceId);
  return !game.units.some((unit) => unit.id === target.unitId && unit.owner === owner);
}

function canSpendGold(game: Game, owner: PlayerId, amount: number) {
  return game.players[owner]!.gold >= amount;
}

function canSupply(game: Game, owner: PlayerId, unitKind: UnitKind) {
  return projectedSupplyUsed(game, owner) + UNIT_DEFS[unitKind].supplyUsed <= game.players[owner]!.supplyCap;
}

function projectedSupplyUsed(game: Game, owner: PlayerId) {
  const unitSupply = game.units.filter((unit) => unit.owner === owner).reduce((total, unit) => total + UNIT_DEFS[unit.kind].supplyUsed, 0);
  const queuedSupply = game.buildings
    .filter((building) => building.owner === owner)
    .flatMap((building) => building.queue)
    .reduce((total, job) => total + UNIT_DEFS[job.unitKind].supplyUsed, 0);
  return unitSupply + queuedSupply;
}

function hasFriendlyUnitAtCamp(game: Game, owner: PlayerId, camp: { x: number; y: number; radius: number }) {
  return game.units.some((unit) => unit.owner === owner && distance(unit, camp) <= camp.radius + unit.radius + MERCENARY_HIRE_RANGE);
}

function isCarryingItem(game: Game, unitId: string, itemId: string) {
  return game.items.some((item) => item.id === itemId && item.carrierId === unitId);
}

function areEnemyOwners(game: Game, a: Owner, b: Owner) {
  if (a === b) return false;
  if (a === "neutral" || b === "neutral") return a !== "neutral" || b !== "neutral";
  return game.teams[a] !== game.teams[b];
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
