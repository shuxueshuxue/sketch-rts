import type { GameSnapshot, PlayerId } from "../shared/types";

export type SketchRtsDebugView = {
  roomId?: string;
  tick?: number;
  unitIds: string[];
  buildingIds: string[];
  selectedIds: string[];
  focusedSelectionId?: string;
  localPlayerUnitIds: string[];
  localPlayerBuildingIds: string[];
  enemyOrders?: Record<string, number>;
};

export function createSketchRtsDebugView(input: {
  roomId: string | undefined;
  localPlayerId: PlayerId;
  snapshot: GameSnapshot | undefined;
  selectedIds: Set<string>;
  focusedSelectionId: string | undefined;
}): SketchRtsDebugView {
  const view: SketchRtsDebugView = {
    unitIds: [],
    buildingIds: [],
    selectedIds: [...input.selectedIds],
    localPlayerUnitIds: [],
    localPlayerBuildingIds: [],
  };
  if (input.roomId !== undefined) view.roomId = input.roomId;
  if (input.focusedSelectionId !== undefined) view.focusedSelectionId = input.focusedSelectionId;
  if (!input.snapshot) return view;

  view.tick = input.snapshot.tick;
  view.unitIds = input.snapshot.units.map((unit) => unit.id);
  view.buildingIds = input.snapshot.buildings.map((building) => building.id);
  view.localPlayerUnitIds = input.snapshot.units.filter((unit) => unit.owner === input.localPlayerId).map((unit) => unit.id);
  view.localPlayerBuildingIds = input.snapshot.buildings.filter((building) => building.owner === input.localPlayerId).map((building) => building.id);

  const enemyOrders: Record<string, number> = {};
  for (const unit of input.snapshot.units) {
    if (unit.owner === input.localPlayerId || !unit.order) continue;
    enemyOrders[unit.order.type] = (enemyOrders[unit.order.type] ?? 0) + 1;
  }
  if (Object.keys(enemyOrders).length > 0) view.enemyOrders = enemyOrders;

  return view;
}
