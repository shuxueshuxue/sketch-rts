import type { Building, BuildingKind, GameSnapshot, PlayerId, Unit, UnitKind } from "../shared/types";

export type SelectionGroup =
  | { id: string; entityType: "unit"; kind: UnitKind; count: number; ids: string[]; focused: boolean }
  | { id: string; entityType: "building"; kind: BuildingKind; count: number; ids: string[]; focused: boolean };

export function resolveFocusedSelectionId(
  snapshot: GameSnapshot,
  selectedIds: Set<string>,
  focusedSelectionId: string | undefined,
  owner: PlayerId,
) {
  const selectable = selectableSelectionEntities(snapshot, selectedIds, owner);
  if (focusedSelectionId && selectable.some((entity) => entity.id === focusedSelectionId)) return focusedSelectionId;
  return selectable[0]?.id;
}

export function buildSelectionGroups(
  snapshot: GameSnapshot,
  selectedIds: Set<string>,
  focusedSelectionId: string | undefined,
  owner: PlayerId,
): SelectionGroup[] {
  const groups = new Map<string, SelectionGroup>();
  for (const unit of snapshot.units) {
    if (unit.owner !== owner || !selectedIds.has(unit.id)) continue;
    const id = `unit:${unit.kind}`;
    const group = groups.get(id) ?? { id, entityType: "unit", kind: unit.kind, count: 0, ids: [], focused: false };
    group.count += 1;
    group.ids.push(unit.id);
    group.focused ||= unit.id === focusedSelectionId;
    groups.set(id, group);
  }
  for (const building of snapshot.buildings) {
    if (building.owner !== owner || !selectedIds.has(building.id)) continue;
    const id = `building:${building.kind}`;
    const group = groups.get(id) ?? { id, entityType: "building", kind: building.kind, count: 0, ids: [], focused: false };
    group.count += 1;
    group.ids.push(building.id);
    group.focused ||= building.id === focusedSelectionId;
    groups.set(id, group);
  }
  return [...groups.values()];
}

export function focusedSelectionEntities(snapshot: GameSnapshot, focusedSelectionId: string | undefined, owner: PlayerId) {
  const units = snapshot.units.filter((unit) => unit.owner === owner && unit.id === focusedSelectionId);
  const buildings = snapshot.buildings.filter((building) => building.owner === owner && building.id === focusedSelectionId);
  return { units, buildings };
}

export function cycleFocusedSelectionId(
  snapshot: GameSnapshot,
  selectedIds: Set<string>,
  focusedSelectionId: string | undefined,
  owner: PlayerId,
  direction: 1 | -1,
) {
  const groups = buildSelectionGroups(snapshot, selectedIds, focusedSelectionId, owner);
  if (groups.length <= 1) return focusedSelectionId;
  const currentIndex = Math.max(0, groups.findIndex((group) => group.focused));
  const nextIndex = (currentIndex + direction + groups.length) % groups.length;
  return groups[nextIndex]?.ids[0] ?? focusedSelectionId;
}

function selectableSelectionEntities(snapshot: GameSnapshot, selectedIds: Set<string>, owner: PlayerId): (Unit | Building)[] {
  return [
    ...snapshot.units.filter((unit) => unit.owner === owner && selectedIds.has(unit.id)),
    ...snapshot.buildings.filter((building) => building.owner === owner && selectedIds.has(building.id)),
  ];
}
