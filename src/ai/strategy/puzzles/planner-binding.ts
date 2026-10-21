import type { SdkGameCommandPlanner } from '../../../sdk/game-runner';
import type { GameSnapshot, PlayerId } from '../../../shared/types';
import type { PuzzlePlanObservation } from './planner-checks';

/** Integration seam only. The goal planner and shared facts are not on main yet.
 * A binding must read the real cold snapshot through the common fact reader and
 * return AiPlanTrace.goalPlanner plus the allocator's real reservation ledger.
 * It must not select a recipe from the puzzle key or supply authored facts.
 * The command planner runs through the ordinary delayed SDK command boundary. */
export type PublicPuzzlePlanner = {
  // No puzzle key, authored landing or reference solution enters this port.
  cold(snapshot: GameSnapshot, owner: PlayerId): PuzzlePlanObservation;
  /** A fresh private policy memory for each execution. */
  commands(): SdkGameCommandPlanner;
};
export const publicPuzzlePlanner: PublicPuzzlePlanner | undefined = undefined;
