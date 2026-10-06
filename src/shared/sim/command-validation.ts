import { shipPassengers } from "../ship-geometry";
import { canBoard } from "../decks";
import { abilityCooldown } from "../ability-cooldowns";
import { aimingProfile } from "../aiming";
import { canAutocast } from "../autocast";
import { canTakeStance } from "../push";
import { buildingPlacementBlocker, terrainBlocksPlacement } from "../build-placement";
import { ABILITY_DEFS, BUILDING_DEFS, MERCENARY_HIRE_RANGE, RACE_DEFS, UNIT_DEFS, UPGRADE_DEFS, maxUpgradeLevel, requiredSupplyCap, unitRules } from "../catalog";
import { canReach, carries, passengerLandingSpot } from "../naval";
import { MAX_CARRIED_ITEMS, buyRefusal, carriedItemCount } from "../shop";
import type { Game } from "../sim";
import type { GameCommand, GameSnapshot, Owner, PlayerId, RallyTarget, Unit, UnitKind } from "../types";
import { ownUnitLookup } from "../unit-lookup";

export type CommandLegalityError = {
  message: string;
  transient: boolean;
};

export function commandValidationError(snapshot: GameSnapshot, owner: PlayerId, command: GameCommand): string | undefined {
  return checkCommandLegality(snapshot, owner, command)?.message;
}

export function checkCommandLegality(snapshot: GameSnapshot, owner: PlayerId, command: GameCommand): CommandLegalityError | undefined {
  const ids="unitIds" in command ? command.unitIds : "unitId" in command ? [command.unitId] : [];
  if(["build","mine","repair","pickupItem","hire"].includes(command.type) && snapshot.units.some(unit=>ids.includes(unit.id) && unit.deck))return commandError("Disembark before working on land",true);
  const player = snapshot.players[owner];
  if (!player) return commandError(`Unknown player ${owner}`);
  if (command.type === "aim") {
    const missing = missingUnitError(snapshot, owner, command.unitIds);
    if (missing) return missing;
    if (!Number.isFinite(command.x) || !Number.isFinite(command.y)) return commandError("Aim requires a finite point");
    return snapshot.units.some(unit => command.unitIds.includes(unit.id) && unit.owner === owner && aimingProfile(unitRules(snapshot, unit))) ? undefined : commandError("Aim requires a ranged unit");
  }
  if (command.type === "move" || command.type === "attackMove" || command.type === "stop" || command.type === "holdPosition" || command.type === "unload") return missingUnitError(snapshot, owner, command.unitIds);
  if (command.type === "unloadPassenger") {
    const transport = snapshot.units.find(unit => unit.id === command.transportId && unit.owner === owner && carries(unit) > 0);
    if (!transport) return commandError(`Unknown ${owner} transport ${command.transportId}`, true);
    if (!shipPassengers(snapshot.units,transport).some(passenger => passenger.id === command.passengerId) && !transport.cargo?.some(passenger=>passenger.id===command.passengerId)) return commandError("Passenger is no longer aboard", true);
    return passengerLandingSpot(snapshot.map, transport, command.passengerId, snapshot.units) ? undefined : commandError("No land nearby to unload; move the transport closer to shore", true);
  }
  if (command.type === "board") {
    const missing = missingUnitError(snapshot, owner, command.unitIds);
    if (missing) return missing;
    const ship = snapshot.units.find(unit => unit.id === command.transportId && unit.owner === owner && carries(unit) > 0);
    if (!ship) return commandError(`Unknown ${owner} transport ${command.transportId}`, true);
    return snapshot.units.some(unit => command.unitIds.includes(unit.id) && unit.owner === owner && canBoard(ship, unit, snapshot.units))
      ? undefined : commandError("No free deck space or payload capacity for these units", true);
  }
  if (command.type === "attack") return missingUnitError(snapshot, owner, command.unitIds) ?? (findTarget(snapshot, command.targetId) ? undefined : commandError(`Unknown target ${command.targetId}`, true));
  if (command.type === "follow") return missingUnitError(snapshot, owner, command.unitIds) ?? (isFriendlyUnit(snapshot, owner, command.targetId) ? undefined : commandError(`Unknown friendly unit ${command.targetId}`, true));
  if (command.type === "mine") return missingUnitError(snapshot, owner, command.unitIds) ?? (snapshot.resources.some((resource) => resource.id === command.resourceId) ? undefined : commandError(`Unknown resource ${command.resourceId}`, true));
  if (command.type === "repair") {
    const missing = missingUnitError(snapshot, owner, command.unitIds);
    if (missing) return missing;
    const building = snapshot.buildings.find((candidate) => candidate.id === command.buildingId && candidate.owner === owner);
    if (!building) return commandError(`Unknown ${owner} building ${command.buildingId}`, true);
    if (building.hp >= building.maxHp) return commandError(`${building.kind} is already fully repaired`, true);
    return undefined;
  }
  if (command.type === "repairShip") {
    const missing = missingUnitError(snapshot, owner, command.unitIds);
    if (missing) return missing;
    const ship = snapshot.units.find(unit => unit.id === command.targetId && unit.owner === owner && UNIT_DEFS[unit.kind].naval);
    if (!ship) return commandError(`Unknown ${owner} ship ${command.targetId}`, true);
    if (ship.hp >= ship.maxHp) return commandError(`${ship.kind} is already fully repaired`, true);
    return undefined;
  }
  if (command.type === "build") {
    const worker = snapshot.units.find((unit) => unit.id === command.unitId && unit.owner === owner && unit.kind === "worker");
    if (!worker) return commandError(`Unknown ${owner} worker ${command.unitId}`, true);
    if (!RACE_DEFS[player.race].buildableBuildings.includes(command.buildingKind)) return commandError(`${player.race} race cannot build ${command.buildingKind}`);
    const blocker = buildingPlacementBlocker(snapshot, command.buildingKind, command);
    if (blocker) return commandError(`${command.buildingKind} placement is too close to ${blocker.kind}`, true);
    if (terrainBlocksPlacement(snapshot.map, command.buildingKind, command)) return commandError(`${command.buildingKind} placement is on blocked ground`);
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
  if (command.type === "cancelTraining") return missingBuildingError(snapshot, owner, [command.buildingId]);
  if (command.type === "train") {
    const building = snapshot.buildings.find((candidate) => candidate.id === command.buildingId && candidate.owner === owner);
    if (!building) return commandError(`Unknown ${owner} building ${command.buildingId}`, true);
    if (!building.complete) return commandError(`Cannot train from incomplete ${building.kind}`);
    if (!BUILDING_DEFS[building.kind].trains.includes(command.unitKind)) return commandError(`${building.kind} cannot train ${command.unitKind}`);
    if (!RACE_DEFS[player.race].trainableUnits.includes(command.unitKind)) return commandError(`${player.race} race cannot train ${command.unitKind}`);
    const cap = requiredSupplyCap(command.unitKind);
    if (player.supplyCap < cap) return commandError(`Need a supply cap of ${cap} to train ${command.unitKind}`, true);
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
    if (!upgrade.researchBuildingKinds.includes(building.kind) || !BUILDING_DEFS[building.kind].researches.includes(command.upgradeKind)) return commandError(`${building.kind} cannot research ${command.upgradeKind}`);
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
  if (command.type === "buy") return buyRefusal(snapshot, owner, command.shopId, command.item);
  if (command.type === "cast") return castError(snapshot, owner, command);
  if (command.type === "setAutocast") {
    if (!canAutocast(command.ability)) return commandError(`${command.ability} cannot be autocast`);
    const missing = missingUnitError(snapshot, owner, command.unitIds);
    if (missing) return missing;
    return snapshot.units.some((unit) => command.unitIds.includes(unit.id) && UNIT_DEFS[unit.kind].abilities.includes(command.ability))
      ? undefined
      : commandError(`None of those units has ${command.ability}`);
  }
  if (command.type === "setStance") {
    const missing = missingUnitError(snapshot, owner, command.unitIds);
    if (missing) return missing;
    return snapshot.units.some((unit) => command.unitIds.includes(unit.id) && canTakeStance(unit.kind)) ? undefined : commandError("None of those units fights in melee");
  }
  if (command.type === "pickupItem") {
    if (!snapshot.units.some((unit) => unit.id === command.unitId && unit.owner === owner)) return commandError(`Unknown ${owner} item carrier ${command.unitId}`, true);
    const item = snapshot.items.find((candidate) => candidate.id === command.itemId);
    if (!item) return commandError(`Unknown item ${command.itemId}`, true);
    if (item.carrierId) return commandError(`${item.id} is already carried`, true);
    return carriedItemCount(snapshot, command.unitId) < MAX_CARRIED_ITEMS ? undefined : commandError(`${command.unitId} carries ${MAX_CARRIED_ITEMS} items already`, true);
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
  if (command.type === "unloadPassenger") {
    const ship=currentUnit(game,owner,command.transportId);
    return ship && (shipPassengers(game.units,ship).some(passenger=>passenger.id===command.passengerId) || ship.cargo?.some(passenger=>passenger.id===command.passengerId)) ? command : undefined;
  }
  if (command.type === "move" || command.type === "attackMove" || command.type === "aim" || command.type === "stop" || command.type === "holdPosition" || command.type === "unload") {
    const unitIds = currentUnitIds(game, owner, command.unitIds);
    return unitIds.length > 0 ? { ...command, unitIds } : undefined;
  }
  if (command.type === "board") {
    const unitIds = currentUnitIds(game, owner, command.unitIds);
    return unitIds.length > 0 && hasCurrentUnit(game, owner, command.transportId) ? { ...command, unitIds } : undefined;
  }
  if (command.type === "attack") {
    const unitIds = currentUnitIds(game, owner, command.unitIds);
    if (unitIds.length === 0 || !findTarget(game, command.targetId)) return undefined;
    return { ...command, unitIds };
  }
  if (command.type === "follow") {
    const unitIds = currentUnitIds(game, owner, command.unitIds);
    if (unitIds.length === 0 || !isFriendlyUnit(game, owner, command.targetId)) return undefined;
    return { ...command, unitIds };
  }
  if (command.type === "mine") {
    const unitIds = currentWorkerIds(game, owner, command.unitIds);
    if (unitIds.length === 0 || !game.resources.some((resource) => resource.id === command.resourceId)) return undefined;
    return { ...command, unitIds };
  }
  if (command.type === "repair") {
    const unitIds = currentWorkerIds(game, owner, command.unitIds);
    const building = currentBuilding(game, owner, command.buildingId);
    if (unitIds.length === 0 || !building) return undefined;
    return { ...command, unitIds };
  }
  if (command.type === "repairShip") {
    const unitIds = currentWorkerIds(game, owner, command.unitIds);
    const ship = currentUnit(game, owner, command.targetId);
    return unitIds.length && ship ? { ...command, unitIds } : undefined;
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
  if (command.type === "cancelTraining") return currentBuilding(game, owner, command.buildingId)?.queue.some(job => job.id === command.jobId) ? command : undefined;
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
    if ((behavior === "heal" || behavior === "curse" || behavior === "charge") && command.targetId && !game.units.some((unit) => unit.id === command.targetId)) return undefined;
    return command;
  }
  if (command.type === "setAutocast" || command.type === "setStance") {
    const unitIds = currentUnitIds(game, owner, command.unitIds);
    return unitIds.length > 0 ? { ...command, unitIds } : undefined;
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
  if (command.type === "hire" || command.type === "buy") {
    return command;
  }
  return command satisfies never;
}

function missingUnitError(snapshot: GameSnapshot, owner: PlayerId, unitIds: string[]) {
  const unit = ownUnitLookup(snapshot.units, owner, unitIds.length);
  const missing = unitIds.find((unitId) => !unit(unitId));
  return missing ? commandError(`Unknown ${owner} unit ${missing}`, true) : undefined;
}

function currentUnitIds(game: Game, owner: PlayerId, unitIds: string[]) {
  const unit = ownUnitLookup(game.units, owner, unitIds.length);
  return unitIds.filter((id) => !!unit(id));
}

function currentWorkerIds(game: Game, owner: PlayerId, unitIds: string[]) {
  const unit = ownUnitLookup(game.units, owner, unitIds.length);
  return unitIds.filter((id) => unit(id)?.kind === "worker");
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
  if (abilityCooldown(caster, command.ability) > 0) return commandError(`${caster.kind} is on cooldown`, true);
  const behavior = ABILITY_DEFS[command.ability].behavior;
  if (behavior === "weapon") {
    const def = ABILITY_DEFS[command.ability];
    if (def.behavior !== "weapon") return commandError("Unknown weapon ability");
    const target = command.targetId ? [...snapshot.units, ...snapshot.buildings, ...(snapshot.obstacles ?? [])].find(target => target.id === command.targetId && areEnemyOwners(snapshot, owner, target.owner)) : undefined;
    if (def.target === "enemy" && !target) return commandError("Weapon requires an enemy target");
    const at = target ?? (Number.isFinite(command.x) && Number.isFinite(command.y) ? {x:command.x!, y:command.y!} : undefined);
    if (!at) return commandError("Weapon requires a target point");
    if (def.weapon.minRange && Math.hypot(at.x-caster.x,at.y-caster.y)<def.weapon.minRange) return commandError("Target is inside the weapon's minimum range",true);
    return undefined;
  }
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
  if (behavior === "charge") {
    const def = ABILITY_DEFS[command.ability];
    const target = command.targetId ? snapshot.units.find((unit) => unit.id === command.targetId && areEnemyOwners(snapshot, unit.owner, owner)) : undefined;
    if (!target || def.behavior !== "charge") return commandError("Charge requires an enemy unit target");
    // Farther than the window, the rider rides up to it first (see @@@cast-order); nearer, there is no room to charge.
    const gap = Math.hypot(target.x - caster.x, target.y - caster.y);
    if (gap < def.minRange) return commandError(`Charge target must be at least ${def.minRange} away`, true);
    // A rider charges nothing it cannot come within reach of (see @@@reach): a ship out on deep water.
    return canReach(snapshot.map, caster, target) ? undefined : commandError("Charge target is out of reach", true);
  }
  return Number.isFinite(command.x) && Number.isFinite(command.y) ? undefined : commandError("Summon requires a target point");
}

// Two owners at war: players on different teams, and a player and the creeps. The client asks it too, for what a
// right-click does and the colour a unit is ringed in.
export function areEnemyOwners(sides: Pick<GameSnapshot, "teams">, a: Owner, b: Owner) {
  if (a === b) return false;
  if (a === "neutral" || b === "neutral") return a !== "neutral" || b !== "neutral";
  return (sides.teams?.[a] ?? a) !== (sides.teams?.[b] ?? b);
}

// An own unit or an ally's: one a unit may follow.
function isFriendlyUnit(sides: Pick<GameSnapshot, "teams" | "units">, owner: PlayerId, unitId: string) {
  return sides.units.some((unit) => unit.id === unitId && !areEnemyOwners(sides, unit.owner, owner));
}

function canSpendGold(snapshot: GameSnapshot, owner: PlayerId, amount: number) {
  return snapshot.players[owner]!.gold >= amount;
}

// As the sim counts it: passengers aboard a transport too (see @@@transport).
function canSupply(snapshot: GameSnapshot, owner: PlayerId, unitKind: UnitKind) {
  const supply = (unit: Unit): number => unitRules(snapshot, unit).supplyUsed + (unit.cargo ?? []).reduce((total, passenger) => total + supply(passenger), 0);
  const unitSupply = snapshot.units.filter((unit) => unit.owner === owner).reduce((total, unit) => total + supply(unit), 0);
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
  return snapshot.units.some((unit) => unit.id === targetId) || snapshot.buildings.some((building) => building.id === targetId) || Boolean(snapshot.obstacles?.some((obstacle) => obstacle.id === targetId));
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
