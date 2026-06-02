import type { BuildingKind, GameSnapshot, PlayerId } from "../../shared/types";
import { createSnapshotQuery, type SnapshotQuery } from "../../sdk/snapshot-query";

const noTeamsQueryKey = {};
const snapshotQueryCache = new WeakMap<GameSnapshot, WeakMap<object, SnapshotQuery>>();

export function aiSnapshotQuery(snapshot: GameSnapshot, teams?: Partial<Record<PlayerId, string>>) {
  const key = teams ?? noTeamsQueryKey;
  let byTeams = snapshotQueryCache.get(snapshot);
  if (!byTeams) {
    byTeams = new WeakMap<object, SnapshotQuery>();
    snapshotQueryCache.set(snapshot, byTeams);
  }
  let query = byTeams.get(key);
  if (!query) {
    query = createSnapshotQuery(snapshot, teams ? { teams } : {});
    byTeams.set(key, query);
  }
  return query;
}

export function activePlayerIds(snapshot: GameSnapshot) {
  return aiSnapshotQuery(snapshot).activePlayerIds();
}

export function combatUnits(snapshot: GameSnapshot, owner: PlayerId) {
  return aiSnapshotQuery(snapshot).combatUnitsFor(owner);
}

export function resources(snapshot: GameSnapshot) {
  return aiSnapshotQuery(snapshot).resources();
}

export function activeResources(snapshot: GameSnapshot) {
  return resources(snapshot).filter((resource) => resource.amount > 0);
}

export function mercenaryCamps(snapshot: GameSnapshot) {
  return aiSnapshotQuery(snapshot).mercenaryCamps();
}

export function items(snapshot: GameSnapshot) {
  return aiSnapshotQuery(snapshot).items();
}

export function groundItems(snapshot: GameSnapshot) {
  return aiSnapshotQuery(snapshot).groundItems();
}

export function carriedItemsFor(snapshot: GameSnapshot, owner: PlayerId) {
  return aiSnapshotQuery(snapshot).carriedItemsFor(owner);
}

export function allBuildings(snapshot: GameSnapshot) {
  return aiSnapshotQuery(snapshot).buildings();
}

export function completeBuildings(snapshot: GameSnapshot, owner: PlayerId, kind: BuildingKind) {
  return aiSnapshotQuery(snapshot).completeBuildingsFor(owner, kind);
}

export function buildings(snapshot: GameSnapshot, owner: PlayerId) {
  return aiSnapshotQuery(snapshot).buildingsFor(owner);
}

export function units(snapshot: GameSnapshot, owner: PlayerId) {
  return aiSnapshotQuery(snapshot).unitsFor(owner);
}

export function neutralUnitsNear(snapshot: GameSnapshot, point: { x: number; y: number }, range: number) {
  return aiSnapshotQuery(snapshot).neutralUnitsNear(point, range);
}

export function neutralUnits(snapshot: GameSnapshot, owner: PlayerId) {
  return aiSnapshotQuery(snapshot).forPlayer(owner).neutral.units;
}

export function enemyUnits(snapshot: GameSnapshot, owner: PlayerId, teams?: Partial<Record<PlayerId, string>>) {
  return aiSnapshotQuery(snapshot, teams).forPlayer(owner).enemy.units;
}

export function enemyCombatUnits(snapshot: GameSnapshot, owner: PlayerId, teams?: Partial<Record<PlayerId, string>>) {
  return aiSnapshotQuery(snapshot, teams).forPlayer(owner).enemy.combatUnits;
}

export function enemyWorkers(snapshot: GameSnapshot, owner: PlayerId, teams?: Partial<Record<PlayerId, string>>) {
  return aiSnapshotQuery(snapshot, teams).forPlayer(owner).enemy.workers;
}

export function enemyBuildings(snapshot: GameSnapshot, owner: PlayerId, teams?: Partial<Record<PlayerId, string>>) {
  return aiSnapshotQuery(snapshot, teams).forPlayer(owner).enemy.buildings;
}

export function enemyCombatUnitsNear(snapshot: GameSnapshot, owner: PlayerId, point: { x: number; y: number }, range: number, teams?: Partial<Record<PlayerId, string>>) {
  return aiSnapshotQuery(snapshot, teams).opponentUnitsNear(owner, point, range).filter((unit) => unit.kind !== "worker");
}

export function enemyUnitsNear(snapshot: GameSnapshot, owner: PlayerId, point: { x: number; y: number }, range: number, teams?: Partial<Record<PlayerId, string>>) {
  return aiSnapshotQuery(snapshot, teams).opponentUnitsNear(owner, point, range);
}

export function enemyBuildingsNear(snapshot: GameSnapshot, owner: PlayerId, point: { x: number; y: number }, range: number, teams?: Partial<Record<PlayerId, string>>) {
  return aiSnapshotQuery(snapshot, teams).opponentBuildingsNear(owner, point, range);
}

export function hostileUnitsNear(snapshot: GameSnapshot, owner: PlayerId, point: { x: number; y: number }, range: number, teams?: Partial<Record<PlayerId, string>>) {
  return [...enemyUnitsNear(snapshot, owner, point, range, teams), ...neutralUnitsNear(snapshot, point, range)];
}

export function hostileCombatUnits(snapshot: GameSnapshot, owner: PlayerId, teams?: Partial<Record<PlayerId, string>>) {
  return [...enemyCombatUnits(snapshot, owner, teams), ...neutralUnits(snapshot, owner).filter((unit) => unit.kind !== "worker")];
}
