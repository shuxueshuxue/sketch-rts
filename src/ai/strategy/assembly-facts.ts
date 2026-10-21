import type { AllocationPrecondition, AllocationReason, AllocationUtility } from './allocation-types';
import type { DecisionFacts } from './decision';
import type { ForceAssemblyForecast } from './force-assembly-forecast';
import type { Objective, Target, ValuationContext, ValuationWindow } from './types';

export type AssemblyPost = Readonly<{ id: string; target: Target; unitIds: readonly string[] }>;
export type AssemblyFactsRequest = Readonly<{
  objective: DecisionFacts<Objective>; methodId: string; campTarget: Target; requiredForce: number;
  posts: readonly AssemblyPost[]; unitIds: readonly string[];
  responseEligibleUnitIds?: readonly string[]; valuation?: ValuationContext;
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
