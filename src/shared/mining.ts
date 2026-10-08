import { BUILDING_DEFS } from "./catalog";
import { snapToFootprint } from "./terrain";
import type { Building, GameMap, GameSnapshot, Owner, ResourceNode } from "./types";

/** Resource bodies, worker budgeting and rates belong to the economy. */
export const GOLD_MINE_RULES = {
  radius: 42,
  entryRange: 44,
  dropRange: 74,
  workstations: 5, // Standard worker budget; admission timing determines actual saturation.
  goldPerTrip: 10,
  gatherSeconds: 0.8,
  entrySeconds: 1.5,
  townHallDistance: 280,
  mainDistance: 288,
  baseRange: 320,
} as const;

/** Translate the initial mine by its hall's footprint-snapping offset, preserving the haul distance. */
export function initialMiningPoint(map: Pick<GameMap, "terrain">, base: {x: number; y: number}, mine: {x: number; y: number}) {
  const at = snapToFootprint(map, BUILDING_DEFS.townHall.radius, base);
  return { x: mine.x + at.x - base.x, y: mine.y + at.y - base.y };
}

export type MiningFrame = {
  resources: Map<string, ResourceNode>;
  nextWorker: Map<string, string>;
  townHalls: Map<Owner, Building[]>;
};

/** Rebuild derived indexes and release mining assignments whose orders ended. */
export function prepareMiningFrame(snapshot: Pick<GameSnapshot, "resources" | "units" | "buildings">): MiningFrame {
  const resources = new Map(snapshot.resources.map(resource => [resource.id, resource]));
  const waiting = new Map<string, { id: string; timer: number }>();
  for (const unit of snapshot.units) {
    if (unit.hp > 0 && unit.kind === "worker" && unit.order.type === "mine" && unit.order.phase === "toMine") {
      const mine = resources.get(unit.order.resourceId);
      if (mine && Math.hypot(unit.x - mine.x, unit.y - mine.y) <= GOLD_MINE_RULES.entryRange) {
        const first = waiting.get(mine.id);
        if (!first || unit.order.timer > first.timer || unit.order.timer === first.timer && unit.id < first.id) waiting.set(mine.id, { id: unit.id, timer: unit.order.timer });
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
  return { resources, nextWorker: new Map([...waiting].map(([mine, unit]) => [mine, unit.id])), townHalls };
}
