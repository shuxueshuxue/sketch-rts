import type { RoomAiVersion } from "../../shared/types";
import type { OpponentVersion, SubjectGauntlet } from "./subject-gauntlet";

// @@@room-gauntlet - A room AI (the versions a room seats: what players actually meet) alone against one group of preset
// versions, by the subject gauntlet's procedure (see @@@subject-gauntlet). The V9 gauntlet measures the preset V9, which
// no room seats; this is the bench for the room AIs. A duel against V8 or V9 separates their strength (a 1v3 against
// V5, V7 and V8 was lost by every subject on every map).
export function roomGauntlet(subject: RoomAiVersion, rivals: readonly OpponentVersion[]): SubjectGauntlet {
  const named = [...rivals].sort().join("+");
  return {
    subject,
    groups: [rivals],
    // The room AIs pick their doctrine outside the V6 tracker; their strategy tally stays empty.
    doctrineTracker: "v9Doctrine",
    watchedKinds: new Set(),
    name: `AI ${subject} vs ${named} Benchmark`,
    evaluationName: `${subject} 1v${rivals.length} vs ${named}`,
  };
}
