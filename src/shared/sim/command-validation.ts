import { summonPlacement } from "./summon-placement";
import { isRangedUnit } from "../unit-weapon-class";
import type { CommandRefusal, CommandRefusalCategory } from "../command-refusal";
import { unitControlsMercenaryCamp } from '../mercenary-camp';
import { canReceiveHealing } from '../healing';
import { SHIP_WEAPONS, installedWeapons } from "../ship-equipment";
import { isMechanicalUnit, matchesUnitTarget, unitClassOf } from "../unit-targeting";
import { unitNeedsRepair } from "../unit-repair";
import { veteranSkillFitsUnitClass } from "../veteran-skills";
import { canEquip, dropRefusal, freeItemSlot, giveRefusalDetail, transferRefusal, weaponRules, wieldRefusal, equipmentSpaceRefusal } from "../equipment";
import { shipPassengers, shipProfile } from "../ship-geometry";
import { shipBoardingRefusal, shipBoardingTargetRefusal } from "../ship-gangway";
import { sameGround } from "../terrain";
import { canBoard } from "../decks";
import { abilityCooldown } from "../ability-cooldowns";
import { aimingProfile } from "../aiming";
import { canAutocast } from "../autocast";
import { canTakeStance } from "../push";
import { buildingPlacementBlocker, terrainBlocksPlacement, upgradeSite } from "../build-placement";
import { ABILITY_DEFS, BUILDING_DEFS, RACE_DEFS, UNIT_DEFS, UPGRADE_DEFS, canTrainAt, canResearchAt, maxUpgradeLevel, requiredSupplyCap, unitRules } from "../catalog";
import { canReach, carries, passengerLandingSpot } from "../naval";
import { MAX_CARRIED_ITEMS, buyRefusal, carriedItemCount } from "../shop";
import type { Game } from "../sim";
import type { GameCommand, GameSnapshot, Owner, PlayerId, RallyTarget, Unit, UnitKind } from "../types";
import { ownUnitLookup } from "../unit-lookup";
import { purchasePlacement } from "../purchase";
import { isStunned, unitAbilities } from "../unit-abilities";
import { canEnterCabin, isInCabin, cabinExitPoint, cabinGroupSelection } from '../ship-cabin';
import { garrisonRefusal, isFortifiedTower, towerGarrison } from "../tower-garrison";
import { trainingJobs, upgradeJob } from "../building-jobs";

// @@@command-refusal - Why an order is refused right now, in the player's terms. This check is the one place a command
// is judged: the sim takes a command only after it (see tryPlayerCommand), and the command card greys a button with
// exactly this (see legalityCommandState), so the card and the sim cannot disagree on what an order costs, how near a
// unit must stand, or when a camp has stock again. The reasons:
//   gold, supply, tier, stock, cooldown   what the player waits or pays for
//   position     a unit of the player's must stand nearer (a camp, a shop, a delivery)
//   gone         the issuer, the building or the target named is not (or no longer) there
//   target       the target is there but the command cannot take it (an enemy to heal, blocked ground to build on)
//   range        the target is too near or too far for the ability or weapon
//   unreachable  no path or water joins the unit and the target
//   occupied     no room: deck space, a cabin, an equipment slot, the ground a building would stand on
//   state        the unit or building's present state forbids it (incomplete, stunned, in a cabin, already done)
//   rules        the catalog forbids it outright (this race, this building, this unit cannot)
export type CommandRefusalReason = CommandRefusalCategory;

export type CommandLegalityError = {
  refusal?: import("../command-refusal").CommandRefusal;
  message: string;
  transient: boolean;
  reason: CommandRefusalReason;
  // reason "cooldown": ticks until it is ready, and the whole cooldown it is part of; reason "tier": the supply cap the
  // unit waits for.
  cooldownTicks?: number;
  cooldownLength?: number;
  supplyCap?: number;
};

export function commandValidationError(snapshot: GameSnapshot, owner: PlayerId, command: GameCommand): string | undefined {
  return checkCommandLegality(snapshot, owner, command)?.message;
}

export type RefusalCheck = { unitId?: string; phase?: "availability" | "arrival" };

/** One read-only rule entry for previews, admission, partial selections and arrival revalidation. */
export function refusalFor(snapshot: GameSnapshot, owner: PlayerId, command: GameCommand, check: RefusalCheck = {}): CommandRefusal | null {
  if (check.unitId && "unitIds" in command) {
    if (command.type === "enterCabin") {
      const ids = command.unitIds;
      const selected = snapshot.units.filter(unit => unit.owner === owner && ids.includes(unit.id));
      if (!cabinGroupSelection(snapshot, selected).includes(check.unitId)) return { reason: "condition-unmet", detail: { category: "occupied" } };
    }
    command = { ...command, unitIds: [check.unitId] };
  }
  return checkCommandLegality(snapshot, owner, command, check.phase)?.refusal ?? null;
}

export function checkCommandAvailability(snapshot: GameSnapshot, owner: PlayerId, command: GameCommand): CommandLegalityError | undefined {
  return checkCommandLegality(snapshot, owner, command, "availability");
}

export function checkCommandLegality(snapshot: GameSnapshot, owner: PlayerId, command: GameCommand, phase?: RefusalCheck["phase"]): CommandLegalityError | undefined {
  if ("unitId" in command) {
    const unit = snapshot.units.find(unit => unit.id === command.unitId);
    if (unit && unit.owner !== owner) return commandError("This unit is not yours", "target", true, { reason: "ownership", detail: { entityId: unit.id, requiredRelation: "own" } });
    if (command.type === "build" && unit && unit.kind !== "worker") return commandError("Building requires a worker", "rules", false, { reason: "unit-ineligible", detail: { required: "worker" } });
  }
  const ids="unitIds" in command ? command.unitIds : "unitId" in command ? [command.unitId] : [];
  if (command.type !== 'enterCabin' && command.type !== 'leaveCabin' && command.type !== 'stop' && snapshot.units.some(unit => ids.includes(unit.id) && isInCabin(unit))) return commandError('Leave the cabin before acting', "state", true);
  if (command.type === 'enterCabin' || command.type === 'leaveCabin') {
    const missing = missingUnitError(snapshot, owner, command.unitIds);
    if (missing) return missing;
    const selected = snapshot.units.filter(unit => command.unitIds.includes(unit.id) && unit.owner === owner && unit.hp > 0);
    if (command.type === 'enterCabin') return selected.some(unit => canEnterCabin(snapshot,unit)) ? undefined : commandError('No available cabin for these crew members', "occupied", true);
    return selected.some(unit => { const ship = snapshot.units.find(ship => ship.id === unit.cabin?.shipId); return isInCabin(unit) && ship && cabinExitPoint(snapshot,ship,unit); }) ? undefined : commandError('No clear deck space by the cabin door', "occupied", true);
  }
  if (command.type === 'transferItem') {
    const item = snapshot.items.find(item => item.id === command.itemId);
    const affected = [item?.carrierId, 'unitId' in command.destination ? command.destination.unitId : 'installerId' in command.destination ? command.destination.installerId : undefined];
    if (snapshot.units.some(unit => affected.includes(unit.id) && isInCabin(unit))) return commandError('Leave the cabin before exchanging equipment', "state", true);
  }
  if (command.type === 'unloadPassenger' && snapshot.units.some(unit => unit.id === command.passengerId && isInCabin(unit))) return commandError('Leave the cabin before disembarking', "state", true);
  if ('targetId' in command && snapshot.units.some(unit => unit.id === command.targetId && isInCabin(unit))) return commandError('Crew inside a cabin cannot be targeted', "state", true);
  if(["build","mine","repair","hire"].includes(command.type) && snapshot.units.some(unit=>ids.includes(unit.id) && unit.deck))return commandError("Disembark before working on land", "state", true);
  const player = snapshot.players[owner];
  if (!player) return commandError(`Unknown player ${owner}`, "rules");
  if ("unitIds" in command && ["mine", "repair", "repairShip", "repairUnit", "attack", "holdPosition", "unload"].includes(command.type)) {
    const ownUnit = ownUnitLookup(snapshot.units, owner, command.unitIds.length);
    const selected = command.unitIds.map(ownUnit).filter((unit): unit is Unit => !!unit);
    const causes = selected.map(unit => actorRefusal(unit, command));
    if (causes.length && causes.every(Boolean)) {
      const repair = command.type === "repairUnit" || command.type === "repairShip";
      return commandError(repair ? "Unit repair requires a worker" : "These units cannot perform this action", "rules", !repair, causes[0]!);
    }
  }
  if ("buildingId" in command && ["train", "research", "upgradeBuilding", "cancelTraining", "repair", "buyShipEquipment"].includes(command.type)) {
    const building = snapshot.buildings.find(building => building.id === command.buildingId);
    if (building && building.owner !== owner) return commandError("This building is not yours", "target", true, { reason: "ownership", detail: { entityId: building.id, requiredRelation: "own" } });
  }
  if (command.type === "forfeit") return undefined;
  if (command.type === "aim") {
    const missing = missingUnitError(snapshot, owner, command.unitIds);
    if (missing) return missing;
    if (!Number.isFinite(command.x) || !Number.isFinite(command.y)) return commandError("Aim requires a finite point", "target");
    return snapshot.units.some(unit => command.unitIds.includes(unit.id) && unit.owner === owner && aimingProfile(weaponRules(snapshot, unit))) ? undefined : commandError("Aim requires a ranged unit", "rules", false, { reason: "unit-ineligible", detail: { required: "ranged" } });
  }
  if (command.type === "move" || command.type === "attackMove" || command.type === "stop" || command.type === "holdPosition" || command.type === "unload") return missingUnitError(snapshot, owner, command.unitIds);
  if (command.type === "unloadPassenger") {
    const transport = snapshot.units.find(unit => unit.id === command.transportId && unit.owner === owner && carries(unit) > 0);
    if (!transport) return commandError(`Unknown ${owner} transport ${command.transportId}`, "gone", true);
    if (!shipPassengers(snapshot.units,transport).some(passenger => passenger.id === command.passengerId && passenger.owner === owner) && !transport.cargo?.some(passenger=>passenger.id===command.passengerId)) return commandError("Passenger is no longer aboard", "gone", true);
    return passengerLandingSpot(snapshot.map, transport, command.passengerId, snapshot.units) ? undefined : commandError("No clear landing nearby; move closer to shore or clear space for passengers", "occupied", true);
  }
  if (command.type === "board") {
    const missing = missingUnitError(snapshot, owner, command.unitIds);
    if (missing) return missing;
    const ship = snapshot.units.find(unit => unit.id === command.transportId && unit.hp>0 && carries(unit) > 0);
    if (!ship) return commandError(`Unknown ${owner} transport ${command.transportId}`, "gone", true);
    return snapshot.units.some(unit => command.unitIds.includes(unit.id) && unit.owner === owner && canBoard(ship, unit, snapshot.units))
      ? undefined : commandError("No free deck space or payload capacity for these units", "occupied", true);
  }
  if (command.type === 'boardShip' || command.type === 'cancelBoardShip') {
    const missing = missingUnitError(snapshot, owner, command.unitIds);
    if (missing) return missing;
    if (!command.unitIds.length) return commandError('No ships selected for boarding', "rules");
    const target = command.type === 'boardShip'
      ? snapshot.units.find(unit => unit.id === command.targetId && unit.hp > 0 && shipProfile(unit)) : undefined;
    if (command.type === 'boardShip' && !target) return commandError(`Unknown boarding target ${command.targetId}`, "gone", true);
    for (const id of command.unitIds) {
      const source = snapshot.units.find(unit => unit.id === id && unit.owner === owner)!;
      if (source.hp <= 0 || !shipProfile(source)) return commandError('Boarding requires a living ship', "state", true);
      if (command.type === 'cancelBoardShip') continue;
      const refusal = shipBoardingRefusal(source, snapshot.units, snapshot.tick, snapshot);
      if (refusal === 'crew') return commandError('Boarding requires exposed walking crew on the source deck', "state", true);
      if (refusal === 'cooldown') return commandError('Boarding is cooling down', "cooldown", true);
      if (refusal) return commandError('Boarding requires a living ship', "state", true);
      const targetRefusal = shipBoardingTargetRefusal(source, target!);
      if (targetRefusal === 'height') return commandError('Decks are too far apart in height for boarding', "range");
      if (targetRefusal) return commandError('Boarding requires another living ship', "target");
      if (!sameGround(snapshot.map, source, target!, 'sea')) return commandError('Ships are in separate waters', "unreachable", true);
    }
    return undefined;
  }
  if (command.type === "attack") {
    const missing = missingUnitError(snapshot, owner, command.unitIds);
    if (missing) return missing;
    const target = findTarget(snapshot, command.targetId);
    if (!target) return commandError(`Unknown target ${command.targetId}`, "gone", true, { reason: "target-gone", detail: { targetId: command.targetId } });
    const ownUnit = ownUnitLookup(snapshot.units, owner, command.unitIds.length);
    return command.unitIds.some(id => { const unit = ownUnit(id); return unit && (unit.deck || canReach(snapshot.map, unit, target, snapshot.units)); }) ? undefined
      : commandError("Target is unreachable", "unreachable", true, { reason: "unreachable", detail: { targetId: target.id } });
  }
  if (command.type === "follow") return missingUnitError(snapshot, owner, command.unitIds) ?? (isFriendlyUnit(snapshot, owner, command.targetId) ? undefined : commandError(`Unknown friendly unit ${command.targetId}`, "gone", true));
  if (command.type === "mine") return missingUnitError(snapshot, owner, command.unitIds) ?? (snapshot.resources.some((resource) => resource.id === command.resourceId) ? undefined : commandError(`Unknown resource ${command.resourceId}`, "gone", true));
  if (command.type === "repair") {
    const missing = missingUnitError(snapshot, owner, command.unitIds);
    if (missing) return missing;
    const building = snapshot.buildings.find((candidate) => candidate.id === command.buildingId && candidate.owner === owner);
    if (!building) return commandError(`Unknown ${owner} building ${command.buildingId}`, "gone", true);
    if (phase === "arrival" && building.complete && building.hp < building.maxHp) { const gold = goldRefusal(snapshot, owner, 1); if (gold) return gold; }
    if (building.hp >= building.maxHp) return commandError(`${building.kind} is already fully repaired`, "state", true);
    return undefined;
  }
  if (command.type === "repairShip" || command.type === "repairUnit") {
    const missing = missingUnitError(snapshot, owner, command.unitIds);
    if (missing) return missing;
    if (!snapshot.units.some(unit => command.unitIds.includes(unit.id) && unit.owner === owner && unit.hp > 0 && unit.kind === "worker")) return commandError("Unit repair requires a worker", "rules");
    const target = snapshot.units.find(unit => unit.id === command.targetId && unit.owner === owner && unit.hp > 0);
    const other = snapshot.units.find(unit => unit.id === command.targetId);
    if (other && other.owner !== owner) return commandError("This unit is not yours", "target", true, { reason: "ownership", detail: { entityId: other.id, requiredRelation: "own" } });
    if (!target || (command.type === "repairShip" && !UNIT_DEFS[target.kind].naval)) return commandError(`Unknown ${owner} ${command.type === "repairShip" ? "ship" : "unit"} ${command.targetId}`, "gone", true);
    if (!isMechanicalUnit(target, snapshot)) return commandError("Only mechanical units can be repaired", "target", false, { reason: "target-type", detail: { targetId: target.id, required: "mechanical" } });
    if (phase === "arrival" && unitNeedsRepair(snapshot, target)) { const gold = goldRefusal(snapshot, owner, 1); if (gold) return gold; }
    if (!unitNeedsRepair(snapshot, target)) return commandError(`${target.kind} is already fully repaired`, "state", true);
    return undefined;
  }
  if (command.type === "build") {
    const worker = snapshot.units.find((unit) => unit.id === command.unitId && unit.owner === owner && unit.kind === "worker");
    if (!worker) return commandError(`Unknown ${owner} worker ${command.unitId}`, "gone", true);
    if (!RACE_DEFS[player.race].buildableBuildings.includes(command.buildingKind)) return commandError(`${player.race} race cannot build ${command.buildingKind}`, "rules");
    const blocker = buildingPlacementBlocker(snapshot, command.buildingKind, command);
    if (blocker) return commandError(`${command.buildingKind} placement is too close to ${blocker.kind}`, "occupied", true, { reason: "site-occupied", detail: { buildingKind: command.buildingKind, blockerId: blocker.id } });
    if (terrainBlocksPlacement(snapshot.map, command.buildingKind, command)) return commandError(`${command.buildingKind} placement is on blocked ground`, "target", false, { reason: "site-terrain", detail: { buildingKind: command.buildingKind } });
    return goldRefusal(snapshot, owner, BUILDING_DEFS[command.buildingKind].cost);
  }
  if (command.type === "setRally") {
    const missing = missingBuildingError(snapshot, owner, command.buildingIds);
    if (missing) return missing;
    const rallyless = command.buildingIds
      .map((buildingId) => snapshot.buildings.find((building) => building.id === buildingId && building.owner === owner))
      .find((building) => building && BUILDING_DEFS[building.kind].trains.length === 0);
    if (rallyless) return commandError(`${rallyless.kind} has no training rally point`, "rules");
    return rallyTargetError(snapshot, owner, command.target);
  }
  if (command.type === "cancelTraining") {
    const missing = missingBuildingError(snapshot, owner, [command.buildingId]);
    if (missing) return missing;
    return snapshot.buildings.find(building => building.id === command.buildingId)!.queue.some(job => job.id === command.jobId) ? undefined
      : commandError("Training job has already ended", "state", true);
  }
  if (command.type === "train") {
    const building = snapshot.buildings.find((candidate) => candidate.id === command.buildingId && candidate.owner === owner);
    if (!building) return commandError(`Unknown ${owner} building ${command.buildingId}`, "gone", true);
    if (!building.complete) return commandError(`Cannot train from incomplete ${building.kind}`, "state", false, { reason: "building-incomplete", detail: { buildingId: building.id } });
    if (!canTrainAt(player.race, building.kind, command.unitKind)) return commandError(`${building.kind} cannot train ${command.unitKind} for ${player.race}`, "rules");
    const cap = requiredSupplyCap(command.unitKind);
    if (player.supplyCap < cap) return refusal(`Need a supply cap of ${cap} to train ${command.unitKind}`, "tier", { supplyCap: cap, refusal: { reason: "supply-tier", detail: { requiredCap: cap, currentCap: player.supplyCap } } });
    const supply = supplyRefusal(snapshot, owner, command.unitKind);
    if (supply) return supply;
    return goldRefusal(snapshot, owner, UNIT_DEFS[command.unitKind].cost);
  }
  if (command.type === "research") {
    const building = snapshot.buildings.find((candidate) => candidate.id === command.buildingId && candidate.owner === owner);
    if (!building) return commandError(`Unknown ${owner} building ${command.buildingId}`, "gone", true);
    if (!building.complete) return commandError(`Cannot research from incomplete ${building.kind}`, "state", false, { reason: "building-incomplete", detail: { buildingId: building.id } });
    const upgrade = UPGRADE_DEFS[command.upgradeKind];
    if (!upgrade) return commandError(`Unknown upgrade ${command.upgradeKind}`, "rules");
    if (!RACE_DEFS[player.race].upgrades.includes(command.upgradeKind)) return commandError(`${player.race} race cannot research ${command.upgradeKind}`, "rules");
    if (!canResearchAt(player.race, building.kind, command.upgradeKind)) return commandError(`${building.kind} cannot research ${command.upgradeKind}`, "rules");
    const currentLevel = player.upgrades[command.upgradeKind] ?? 0;
    if (currentLevel >= maxUpgradeLevel(command.upgradeKind)) return commandError(`${command.upgradeKind} already at max level`, "state", true);
    if (building.researchQueue.some((job) => job.upgradeKind === command.upgradeKind)) return commandError(`${command.upgradeKind} is already queued`, "state", true);
    const nextLevel = upgrade.levels[currentLevel];
    if (!nextLevel) return commandError(`${command.upgradeKind} missing level ${currentLevel + 1}`, "rules");
    return goldRefusal(snapshot, owner, nextLevel.cost);
  }
  if (command.type === "hire") {
    const camp = snapshot.mercenaryCamps.find((candidate) => candidate.id === command.campId);
    if (!camp) return commandError(`Unknown mercenary camp ${command.campId}`, "rules");
    if (camp.stock <= 0) return refusal(`${camp.id} has no mercenary stock`, "stock", { refusal: { reason: "stock-empty", detail: { sellerId: camp.id } } });
    if (camp.cooldownRemaining > 0) return refusal(`${camp.id} is between hires`, "cooldown", { cooldownTicks: camp.cooldownRemaining, cooldownLength: camp.cooldown });
    if (!hasFriendlyUnitAtCamp(snapshot, owner, camp)) return refusal(`${camp.id} needs a friendly unit nearby before hiring`, "position");
    const supply = supplyRefusal(snapshot, owner, camp.hireKind);
    if (supply) return supply;
    return goldRefusal(snapshot, owner, camp.cost);
  }
  if(command.type==="buyShipEquipment"){const dock=snapshot.buildings.find(building=>building.id===command.buildingId && building.owner===owner && building.complete && building.kind==="shipyard");if(!dock)return commandError("A completed shipyard is required", "state", true);if(command.recipientId!==undefined){const delivery=purchasePlacement(snapshot,owner,dock,command.item,command.recipientId);if("refusal" in delivery)return refusal(delivery.refusal,"position", { ...(delivery.cause ? { refusal: delivery.cause } : {}) });}return goldRefusal(snapshot,owner,SHIP_WEAPONS[command.item].cost);}
  if (command.type === "buy") {
    const error = buyRefusal(snapshot, owner, command.shopId, command.item, command.recipientId);
    return error ? { ...error, refusal: error.refusal ?? { reason: "condition-unmet", detail: { category: error.reason } } } : undefined;
  }
  if (command.type === "learnVeteranSkill") {
    const unit = snapshot.units.find(candidate => candidate.id === command.unitId && candidate.owner === owner && candidate.hp > 0);
    if (!unit) return commandError(`Unknown living ${owner} unit ${command.unitId}`, "gone", true);
    if (unit.veteranSkill) return commandError("Veteran skill already learned", "state", true);
    if (unit.level < 3 || unit.expiresTick !== undefined || (unit.variant !== undefined && snapshot.variants?.[unit.variant]?.heroic)) return commandError("Only a permanent three-star non-hero unit may learn a veteran skill", "state");
    const choices = unit.veteranSkillChoices;
    if (!choices || choices.length !== 3 || new Set(choices).size !== 3 || !choices.includes(command.skill)) return commandError("Skill is not one of this unit's three veteran choices", "rules");
    if (command.skill === "veteranSiegeDrill" && !isRangedUnit(unit)) return commandError("Rangefinding requires a ranged weapon", "rules");
    if (!veteranSkillFitsUnitClass(command.skill, unitClassOf(unit, snapshot))) return commandError("Veteran skill cannot affect this unit class", "rules");
    return undefined;
  }
  if (command.type === "cast") return phase === "availability" ? castAvailabilityError(snapshot, owner, command) : castError(snapshot, owner, command);
  if (command.type === "setAutocast") {
    if (!canAutocast(command.ability)) return commandError(`${command.ability} cannot be autocast`, "rules");
    const missing = missingUnitError(snapshot, owner, command.unitIds);
    if (missing) return missing;
    return snapshot.units.some((unit) => command.unitIds.includes(unit.id) && unitAbilities(unit).includes(command.ability))
      ? undefined
      : commandError(`None of those units has ${command.ability}`, "rules");
  }
  if (command.type === "setStance") {
    const missing = missingUnitError(snapshot, owner, command.unitIds);
    if (missing) return missing;
    return snapshot.units.some((unit) => command.unitIds.includes(unit.id) && canTakeStance(unit)) ? undefined : commandError("None of those units fights in melee", "rules", false, { reason: "unit-ineligible", detail: { required: "melee" } });
  }
  if(command.type === "transferItem"){const message=transferRefusal(snapshot,owner,command.itemId,command.destination);return message?commandError(message, "state", true):undefined;}
  if(command.type === "wieldItem"){const message=wieldRefusal(snapshot,owner,command.unitId,command.itemId,command.hand);return message?commandError(message, "state", true):undefined;}
  if (command.type === "pickupItem") {
    if (!snapshot.units.some((unit) => unit.id === command.unitId && unit.owner === owner)) return commandError(`Unknown ${owner} item carrier ${command.unitId}`, "gone", true);
    const item = snapshot.items.find((candidate) => candidate.id === command.itemId);
    if (!item) return commandError(`Unknown item ${command.itemId}`, "gone", true);
    if (item.carrierId || item.shipId) return commandError(`${item.id} is already carried`, "occupied", true);
    const unit=snapshot.units.find(unit=>unit.id===command.unitId)!;return canEquip(unit) && freeItemSlot(snapshot,unit,item.kind) ? undefined : commandError(`${command.unitId} has no free equipment position`, "occupied", true, equipmentSpaceRefusal(snapshot, unit, item.kind) ?? { reason: "condition-unmet", detail: { category: "rules" } });
  }
  if (command.type === "giveItem") {
    const denied = giveRefusalDetail(snapshot, owner, command.unitId, command.itemId, command.targetId);
    return denied ? commandError(denied.message, "state", true, denied.cause) : undefined;
  }
  if (command.type === "dropItem" || command.type === "useItem") {
    if (command.type === "dropItem") { const message = dropRefusal(snapshot, owner, command.unitId, command.itemId); return message ? commandError(message, "state", true) : undefined; }
    if (!snapshot.units.some((unit) => unit.id === command.unitId && unit.owner === owner)) return commandError(`Unknown ${owner} item carrier ${command.unitId}`, "gone", true);
    const item = snapshot.items.find((candidate) => candidate.id === command.itemId);
    if (!item) return commandError(`Unknown item ${command.itemId}`, "gone", true);
    if (item.carrierId !== command.unitId) return commandError(`${command.unitId} is not carrying ${item.id}`, "state", true, { reason: "item-not-carried", detail: { itemId: item.id, unitId: command.unitId } });
    if (item.cooldownRemaining > 0) return refusal("Item is cooling down", "cooldown", { cooldownTicks: item.cooldownRemaining, refusal: { reason: "cooldown", detail: { remainingTicks: item.cooldownRemaining, itemId: item.id } } });
    if (phase === "availability" && ["lightningRod", "stormStaff", "breachCharge", "ivoryTower"].includes(item.kind)) return undefined;
    if (item.kind === "lightningRod" && !snapshot.units.some(unit => unit.id === command.targetId && areEnemyOwners(snapshot, owner, unit.owner))) return commandError("Item requires an enemy unit", "target", false, { reason: "target-type", detail: { required: "enemy-unit", ...(command.targetId ? { targetId: command.targetId } : {}) } });
    if (item.kind === "breachCharge" && !snapshot.buildings.some(building => building.id === command.targetId && areEnemyOwners(snapshot, owner, building.owner))) return commandError("Item requires an enemy building", "target", false, { reason: "target-type", detail: { required: "enemy-building", ...(command.targetId ? { targetId: command.targetId } : {}) } });
    if (item.kind === "stormStaff" && !snapshot.units.some(unit => unit.id === command.targetId) && !(Number.isFinite(command.x) && Number.isFinite(command.y))) return commandError("Item requires a unit or point", "target", false, { reason: "target-type", detail: { required: "unit-or-point" } });
    if (item.kind === "ivoryTower") {
      if (!Number.isFinite(command.x) || !Number.isFinite(command.y)) return commandError("Tower requires a point", "target");
      const at = { x: command.x!, y: command.y! };
      const blocker = buildingPlacementBlocker(snapshot, "defenseTower", at);
      if (blocker) return commandError("Tower site occupied", "occupied", true, { reason: "site-occupied", detail: { buildingKind: "defenseTower", blockerId: blocker.id } });
      if (terrainBlocksPlacement(snapshot.map, "defenseTower", at)) return commandError("Tower terrain blocked", "target", false, { reason: "site-terrain", detail: { buildingKind: "defenseTower" } });
    }
    if (!["lightningRod", "stormStaff", "breachCharge", "ivoryTower", "experienceBook", "guardianScroll", "healingScroll"].includes(item.kind)) return commandError("Item is passive", "rules", false, { reason: "item-passive", detail: { itemKind: item.kind } });
    return undefined;
  }
  if (command.type === "upgradeBuilding") {
    const building = snapshot.buildings.find((candidate) => candidate.id === command.buildingId && candidate.owner === owner);
    if (!building) return commandError(`Unknown ${owner} building ${command.buildingId}`, "gone", true);
    if (BUILDING_DEFS[command.to]?.upgradeFrom !== building.kind) return commandError(`${building.kind} cannot be upgraded to ${command.to}`, "rules");
    if (!building.complete) return commandError(`Cannot upgrade incomplete ${building.kind}`, "state", false, { reason: "building-incomplete", detail: { buildingId: building.id } });
    if (upgradeJob(building)) return commandError(`${building.kind} is already upgrading`, "state", true);
    if (!upgradeSite(snapshot, building, command.to)) return refusal(`No room round the ${building.kind} to stand a ${command.to}`, "occupied");
    return goldRefusal(snapshot, owner, BUILDING_DEFS[command.to].cost);
  }
  if (command.type === "garrison" || command.type === "ungarrison") {
    const tower = snapshot.buildings.find((candidate) => candidate.id === command.buildingId);
    if (!tower || !isFortifiedTower(tower)) return commandError(`Unknown ${owner} fortified tower ${command.buildingId}`, "gone", true);
    if (command.type === "ungarrison" && tower.owner !== owner) return commandError("You can only ungarrison your own tower", "rules");
    if (command.type === "ungarrison") return towerGarrison(snapshot.units, tower).length ? undefined : commandError("No troops on this tower", "state", true);
    const missing = missingUnitError(snapshot, owner, command.unitIds);
    if (missing) return missing;
    const troops = snapshot.units.filter(unit => command.unitIds.includes(unit.id) && unit.owner === owner && unit.garrison?.buildingId !== tower.id);
    if (!troops.length) return commandError("No troops that can stand on this tower", "rules", true);
    if (troops.some(unit => !garrisonRefusal(snapshot, tower, unit))) return undefined;
    const cause = garrisonRefusal(snapshot, tower, troops[0]!)!;
    const messages = { "garrison-mechanical": "Mechanical units cannot garrison towers", "tower-full": "The tower's top is full",
      "garrison-not-infantry": "Only foot troops can garrison towers",
      "garrison-body-size": "This unit's body does not fit on the tower's top", "garrison-ownership": "You can only garrison your own tower",
      "garrison-ineligible": "This unit cannot stand on a tower" };
    return { ...refusal(messages[cause.reason], cause.reason === "tower-full" || cause.reason === "garrison-body-size" ? "position" : "rules"), refusal: cause };
  }
  return command satisfies never;
}

function actorRefusal(unit: Unit, command: GameCommand): CommandRefusal | null {
  let required: Extract<CommandRefusal, { reason: "unit-ineligible" }>["detail"]["required"] | undefined;
  if (["mine", "repair", "repairShip", "repairUnit"].includes(command.type) && unit.kind !== "worker") required = "worker";
  else if (command.type === "attack" && unit.attackDamage <= 0) required = "armed";
  else if (command.type === "holdPosition" && unit.kind === "worker") required = "hold-capable";
  else if (command.type === "unload" && carries(unit) <= 0) required = "transport";
  return required ? { reason: "unit-ineligible", detail: { required } } : null;
}

function commandError(message: string, reason: CommandRefusalReason, transient = false, cause?: CommandRefusal): CommandLegalityError {
  return { message, transient, reason, refusal: cause ?? { reason: "condition-unmet", detail: { category: reason } } };
}

function refusal(message: string, reason: CommandRefusalReason, extra: Pick<CommandLegalityError, "cooldownTicks" | "cooldownLength" | "supplyCap" | "refusal"> = {}): CommandLegalityError {
  const cause = extra.refusal ?? (reason === "cooldown" && extra.cooldownTicks !== undefined
    ? { reason: "cooldown" as const, detail: { remainingTicks: extra.cooldownTicks } }
    : { reason: "condition-unmet" as const, detail: { category: reason } });
  return { message, transient: true, reason, ...extra, refusal: cause };
}

function goldRefusal(snapshot: GameSnapshot, owner: PlayerId, cost: number) {
  return canSpendGold(snapshot, owner, cost) ? undefined : refusal(`Need ${cost} gold`, "gold", {
    refusal: { reason: "gold", detail: { required: cost, available: snapshot.players[owner]!.gold } },
  });
}

export function narrowFrameCommandToLiveOperands(game: Game, owner: PlayerId, command: GameCommand): GameCommand | undefined {
  if (!game.players[owner] || command.type === "forfeit") return command;
  if (command.type === 'enterCabin' || command.type === 'leaveCabin') {
    const unitIds = currentUnitIds(game,owner,command.unitIds);
    return unitIds.length ? {...command,unitIds} : undefined;
  }
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
    return unitIds.length > 0 && game.units.some(unit=>unit.id===command.transportId && unit.hp>0 && carries(unit)>0) ? { ...command, unitIds } : undefined;
  }
  if (command.type === 'boardShip' || command.type === 'cancelBoardShip') {
    const unitIds = currentUnitIds(game, owner, command.unitIds)
      .filter(id => { const unit = currentUnit(game, owner, id); return unit && unit.hp > 0 && shipProfile(unit); });
    if (!unitIds.length) return undefined;
    if (command.type === 'boardShip' && !game.units.some(unit => unit.id === command.targetId && unit.hp > 0 && shipProfile(unit))) return undefined;
    return { ...command, unitIds };
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
    const unitIds = currentUnitIds(game, owner, command.unitIds);
    if (unitIds.length === 0 || !game.resources.some((resource) => resource.id === command.resourceId)) return undefined;
    return { ...command, unitIds };
  }
  if (command.type === "repair") {
    const unitIds = currentUnitIds(game, owner, command.unitIds);
    const building = currentBuilding(game, owner, command.buildingId);
    if (unitIds.length === 0 || !building) return undefined;
    return { ...command, unitIds };
  }
  if (command.type === "repairShip" || command.type === "repairUnit") {
    const ownUnit = ownUnitLookup(game.units, owner, command.unitIds.length);
    const unitIds = command.unitIds.filter(id => { const unit = ownUnit(id); return unit && unit.hp > 0; });
    const target = currentUnit(game, owner, command.targetId);
    return unitIds.length && target && target.hp > 0 ? { ...command, unitIds } : undefined;
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
  if (command.type === "learnVeteranSkill") {
    const unit = currentUnit(game, owner, command.unitId);
    return unit && unit.hp > 0 ? command : undefined;
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
  if (command.type === "dropItem" || command.type === "useItem" || command.type === "giveItem") {
    if (!hasCurrentUnit(game, owner, command.unitId)) return undefined;
    return game.items.some((item) => item.id === command.itemId) ? command : undefined;
  }
  if(command.type === "transferItem")return game.items.some(item=>item.id===command.itemId) ? command : undefined;
  if(command.type === "wieldItem")return hasCurrentUnit(game,owner,command.unitId) ? command : undefined;
  if (command.type === "hire" || command.type === "buy" || command.type==="buyShipEquipment") {
    return command;
  }
  if (command.type === "upgradeBuilding" || command.type === "ungarrison") return currentBuilding(game, owner, command.buildingId) ? command : undefined;
  if (command.type === "garrison") {
    const unitIds = currentUnitIds(game, owner, command.unitIds);
    return unitIds.length && currentBuilding(game, owner, command.buildingId) ? { ...command, unitIds } : undefined;
  }
  return command satisfies never;
}

function missingUnitError(snapshot: GameSnapshot, owner: PlayerId, unitIds: string[]) {
  const unit = ownUnitLookup(snapshot.units, owner, unitIds.length);
  const missing = unitIds.find((unitId) => !unit(unitId));
  if (!missing) return undefined;
  const exists = snapshot.units.some(unit => unit.id === missing);
  return commandError(`Unknown ${owner} unit ${missing}`, "gone", true, exists
    ? { reason: "ownership", detail: { entityId: missing, requiredRelation: "own" } }
    : { reason: "issuer-gone", detail: { entityId: missing } });
}

function currentUnitIds(game: Game, owner: PlayerId, unitIds: string[]) {
  const unit = ownUnitLookup(game.units, owner, unitIds.length);
  return unitIds.filter((id) => !!unit(id));
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
  return missing ? commandError(`Unknown ${owner} building ${missing}`, "gone", true) : undefined;
}

function rallyTargetError(snapshot: GameSnapshot, owner: PlayerId, target: Extract<GameCommand, { type: "setRally" }>["target"]) {
  if (!target || target.type === "point") return undefined;
  if (target.type === "resource") return snapshot.resources.some((resource) => resource.id === target.resourceId) ? undefined : commandError(`Unknown rally resource ${target.resourceId}`, "gone", true);
  return snapshot.units.some((unit) => unit.id === target.unitId && unit.owner === owner) ? undefined : commandError(`Unknown ${owner} rally unit ${target.unitId}`, "gone", true);
}

function castAvailabilityError(snapshot: GameSnapshot, owner: PlayerId, command: Extract<GameCommand, { type: "cast" }>) {
  const caster = snapshot.units.find((unit) => unit.id === command.unitId && unit.owner === owner && unit.hp > 0);
  if (!caster) return commandError(`Unknown ${owner} caster ${command.unitId}`, "gone", true);
  if (!unitAbilities(caster).includes(command.ability)) return commandError(`${caster.kind} cannot cast ${command.ability}`, "rules");
  if (isStunned(caster)) return commandError(`${caster.kind} is stunned`, "state", true);
  if(command.ability==="incendiaryFlume" && caster.fittings && !installedWeapons(snapshot,caster).some(item=>item.kind==="flameProjector" && (item.durability ?? 1)>0))return commandError("An operational flame projector is required", "state", true);
  if (abilityCooldown(caster, command.ability) > 0) return refusal(`${caster.kind} is on cooldown`, "cooldown", { cooldownTicks: abilityCooldown(caster, command.ability), refusal: { reason: "cooldown", detail: { remainingTicks: abilityCooldown(caster, command.ability), ability: command.ability } } });
  return undefined;
}

function castError(snapshot: GameSnapshot, owner: PlayerId, command: Extract<GameCommand, { type: "cast" }>) {
  const availability = castAvailabilityError(snapshot, owner, command);
  if (availability) return availability;
  const caster = snapshot.units.find(unit => unit.id === command.unitId)!;
  const definition = ABILITY_DEFS[command.ability];
  const behavior = definition.behavior;
  const unitTarget = command.targetId ? snapshot.units.find(unit => unit.id === command.targetId) : undefined;
  if (unitTarget && !matchesUnitTarget(unitTarget, definition.targets, snapshot)) return commandError(behavior === "heal" ? "Healing cannot restore mechanical units" : "Ability cannot target this unit class", "target", false, { reason: "target-type", detail: { targetId: unitTarget.id, required: definition.targets?.unitClasses?.length === 1 ? definition.targets.unitClasses[0] === "mechanical" ? "mechanical" : "non-mechanical" : "unit-or-point" } });
  if (behavior === "veteran") return undefined;
  if (behavior === "weapon") {
    const def = ABILITY_DEFS[command.ability];
    if (def.behavior !== "weapon") return commandError("Unknown weapon ability", "rules");
    const target = command.targetId ? [...snapshot.units, ...snapshot.buildings, ...(snapshot.obstacles ?? [])].find(target => target.id === command.targetId && areEnemyOwners(snapshot, owner, target.owner)) : undefined;
    if (def.target === "enemy" && !target) return commandError("Weapon requires an enemy target", "target");
    const at = target ?? (Number.isFinite(command.x) && Number.isFinite(command.y) ? {x:command.x!, y:command.y!} : undefined);
    if (!at) return commandError("Weapon requires a target point", "target");
    if (def.weapon.minRange && Math.hypot(at.x-caster.x,at.y-caster.y)<def.weapon.minRange) return commandError("Target is inside the weapon's minimum range", "range", true, { reason: "inside-min-range", detail: { ...(command.targetId ? { targetId: command.targetId } : {}), minimum: def.weapon.minRange, distance: Math.hypot(at.x-caster.x,at.y-caster.y) } });
    return undefined;
  }
  if (behavior === "heal") {
    const target = snapshot.units.find(unit => unit.id === command.targetId);
    if (target && !canReceiveHealing(target, snapshot)) return commandError("Healing cannot restore mechanical units", "target", false, { reason: "target-type", detail: { targetId: target.id, required: "non-mechanical" } });
    return command.targetId && snapshot.units.some((unit) => unit.id === command.targetId && !areEnemyOwners(snapshot, unit.owner, owner))
      ? undefined
      : commandError("Heal requires an allied unit target", "target", false, { reason: "target-type", detail: { ...(command.targetId ? { targetId: command.targetId } : {}), required: "friendly-unit" } });
  }
  if (behavior === "curse") {
    return command.targetId && snapshot.units.some((unit) => unit.id === command.targetId && areEnemyOwners(snapshot, unit.owner, owner))
      ? undefined
      : commandError("Curse requires an enemy unit target", "target", false, { reason: "target-type", detail: { ...(command.targetId ? { targetId: command.targetId } : {}), required: "enemy-unit" } });
  }
  if (behavior === "charge") {
    const def = ABILITY_DEFS[command.ability];
    const target = command.targetId ? snapshot.units.find((unit) => unit.id === command.targetId && areEnemyOwners(snapshot, unit.owner, owner)) : undefined;
    if (!target || def.behavior !== "charge") return commandError("Charge requires an enemy unit target", "target");
    // Farther than the window, the rider rides up to it first (see @@@cast-order); nearer, there is no room to charge.
    const gap = Math.hypot(target.x - caster.x, target.y - caster.y);
    if (gap < def.minRange) return commandError(`Charge target must be at least ${def.minRange} away`, "range", true, { reason: "inside-min-range", detail: { targetId: target.id, minimum: def.minRange, distance: gap } });
    // A rider charges nothing it cannot come within reach of (see @@@reach): a ship out on deep water.
    return canReach(snapshot.map, caster, target) ? undefined : commandError("Charge target is out of reach", "unreachable", true, { reason: "unreachable", detail: { targetId: target.id } });
  }
  if (behavior === "summon" && Number.isFinite(command.x) && Number.isFinite(command.y)) {
    const placement = summonPlacement(snapshot, caster, definition.summonKind, { x: command.x!, y: command.y! });
    if ('refusal' in placement) return commandError("Summon target has no space", "target", true, placement.refusal);
  }
  return Number.isFinite(command.x) && Number.isFinite(command.y) ? undefined : commandError("Summon requires a target point", "target");
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
function supplyRefusal(snapshot: GameSnapshot, owner: PlayerId, unitKind: UnitKind): CommandLegalityError | undefined {
  const supply = (unit: Unit): number => unitRules(snapshot, unit).supplyUsed + (unit.cargo ?? []).reduce((total, passenger) => total + supply(passenger), 0);
  const unitSupply = snapshot.units.filter((unit) => unit.owner === owner).reduce((total, unit) => total + supply(unit), 0);
  const queuedSupply = snapshot.buildings
    .filter((building) => building.owner === owner)
    .flatMap((building) => trainingJobs(building))
    .reduce((total, job) => total + UNIT_DEFS[job.unitKind].supplyUsed, 0);
  const used = unitSupply + queuedSupply, required = UNIT_DEFS[unitKind].supplyUsed, capacity = snapshot.players[owner]!.supplyCap;
  return used + required <= capacity ? undefined : refusal(`Need more supply to train ${unitKind}`, "supply", { refusal: { reason: "supply", detail: { used, required, capacity } } });
}

function hasFriendlyUnitAtCamp(snapshot: GameSnapshot, owner: PlayerId, camp: { x: number; y: number; radius: number }) {
  return snapshot.units.some((unit) => unit.owner === owner && unitControlsMercenaryCamp(unit, camp));
}

function findTarget(snapshot: GameSnapshot, targetId: string) {
  return snapshot.units.find((unit) => unit.id === targetId) ?? snapshot.buildings.find((building) => building.id === targetId) ?? snapshot.obstacles?.find((obstacle) => obstacle.id === targetId);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
