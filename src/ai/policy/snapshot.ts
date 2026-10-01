import type { BuildingKind, GameSnapshot, PlayerId } from "../../shared/types";
import { createSnapshotQuery, type SnapshotQuery } from "../../sdk/snapshot-query";
import { onOwnGround, withoutShips } from "./ground";

const noTeamsQueryKey = {};
const snapshotQueryCache = new WeakMap<GameSnapshot, WeakMap<object, SnapshotQuery>>();
// The last query handed out: a plan asks for the same snapshot's query thousands of times in a row, so it skips the maps.
let lastQuery: { snapshot: GameSnapshot; key: object; query: SnapshotQuery } | undefined;

export function aiSnapshotQuery(snapshot: GameSnapshot, teams?: Partial<Record<PlayerId, string>>) {
  const key = teams ?? noTeamsQueryKey;
  if (lastQuery && lastQuery.snapshot === snapshot && lastQuery.key === key) return lastQuery.query;
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
  lastQuery = { snapshot, key, query };
  return query;
}

export function activePlayerIds(snapshot: GameSnapshot) {
  return aiSnapshotQuery(snapshot).activePlayerIds();
}

// The owner's army that walks: its ships are the naval script's (see @@@ai-home-ground).
export function combatUnits(snapshot: GameSnapshot, owner: PlayerId) {
  return withoutShips(snapshot, aiSnapshotQuery(snapshot).combatUnitsFor(owner));
}

export function resources(snapshot: GameSnapshot) {
  return aiSnapshotQuery(snapshot).resources();
}

export function activeResources(snapshot: GameSnapshot) {
  return aiSnapshotQuery(snapshot).activeResources();
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
  return withoutShips(snapshot, aiSnapshotQuery(snapshot, teams).forPlayer(owner).enemy.combatUnits);
}

export function enemyWorkers(snapshot: GameSnapshot, owner: PlayerId, teams?: Partial<Record<PlayerId, string>>) {
  return aiSnapshotQuery(snapshot, teams).forPlayer(owner).enemy.workers;
}

// The enemy's buildings the owner's army can walk to (see @@@ai-home-ground).
export function enemyBuildings(snapshot: GameSnapshot, owner: PlayerId, teams?: Partial<Record<PlayerId, string>>) {
  return onOwnGround(snapshot, owner, aiSnapshotQuery(snapshot, teams).forPlayer(owner).enemy.buildings);
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
  return aiSnapshotQuery(snapshot, teams).hostileUnitsNear(owner, point, range);
}

export function hostileCombatUnits(snapshot: GameSnapshot, owner: PlayerId, teams?: Partial<Record<PlayerId, string>>) {
  return aiSnapshotQuery(snapshot, teams).hostileCombatUnitsFor(owner);
}
