/** ETA discount over a monotone, target-specific cohort evaluation. Marginal
 * camp force is recomputed on whole groups; singleton ratings are not additive. */
export function arrivalWeightedForce<T extends { id: string }>(onStation: readonly T[],
  enRoute: readonly Readonly<{ unit: T; etaTicks: number }>[], windowTicks: number,
  assess: (cohort: readonly T[]) => number) {
  if (!Number.isFinite(windowTicks) || windowTicks <= 0) throw new Error('Invalid arrival force window');
  const ids = new Set<string>();
  const member = (unit: T) => {
    if (ids.has(unit.id)) throw new Error(`Arrival force counts unit twice: ${unit.id}`);
    ids.add(unit.id);
  };
  const present = [...onStation].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const unit of present) member(unit);
  const incoming = [...enRoute].sort((a, b) => a.etaTicks - b.etaTicks
    || (a.unit.id < b.unit.id ? -1 : a.unit.id > b.unit.id ? 1 : 0));
  for (const arrival of incoming) {
    member(arrival.unit);
    if (!Number.isFinite(arrival.etaTicks) || arrival.etaTicks < 0) throw new Error(`Invalid arrival force ETA: ${arrival.unit.id}`);
  }
  const value = (group: readonly T[]) => {
    const force = assess(group);
    if (!Number.isFinite(force) || force < 0) throw new Error('Invalid assessed arrival force');
    return force;
  };
  const cohort = [...present];
  const onStationForce = value(cohort);
  let totalForce = onStationForce, effectiveForce = onStationForce;
  for (let index = 0; index < incoming.length;) {
    const eta = incoming[index]!.etaTicks;
    // Simultaneous arrivals share one cohort evaluation, including interactions.
    do { cohort.push(incoming[index++]!.unit); } while (index < incoming.length && incoming[index]!.etaTicks === eta);
    const next = value(cohort), marginal = next - totalForce;
    if (marginal < -1e-9) throw new Error('Arrival force evaluator must be monotone');
    effectiveForce += Math.max(0, marginal) / (1 + eta / windowTicks);
    totalForce = next;
  }
  effectiveForce = Math.min(totalForce, effectiveForce);
  return { onStationForce, totalForce, effectiveForce, discountedEnRouteForce: effectiveForce - onStationForce };
}
