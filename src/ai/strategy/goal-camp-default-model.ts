import { gunzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import compressed from './data/goal-camp-model.gzip.json';
import { createEmpiricalGoalCampBattleModel, type CampEmpiricalTable } from './goal-camp-empirical-model';
import { calibratedAlphaGoalCampBattleModel, type GoalCampBattleModel } from './goal-camp-quotation';

export type GoalCampModelSelection = Readonly<{
  selected: 'empirical' | 'alpha' | 'pending'; outsideSupport: boolean;
  reasonCode: string; modelId: string | null; unitIds: readonly string[];
}>;
export type GoalCampModelObserver = (selection: GoalCampModelSelection) => void;
export type GoalCampModelUsage = {
  quotes: number; empirical: number; alpha: number; outsideSupport: number; pending: number;
};
/** Owner-think-local accounting. The caller chooses its trace destination;
 * model selection never writes process-global counters or world facts. */
export function createGoalCampModelUsage() {
  const counts: GoalCampModelUsage = { quotes: 0, empirical: 0, alpha: 0, outsideSupport: 0, pending: 0 };
  return { counts, observe(selection: GoalCampModelSelection) {
    counts.quotes++; counts[selection.selected]++;
    if (selection.outsideSupport) counts.outsideSupport++;
  } };
}
const supportReasons = new Set([
  'camp-model-composition-outside-support', 'camp-model-feature-outside-support',
  'camp-model-neutral-item-policy-outside-support', 'camp-model-third-party-contact-outside-support',
]);

/** Only a known support boundary selects alpha. Unknown affiliation/ETA,
 * invalid input, censored leaves and damaged model data stay pending. */
export function createSupportedGoalCampBattleModel(empirical: GoalCampBattleModel,
  alpha: GoalCampBattleModel, observe?: GoalCampModelObserver): GoalCampBattleModel {
  return input => {
    const proposed = empirical(input), outsideSupport = proposed.state === 'pending' && supportReasons.has(proposed.reason.code);
    let result = outsideSupport ? alpha(input) : proposed;
    const reasonCode = proposed.state === 'met' ? 'camp-model-supported' : proposed.reason.code;
    if (outsideSupport) {
      const marker = `camp-model:outside-support:${reasonCode}`;
      if (result.state === 'met') {
        const factIds = [...new Set([...result.factIds, ...result.value.factIds, marker])].sort();
        result = { ...result, factIds, value: { ...result.value, factIds } };
      } else result = { ...result, reason: { ...result.reason,
        factIds: [...new Set([...result.reason.factIds, marker])].sort() } };
    }
    observe?.({ selected: result.state === 'met' ? outsideSupport ? 'alpha' : 'empirical' : 'pending',
      outsideSupport, reasonCode, modelId: result.state === 'met' ? result.value.modelId : null,
      unitIds: [...new Set(input.unitIds)].sort() });
    return result;
  };
}
// Same synchronous browser/Node carrier as the existing supply calibration.
// No float rounding or support expansion is performed by this reader.
let empirical: GoalCampBattleModel | undefined;
function readEmpirical(): GoalCampBattleModel {
  if (!empirical) {
    const bytes = Uint8Array.from(atob(compressed.gzipBase64), character => character.charCodeAt(0));
    const table = JSON.parse(new TextDecoder().decode(gunzipSync(bytes))) as CampEmpiricalTable;
    empirical = createEmpiricalGoalCampBattleModel(table);
  }
  return empirical;
}
export const GOAL_CAMP_DEFAULT_MODEL_ID = compressed.modelId;
export const GOAL_CAMP_DEFAULT_PAYLOAD_SHA256 = compressed.payloadSha256;
export const createDefaultGoalCampBattleModel = (observe?: GoalCampModelObserver): GoalCampBattleModel =>
  createSupportedGoalCampBattleModel(input => readEmpirical()(input), calibratedAlphaGoalCampBattleModel, observe);
