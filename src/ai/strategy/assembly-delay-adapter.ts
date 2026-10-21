import type { AssemblyDelayLossValue } from './assembly-delay-loss';
import type { AssemblyDelayLossUpperBound, AssemblyDisplacementQuote } from './types';
import { valuationWindow } from './utility';

/** Only bound enters allocation memory. The evaluation caller retains sidecar
 * separately: it is the complete monetary proof, without a forecast world or
 * the original cash-flow input graph. */
export type AdaptedAssemblyDelayLoss = AssemblyDisplacementQuote & Readonly<{ sidecar: AssemblyDelayLossValue }>;
const nonnegative = (value: number) => Number.isFinite(value) && value >= 0;

/** Bridge the pure monetary proof to formal gathering displacement. A finite
 * same-window continuation cap can replace incomplete component detail; a
 * missing cap cannot be replaced by a payoff lower bound or a fake zero. */
export function adaptAssemblyDelayLoss(targetId: string, value: AssemblyDelayLossValue): AdaptedAssemblyDelayLoss {
  const sidecar = structuredClone(value);
  const unknown = (reasonCode: string): AdaptedAssemblyDelayLoss => ({ status: 'unknown', reasonCode, sidecar });
  const cap = value.valueCapGold;
  if (cap === null || !nonnegative(cap)) return unknown('assembly-continuation-value-unknown');
  if (!targetId) return unknown('assembly-delay-target-unquoted');
  try { valuationWindow(value.window.taskTicks, { phase: 'gross', window: value.window }); }
  catch { return unknown('assembly-delay-window-invalid'); }
  const factIds = [...new Set([targetId, ...value.reason.factIds])];
  const known = (gold: number, mode: AssemblyDelayLossUpperBound['mode'],
    components: AssemblyDelayLossUpperBound['components']): AdaptedAssemblyDelayLoss => ({ status: 'known',
    bound: { targetId, gold: gold === 0 ? 0 : gold, window: { ...value.window }, continuationUpperGold: cap,
      mode, components }, sidecar });
  const aggregate = (gold: number, code: string, mode: AssemblyDelayLossUpperBound['mode']) =>
    known(gold, mode, [{ code, valueGold: gold === 0 ? 0 : gold, factIds }]);
  const fallback = () => aggregate(cap, 'assembly-delay-adapter-whole-value-cap', 'whole-value-cap');
  if (value.status !== 'known' || !nonnegative(value.lossUpperGold)
    || !nonnegative(value.uncappedLossUpperGold)) return fallback();
  if (!value.components.length || value.components.some(term => !term.code || !nonnegative(term.valueGold))) return fallback();
  const components = value.components.map(term => ({ code: term.code, valueGold: term.valueGold === 0 ? 0 : term.valueGold,
    factIds: [...term.factIds] }));
  const sum = components.reduce((total, term) => total + term.valueGold, 0);
  if (!nonnegative(sum)) return fallback();
  // The oracle requires exact equality. Only machine rounding may be reconciled;
  // inconsistent proof amounts use the independently supplied whole-value cap.
  const tolerance = 8 * Number.EPSILON * Math.max(1, sum, value.lossUpperGold) * components.length;
  if (Math.abs(sum - value.lossUpperGold) > tolerance) return fallback();
  const conservative = Math.max(sum, value.lossUpperGold);
  if (conservative > cap) return aggregate(cap, 'assembly-delay-adapter-capped-proof', 'whole-value-cap');
  const mode = !value.paths.length || value.paths.some(path => path.probability > 0
    && (path.basis === 'full-cap' || path.rawLossUpperGold > path.lossUpperGold))
    || value.uncappedLossUpperGold > cap ? 'whole-value-cap' : 'scenario-delay';
  if (conservative === sum) return known(sum, mode, components);
  return aggregate(conservative, 'assembly-delay-adapter-rounded-proof', mode);
}
