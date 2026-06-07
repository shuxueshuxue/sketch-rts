import { buildingPlacementBlocker } from "../build-placement";
import { ABILITY_DEFS, BUILDING_DEFS, MERCENARY_HIRE_RANGE, RACE_DEFS, UNIT_DEFS, UPGRADE_DEFS, maxUpgradeLevel } from "../catalog";
import type { Game } from "../sim";
import type { GameCommand, GameSnapshot, Owner, PlayerId, RallyTarget, UnitKind } from "../types";

export type CommandLegalityError = {
  message: string;
  transient: boolean;
};

export function commandValidationError(snapshot: GameSnapshot, owner: PlayerId, command: GameCommand): string | undefined {
  return checkCommandLegality(snapshot, owner, command)?.message;
}

export function checkCommandLegality(snapshot: GameSnapshot, owner: PlayerId, command: GameCommand): CommandLegalityError | undefined {
  const player = snapshot.players[owner];
  if (!player) return commandError(`Unknown player ${owner}`);
  if (command.type === "move" || command.type === "attackMove") return missingUnitError(snapshot, owner, command.unitIds);
  if (command.type === "attack") return missingUnitError(snapshot, owner, command.unitIds) ?? (findTarget(snapshot, command.targetId) ? undefined : commandError(`Unknown target ${command.targetId}`, true));
  if (command.type === "mine") return missingUnitError(snapshot, owner, command.unitIds) ?? (snapshot.resources.some((resource) => resource.id === command.resourceId) ? undefined : commandError(`Unknown resource ${command.resourceId}`, true));
  if (command.type === "repair") {
    const missing = missingUnitError(snapshot, owner, command.unitIds);
    if (missing) return missing;
    const building = snapshot.buildings.find((candidate) => candidate.id === command.buildingId && candidate.owner === owner);
    if (!building) return commandError(`Unknown ${owner} building ${command.buildingId}`, true);
    if (building.hp >= building.maxHp) return commandError(`${building.kind} is already fully repaired`, true);
    return undefined;
  }
  if (command.type === "build") {
    const worker = snapshot.units.find((unit) => unit.id === command.unitId && unit.owner === owner && unit.kind === "worker");
    if (!worker) return commandError(`Unknown ${owner} worker ${command.unitId}`, true);
    if (!RACE_DEFS[player.race].buildableBuildings.includes(command.buildingKind)) return commandError(`${player.race} race cannot build ${command.buildingKind}`);
    const blocker = buildingPlacementBlocker(snapshot, command.buildingKind, command);
    if (blocker) return commandError(`${command.buildingKind} placement is too close to ${blocker.kind}`, true);
    return canSpendGold(snapshot, owner, BUILDING_DEFS[command.buildingKind].cost) ? undefined : commandError(`Need ${BUILDING_DEFS[command.buildingKind].cost} gold`, true);
  }
  if (command.type === "setRally") {
    const missing = missingBuildingError(snapshot, owner, command.buildingIds);
    if (missing) return missing;
    const rallyless = command.buildingIds
      .map((buildingId) => snapshot.buildings.find((building) => building.id === buildingId && building.owner === owner))
      .find((building) => building && BUILDING_DEFS[building.kind].trains.length === 0);
    if (rallyless) return commandError(`${rallyless.kind} has no training rally point`);
    return rallyTargetError(snapshot, owner, command.target);
  }
  if (command.type === "train") {
    const building = snapshot.buildings.find((candidate) => candidate.id === command.buildingId && candidate.owner === owner);
    if (!building) return commandError(`Unknown ${owner} building ${command.buildingId}`, true);
    if (!building.complete) return commandError(`Cannot train from incomplete ${building.kind}`);
    if (!BUILDING_DEFS[building.kind].trains.includes(command.unitKind)) return commandError(`${building.kind} cannot train ${command.unitKind}`);
    if (!RACE_DEFS[player.race].trainableUnits.includes(command.unitKind)) return commandError(`${player.race} race cannot train ${command.unitKind}`);
    if (!canSupply(snapshot, owner, command.unitKind)) return commandError(`Need more supply to train ${command.unitKind}`, true);
    return canSpendGold(snapshot, owner, UNIT_DEFS[command.unitKind].cost) ? undefined : commandError(`Need ${UNIT_DEFS[command.unitKind].cost} gold`, true);
  }
  if (command.type === "research") {
    const building = snapshot.buildings.find((candidate) => candidate.id === command.buildingId && candidate.owner === owner);
    if (!building) return commandError(`Unknown ${owner} building ${command.buildingId}`, true);
    if (!building.complete) return commandError(`Cannot research from incomplete ${building.kind}`);
    const upgrade = UPGRADE_DEFS[command.upgradeKind];
    if (!upgrade) return commandError(`Unknown upgrade ${command.upgradeKind}`);
    if (!RACE_DEFS[player.race].upgrades.includes(command.upgradeKind)) return commandError(`${player.race} race cannot research ${command.upgradeKind}`);
    if (upgrade.buildingKind !== building.kind || !BUILDING_DEFS[building.kind].researches.includes(command.upgradeKind)) return commandError(`${building.kind} cannot research ${command.upgradeKind}`);
    const currentLevel = player.upgrades[command.upgradeKind] ?? 0;
    if (currentLevel >= maxUpgradeLevel(command.upgradeKind)) return commandError(`${command.upgradeKind} already at max level`, true);
    if (building.researchQueue.some((job) => job.upgradeKind === command.upgradeKind)) return commandError(`${command.upgradeKind} is already queued`, true);
    const nextLevel = upgrade.levels[currentLevel];
    if (!nextLevel) return commandError(`${command.upgradeKind} missing level ${currentLevel + 1}`);
    return canSpendGold(snapshot, owner, nextLevel.cost) ? undefined : commandError(`Need ${nextLevel.cost} gold`, true);
  }
  if (command.type === "hire") {
    const camp = snapshot.mercenaryCamps.find((candidate) => candidate.id === command.campId);
    if (!camp) return commandError(`Unknown mercenary camp ${command.campId}`);
    if (camp.stock <= 0) return commandError(`${camp.id} has no mercenary stock`, true);
    if (camp.cooldownRemaining > 0) return commandError(`${camp.id} is restocking`, true);
    if (!hasFriendlyUnitAtCamp(snapshot, owner, camp)) return commandError(`${camp.id} needs a friendly unit nearby before hiring`, true);
    if (!canSupply(snapshot, owner, camp.hireKind)) return commandError(`Need more supply to hire ${camp.hireKind}`, true);
    return canSpendGold(snapshot, owner, camp.cost) ? undefined : commandError(`Need ${camp.cost} gold`, true);
  }
  if (command.type === "cast") return castError(snapshot, owner, command);
  if (command.type === "pickupItem") {
    if (!snapshot.units.some((unit) => unit.id === command.unitId && unit.owner === owner)) return commandError(`Unknown ${owner} item carrier ${command.unitId}`, true);
    const item = snapshot.items.find((candidate) => candidate.id === command.itemId);
    if (!item) return commandError(`Unknown item ${command.itemId}`, true);
    return item.carrierId ? commandError(`${item.id} is already carried`, true) : undefined;
  }
  if (command.type === "dropItem" || command.type === "useItem") {
    if (!snapshot.units.some((unit) => unit.id === command.unitId && unit.owner === owner)) return commandError(`Unknown ${owner} item carrier ${command.unitId}`, true);
    const item = snapshot.items.find((candidate) => candidate.id === command.itemId);
    if (!item) return commandError(`Unknown item ${command.itemId}`, true);
    return item.carrierId === command.unitId ? undefined : commandError(`${command.unitId} is not carrying ${item.id}`, true);
  }
  return command satisfies never;
}

function commandError(message: string, transient = false): CommandLegalityError {
  return { message, transient };
}

export function narrowFrameCommandToLiveOperands(game: Game, owner: PlayerId, command: GameCommand): GameCommand | undefined {
  if (!game.players[owner]) return command;
  if (command.type === "move" || command.type === "attackMove") {
    const unitIds = currentUnitIds(game, owner, command.unitIds);
    return unitIds.length > 0 ? { ...command, unitIds } : undefined;
  }
  if (command.type === "attack") {
    const unitIds = currentUnitIds(game, owner, command.unitIds);
    if (unitIds.length === 0 || !findTarget(game, command.targetId)) return undefined;
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
    if (unitIds.length === 0 || !building) return undefined;
    return { ...command, unitIds };
  }
  if (command.type === "build") {
    if (currentUnit(game, owner, command.unitId)?.kind !== "worker") return undefined;
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
    return command;
  }
  if (command.type === "research") {
    const building = currentBuilding(game, owner, command.buildingId);
    if (!building) return undefined;
    return command;
  }
  if (command.type === "cast") {
    const caster = currentUnit(game, owner, command.unitId);
    if (!caster) return undefined;
    const behavior = ABILITY_DEFS[command.ability].behavior;
    if ((behavior === "heal" || behavior === "curse") && command.targetId && !game.units.some((unit) => unit.id === command.targetId)) return undefined;
    return command;
  }
  if (command.type === "pickupItem") {
    if (!hasCurrentUnit(game, owner, command.unitId)) return undefined;
    const item = game.items.find((candidate) => candidate.id === command.itemId);
    return item ? command : undefined;
  }
  if (command.type === "dropItem" || command.type === "useItem") {
    if (!hasCurrentUnit(game, owner, command.unitId)) return undefined;
    return game.items.some((item) => item.id === command.itemId) ? command : undefined;
  }
  if (command.type === "hire") {
    return command;
  }
  return command satisfies never;
}

function missingUnitError(snapshot: GameSnapshot, owner: PlayerId, unitIds: string[]) {
  const missing = unitIds.find((unitId) => !snapshot.units.some((unit) => unit.id === unitId && unit.owner === owner));
  return missing ? commandError(`Unknown ${owner} unit ${missing}`, true) : undefined;
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

function isStaleRallyTarget(game: Game, owner: PlayerId, target: RallyTarget | undefined) {
  if (!target || target.type === "point") return false;
  if (target.type === "resource") return !game.resources.some((resource) => resource.id === target.resourceId);
  return !game.units.some((unit) => unit.id === target.unitId && unit.owner === owner);
}

function missingBuildingError(snapshot: GameSnapshot, owner: PlayerId, buildingIds: string[]) {
  const missing = buildingIds.find((buildingId) => !snapshot.buildings.some((building) => building.id === buildingId && building.owner === owner));
  return missing ? commandError(`Unknown ${owner} building ${missing}`, true) : undefined;
}

function rallyTargetError(snapshot: GameSnapshot, owner: PlayerId, target: Extract<GameCommand, { type: "setRally" }>["target"]) {
  if (!target || target.type === "point") return undefined;
  if (target.type === "resource") return snapshot.resources.some((resource) => resource.id === target.resourceId) ? undefined : commandError(`Unknown rally resource ${target.resourceId}`, true);
  return snapshot.units.some((unit) => unit.id === target.unitId && unit.owner === owner) ? undefined : commandError(`Unknown ${owner} rally unit ${target.unitId}`, true);
}

function castError(snapshot: GameSnapshot, owner: PlayerId, command: Extract<GameCommand, { type: "cast" }>) {
  const caster = snapshot.units.find((unit) => unit.id === command.unitId && unit.owner === owner);
  if (!caster) return commandError(`Unknown ${owner} caster ${command.unitId}`, true);
  if (!UNIT_DEFS[caster.kind].abilities.includes(command.ability)) return commandError(`${caster.kind} cannot cast ${command.ability}`);
  if (caster.cooldown > 0) return commandError(`${caster.kind} is on cooldown`, true);
  const behavior = ABILITY_DEFS[command.ability].behavior;
  if (behavior === "heal") {
    return command.targetId && snapshot.units.some((unit) => unit.id === command.targetId && !areEnemyOwners(snapshot, unit.owner, owner))
      ? undefined
      : commandError("Heal requires an allied unit target");
  }
  if (behavior === "curse") {
    return command.targetId && snapshot.units.some((unit) => unit.id === command.targetId && areEnemyOwners(snapshot, unit.owner, owner))
      ? undefined
      : commandError("Curse requires an enemy unit target");
  }
  return Number.isFinite(command.x) && Number.isFinite(command.y) ? undefined : commandError("Summon requires a target point");
}

function areEnemyOwners(snapshot: GameSnapshot, a: Owner, b: Owner) {
  if (a === b) return false;
  if (a === "neutral" || b === "neutral") return a !== "neutral" || b !== "neutral";
  return (snapshot.teams?.[a] ?? a) !== (snapshot.teams?.[b] ?? b);
}

function canSpendGold(snapshot: GameSnapshot, owner: PlayerId, amount: number) {
  return snapshot.players[owner]!.gold >= amount;
}

function canSupply(snapshot: GameSnapshot, owner: PlayerId, unitKind: UnitKind) {
  const unitSupply = snapshot.units.filter((unit) => unit.owner === owner).reduce((total, unit) => total + UNIT_DEFS[unit.kind].supplyUsed, 0);
  const queuedSupply = snapshot.buildings
    .filter((building) => building.owner === owner)
    .flatMap((building) => building.queue)
    .reduce((total, job) => total + UNIT_DEFS[job.unitKind].supplyUsed, 0);
  return unitSupply + queuedSupply + UNIT_DEFS[unitKind].supplyUsed <= snapshot.players[owner]!.supplyCap;
}

function hasFriendlyUnitAtCamp(snapshot: GameSnapshot, owner: PlayerId, camp: { x: number; y: number; radius: number }) {
  return snapshot.units.some((unit) => unit.owner === owner && distance(unit, camp) <= camp.radius + unit.radius + MERCENARY_HIRE_RANGE);
}

function findTarget(snapshot: GameSnapshot, targetId: string) {
  return snapshot.units.some((unit) => unit.id === targetId) || snapshot.buildings.some((building) => building.id === targetId);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
