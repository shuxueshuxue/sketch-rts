import { unitMover } from '../../shared/catalog';
import type { GameSnapshot, Unit } from '../../shared/types';
import type { GoalPoolMemberReference } from './goal-planner-types';
import { landIdAt, seaIdAt } from './regions';

/** Read the current native pool only. No prospective ID, route solver,
 * allocation or persistent binding is created by this selection query. */
export function goalPoolMemberCandidates(input: Readonly<{
  snapshot: GameSnapshot; owner: string; reference: GoalPoolMemberReference;
  allowedUnitIds?: readonly string[] | undefined; interruptedUnitIds?: readonly string[] | undefined; excludedUnitIds?: readonly string[] | undefined;
}>): readonly Unit[] {
  const { snapshot, owner, reference } = input, mover = unitMover(reference.unitKind), profile = reference.routeProfile;
  const region = mover === 'land' ? reference.at.landId : reference.at.seaId;
  if (!reference.slot || !region || profile && (!Number.isFinite(profile.from.x) || !Number.isFinite(profile.from.y)
    || !Number.isFinite(profile.speed) || profile.speed <= 0)) return [];
  const allowed = input.allowedUnitIds && new Set(input.allowedUnitIds);
  const excluded = new Set([...(input.interruptedUnitIds ?? []), ...(input.excludedUnitIds ?? [])]);
  return snapshot.units.filter(unit => unit.owner === owner && unit.kind === reference.unitKind && unit.hp > 0
    && unit.expiresTick === undefined && !unit.deck && !unit.cabin && (!allowed || allowed.has(unit.id)) && !excluded.has(unit.id)
    && (mover === 'land' ? landIdAt(snapshot.map, unit) : seaIdAt(snapshot.map, unit)) === region
    && (!profile || Math.hypot(unit.x - profile.from.x, unit.y - profile.from.y) <= 1e-6 && Math.abs(unit.speed - profile.speed) <= 1e-9))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
