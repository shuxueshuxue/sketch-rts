import type { GameCommand, GameSnapshot, PlayerId } from "../shared/types";

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

/** Dev-build hooks for scene scripts (see @@@debug-hooks). */
export type SketchRtsDebugHooks = {
  camera(x: number, y: number, zoom?: number): void;
  select(ids: string[]): void;
  command(command: GameCommand): boolean;
  /** The page point (CSS pixels) where a world point is drawn now. */
  screenOf(x: number, y: number): { x: number; y: number };
  /** The page has opened its first screen and no art is loading (the home's, or a match's). */
  ready(): boolean;
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
  const enemyOrders: Record<string, number> = {};
  for (const unit of input.snapshot.units) {
    view.unitIds.push(unit.id);
    if (unit.owner === input.localPlayerId) view.localPlayerUnitIds.push(unit.id);
    else if (unit.order) enemyOrders[unit.order.type] = (enemyOrders[unit.order.type] ?? 0) + 1;
  }
  for (const building of input.snapshot.buildings) {
    view.buildingIds.push(building.id);
    if (building.owner === input.localPlayerId) view.localPlayerBuildingIds.push(building.id);
  }
  if (Object.keys(enemyOrders).length > 0) view.enemyOrders = enemyOrders;

  return view;
}
