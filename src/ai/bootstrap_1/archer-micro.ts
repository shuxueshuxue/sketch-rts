import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import { planSkirmishPreservation } from '../policy/skirmish-tactics';
import type { AiPolicyContext, AiScript } from '../policy/types';
import { isBacklineKind } from '../policy/v6/backline';

// @@@archer-one-voice - While the general fights for a base (defend, guard), it alone judges whether that fight is lost and
// where the army stands (see @@@v7-one-voice); the skirmish script keeps only its shooters' and casters' own micro (kiting,
// pulling a wounded shooter back, a critical pick-off). Fed the shared script whole, the archer AI walked a locally
// outnumbered group home while the general defended its natural (ladder-11 v9_archer grove, v5-final-2, 11:40): nine units,
// the melee screen included, left for the main, the general sent the melee back in and its leash walked the archers back
// under move orders, so they crossed the field twice without shooting while the screen fought alone. Away from a base
// fight an outnumbered group still withdraws on its own.
const BASE_FIGHT = new Set(['defend', 'guard']);

function archerSkirmish(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): GameCommand[] {
  if (!BASE_FIGHT.has(options.memory.v6?.general?.mode ?? '')) return planSkirmishPreservation(snapshot, owner, options);
  const free = new Set(snapshot.units.filter(unit => unit.owner === owner && (unit.attackRange > 100 || isBacklineKind(unit)))
    .map(unit => unit.id));
  return planSkirmishPreservation(snapshot, owner, options, false).flatMap((command): GameCommand[] => {
    if (!('unitIds' in command)) return [command];
    const unitIds = command.unitIds.filter(id => free.has(id));
    return unitIds.length > 0 ? [{ ...command, unitIds } as GameCommand] : [];
  });
}

export const archerMicro: AiScript = {
  id: 'skirmishPreservation',
  phase: 'tactics',
  run(snapshot, owner, options) {
    return archerSkirmish(snapshot, owner, options)
      .map(command => command.type === 'attackMove' ? { ...command, type: 'move' as const, avoidCombat: true } : command);
  },
  claimsUnits(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
    const continuing = snapshot.units.filter(unit => unit.owner === owner && unit.order.type === 'move'
      && options.memory.unitClaims[unit.id]?.kind === 'retreat').map(unit => unit.id);
    return new Set([...continuing, ...archerSkirmish(snapshot, owner, options)
      .flatMap(command => command.type === 'move' || command.type === 'attack' || command.type === 'attackMove' ? command.unitIds : [])
    ].filter(id => snapshot.units.some(unit => unit.id === id && ['archer', 'horseArcher', 'sparkArcher'].includes(unit.kind))));
  },
};
