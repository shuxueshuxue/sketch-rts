import type { Game } from "../sim";
import type { GameCommand, PlayerId } from "../types";
import { checkCommandLegality, narrowFrameCommandToLiveOperands } from "./command-validation";

// @@@planner-schedule - Programs that plan from a copy of the world (the internal AI, SDK agents in the game runner) share
// one think interval, each on its own phase of it, and their commands land a fixed number of ticks after the think that
// made them. Phases keep several planners from all thinking on one tick. The fixed delay lets a think run beside the
// simulation (on another thread) while the match stays a function of its inputs alone, however fast the machine is: the
// tick a command lands on never depends on when its think finished.
export const PLANNER_COMMAND_DELAY_TICKS = 3;

/** The tick offset, within one think interval, of the index-th of `count` planners. */
export function plannerPhase(index: number, count: number, interval: number): number {
  return count > 1 ? Math.floor((index * interval) / count) : 0;
}

/** Whether a planner on this phase thinks on this tick. */
export function plannerThinksAt(tick: number, phase: number, interval: number): boolean {
  return tick >= phase && (tick - phase) % interval === 0;
}

/**
 * A planned command reaches the game some ticks after the world it was planned from. One whose issuers have all died
 * since is skipped at apply as usual; one the game would now reject outright is stale (the world moved on during the
 * delay), and is dropped instead of failing the frame. A rejection that could pass on a later tick (transient) is left
 * for apply, which skips it as it does for every command. Planners are checked against their own world copy when they
 * plan, so a command that was never legal still fails loudly there.
 */
export function partitionDeliveredPlannerCommands<Entry extends { playerId: PlayerId; command: GameCommand }>(game: Game, entries: readonly Entry[]): { deliverable: Entry[]; stale: Entry[] } {
  const deliverable: Entry[] = [];
  const stale: Entry[] = [];
  for (const entry of entries) {
    const command = narrowFrameCommandToLiveOperands(game, entry.playerId, entry.command);
    const legality = command ? checkCommandLegality(game, entry.playerId, command) : undefined;
    if (legality && !legality.transient) stale.push(entry);
    else deliverable.push(entry);
  }
  return { deliverable, stale };
}
