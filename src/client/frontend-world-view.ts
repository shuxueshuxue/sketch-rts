import type { ControlGroups } from "./control-groups";
import { pruneControlGroups } from "./control-groups";
import type { GameAdapter } from "./game-adapter";
import { resolveFocusedSelectionId } from "./hud-model";
import type { GameSnapshot, PlayerId } from "../shared/types";
import { isInCabin } from '../shared/ship-cabin';

export type FrontendWorldViewState = {
  owner: PlayerId;
  snapshot: GameSnapshot | undefined;
  selectedIds: Set<string>;
  focusedSelectionId: string | undefined;
  selectedCampId: string | undefined;
  controlGroups: ControlGroups;
};

export function syncFrontendWorldView(adapter: GameAdapter, state: FrontendWorldViewState): FrontendWorldViewState {
  adapter.updateToRenderTime();
  const snapshot = adapter.currentSnapshot();
  if (!snapshot) return { ...state, snapshot: undefined, selectedIds: new Set(), focusedSelectionId: undefined, selectedCampId: undefined };

  const liveIds = liveSelectionIds(snapshot, state.owner);
  const selectedIds = new Set([...state.selectedIds].filter((id) => liveIds.has(id)));
  pruneControlGroups(state.controlGroups, liveIds);

  const selectedCampId =
    state.selectedCampId && [...snapshot.mercenaryCamps, ...(snapshot.shops ?? [])].some((post) => post.id === state.selectedCampId) ? state.selectedCampId : undefined;

  return {
    ...state,
    snapshot,
    selectedIds,
    focusedSelectionId: resolveFocusedSelectionId(snapshot, selectedIds, state.focusedSelectionId, state.owner),
    selectedCampId,
  };
}

export function liveSelectionIds(snapshot: GameSnapshot, viewer?: PlayerId) {
  return new Set([...snapshot.units.filter(unit=>!viewer||unit.owner===viewer||!isInCabin(unit)).map((unit) => unit.id), ...snapshot.buildings.map((building) => building.id)]);
}
