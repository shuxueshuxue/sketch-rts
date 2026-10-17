import { roundGold } from "./gold";
import { BUILDING_DEFS } from "./catalog";
import { footprintBounds, footprintGap, footprintHalf, isOpenGround, snapToFootprint } from "./terrain";
import { isStaggered } from "./push";
import { isStunned } from "./unit-abilities";
import type { Building, GameMap, GameSnapshot, Owner, ResourceNode } from "./types";

/** Resource bodies, worker budgeting and rates belong to the economy. */
export const GOLD_MINE_RULES = {
  // A mine's body is two cells across (see @@@structure-body): its art is drawn larger, as a building's is.
  radius: 32,
  // A worker enters the mine from beside its footprint (see @@@structure-body): within this of the footprint's edge past
  // its own body, as a builder works from beside its site's walls.
  entryReach: 4,
  // No building's footprint comes within this of a mine's center (see resourceBlocksPlacement): an apron round its
  // two-cell body, kept as wide as the ring placement always kept round a mine.
  apron: 46,
  dropRange: 74,
  workstations: 5, // Standard worker budget; admission timing determines actual saturation.
  goldPerTrip: 10,
  // Keep the 400 gold/minute admission cap after shortening the hauling lane.
  // At a 216-unit hall distance, a 60-unit/s worker cycles in about 6.6s:
  // 3.5s working + 2 * (216 - 49 - 74) / 60 travelling, where 49 is the mine's
  // entrance straight out from a face (its 32-unit footprint half, a worker's
  // 15 and half of entryReach: see mineEntrance). Five workers saturate the
  // 1.5s admission interval; a sixth can still help longer routes. Before the
  // mine was a body (see @@@structure-body) workers entered it at 44 from its
  // center, inside it, and worked 3.2s.
  gatherSeconds: 3.5,
  entrySeconds: 1.5,
  townHallDistance: 210,
  mainDistance: 216,
  baseRange: 320,
} as const;

/** Preserve the authored direction from the snapped hall at the standard hauling distance. */
export function initialMiningPoint(map: Pick<GameMap, "terrain">, base: {x: number; y: number}, mine: {x: number; y: number}) {
  const at = snapToFootprint(map, BUILDING_DEFS.townHall.radius, base);
  const dx = mine.x - base.x, dy = mine.y - base.y;
  const scale = GOLD_MINE_RULES.mainDistance / (Math.hypot(dx, dy) || 1);
  return { x: at.x + dx * scale, y: at.y + dy * scale };
}

// Whether a worker stands at the mine's entrance: beside its footprint (a mine is a body: see @@@structure-body), or on
// a map without terrain beside its round body.
export function atMineEntrance(map: Pick<GameMap, "terrain">, worker: { x: number; y: number; radius: number }, mine: { x: number; y: number }) {
  return footprintGap(map, worker, { x: mine.x, y: mine.y, radius: GOLD_MINE_RULES.radius }) <= worker.radius + GOLD_MINE_RULES.entryReach;
}

// Where a worker coming from `from` enters the mine: the open point beside its footprint nearest it, as a Warcraft III
// miner walks to the face of the mine toward its hall. A walk to the mine's center (ground no worker stands on) ended at
// whichever open cell lay nearest the center, round a corner from the hall on a diagonal haul; and the nearest point
// itself may lie under a building laid against the mine (a tower at its corner held five workers there for good), so
// the entrance is the nearest point round the footprint that is open ground.
export function mineEntrance(map: Pick<GameMap, "terrain">, mine: { x: number; y: number }, from: { x: number; y: number }, workerRadius: number) {
  const reach = workerRadius + GOLD_MINE_RULES.entryReach / 2;
  if (!map.terrain) {
    const gap = Math.hypot(from.x - mine.x, from.y - mine.y) || 1, out = GOLD_MINE_RULES.radius + reach;
    return { x: mine.x + (from.x - mine.x) * out / gap, y: mine.y + (from.y - mine.y) * out / gap };
  }
  const bounds = footprintBounds(map.terrain.cell, { x: mine.x, y: mine.y, radius: GOLD_MINE_RULES.radius });
  let best: { x: number; y: number } | undefined, bestGap = Infinity;
  for (const point of entranceRing(bounds, reach)) {
    const gap = Math.hypot(point.x - from.x, point.y - from.y);
    if (gap < bestGap && isOpenGround(map, point.x, point.y)) { best = point; bestGap = gap; }
  }
  // A mine walled in on every side has no entrance: its nearest point, where a worker stands as near as it can.
  return best ?? nearestRingPoint(bounds, reach, from);
}

// The points `reach` out from a footprint's edges, ENTRANCE_STEP apart, round its corners on arcs.
const ENTRANCE_STEP = 8;
function* entranceRing(bounds: { left: number; right: number; top: number; bottom: number }, reach: number) {
  for (let x = bounds.left; x <= bounds.right; x += ENTRANCE_STEP) { yield { x, y: bounds.top - reach }; yield { x, y: bounds.bottom + reach }; }
  for (let y = bounds.top; y <= bounds.bottom; y += ENTRANCE_STEP) { yield { x: bounds.left - reach, y }; yield { x: bounds.right + reach, y }; }
  const corners = [[bounds.left, bounds.top, Math.PI], [bounds.right, bounds.top, -Math.PI / 2], [bounds.right, bounds.bottom, 0], [bounds.left, bounds.bottom, Math.PI / 2]] as const;
  const steps = Math.max(1, Math.ceil(reach * Math.PI / 2 / ENTRANCE_STEP));
  for (const [x, y, start] of corners) for (let i = 1; i < steps; i++) {
    const angle = start + (i / steps) * Math.PI / 2;
    yield { x: x + Math.cos(angle) * reach, y: y + Math.sin(angle) * reach };
  }
}

function nearestRingPoint(bounds: { left: number; right: number; top: number; bottom: number }, reach: number, from: { x: number; y: number }) {
  const x = Math.min(bounds.right, Math.max(bounds.left, from.x)), y = Math.min(bounds.bottom, Math.max(bounds.top, from.y));
  const dx = from.x - x, dy = from.y - y, gap = Math.hypot(dx, dy);
  if (gap > 0) return { x: x + dx / gap * reach, y: y + dy / gap * reach };
  return { x: bounds.left - reach, y };
}

// How far from a mine's center its entrance lies, straight out from a face of its footprint, for a worker of this radius.
export function mineEntranceDistance(map: Pick<GameMap, "terrain">, workerRadius: number) {
  return (map.terrain ? footprintHalf(GOLD_MINE_RULES.radius, map.terrain.cell) : GOLD_MINE_RULES.radius) + workerRadius + GOLD_MINE_RULES.entryReach;
}

export type MiningFrame = {
  resources: Map<string, ResourceNode>;
  nextWorker: Map<string, string>;
  townHalls: Map<Owner, Building[]>;
};

/** Rebuild derived indexes and release mining assignments whose orders ended. */
export function prepareMiningFrame(snapshot: Pick<GameSnapshot, "map" | "resources" | "units" | "buildings">): MiningFrame {
  const resources = new Map<string, ResourceNode>();
  for (const resource of snapshot.resources) resources.set(resource.id, resource);
  const waiting = new Map<string, { id: string; timer: number }>();
  for (const unit of snapshot.units) {
    // A controlled worker keeps its waiting priority, but cannot hold the
    // entrance while updateUnits is unable to execute its mining order.
    if (unit.hp > 0 && unit.kind === "worker" && unit.order.type === "mine" && unit.order.phase === "toMine" && !isStunned(unit) && !isStaggered(unit)) {
      const mine = resources.get(unit.order.resourceId);
      if (mine && atMineEntrance(snapshot.map, unit, mine)) {
        const first = waiting.get(mine.id);
        if (!first) waiting.set(mine.id, { id: unit.id, timer: unit.order.timer });
        else if (unit.order.timer > first.timer || unit.order.timer === first.timer && unit.id < first.id) {
          first.id = unit.id;
          first.timer = unit.order.timer;
        }
      }
    }
    if (!unit.mineSlot) continue;
    if (unit.hp <= 0 || unit.kind !== "worker" || unit.order.type !== "mine" || unit.order.resourceId !== unit.mineSlot || !resources.has(unit.mineSlot)) {
      unit.mineSlot = undefined;
      continue;
    }
  }
  const townHalls = new Map<Owner, Building[]>();
  for (const building of snapshot.buildings) {
    if (building.kind !== "townHall" || !building.complete || building.hp <= 0) continue;
    const own = townHalls.get(building.owner) ?? [];
    own.push(building);
    townHalls.set(building.owner, own);
  }
  const nextWorker = new Map<string, string>();
  for (const [mine, unit] of waiting) nextWorker.set(mine, unit.id);
  return { resources, nextWorker, townHalls };
}

/** Equivalent fully staffed mines needed to retain the one-mine, 40-supply income.
 * Interpolate mine demand, not income percentages: each extra mine supports 30 supply.
 * Below 40 supply there is no tax or subsidy. Capacity remains building-driven and uncapped.
 */
export function miningIncomeRate(supplyUsed: number) {
  return supplyUsed <= 40 ? 1 : 30 / (supplyUsed - 10);
}

/** Settle each delivery at its current population, rounded to the nearest cent. */
export function upkeepGoldIncome(carriedGold: number, supplyUsed: number) {
  return roundGold(carriedGold * miningIncomeRate(supplyUsed));
}
