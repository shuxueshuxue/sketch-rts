import type { ActionToken, StrategyAllocationMemory } from './allocation-types';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const token = (value: unknown): value is ActionToken => record(value)
  && typeof value.actionId === 'string' && Number.isSafeInteger(value.generation) && Number(value.generation) >= 0;
const key = (value: ActionToken) => JSON.stringify([value.actionId, value.generation]);
const primary = (value: Record<string, unknown>): ActionToken[] => token(value) ? [value]
  : [value.token, value.action, value.parent].filter(token);

/** Build ownership before decoding anything. Journal/order roots can outlive
 * their execution; generation is part of their identity, not a fallback. */
export function goalMigrationScopes(authority: StrategyAllocationMemory) {
  const owners = new Map<string, string>(), tokens = new Map<string, ActionToken>(), goals = new Set<string>();
  const claim = (action: ActionToken, goal: string) => {
    const id = key(action), old = owners.get(id);
    if (old !== undefined && old !== goal) throw Error(`Conflicting authority token goals: ${id}`);
    owners.set(id, goal); goals.add(goal);
  };
  const explicit = (value: Record<string, unknown>): string | undefined => {
    const fields = [value.goalId, value.objectiveId, value.goal];
    if (record(value.intent) && value.intent.kind === 'goal-action') fields.push(value.intent.goalId);
    const claims = [...new Set(fields.filter((item): item is string => typeof item === 'string' && !!item))];
    if (claims.length > 1) throw Error('Conflicting authority record goals');
    return claims[0];
  };
  const scan = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(scan); return; }
    if (!record(value)) return;
    const goal = explicit(value); if (goal) goals.add(goal);
    for (const action of primary(value)) {
      tokens.set(key(action), action);
      if (goal) claim(action, goal);
    }
    Object.values(value).forEach(scan);
  };
  scan(authority);
  // A retained action definition can be the last owner anchor for a journal.
  for (const action of tokens.values()) {
    const entry = authority.goalReferences?.entries[action.actionId];
    if (entry?.namespace === 'action' && record(entry.content) && typeof entry.content.goal === 'string')
      claim(action, entry.content.goal);
  }
  for (const action of tokens.values()) if (/^goal-v[1-9][0-9]*$/.test(action.actionId) && !owners.has(key(action)))
    throw Error(`Missing authority token goal: ${key(action)}`);

  const scope = (value: unknown, fallback?: string): string | undefined => {
    if (!record(value)) return fallback;
    const claims = new Set<string>();
    const own = explicit(value); if (own) claims.add(own);
    for (const action of primary(value)) {
      const goal = owners.get(key(action)); if (goal) claims.add(goal);
    }
    if (claims.size > 1) throw Error('Conflicting authority token goals');
    return [...claims][0] ?? fallback;
  };
  return { goals, scope };
}
