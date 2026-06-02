import { BUILDING_DEFS, UNIT_DEFS } from "../../shared/catalog";
import type { AbilityKind, Building, BuildingKind, GameCommand, GameSnapshot, PlayerId, TrainableUnitKind, Unit, UpgradeKind } from "../../shared/types";
import { createSnapshotQuery, type SnapshotQueryOptions } from "../snapshot/query";

export type SdkUnitSelector = "all" | "combat" | "workers" | string[];

export type SdkCommandIntent =
  | { type: "move"; unitIds?: SdkUnitSelector; x: number; y: number }
  | { type: "gatherArmy"; unitIds?: SdkUnitSelector; x: number; y: number }
  | { type: "attackMove"; unitIds?: SdkUnitSelector; x: number; y: number }
  | { type: "focusFire"; unitIds?: SdkUnitSelector; targetId: string }
  | { type: "focusFireNear"; unitIds?: SdkUnitSelector; targetId: string; joinRange?: number }
  | { type: "retreat"; unitIds?: SdkUnitSelector; x?: number; y?: number }
  | { type: "retreatWounded"; unitIds?: SdkUnitSelector; hpRatio?: number; x?: number; y?: number }
  | { type: "mine"; unitIds?: SdkUnitSelector; resourceId?: string }
  | { type: "repair"; unitIds?: SdkUnitSelector; buildingId: string }
  | { type: "expand"; resourceId?: string; unitId?: string }
  | { type: "creepCamp"; campId?: string; unitIds?: SdkUnitSelector }
  | { type: "build"; unitId?: string; buildingKind: BuildingKind; x: number; y: number }
  | { type: "train"; buildingId?: string; unitKind: TrainableUnitKind }
  | { type: "research"; buildingId?: string; upgradeKind: UpgradeKind }
  | { type: "hire"; campId: string }
  | { type: "cast"; unitId?: string; ability: AbilityKind; targetId?: string; x?: number; y?: number }
  | { type: "pickupItem"; unitId?: string; itemId: string }
  | { type: "useItem"; unitId?: string; itemId: string; targetId?: string; x?: number; y?: number };

export function resolveSdkCommandIntent(snapshot: GameSnapshot, owner: PlayerId, intent: SdkCommandIntent, options: SnapshotQueryOptions = {}): GameCommand {
  if (intent.type === "move" || intent.type === "gatherArmy") return { type: "move", unitIds: selectedUnitIds(snapshot, owner, intent.unitIds ?? "combat"), x: intent.x, y: intent.y };
  if (intent.type === "attackMove") return { type: "attackMove", unitIds: selectedUnitIds(snapshot, owner, intent.unitIds ?? "combat"), x: intent.x, y: intent.y };
  if (intent.type === "focusFire") return { type: "attack", unitIds: selectedUnitIds(snapshot, owner, intent.unitIds ?? "combat"), targetId: intent.targetId };
  if (intent.type === "focusFireNear") return { type: "attack", unitIds: selectedFocusFireNearUnitIds(snapshot, owner, intent.unitIds ?? "combat", intent.targetId, intent.joinRange ?? 95), targetId: intent.targetId };
  if (intent.type === "retreat") {
    const point = intent.x !== undefined && intent.y !== undefined ? { x: intent.x, y: intent.y } : retreatPoint(snapshot, owner);
    return { type: "move", unitIds: selectedUnitIds(snapshot, owner, intent.unitIds ?? "combat"), x: point.x, y: point.y };
  }
  if (intent.type === "retreatWounded") {
    const point = intent.x !== undefined && intent.y !== undefined ? { x: intent.x, y: intent.y } : retreatPoint(snapshot, owner);
    return { type: "move", unitIds: selectedWoundedUnitIds(snapshot, owner, intent.unitIds ?? "combat", intent.hpRatio ?? 0.5), x: point.x, y: point.y };
  }
  if (intent.type === "mine") return { type: "mine", unitIds: selectedUnitIds(snapshot, owner, intent.unitIds ?? "workers"), resourceId: intent.resourceId ?? nearestResourceId(snapshot, owner) };
  if (intent.type === "repair") return { type: "repair", unitIds: selectedUnitIds(snapshot, owner, intent.unitIds ?? "workers"), buildingId: intent.buildingId };
  if (intent.type === "expand") {
    const resource = expansionResource(snapshot, owner, intent.resourceId);
    return { type: "build", unitId: intent.unitId ?? nearestWorkerId(snapshot, owner, resource), buildingKind: "townHall", x: resource.x, y: resource.y };
  }
  if (intent.type === "creepCamp") {
    const point = creepCampPoint(snapshot, owner, intent.campId, options);
    return { type: "attackMove", unitIds: selectedUnitIds(snapshot, owner, intent.unitIds ?? "combat"), x: point.x, y: point.y };
  }
  if (intent.type === "build") return { type: "build", unitId: intent.unitId ?? nearestWorkerId(snapshot, owner, { x: intent.x, y: intent.y }), buildingKind: intent.buildingKind, x: intent.x, y: intent.y };
  if (intent.type === "train") return { type: "train", buildingId: intent.buildingId ?? trainingBuildingId(snapshot, owner, intent.unitKind), unitKind: intent.unitKind };
  if (intent.type === "research") return { type: "research", buildingId: intent.buildingId ?? researchBuildingId(snapshot, owner, intent.upgradeKind), upgradeKind: intent.upgradeKind };
  if (intent.type === "hire") return { type: "hire", campId: intent.campId };
  if (intent.type === "cast") return { type: "cast", unitId: intent.unitId ?? casterForAbility(snapshot, owner, intent.ability), ability: intent.ability, ...(intent.targetId ? { targetId: intent.targetId } : {}), ...(intent.x !== undefined ? { x: intent.x } : {}), ...(intent.y !== undefined ? { y: intent.y } : {}) };
  if (intent.type === "pickupItem") return { type: "pickupItem", unitId: intent.unitId ?? carrierForItem(snapshot, owner, intent.itemId), itemId: intent.itemId };
  if (intent.type === "useItem") return { type: "useItem", unitId: intent.unitId ?? carrierForItem(snapshot, owner, intent.itemId), itemId: intent.itemId, ...(intent.targetId ? { targetId: intent.targetId } : {}), ...(intent.x !== undefined ? { x: intent.x } : {}), ...(intent.y !== undefined ? { y: intent.y } : {}) };
  return assertNever(intent);
}

export function selectedUnitIds(snapshot: GameSnapshot, owner: PlayerId, selector: SdkUnitSelector): string[] {
  if (Array.isArray(selector)) {
    for (const id of selector) {
      const unit = snapshot.units.find((candidate) => candidate.id === id && candidate.owner === owner);
      if (!unit) throw new Error(`Unknown ${owner} unit ${id}`);
    }
    return selector;
  }
  const units = snapshot.units.filter((unit) => unit.owner === owner && matchesSelector(unit, selector));
  if (units.length === 0) throw new Error(`No ${owner} units match selector ${selector}`);
  return units.map((unit) => unit.id);
}

function selectedWoundedUnitIds(snapshot: GameSnapshot, owner: PlayerId, selector: SdkUnitSelector, hpRatio: number): string[] {
  if (!Number.isFinite(hpRatio) || hpRatio <= 0 || hpRatio > 1) throw new Error(`retreatWounded hpRatio must be within (0, 1], got ${hpRatio}`);
  const selected = new Set(selectedUnitIds(snapshot, owner, selector));
  const wounded = snapshot.units.filter((unit) => selected.has(unit.id) && unit.hp / unit.maxHp <= hpRatio);
  if (wounded.length === 0) throw new Error(`No ${owner} wounded units match selector ${selector} at hp ratio ${hpRatio}`);
  return wounded.map((unit) => unit.id);
}

function selectedFocusFireNearUnitIds(snapshot: GameSnapshot, owner: PlayerId, selector: SdkUnitSelector, targetId: string, joinRange: number): string[] {
  if (!Number.isFinite(joinRange) || joinRange < 0) throw new Error(`focusFireNear joinRange must be a non-negative finite number, got ${joinRange}`);
  const target = snapshot.units.find((unit) => unit.id === targetId) ?? snapshot.buildings.find((building) => building.id === targetId);
  if (!target) throw new Error(`Unknown focus target ${targetId}`);
  const selected = new Set(selectedUnitIds(snapshot, owner, selector));
  const joiners = snapshot.units.filter((unit) => selected.has(unit.id) && distance(unit, target) <= unit.attackRange + unit.radius + ("radius" in target ? target.radius : 0) + joinRange);
  if (joiners.length === 0) throw new Error(`No ${owner} units near enough to focus ${targetId}`);
  return joiners.map((unit) => unit.id);
}

export function controlledPoint(snapshot: GameSnapshot, owner: PlayerId) {
  return armyCenter(snapshot.units.filter((unit) => unit.owner === owner && unit.kind !== "worker")) ?? retreatPoint(snapshot, owner);
}

function matchesSelector(unit: Unit, selector: Exclude<SdkUnitSelector, string[]>): boolean {
  if (selector === "all") return true;
  if (selector === "combat") return unit.kind !== "worker";
  if (selector === "workers") return unit.kind === "worker";
  return assertNever(selector);
}

function retreatPoint(snapshot: GameSnapshot, owner: PlayerId) {
  return baseCenter(snapshot.buildings.filter((building) => building.owner === owner)) ?? armyCenter(snapshot.units.filter((unit) => unit.owner === owner)) ?? { x: snapshot.map.width / 2, y: snapshot.map.height / 2 };
}

function nearestResourceId(snapshot: GameSnapshot, owner: PlayerId): string {
  const point = retreatPoint(snapshot, owner);
  const resource = nearest(snapshot.resources, point);
  if (!resource) throw new Error("No resources exist in this command intent context");
  return resource.id;
}

function expansionResource(snapshot: GameSnapshot, owner: PlayerId, resourceId?: string) {
  if (resourceId) {
    const resource = snapshot.resources.find((candidate) => candidate.id === resourceId);
    if (!resource) throw new Error(`Unknown resource ${resourceId}`);
    return resource;
  }
  const ownedBases = snapshot.buildings.filter((building) => building.owner === owner && building.kind === "townHall");
  const resource = snapshot.resources
    .filter((candidate) => !ownedBases.some((base) => distance(base, candidate) <= 300))
    .map((candidate) => ({ candidate, distance: distance(candidate, retreatPoint(snapshot, owner)) }))
    .sort((a, b) => a.distance - b.distance)[0]?.candidate;
  if (!resource) throw new Error(`No expansion resource available for ${owner}`);
  return resource;
}

function creepCampPoint(snapshot: GameSnapshot, owner: PlayerId, campId: string | undefined, options: SnapshotQueryOptions) {
  if (campId) {
    const query = createSnapshotQuery(snapshot, options);
    const camp = query.mercenaryCampById(campId);
    if (camp) return { x: camp.x, y: camp.y };
    const neutral = query.unitById(campId);
    if (neutral?.owner === "neutral") return { x: neutral.x, y: neutral.y };
    throw new Error(`Unknown creep camp ${campId}`);
  }
  const point = controlledPoint(snapshot, owner);
  const camp = nearest(snapshot.mercenaryCamps, point) ?? nearest(snapshot.units.filter((unit) => unit.owner === "neutral"), point);
  if (!camp) throw new Error("No creep camp target exists in this command intent context");
  return { x: camp.x, y: camp.y };
}

function nearestWorkerId(snapshot: GameSnapshot, owner: PlayerId, point: { x: number; y: number }): string {
  const workers = snapshot.units.filter((unit) => unit.owner === owner && unit.kind === "worker");
  const worker = nearest(workers.filter(isAvailableBuilder), point) ?? nearest(workers, point);
  if (!worker) throw new Error(`No ${owner} workers available`);
  return worker.id;
}

function isAvailableBuilder(unit: Unit) {
  return unit.order.type === "idle" || unit.order.type === "mine";
}

function trainingBuildingId(snapshot: GameSnapshot, owner: PlayerId, unitKind: TrainableUnitKind): string {
  const building = snapshot.buildings.find((candidate) => candidate.owner === owner && candidate.complete && BUILDING_DEFS[candidate.kind].trains.includes(unitKind));
  if (!building) throw new Error(`No ${owner} complete building can train ${unitKind}`);
  return building.id;
}

function researchBuildingId(snapshot: GameSnapshot, owner: PlayerId, upgradeKind: UpgradeKind): string {
  const building = snapshot.buildings.find((candidate) => candidate.owner === owner && candidate.complete && BUILDING_DEFS[candidate.kind].researches.includes(upgradeKind));
  if (!building) throw new Error(`No ${owner} complete building can research ${upgradeKind}`);
  return building.id;
}

function carrierForItem(snapshot: GameSnapshot, owner: PlayerId, itemId: string): string {
  const item = snapshot.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`Unknown item ${itemId}`);
  if (item.carrierId && snapshot.units.some((unit) => unit.id === item.carrierId && unit.owner === owner)) return item.carrierId;
  const unit = nearest(snapshot.units.filter((candidate) => candidate.owner === owner), item);
  if (!unit) throw new Error(`No ${owner} units available to use ${itemId}`);
  return unit.id;
}

function casterForAbility(snapshot: GameSnapshot, owner: PlayerId, ability: AbilityKind): string {
  const unit = snapshot.units.find((candidate) => candidate.owner === owner && UNIT_DEFS[candidate.kind].abilities.includes(ability));
  if (!unit) throw new Error(`No ${owner} unit can cast ${ability}`);
  return unit.id;
}

function armyCenter(units: Pick<Unit, "x" | "y">[]) {
  if (units.length === 0) return undefined;
  return { x: average(units.map((unit) => unit.x)), y: average(units.map((unit) => unit.y)) };
}

function baseCenter(buildings: Pick<Building, "kind" | "x" | "y">[]) {
  const bases = buildings.filter((building) => building.kind === "townHall");
  return armyCenter(bases.length > 0 ? bases : buildings);
}

function nearest<T extends { x: number; y: number }>(candidates: T[], point: { x: number; y: number }): T | undefined {
  return candidates.map((candidate) => ({ candidate, distance: distance(candidate, point) })).sort((a, b) => a.distance - b.distance)[0]?.candidate;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled SDK command intent ${JSON.stringify(value)}`);
}
