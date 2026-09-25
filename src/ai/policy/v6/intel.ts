import type { Building, GameSnapshot, PlayerId, Unit } from "../../../shared/types";
import { opponentPlayerIds } from "../ownership";
import { buildings, units } from "../snapshot";
import { averagePoint, distance, type Point } from "../spatial";
import type { PresetAiPolicyOptions } from "../types";
import { strengthOf, TOWER_STRENGTH } from "./strength";

// @@@v6-intel - One read of the board that every V6 module plans from: where each opponent's army is and what it is doing,
// which of its mining bases are rich and which are guarded, and where V6's own army stands. Modules decide; intel only
// describes.

export type V6EnemyState = "none" | "home" | "creeping" | "pushing" | "away";

export type V6BaseIntel = {
  hall: Building;
  owner: PlayerId;
  workers: Unit[];
  towers: Building[];
  defenders: Unit[];
  defense: number;
};

export type V6EnemyIntel = {
  owner: PlayerId;
  army: Unit[];
  center?: Point;
  power: number;
  state: V6EnemyState;
  bases: V6BaseIntel[];
  buildings: Building[];
  workers: Unit[];
};

// Enemies at V6's buildings, not passing by: the building with the most enemy strength close to it, and the group closing in.
export type V6Intrusion = { building: Building; attackers: Unit[]; threat: number };

export type V6Intel = {
  tick: number;
  home: Point;
  ownHalls: Building[];
  ownTowers: Building[];
  army: Unit[];
  armyCenter?: Point;
  power: number;
  enemies: V6EnemyIntel[];
  intrusion?: V6Intrusion;
};

const HOME_RANGE = 900;
const PUSH_RANGE = 1_300;
const CREEP_CONTACT = 320;
const BASE_WORKER_RANGE = 520;
const BASE_DEFENSE_RANGE = 700;
// An army walking the middle of the map 1300 from a hall is not an attack: the first version called it one, and marched
// V6 out of its towers' reach to meet it, and froze its expansion for as long as the enemy lingered there.
const INTRUSION_RANGE = 750;
const INTRUDER_GROUP_RANGE = 1_000;
// The natural sits under the main's towers: an enemy army has to be close before it stops V6 from taking it.
const NATURAL_RANGE = 900;
const NATURAL_CLEARANCE = 650;
const FAR_MINE_CLEARANCE = 1_100;

const cache = new WeakMap<GameSnapshot, Map<PlayerId, V6Intel>>();

export function readV6Intel(snapshot: GameSnapshot, owner: PlayerId, options: PresetAiPolicyOptions): V6Intel {
  const perSnapshot = cache.get(snapshot) ?? new Map<PlayerId, V6Intel>();
  cache.set(snapshot, perSnapshot);
  const cached = perSnapshot.get(owner);
  if (cached) return cached;
  const ownHalls = buildings(snapshot, owner).filter((building) => building.kind === "townHall" && building.complete);
  const ownBuildings = buildings(snapshot, owner);
  const army = units(snapshot, owner).filter((unit) => unit.kind !== "worker");
  const home = ownHalls[0] ?? ownBuildings[0] ?? { x: snapshot.map.width / 2, y: snapshot.map.height / 2 };
  const neutrals = snapshot.units.filter((unit) => unit.owner === "neutral");
  const enemies = opponentPlayerIds(snapshot, owner, options).map((enemy) => readEnemy(snapshot, enemy, ownBuildings, neutrals));
  const intrusion = readIntrusion(ownBuildings, enemies);
  const intel: V6Intel = {
    tick: snapshot.tick,
    home: { x: home.x, y: home.y },
    ownHalls,
    ownTowers: ownBuildings.filter((building) => building.kind === "defenseTower" && building.complete),
    army,
    ...(army.length > 0 ? { armyCenter: averagePoint(army) } : {}),
    power: strengthOf(army),
    enemies,
    ...(intrusion ? { intrusion } : {}),
  };
  perSnapshot.set(owner, intel);
  return intel;
}

function readEnemy(snapshot: GameSnapshot, enemy: PlayerId, ownBuildings: Building[], neutrals: Unit[]): V6EnemyIntel {
  const all = units(snapshot, enemy);
  const army = all.filter((unit) => unit.kind !== "worker");
  const workers = all.filter((unit) => unit.kind === "worker");
  const enemyBuildings = buildings(snapshot, enemy);
  const halls = enemyBuildings.filter((building) => building.kind === "townHall");
  const center = army.length > 0 ? averagePoint(army) : undefined;
  const bases = halls.map((hall): V6BaseIntel => {
    const towers = enemyBuildings.filter((building) => building.kind === "defenseTower" && building.complete && distance(building, hall) <= BASE_DEFENSE_RANGE);
    const defenders = army.filter((unit) => distance(unit, hall) <= BASE_DEFENSE_RANGE);
    return { hall, owner: enemy, workers: workers.filter((worker) => distance(worker, hall) <= BASE_WORKER_RANGE), towers, defenders, defense: strengthOf(defenders) + towers.length * TOWER_STRENGTH };
  });
  return { owner: enemy, army, ...(center ? { center } : {}), power: strengthOf(army), state: enemyState(army, center, halls, ownBuildings, neutrals), bases, buildings: enemyBuildings, workers };
}

function readIntrusion(ownBuildings: Building[], enemies: V6EnemyIntel[]): V6Intrusion | undefined {
  const army = enemies.flatMap((enemy) => enemy.army);
  const attacked = ownBuildings
    .map((building) => ({ building, threat: strengthOf(army.filter((unit) => distance(unit, building) <= INTRUSION_RANGE)) }))
    .filter(({ threat }) => threat > 0)
    .sort((a, b) => b.threat - a.threat)[0];
  if (!attacked) return undefined;
  const attackers = army.filter((unit) => distance(unit, attacked.building) <= INTRUDER_GROUP_RANGE);
  return { building: attacked.building, attackers, threat: strengthOf(attackers) };
}

function enemyState(army: Unit[], center: Point | undefined, halls: Building[], ownBuildings: Building[], neutrals: Unit[]): V6EnemyState {
  if (!center || army.length === 0) return "none";
  if (ownBuildings.some((building) => distance(building, center) <= PUSH_RANGE)) return "pushing";
  const inCreepContact = army.filter((unit) => neutrals.some((neutral) => distance(neutral, unit) <= CREEP_CONTACT)).length;
  if (inCreepContact >= Math.max(2, army.length * 0.4)) return "creeping";
  if (halls.some((hall) => distance(hall, center) <= HOME_RANGE)) return "home";
  return "away";
}

// The mine V6 expands to next: the nearest one no hall stands on, away from enemy halls and armies. Whether creeps still
// guard it is the caller's question: the economy waits for it to be clear, the general goes and clears it.
export function nextExpansionMine(snapshot: GameSnapshot, intel: V6Intel) {
  const halls = snapshot.buildings.filter((building) => building.kind === "townHall");
  const enemyHalls = intel.enemies.flatMap((enemy) => enemy.bases.map((base) => base.hall));
  return snapshot.resources
    .filter((mine) => mine.amount > 0)
    .filter((mine) => halls.every((hall) => distance(hall, mine) > 340))
    .filter((mine) => enemyHalls.every((hall) => distance(hall, mine) > 1_200))
    .filter((mine) => enemyPowerNear(intel, mine, distance(mine, intel.home) <= NATURAL_RANGE ? NATURAL_CLEARANCE : FAR_MINE_CLEARANCE) === 0)
    .sort((a, b) => distance(a, intel.home) - distance(b, intel.home))[0];
}

export function mineGuards(snapshot: GameSnapshot, mine: Point) {
  return snapshot.units.filter((unit) => unit.owner === "neutral" && distance(unit, mine) <= 350);
}

export function enemyPowerNear(intel: V6Intel, point: Point, range: number) {
  return intel.enemies.reduce((total, enemy) => total + strengthOf(enemy.army.filter((unit) => distance(unit, point) <= range)), 0);
}
