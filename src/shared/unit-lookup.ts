import type { Owner, Unit } from "./types";

const LOOKUP_MAP_MIN_IDS = 8;

// @@@unit-lookup - A command's own units by id. A find over every unit for each id made a big army's commands cost ids x
// units; past a few ids, one map of the owner's units answers them all. The map keeps the owner's first unit per id, the one
// find returns, so every answer is find's.
export function ownUnitLookup(units: readonly Unit[], owner: Owner, idCount: number): (id: string) => Unit | undefined {
  if (idCount < LOOKUP_MAP_MIN_IDS) return (id) => units.find((unit) => unit.id === id && unit.owner === owner);
  const byId = new Map<string, Unit>();
  for (const unit of units) if (unit.owner === owner && !byId.has(unit.id)) byId.set(unit.id, unit);
  return (id) => byId.get(id);
}
