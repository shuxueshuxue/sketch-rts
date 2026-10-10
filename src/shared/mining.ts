import { BUILDING_DEFS } from "./catalog";
import { snapToFootprint } from "./terrain";
import { isStaggered } from "./push";
import { isStunned } from "./unit-abilities";
import type { Building, GameMap, GameSnapshot, Owner, ResourceNode } from "./types";

/** Resource bodies, worker budgeting and rates belong to the economy. */
export const GOLD_MINE_RULES = {
  radius: 42,
  entryRange: 44,
  dropRange: 74,
  workstations: 5, // Standard worker budget; admission timing determines actual saturation.
  goldPerTrip: 10,
  // Keep the 400 gold/minute admission cap after shortening the hauling lane.
  // At a 216-unit hall distance, a 60-unit/s worker cycles in about 6.5s:
  // 3.2s working + 2 * (216 - 44 - 74) / 60 travelling. Five workers
  // saturate the 1.5s admission interval; a sixth can still help longer routes.
  gatherSeconds: 3.2,
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

export type MiningFrame = {
  resources: Map<string, ResourceNode>;
  nextWorker: Map<string, string>;
  townHalls: Map<Owner, Building[]>;
};

/** Rebuild derived indexes and release mining assignments whose orders ended. */
export function prepareMiningFrame(snapshot: Pick<GameSnapshot, "resources" | "units" | "buildings">): MiningFrame {
  const resources = new Map<string, ResourceNode>();
  for (const resource of snapshot.resources) resources.set(resource.id, resource);
  const waiting = new Map<string, { id: string; timer: number }>();
  for (const unit of snapshot.units) {
    // A controlled worker keeps its waiting priority, but cannot hold the
    // entrance while updateUnits is unable to execute its mining order.
    if (unit.hp > 0 && unit.kind === "worker" && unit.order.type === "mine" && unit.order.phase === "toMine" && !isStunned(unit) && !isStaggered(unit)) {
      const mine = resources.get(unit.order.resourceId);
      if (mine && Math.hypot(unit.x - mine.x, unit.y - mine.y) <= GOLD_MINE_RULES.entryRange) {
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
      delete unit.mineSlot;
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
