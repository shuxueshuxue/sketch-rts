// @@@errand - An errand is an order that walks to something and then does one thing there: pick up an item, mend a
// building or a machine, mine, build, cast, climb a tower, give, use or drop an item. Each walks the same way and ends
// the same way (see errandWalk and endOrder in sim.ts):
// - in reach: the order does its own part, and checks its own rules once more there (a slot, gold, a cooldown);
// - not yet: the unit walks; once the walk is over (it stands as near as the ground lets it: see walkEnded) and it is
//   still out of reach, the order ends as unreachable. Before this, pickup and repair walked at a target they could
//   not reach for good. Mining is the exception: a mine order on another island is what a ferry carries the worker to
//   (the AIs expand so), so it waits at the shore as before;
// - ended for any reason but being done: an orderEnded effect says which (the owner sees it, replays and tests read it).

/** Why an order ended before it was done. */
export type OrderEndReason =
  | "target-gone"   // the item, building, unit or mine is gone, taken, or no longer the player's
  | "unreachable"   // the walk is over and the target is still out of reach
  | "stuck"         // no progress toward the target for a long while (a build plan)
  | "blocked"       // the ground for a building is taken
  | "no-room"       // no free slot, tower top or deck space where it arrived
  | "refused";      // the order's own rules refused it at the target (gold, cooldown, range)

/** How near an errand on an item, a carrier or a friend must come: a pickup, a hand-over, a drop, a follow's standoff. */
export const ERRAND_REACH = 72;
