/** Explicit event dependencies decide equal-time causality. Stable keys only
 * break ties between independent events; a finish credit cannot leap over
 * its own zero-duration start debit. This function has no world/query port. */
export function orderGoalReplayEvents<T>(events: readonly Readonly<{
  id: string; tick: number; dependsOn: readonly string[]; value: T;
}>[], compare: (a: T, b: T) => number): readonly T[] | null {
  const byId = new Map(events.map(event => [event.id, event]));
  if (byId.size !== events.length || events.some(event => !Number.isFinite(event.tick)
    || event.dependsOn.some(id => !byId.has(id) || byId.get(id)!.tick > event.tick))) return null;
  const remaining = new Map(events.map(event => [event.id, new Set(event.dependsOn)]));
  const children = new Map<string, string[]>();
  for (const event of events) for (const parent of new Set(event.dependsOn))
    children.set(parent, [...children.get(parent) ?? [], event.id]);
  const ready = events.filter(event => !remaining.get(event.id)!.size), result: T[] = [];
  while (ready.length) {
    ready.sort((a, b) => a.tick - b.tick || compare(a.value, b.value) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const event = ready.shift()!; result.push(event.value);
    for (const child of children.get(event.id) ?? []) {
      remaining.get(child)!.delete(event.id);
      if (!remaining.get(child)!.size) ready.push(byId.get(child)!);
    }
  }
  return result.length === events.length ? result : null;
}

export function goalReplayAncestors(actions: readonly Readonly<{ action: { id: string }; dependsOn?: readonly string[] }>[]) {
  const byId = new Map(actions.map(action => [action.action.id, action]));
  const result = new Map<string, ReadonlySet<string>>(), visiting = new Set<string>();
  const visit = (id: string): ReadonlySet<string> | null => {
    const known = result.get(id); if (known) return known;
    if (visiting.has(id) || !byId.has(id)) return null;
    visiting.add(id); const ancestors = new Set<string>();
    for (const parent of byId.get(id)!.dependsOn ?? []) {
      const previous = visit(parent); if (!previous) return null;
      ancestors.add(parent); previous.forEach(id => ancestors.add(id));
    }
    visiting.delete(id); result.set(id, ancestors); return ancestors;
  };
  return byId.size === actions.length && actions.every(action => visit(action.action.id)) ? result : null;
}

/** Validate the action graph without materializing its transitive closure.
 * Cash events at distinct ticks need only this check and chronological order. */
export function validGoalReplayDependencies(actions: readonly Readonly<{ action: { id: string }; dependsOn?: readonly string[] }>[]): boolean {
  const byId = new Map(actions.map(action => [action.action.id, action])), done = new Set<string>(), visiting = new Set<string>();
  const visit = (id: string): boolean => {
    if (done.has(id)) return true;
    const action = byId.get(id);
    if (!action || visiting.has(id)) return false;
    visiting.add(id);
    if (!(action.dependsOn ?? []).every(visit)) return false;
    visiting.delete(id); done.add(id); return true;
  };
  return byId.size === actions.length && actions.every(action => visit(action.action.id));
}
