import { buildingPlacementBlocker } from "../build-placement";
import { BUILDING_DEFS, MERCENARY_HIRE_RANGE, RACE_DEFS, UNIT_DEFS, UPGRADE_DEFS, maxUpgradeLevel } from "../catalog";
import type { GameCommand, GameSnapshot, PlayerId, UnitKind } from "../types";

export function commandValidationError(snapshot: GameSnapshot, owner: PlayerId, command: GameCommand): string | undefined {
  const player = snapshot.players[owner];
  if (!player) return `Unknown player ${owner}`;
  if (command.type === "startMap") return "startMap is a server session command, not a simulation order";
  if (command.type === "move" || command.type === "attackMove") return missingUnitError(snapshot, owner, command.unitIds);
  if (command.type === "attack") return missingUnitError(snapshot, owner, command.unitIds) ?? (findTarget(snapshot, command.targetId) ? undefined : `Unknown target ${command.targetId}`);
  if (command.type === "mine") return missingUnitError(snapshot, owner, command.unitIds) ?? (snapshot.resources.some((resource) => resource.id === command.resourceId) ? undefined : `Unknown resource ${command.resourceId}`);
  if (command.type === "repair") {
    const missing = missingUnitError(snapshot, owner, command.unitIds);
    if (missing) return missing;
    const building = snapshot.buildings.find((candidate) => candidate.id === command.buildingId && candidate.owner === owner);
    if (!building) return `Unknown ${owner} building ${command.buildingId}`;
    if (building.hp >= building.maxHp) return `${building.kind} is already fully repaired`;
    return undefined;
  }
  if (command.type === "build") {
    const worker = snapshot.units.find((unit) => unit.id === command.unitId && unit.owner === owner && unit.kind === "worker");
    if (!worker) return `Unknown ${owner} worker ${command.unitId}`;
    if (!RACE_DEFS[player.race].buildableBuildings.includes(command.buildingKind)) return `${player.race} race cannot build ${command.buildingKind}`;
    const blocker = buildingPlacementBlocker(snapshot, command.buildingKind, command);
    if (blocker) return `${command.buildingKind} placement is too close to ${blocker.kind}`;
    return canSpendGold(snapshot, owner, BUILDING_DEFS[command.buildingKind].cost) ? undefined : `Need ${BUILDING_DEFS[command.buildingKind].cost} gold`;
  }
  if (command.type === "setRally") {
    const missing = missingBuildingError(snapshot, owner, command.buildingIds);
    if (missing) return missing;
    const rallyless = command.buildingIds
      .map((buildingId) => snapshot.buildings.find((building) => building.id === buildingId && building.owner === owner))
      .find((building) => building && BUILDING_DEFS[building.kind].trains.length === 0);
    if (rallyless) return `${rallyless.kind} has no training rally point`;
    return rallyTargetError(snapshot, owner, command.target);
  }
  if (command.type === "train") {
    const building = snapshot.buildings.find((candidate) => candidate.id === command.buildingId && candidate.owner === owner);
    if (!building) return `Unknown ${owner} building ${command.buildingId}`;
    if (!building.complete) return `Cannot train from incomplete ${building.kind}`;
    if (!BUILDING_DEFS[building.kind].trains.includes(command.unitKind)) return `${building.kind} cannot train ${command.unitKind}`;
    if (!RACE_DEFS[player.race].trainableUnits.includes(command.unitKind)) return `${player.race} race cannot train ${command.unitKind}`;
    if (!canSupply(snapshot, owner, command.unitKind)) return `Need more supply to train ${command.unitKind}`;
    return canSpendGold(snapshot, owner, UNIT_DEFS[command.unitKind].cost) ? undefined : `Need ${UNIT_DEFS[command.unitKind].cost} gold`;
  }
  if (command.type === "research") {
    const building = snapshot.buildings.find((candidate) => candidate.id === command.buildingId && candidate.owner === owner);
    if (!building) return `Unknown ${owner} building ${command.buildingId}`;
    if (!building.complete) return `Cannot research from incomplete ${building.kind}`;
    const upgrade = UPGRADE_DEFS[command.upgradeKind];
    if (!upgrade) return `Unknown upgrade ${command.upgradeKind}`;
    if (!RACE_DEFS[player.race].upgrades.includes(command.upgradeKind)) return `${player.race} race cannot research ${command.upgradeKind}`;
    if (upgrade.buildingKind !== building.kind || !BUILDING_DEFS[building.kind].researches.includes(command.upgradeKind)) return `${building.kind} cannot research ${command.upgradeKind}`;
    const currentLevel = player.upgrades[command.upgradeKind] ?? 0;
    if (currentLevel >= maxUpgradeLevel(command.upgradeKind)) return `${command.upgradeKind} already at max level`;
    if (building.researchQueue.some((job) => job.upgradeKind === command.upgradeKind)) return `${command.upgradeKind} is already queued`;
    const nextLevel = upgrade.levels[currentLevel];
    if (!nextLevel) return `${command.upgradeKind} missing level ${currentLevel + 1}`;
    return canSpendGold(snapshot, owner, nextLevel.cost) ? undefined : `Need ${nextLevel.cost} gold`;
  }
  if (command.type === "hire") {
    const camp = snapshot.mercenaryCamps.find((candidate) => candidate.id === command.campId);
    if (!camp) return `Unknown mercenary camp ${command.campId}`;
    if (camp.stock <= 0) return `${camp.id} has no mercenary stock`;
    if (camp.cooldownRemaining > 0) return `${camp.id} is restocking`;
    if (!hasFriendlyUnitAtCamp(snapshot, owner, camp)) return `${camp.id} needs a friendly unit nearby before hiring`;
    if (!canSupply(snapshot, owner, camp.hireKind)) return `Need more supply to hire ${camp.hireKind}`;
    return canSpendGold(snapshot, owner, camp.cost) ? undefined : `Need ${camp.cost} gold`;
  }
  if (command.type === "cast") return castError(snapshot, owner, command);
  if (command.type === "pickupItem") {
    if (!snapshot.units.some((unit) => unit.id === command.unitId && unit.owner === owner)) return `Unknown ${owner} item carrier ${command.unitId}`;
    const item = snapshot.items.find((candidate) => candidate.id === command.itemId);
    if (!item) return `Unknown item ${command.itemId}`;
    return item.carrierId ? `${item.id} is already carried` : undefined;
  }
  if (command.type === "dropItem" || command.type === "useItem") {
    if (!snapshot.units.some((unit) => unit.id === command.unitId && unit.owner === owner)) return `Unknown ${owner} item carrier ${command.unitId}`;
    const item = snapshot.items.find((candidate) => candidate.id === command.itemId);
    if (!item) return `Unknown item ${command.itemId}`;
    return item.carrierId === command.unitId ? undefined : `${command.unitId} is not carrying ${item.id}`;
  }
  return command satisfies never;
}

function missingUnitError(snapshot: GameSnapshot, owner: PlayerId, unitIds: string[]) {
  const missing = unitIds.find((unitId) => !snapshot.units.some((unit) => unit.id === unitId && unit.owner === owner));
  return missing ? `Unknown ${owner} unit ${missing}` : undefined;
}

function missingBuildingError(snapshot: GameSnapshot, owner: PlayerId, buildingIds: string[]) {
  const missing = buildingIds.find((buildingId) => !snapshot.buildings.some((building) => building.id === buildingId && building.owner === owner));
  return missing ? `Unknown ${owner} building ${missing}` : undefined;
}

function rallyTargetError(snapshot: GameSnapshot, owner: PlayerId, target: Extract<GameCommand, { type: "setRally" }>["target"]) {
  if (!target || target.type === "point") return undefined;
  if (target.type === "resource") return snapshot.resources.some((resource) => resource.id === target.resourceId) ? undefined : `Unknown rally resource ${target.resourceId}`;
  return snapshot.units.some((unit) => unit.id === target.unitId && unit.owner === owner) ? undefined : `Unknown ${owner} rally unit ${target.unitId}`;
}

function castError(snapshot: GameSnapshot, owner: PlayerId, command: Extract<GameCommand, { type: "cast" }>) {
  const caster = snapshot.units.find((unit) => unit.id === command.unitId && unit.owner === owner);
  if (!caster) return `Unknown ${owner} caster ${command.unitId}`;
  if (!UNIT_DEFS[caster.kind].abilities.includes(command.ability)) return `${caster.kind} cannot cast ${command.ability}`;
  if (caster.cooldown > 0) return `${caster.kind} is on cooldown`;
  if (command.ability === "heal") return command.targetId && snapshot.units.some((unit) => unit.id === command.targetId) ? undefined : "Heal requires an allied unit target";
  if (command.ability === "curse") return command.targetId && snapshot.units.some((unit) => unit.id === command.targetId) ? undefined : "Curse requires an enemy unit target";
  return Number.isFinite(command.x) && Number.isFinite(command.y) ? undefined : "Summon requires a target point";
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
