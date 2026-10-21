import type { ObservedSource } from '../shared/sim/observation';
import type { PlayerId } from '../shared/types';
import type { AiDeathEngagement, AiUnitDeathRecord } from './death-ledger-types';

type Identity = Pick<ObservedSource, 'owner' | 'kind' | 'entityType'>;
type DeathFacts = Omit<AiUnitDeathRecord, 'classification'>;

export function assignmentClearsCamp(assignment: DeathFacts['assignment'], sourceId: string): boolean {
  const tasks = [assignment.task, ...assignment.otherTaskCandidates];
  const formal = tasks.filter(task => task?.attribution === 'assignment');
  return (formal.length ? formal : tasks).some(task => task?.clearing
    && (task.clearingTargetIds === undefined || task.clearingTargetIds.includes(sourceId)));
}

export function isAiDeathOpponent(owner: PlayerId, record: Pick<DeathFacts, 'owner' | 'assignment'>,
  teams: Partial<Record<PlayerId, string>>, sourceId = '') {
  return owner === 'neutral' ? assignmentClearsCamp(record.assignment, sourceId)
    : owner !== record.owner && (teams[owner] ?? owner) !== (teams[record.owner] ?? record.owner);
}

/** Uses the native fatal-hit force IDs, not a later world's approximate positions.
 * Worlds are needed only to identify those IDs during offline reclassification.
 */
export function inferAiDeathEngagement(record: DeathFacts, options: {
  identities: ReadonlyMap<string, Identity>;
  teams: Partial<Record<PlayerId, string>>;
  dealtDamage: number | null;
  carrier?: Pick<DeathFacts, 'unit' | 'damageWindow'>;
  provenance: AiDeathEngagement['provenance'];
}): AiDeathEngagement {
  const { identities, teams } = options, opponentIds: string[] = [], unresolvedNearbyIds: string[] = [];
  for (const id of record.context.balance.hostileIds) {
    const identity = identities.get(id);
    if (!identity) { unresolvedNearbyIds.push(id); continue; }
    if (identity.entityType !== 'unit' || identity.kind === 'worker') continue;
    // Neutral camps are an intentional combat opponent only for a recorded clearing task.
    if (!isAiDeathOpponent(identity.owner, record, teams, id)) continue;
    opponentIds.push(id);
  }
  // The force estimator excludes some cross-ground threats (e.g. a ship firing
  // at a unit on shore). A live killer's native position is direct evidence of
  // proximity even when it cannot share the victim's walking ground.
  const killer = record.killer;
  if (killer?.present && killer.entityType === 'unit' && killer.kind !== 'worker'
    && isAiDeathOpponent(killer.owner, record, teams, killer.id)
    && Math.hypot(killer.x - record.unit.x, killer.y - record.unit.y) <= record.context.balance.radius
    && !opponentIds.includes(killer.id)) opponentIds.push(killer.id);
  const inherited = record.cause === 'sinking' && options.carrier;
  const damageWindow = inherited ? options.carrier!.damageWindow : record.damageWindow;
  const receivedDamage = damageWindow.sources.filter(hit => isAiDeathOpponent(hit.source.owner, record, teams, hit.source.id))
    .reduce((sum, hit) => sum + Math.max(0, hit.damage), 0);
  const exchanged = receivedDamage > 0 || (options.dealtDamage ?? 0) > 0;
  const status = opponentIds.length && exchanged ? 'engaged'
    : unresolvedNearbyIds.length || opponentIds.length && options.dealtDamage === null ? 'unknown' : 'outside-combat';
  return {
    status, window: { fromTick: damageWindow.fromTick, toTick: damageWindow.toTick },
    radius: record.context.balance.radius, balanceTick: record.context.balance.tick,
    opponentIds, unresolvedNearbyIds, receivedDamage, dealtDamage: options.dealtDamage,
    inheritedFromCarrier: inherited ? options.carrier!.unit.id : null, provenance: options.provenance,
    evidence: ['native-fatal-hit-force-ids', 'unit-identities-and-team-relations', 'bounded-damage-window-includes-fatal-hit',
      ...(inherited ? ['sinking-inherits-hull-engagement'] : []),
      ...(options.dealtDamage === null ? ['outgoing-damage-not-recorded-in-v1'] : ['outgoing-damage-observed']),
      'neutral-opponent-requires-matching-clearing-target', 'damage-exchange-must-involve-an-opponent',
      'live-killer-position-includes-cross-ground-threats'],
  };
}
