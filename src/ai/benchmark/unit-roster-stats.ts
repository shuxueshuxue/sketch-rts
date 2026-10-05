import type { BenchmarkTracker } from "../../sdk/benchmark/core";
import { SIM_TICKS_PER_SECOND } from "../../shared/time";
import type { PlayerId, UnitKind } from "../../shared/types";
import type { AiGameAgent } from "../game-runner";

// What each side fielded: every unit it asked for (train and hire orders, counted by kind) and the most of each kind it
// had alive at once. Composition questions ("did V6 ever get a shooter?", "how many casters did V5 run?") read this.
export type UnitRosterStats = {
  owners: Record<PlayerId, UnitRosterOwnerStats>;
};

export type UnitRosterOwnerStats = {
  orderedByKind: Partial<Record<UnitKind, number>>;
  peakByKind: Partial<Record<UnitKind, number>>;
};

export function createUnitRosterStatsTracker(): BenchmarkTracker<AiGameAgent, UnitRosterStats, UnitRosterStats> {
  return {
    id: "unitRosterStats",
    create: ({ players }) => ({ owners: Object.fromEntries(players.map((owner) => [owner, { orderedByKind: {}, peakByKind: {} }])) }),
    onCommand(state, { owner, command, game }) {
      const kind = command.type === "train" ? command.unitKind : command.type === "hire" ? game.mercenaryCamps.find((camp) => camp.id === command.campId)?.hireKind : undefined;
      if (!kind) return;
      const ordered = (state.owners[owner] ??= { orderedByKind: {}, peakByKind: {} }).orderedByKind;
      ordered[kind] = (ordered[kind] ?? 0) + 1;
    },
    afterStep(state, { after }) {
      if (after.tick % SIM_TICKS_PER_SECOND !== 0) return;
      const alive = new Map<PlayerId, Map<UnitKind, number>>();
      for (const unit of after.units) {
        if (unit.owner === "neutral") continue;
        const counts = alive.get(unit.owner) ?? new Map<UnitKind, number>();
        counts.set(unit.kind, (counts.get(unit.kind) ?? 0) + 1);
        alive.set(unit.owner, counts);
      }
      for (const [owner, counts] of alive) {
        const peak = (state.owners[owner] ??= { orderedByKind: {}, peakByKind: {} }).peakByKind;
        for (const [kind, count] of counts) peak[kind] = Math.max(peak[kind] ?? 0, count);
      }
    },
    finish: (state) => state,
  };
}
