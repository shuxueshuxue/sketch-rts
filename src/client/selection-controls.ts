import type { Building, GameSnapshot, PlayerId, Unit } from "../shared/types";

export type SelectionState = {
  selectedIds: Set<string>;
  focusedSelectionId: string | undefined;
};

export type ScreenRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type Point = { x: number; y: number };

export function selectInScreenBox(
  snapshot: GameSnapshot,
  owner: PlayerId,
  rect: ScreenRect,
  project: (point: Point) => Point,
  previous: SelectionState,
  additive: boolean,
): SelectionState {
  const units = snapshot.units.filter((unit) => unit.owner === owner && isProjectedInside(unit, rect, project)).map((unit) => unit.id);
  if (units.length > 0) return applySelectionPick(previous, units, additive);
  const building = snapshot.buildings.find((candidate) => candidate.owner === owner && isProjectedInside(candidate, rect, project));
  return applySelectionPick(previous, building ? [building.id] : [], additive);
}

export function applySelectionPick(previous: SelectionState, pickedIds: string[], additive: boolean): SelectionState {
  if (pickedIds.length === 0) return additive ? previous : { selectedIds: new Set(), focusedSelectionId: undefined };
  if (!additive) return { selectedIds: new Set(pickedIds), focusedSelectionId: pickedIds[0] };
  return {
    selectedIds: new Set([...previous.selectedIds, ...pickedIds]),
    focusedSelectionId: pickedIds[pickedIds.length - 1],
  };
}

function isProjectedInside(entity: Unit | Building, rect: ScreenRect, project: (point: Point) => Point) {
  const screen = project(entity);
  return screen.x >= rect.left && screen.x <= rect.right && screen.y >= rect.top && screen.y <= rect.bottom;
}
