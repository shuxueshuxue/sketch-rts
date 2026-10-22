import type { GameSnapshot } from '../../shared/types';
import { unitMover } from '../../shared/catalog';
import { neutralCampExposure, type NeutralCampExposure } from '../situation/neutral-camp-exposure';
import type { GoalFact, GoalFactPredicate, GoalResource } from './goal-planner-types';
import { goalPlanningReferenceProjection, referenceGoalFact } from './goal-planning-references';

/** Full semantic keys avoid shortened-hash collisions. Task IDs, caller order
 * and process state never participate in fact identity. */
function canonical(value: unknown): unknown {
  const reference = goalPlanningReferenceProjection(value); if (reference) return reference;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => [key, canonical(item)]));
  if (typeof value === 'number' && !Number.isFinite(value)) return { invalidNumber: String(value) };
  return value;
}
export function goalValueKey(value: unknown): string { return JSON.stringify(canonical(value)); }
const region = (at: import('./types').Target, mover: 'land' | 'sea') => mover === 'sea'
  ? at.seaId ? { seaId: at.seaId } : at : at.landId ? { landId: at.landId } : at;
export function goalResourceKey(resource: GoalResource): string {
  const normalized = resource.kind === 'unit-pool' ? { ...resource, at: region(resource.at, unitMover(resource.unitKind)) }
    : resource.kind === 'force' && resource.scope === 'pool' ? { ...resource, at: region(resource.at, 'land') } : resource;
  return goalValueKey(normalized);
}
export function goalFact(predicate: GoalFactPredicate): GoalFact {
  return referenceGoalFact(normalizeGoalPredicate(predicate), semanticGoalPredicate(predicate));
}
export function normalizeGoalPredicate(predicate: GoalFactPredicate): GoalFactPredicate {
  const refs = (values: readonly import('./goal-planner-types').GoalEntityReference[]) => [...new Map(values
    .map(value => [goalValueKey(value), value] as const)).entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value);
  const normalized = predicate.kind === 'assets-safe' || predicate.kind === 'harassment-ended' && predicate.unitIds
    ? { ...predicate, unitIds: [...new Set(predicate.unitIds)].sort() }
    : predicate.kind === 'cargo-aboard' ? { ...predicate, units: refs(predicate.units) }
    : 'cohort' in predicate && predicate.cohort ? { ...predicate, cohort: refs(predicate.cohort) } : predicate;
  return normalized;
}
export function semanticGoalPredicate(predicate: GoalFactPredicate): GoalFactPredicate {
  const normalized = normalizeGoalPredicate(predicate);
  return (normalized.kind === 'unit-available' ? { ...normalized, at: region(normalized.at, unitMover(normalized.unitKind)) }
    : normalized.kind === 'worker-at' || normalized.kind === 'force-available' ? { ...normalized, at: region(normalized.at, 'land') } : normalized) as GoalFactPredicate;
}

/** A camp is the shared native home group, identified by its recorded member
 * IDs. Never use enumeration indices or nearest-center guesses. Retain this
 * original ID as guards die so camp-cleared can still be read from the world. */
export function goalCampId(memberIds: readonly string[]): string {
  return `camp:${JSON.stringify([...new Set(memberIds)].sort())}`;
}
export function goalCampMemberIds(campId: string): readonly string[] | null {
  if (!campId.startsWith('camp:')) return null;
  try {
    const ids: unknown = JSON.parse(campId.slice(5));
    return Array.isArray(ids) && ids.length > 0 && ids.every(id => typeof id === 'string')
      && goalCampId(ids) === campId ? ids as string[] : null;
  } catch { return null; }
}
export function resolveGoalCamp(snapshot: GameSnapshot, campId: string):
  | Readonly<{ status: 'present'; exposure: NeutralCampExposure; originalMemberIds: readonly string[] }>
  | Readonly<{ status: 'cleared'; originalMemberIds: readonly string[] }>
  | Readonly<{ status: 'invalid' }> {
  const ids = goalCampMemberIds(campId);
  if (!ids) return { status: 'invalid' };
  const live = snapshot.units.filter(unit => ids.includes(unit.id) && unit.owner === 'neutral' && unit.hp > 0);
  if (!live.length) return { status: 'cleared', originalMemberIds: ids };
  const exposure = neutralCampExposure(snapshot).camps.find(camp => live.every(unit => camp.memberIds.includes(unit.id)));
  return exposure ? { status: 'present', exposure, originalMemberIds: ids } : { status: 'invalid' };
}
