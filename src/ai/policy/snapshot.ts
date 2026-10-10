import type { BuildingKind, GameSnapshot, PlayerId } from "../../shared/types";
import { createSnapshotQuery, type SnapshotPlayerView, type SnapshotQuery } from "../../sdk/snapshot-query";
import { onOwnGround, withoutShips } from "./ground";

const noTeamsQueryKey = {};
const snapshotQueryCache = new WeakMap<GameSnapshot, WeakMap<object, SnapshotQuery>>();
const playerViewCache = new WeakMap<SnapshotQuery, Map<PlayerId, SnapshotPlayerView>>();
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
    query = createSnapshotQuery(snapshot, { ...(teams ? { teams } : {}), excludeIssuedWeapons:true });
    byTeams.set(key, query);
  }
  lastQuery = { snapshot, key, query };
  return query;
}

// A policy often needs one list from the view. Copy the complete view once per
// immutable query, then return a fresh selected list so callers can sort it.
function playerView(query: SnapshotQuery, owner: PlayerId): SnapshotPlayerView {
  let byOwner = playerViewCache.get(query);
  if (!byOwner) playerViewCache.set(query, byOwner = new Map());
  let view = byOwner.get(owner);
  if (!view) byOwner.set(owner, view = query.forPlayer(owner));
  return view;
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
  return playerView(aiSnapshotQuery(snapshot), owner).neutral.units.slice();
}

export function enemyUnits(snapshot: GameSnapshot, owner: PlayerId, teams?: Partial<Record<PlayerId, string>>) {
  return playerView(aiSnapshotQuery(snapshot, teams), owner).enemy.units.slice();
}

export function enemyCombatUnits(snapshot: GameSnapshot, owner: PlayerId, teams?: Partial<Record<PlayerId, string>>) {
  return withoutShips(snapshot, playerView(aiSnapshotQuery(snapshot, teams), owner).enemy.combatUnits.slice());
}

export function enemyWorkers(snapshot: GameSnapshot, owner: PlayerId, teams?: Partial<Record<PlayerId, string>>) {
  return playerView(aiSnapshotQuery(snapshot, teams), owner).enemy.workers.slice();
}

// The enemy's buildings the owner's army can walk to (see @@@ai-home-ground).
export function enemyBuildings(snapshot: GameSnapshot, owner: PlayerId, teams?: Partial<Record<PlayerId, string>>) {
  return onOwnGround(snapshot, owner, playerView(aiSnapshotQuery(snapshot, teams), owner).enemy.buildings.slice());
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
