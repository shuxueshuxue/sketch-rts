import { V8_STRATEGIES } from "../v8/doctrine";
import type { V6Phase, V6Strategy } from "../v6/doctrine";

// @@@v9-doctrine - V9 starts from V8's two lines (see v8-doctrine), against V5, V7 and V8 together, measured while it is
// developed in duels against V8 on generated maps (see v9-gauntlet), where V9 on V8's own lines wins half.
// @@@v9-no-rising-strike - Neither line strikes a rising hall: against three, a rival's new hall stands among all three
// armies, and the strike and the retreats from it cost 390 of the 724 soldiers V9 lost by 8:00 in the games it lost (200
// games); in a duel against V8 it also won 4179 of 8000 nudged games without it against 4031 with it.
// @@@v9-upgrades - Both forge lines to the third level from the first phase on, in a second research hall so they run
// side by side: weapons to 1.45 of the attack and plating to 1.45 of the health, 1155 gold in all (the price of ten
// soldiers), double what every soldier is worth in a fight, and V8's lines took only the second level and only in their
// late phase. In the duel against V8: 4953 of 8000 nudged games against 4179 without them.
// @@@v9-early-soldiers - The first two phases also keep eight, then ten, of the line's basic soldier (see v6-tech-up)
// standing beside what they wait on: at 8:00 V9's army stood at 6.6 against 7.7 for each rival in the median (200 games on
// generated maps). With them V9 won 5202 of 8000 nudged games against V8 against 4953 (and 4286 against 4031 without
// the upgrades).
const RESEARCH_HALL = { grove: "barracks", ember: "emberForge" } as const;
const UPGRADE_PHASES = 3;
const EARLY_SOLDIERS = [
  { count: 8, priority: 59 },
  { count: 10, priority: 55 },
];

// @@@v9-bases-first - Mining is what V9 is short of against three: given twice its own mining, the same V9 won 959 of 1000
// games (three times: 996), yet it sat on two halls in every game, its third base ranked under towers and soldiers (saved
// for last, never bought) and V8's later phases rank a third and fourth at 45 to 50 and 35. V9 wants its third and fourth
// base ahead of everything else in every phase.
const V9_BASES = [
  { bases: 3, priority: 65 },
  { bases: 4, priority: 61 },
] as const;

function v9Phases(strategy: V6Strategy): V6Phase[] {
  const hall = RESEARCH_HALL[strategy.race];
  return strategy.phases.map((phase, index) => {
    const bases = [...phase.wants.filter((want) => !("bases" in want) || want.bases < 3), ...V9_BASES];
    if (index >= UPGRADE_PHASES) return { ...phase, wants: bases };
    const level = index + 1;
    const priority = 62 - index;
    const soldiers = EARLY_SOLDIERS[index];
    return {
      ...phase,
      wants: [
        ...bases.filter((want) => !("upgrade" in want) || (want.upgrade !== "weaponTraining" && want.upgrade !== "reinforcedPlating")),
        { upgrade: "weaponTraining", level, priority },
        { upgrade: "reinforcedPlating", level, priority },
        { building: hall, count: 2, priority },
        ...(soldiers ? [{ unit: strategy.standIn, count: soldiers.count, priority: soldiers.priority }] : []),
      ],
    };
  });
}

// @@@v9-fortress - Against three, V9 first holds: after its opening it masses its line's basic soldier and raises towers at
// its natural and one in its main before any tech. On V8's lines (priests, a sanctum, stables, a second barracks and two
// upgrades from the first phase) V9's army stood at 4.4 at 8:00 against 29.4 for the three rivals together (1000 games on
// ladder maps, median), its soldiers a fifth of its spending.
function fortressPhase(strategy: V6Strategy): V6Phase {
  return {
    wants: [
      { bases: 2, priority: 66 },
      { towers: "outposts", count: 6, priority: 64 },
      { unit: strategy.standIn, count: 16, priority: 62 },
      { towers: "main", count: 3, priority: 60 },
      { bases: 3, priority: 65 },
      { bases: 4, priority: 61 },
    ],
    advanceShare: 0.75,
    advanceSupply: 44,
  };
}

// @@@v9-opening-clock - V9's opening moves on at 5:00 whatever it has (V7's clock; V8's lines wait on the second base or
// 34 supply): stuck in it without a natural, V9 kept six lancers and banked its gold to the end of the game.
export const V9_STRATEGIES: V6Strategy[] = V8_STRATEGIES.map((strategy) => ({ ...strategy, risingStrike: false, opensOnState: false, phases: [fortressPhase(strategy), ...v9Phases(strategy)] }));
