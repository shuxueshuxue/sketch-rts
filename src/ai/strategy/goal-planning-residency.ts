import type { AiPolicyMemory } from '../memory';

/** Read-only wire-size accounting. Shared observation bytes are reported in
 * full; only their increase over a same-frame control-off run is charged to
 * the planner. This adds no runtime quota or eviction rule. */
export function measureGoalPlanningResidency(memory: AiPolicyMemory, controlOff: AiPolicyMemory) {
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value) ?? '').length;
  const resident = { planner: memory.goalPlanning, definitions: memory.goalPlanningReferences, authority: memory.strategyAllocation };
  const plannerBytes = bytes(memory.goalPlanning), definitionsBytes = bytes(memory.goalPlanningReferences),
    authorityBytes = bytes(memory.strategyAllocation), totalBytes = bytes(resident),
    sharedObservationBytes = bytes(memory.strategy?.observation), controlOffObservationBytes = bytes(controlOff.strategy?.observation),
    observationIncrementBytes = Math.max(0, sharedObservationBytes - controlOffObservationBytes);
  return { plannerBytes, definitionsBytes, authorityBytes, totalBytes, sharedObservationBytes, controlOffObservationBytes,
    observationIncrementBytes, chargedTotalBytes: totalBytes + observationIncrementBytes,
    withSharedObservationBytes: bytes({ ...resident, sharedObservation: memory.strategy?.observation }) };
}
