import type { ActionIntent, AllocationPrecondition, AllocationReason, AllocationUtility } from './allocation-types';
import type { DecisionFacts } from './decision';
import type { ForceAssemblyForecast } from './force-assembly-forecast';
import type { Objective, SituationUnit, Target, ValuationContext, ValuationWindow } from './types';

export type AssemblyPost = Readonly<{ id: string; target: Target; unitIds: readonly string[] }>;
export type AssemblyFactsRequest = Readonly<{
  objective: DecisionFacts<Objective>; methodId: string; campTarget: Target; requiredForce: number;
  posts: readonly AssemblyPost[]; unitIds: readonly string[];
  responseEligibleUnitIds?: readonly string[]; interruptedUnitIds?: readonly string[]; valuation?: ValuationContext;
}>;
export type AssemblyFacts = Readonly<{
  forecast: ForceAssemblyForecast;
  /** Conditional continuation of the conquest. Every cash flow has already
   * been delayed to readyTick and clipped to this same comparison window.
   * The provider must not discount the score a second time or claim this as
   * an immediately executable conquest. Assembly's own occupation is separate. */
  continuation: Readonly<{ utility: AllocationUtility; window: ValuationWindow;
    assemblyDelayApplied: true; assumptions: readonly AllocationReason[] }> | null;
  missing: readonly AllocationPrecondition[];
}>;
/** One think's shared facts. The framework binds the real quote's resource
 * exclusions/window on every gross/net reprice; providers do not cache it. */
export type AssemblyFactsReader = (request: AssemblyFactsRequest) => AssemblyFacts;

/** The action coordinates several physical land posts. An ETA to the mine or
 * another source island is never an ETA to this member's assembly post. */
export const assemblyPostArrivalId = (actionId: string, postId: string) => `${actionId}/post/${postId}`;
export function assemblyPostForUnit(intent: Extract<ActionIntent, { kind: 'assemble-force' }>,
  unit: DecisionFacts<Pick<SituationUnit, 'id' | 'location'>>): AssemblyPost | null {
  const explicit = intent.posts.find(post => post.unitIds.includes(unit.id));
  if (explicit) return explicit;
  const location = unit.location;
  if (location.kind !== 'land') return null;
  return [...intent.posts].filter(post => post.target.landId === location.landId)
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)[0] ?? null;
}
