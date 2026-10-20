import type { ObservedSource } from '../shared/sim/observation';
import type { PlayerId } from '../shared/types';
import type { AiDeathEngagement, AiUnitDeathRecord } from './death-ledger-types';

type Identity = Pick<ObservedSource, 'owner' | 'kind' | 'entityType'>;
type DeathFacts = Omit<AiUnitDeathRecord, 'classification'>;

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
  const ownTeam = teams[record.owner] ?? record.owner;
  for (const id of record.context.balance.hostileIds) {
    const identity = identities.get(id);
    if (!identity) { unresolvedNearbyIds.push(id); continue; }
    if (identity.entityType !== 'unit' || identity.kind === 'worker') continue;
    // Neutral camps are an intentional combat opponent only for a recorded clearing task.
    if (identity.owner === 'neutral' ? !record.assignment.task?.clearing
      : identity.owner === record.owner || (teams[identity.owner] ?? identity.owner) === ownTeam) continue;
    opponentIds.push(id);
  }
  const inherited = record.cause === 'sinking' && options.carrier;
  const damageWindow = inherited ? options.carrier!.damageWindow : record.damageWindow;
  const receivedDamage = damageWindow.sources.reduce((sum, hit) => sum + Math.max(0, hit.damage), 0);
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
      'neutral-opponent-requires-clearing-task'],
  };
}
