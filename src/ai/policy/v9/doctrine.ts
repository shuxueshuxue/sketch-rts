import { V8_STRATEGIES } from "../v8/doctrine";
import type { V6Strategy } from "../v6/doctrine";

// @@@v9-doctrine - V9 starts from V8's two lines (see v8-doctrine), against V5, V7 and V8 together.
// @@@v9-rising-strike - Both lines strike an enemy hall still rising, not the ravager line alone: a hall under
// construction starts at a tenth of its health (see construction-hp), so the strike is over before defenders arrive. The
// grove line held its lancers at the rally from 3:19 to 5:30 while V7's center hall rose from 90 (umberCauseway, 4:30);
// by hand five lancers razed it by 4:50 without a loss and the AI won the game it had lost. Against V5 and V7, 8000
// nudged tune games: the grove line 3551 wins against 3399, all 6889 against 6737.
export const V9_STRATEGIES: V6Strategy[] = V8_STRATEGIES.map((strategy) => ({ ...strategy, risingStrike: true }));
