import type { Building, GameSnapshot, Owner, ResourceNode } from "./types";

/** Resource bodies, workstations and rates belong to the economy, not to click handlers or AI versions. */
export const GOLD_MINE_RULES = {
  radius: 42,
  workstations: 5,
  goldPerTrip: 10,
  gatherSeconds: 5,
  entrySeconds: 1.6,
  townHallGap: 48,
} as const;

export type MiningFrame = {
  resources: Map<string, ResourceNode>;
  occupied: Map<string, number>;
  townHalls: Map<Owner, Building[]>;
};

/** Rebuild derived indexes once per step. A workstation covers the whole haul cycle. */
export function prepareMiningFrame(snapshot: Pick<GameSnapshot, "resources" | "units" | "buildings">): MiningFrame {
  const resources = new Map(snapshot.resources.map(resource => [resource.id, resource]));
  const occupied = new Map<string, number>();
  for (const unit of snapshot.units) {
    if (!unit.mineSlot) continue;
    if (unit.hp <= 0 || unit.kind !== "worker" || unit.order.type !== "mine" || unit.order.resourceId !== unit.mineSlot || !resources.has(unit.mineSlot)) {
      delete unit.mineSlot;
      continue;
    }
    occupied.set(unit.mineSlot, (occupied.get(unit.mineSlot) ?? 0) + 1);
  }
  const townHalls = new Map<Owner, Building[]>();
  for (const building of snapshot.buildings) {
    if (building.kind !== "townHall" || !building.complete || building.hp <= 0) continue;
    const own = townHalls.get(building.owner) ?? [];
    own.push(building);
    townHalls.set(building.owner, own);
  }
  return { resources, occupied, townHalls };
}
