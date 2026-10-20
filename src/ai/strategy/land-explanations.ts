import type { Evidence, Opportunity, Reason, Situation, UtilityTerm } from './types';
import { capturesExplanations, deferredEvidence, explanationRecipe, projectedProperty, projectedValueReader, valueReader } from './explanations';

type TextPart = string | number | Readonly<{ fixed: number }> | Readonly<{ ids: readonly string[] }>;
export type LandText = string | readonly TextPart[];
// These owned values contain no reader, Situation row, model or snapshot. A
// cached numerical assessment can therefore be rebound in a later evaluation.
export type LandReasonFact = Readonly<{ code: string; message: LandText; certainty: Evidence['certainty'] }>;
export type LandTermFact = Readonly<{ code: string; value: number; label: string }>;
export const reasonFact = (code: string, message: LandText, certainty: Evidence['certainty'] = 'inferred'): LandReasonFact =>
  ({ code, message, certainty });
export const termFact = (code: string, value: number, label: string): LandTermFact => ({ code, value, label });

function renderText(message: LandText): string {
  if (typeof message === 'string') return message;
  return message.map(part => typeof part === 'object' ? 'fixed' in part ? part.fixed.toFixed(3) : part.ids.join(', ') : part).join('');
}
function reasonEvidence(data: { tick: number; certainty: Evidence['certainty']; text: () => string }): readonly Evidence[] {
  return [{ source: 'land-objectives', tick: data.tick, certainty: data.certainty, detail: data.text() }];
}
export function projectLandReason(fact: LandReasonFact, tick: number): Reason {
  const text = explanationRecipe(renderText, fact.message);
  return deferredEvidence(projectedProperty({ code: fact.code }, 'detail', text),
    explanationRecipe(reasonEvidence, { tick, certainty: fact.certainty, text }));
}
export const landReason = (situation: Situation, code: string, message: LandText, certainty: Evidence['certainty'] = 'inferred') =>
  projectLandReason(reasonFact(code, message, certainty), situation.tick);
export const projectLandTerm = (fact: LandTermFact): UtilityTerm =>
  projectedProperty({ code: fact.code, value: fact.value }, 'explanation', valueReader(fact.label));

type AssessmentEvidence = { reads: readonly (() => readonly Evidence[])[]; tick: number; available: number; power: number; required: number };
function renderAssessmentEvidence(data: AssessmentEvidence): readonly Evidence[] {
  return [...data.reads.flatMap(read => read()), { source: 'land-objectives', tick: data.tick, certainty: 'inferred',
    detail: `有效/待借/需求：${data.available}/${data.power}/${data.required}；仅消费 Situation 的 ETA 与敌援事实` }];
}
export function landAssessmentEvidence(opportunities: readonly Opportunity[], tick: number, available: number, power: number, required: number) {
  if (!capturesExplanations()) return valueReader<readonly Evidence[]>([]);
  // Capture the current projection now, not when it is eventually rendered.
  const reads = opportunities.map(opportunity => projectedValueReader(opportunity, 'evidence'));
  return explanationRecipe(renderAssessmentEvidence, { reads, tick, available, power, required });
}
