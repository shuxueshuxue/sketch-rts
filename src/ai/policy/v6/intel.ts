import type { Building, GameSnapshot, PlayerId, Unit } from "../../../shared/types";
import { opponentPlayerIds } from "../ownership";
import { walkingDistance } from "../../../shared/terrain";
import { sameGroundAs, withoutShips } from "../ground";
import { buildings, units } from "../snapshot";
import { averagePoint, distance, withinRangeOf, type Point } from "../spatial";
import type { PresetAiPolicyOptions } from "../types";
import { isV9Policy } from "../versions";
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
  const army = withoutShips(snapshot, units(snapshot, owner).filter((unit) => unit.kind !== "worker"));
  const home = ownHalls[0] ?? ownBuildings[0] ?? { x: snapshot.map.width / 2, y: snapshot.map.height / 2 };
  const neutrals = snapshot.units.filter((unit) => unit.owner === "neutral");
  const enemies = opponentPlayerIds(snapshot, owner, options).map((enemy) => readEnemy(snapshot, enemy, ownBuildings, neutrals));
  const intrusion = readIntrusion(ownBuildings, enemies, isV9Policy(options));
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

// An enemy as the owner's walking army sees it: its ships and what stands on ground the owner cannot walk to are the naval
// script's (see @@@ai-home-ground).
function readEnemy(snapshot: GameSnapshot, enemy: PlayerId, ownBuildings: Building[], neutrals: Unit[]): V6EnemyIntel {
  const home = ownBuildings.find(building => building.kind === "townHall" && building.complete) ?? ownBuildings[0];
  // A colony does not make its island reachable by the main army. The naval commander owns that separate front.
  const all = withoutShips(snapshot, units(snapshot, enemy)).filter(unit => !home || sameGroundAs(snapshot, home, unit));
  const army = all.filter((unit) => unit.kind !== "worker");
  const workers = all.filter((unit) => unit.kind === "worker");
  const enemyBuildings = buildings(snapshot, enemy).filter(building => !home || sameGroundAs(snapshot, home, building));
  const halls = enemyBuildings.filter((building) => building.kind === "townHall");
  const center = army.length > 0 ? averagePoint(army) : undefined;
  const bases = halls.map((hall): V6BaseIntel => {
    const towers = enemyBuildings.filter((building) => building.kind === "defenseTower" && building.complete && distance(building, hall) <= BASE_DEFENSE_RANGE);
    const defenders = army.filter((unit) => distance(unit, hall) <= BASE_DEFENSE_RANGE);
    return { hall, owner: enemy, workers: workers.filter((worker) => distance(worker, hall) <= BASE_WORKER_RANGE), towers, defenders, defense: strengthOf(defenders) + towers.length * TOWER_STRENGTH };
  });
  return { owner: enemy, army, ...(center ? { center } : {}), power: strengthOf(army), state: enemyState(army, center, halls, ownBuildings, neutrals), bases, buildings: enemyBuildings, workers };
}

// Range questions of the whole enemy army through withinRangeOf (@@@range-grid): per own building here, per creep in
// enemyState; the same units in the same order as the filters over every enemy unit they replace.
// @@@v9-home-is-no-intrusion - For V9 an enemy soldier nearer one of its own halls than any building of V9's is at home,
// not intruding: V8's raiders idling 350 from their hall stood 733 to 757 from V9's outpost tower, in and out of
// INTRUSION_RANGE, and V9's army of 33 turned between defending against them and its attack every 20 to 60 seconds for
// twenty minutes (pool-elderwood-3).
function readIntrusion(ownBuildings: Building[], enemies: V6EnemyIntel[], homeAware: boolean): V6Intrusion | undefined {
  const nearest = (unit: Unit, points: readonly Point[]) => points.reduce((best, point) => Math.min(best, distance(unit, point)), Infinity);
  const atHome = (unit: Unit, enemy: V6EnemyIntel) => nearest(unit, enemy.bases.map((base) => base.hall)) < nearest(unit, ownBuildings);
  const army = enemies.flatMap((enemy) => (homeAware ? enemy.army.filter((unit) => !atHome(unit, enemy)) : enemy.army));
  const armyNear = withinRangeOf(army, INTRUSION_RANGE);
  const attacked = ownBuildings
    .map((building) => ({ building, threat: strengthOf(armyNear(building)) }))
    .filter(({ threat }) => threat > 0)
    .sort((a, b) => b.threat - a.threat)[0];
  if (!attacked) return undefined;
  const attackers = army.filter((unit) => distance(unit, attacked.building) <= INTRUDER_GROUP_RANGE);
  return { building: attacked.building, attackers, threat: strengthOf(attackers) };
}

// The enemy soldiers V9's front is driving off, while they are still out in the field (see v9-pursue): within
// INTRUDER_GROUP_RANGE of the front and not yet within INTRUSION_RANGE of one of their own halls; none while another
// enemy's soldiers stand within INTRUDER_GROUP_RANGE of them (a chase there met a third army: 196 of V9's units lost
// chasing in 500 games against three, to 18 without the chase).
export function v9Fleeing(intel: V6Intel, front: Point): Unit[] {
  const fleeing = intel.enemies.flatMap((enemy) => enemy.army.filter((unit) => distance(unit, front) <= INTRUDER_GROUP_RANGE && enemy.bases.every((base) => distance(unit, base.hall) > INTRUSION_RANGE)));
  if (fleeing.length === 0) return fleeing;
  const middle = averagePoint(fleeing);
  const chased = new Set(fleeing.map((unit) => unit.owner));
  return intel.enemies.some((enemy) => !chased.has(enemy.owner) && enemy.army.some((unit) => distance(unit, middle) <= INTRUDER_GROUP_RANGE)) ? [] : fleeing;
}

function enemyState(army: Unit[], center: Point | undefined, halls: Building[], ownBuildings: Building[], neutrals: Unit[]): V6EnemyState {
  if (!center || army.length === 0) return "none";
  if (ownBuildings.some((building) => distance(building, center) <= PUSH_RANGE)) return "pushing";
  // The army units some creep is within CREEP_CONTACT of, found from each creep's side.
  const armyNear = withinRangeOf(army, CREEP_CONTACT);
  const inCreepContact = new Set(neutrals.flatMap((neutral) => armyNear(neutral))).size;
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
    .filter((mine) => mine.amount > 0 && sameGroundAs(snapshot, intel.home, mine))
    .filter((mine) => halls.every((hall) => distance(hall, mine) > 340))
    .filter((mine) => enemyHalls.every((hall) => distance(hall, mine) > 1_200))
    .filter((mine) => enemyPowerNear(intel, mine, distance(mine, intel.home) <= NATURAL_RANGE ? NATURAL_CLEARANCE : FAR_MINE_CLEARANCE) === 0)
    .sort((a, b) => distance(a, intel.home) - distance(b, intel.home))[0];
}

// @@@v9-expansion-mine - V9's next mine: the one nearest its halls on foot, no hall on it, no enemy hall within 900 of it
// and enemy soldiers within 800 of it worth under half V9's army (see v9-contested-creep). With V6's rule (no enemy hall
// within 1200, no enemy soldier within 1100) V9 found no mine to take at 6:00-9:00 in 33 of 50 games against three: the
// mines between it and its neighbours stand within 1200 of their naturals, and some rival's soldiers are always about.
const V9_ENEMY_HALL_CLEARANCE = 900;
const V9_MINE_ENEMY_RANGE = 800;

export function v9ExpansionMine(snapshot: GameSnapshot, intel: V6Intel) {
  const halls = snapshot.buildings.filter((building) => building.kind === "townHall");
  const enemyHalls = intel.enemies.flatMap((enemy) => enemy.bases.map((base) => base.hall));
  const tolerance = v9ExpansionTolerance(intel);
  const own: Point[] = intel.ownHalls.length > 0 ? intel.ownHalls : [intel.home];
  return snapshot.resources
    .filter((mine) => mine.amount > 0 && halls.every((hall) => distance(hall, mine) > 340) && enemyHalls.every((hall) => distance(hall, mine) > V9_ENEMY_HALL_CLEARANCE))
    .filter((mine) => enemyPowerNear(intel, mine, V9_MINE_ENEMY_RANGE) <= tolerance)
    .map((mine) => ({ mine, walk: Math.min(...own.map((hall) => walkingDistance(snapshot.map, hall, mine) ?? Infinity)) }))
    .filter((entry) => entry.walk < Infinity)
    .sort((a, b) => a.walk - b.walk)[0]?.mine;
}

export function mineGuards(snapshot: GameSnapshot, mine: Point) {
  return snapshot.units.filter((unit) => unit.owner === "neutral" && distance(unit, mine) <= 350);
}

// @@@v9-contested-creep - V9 creeps an expansion's guard and takes the mine with enemy soldiers about, as long as they are
// worth less than half its army: holding off until none stood within 1200 of the camp, V9 never took its natural on the
// ladder maps while a rival's archers wandered past it, stayed in its opening (which waits on the second base) with six
// lancers and banked a thousand gold by 6:35 (emberFen, v5-extra-1, hand-played); the same rule froze the rival whose
// natural's guard stood within 1200 of V9's rally the same way. Half is where a creep under way already gives up.
export const V9_CREEP_ENEMY_SHARE = 0.5;

export function v9ExpansionTolerance(intel: V6Intel) {
  return intel.power * V9_CREEP_ENEMY_SHARE;
}

export function enemyPowerNear(intel: V6Intel, point: Point, range: number) {
  return intel.enemies.reduce((total, enemy) => total + strengthOf(enemy.army.filter((unit) => distance(unit, point) <= range)), 0);
}
