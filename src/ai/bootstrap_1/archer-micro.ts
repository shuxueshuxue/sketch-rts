import type { GameSnapshot, PlayerId } from '../../shared/types';
import { planSkirmishPreservation } from '../policy/skirmish-tactics';
import type { AiPolicyContext, AiScript } from '../policy/types';

export const archerMicro: AiScript = {
  id: 'skirmishPreservation',
  phase: 'tactics',
  run(snapshot, owner, options) {
    return planSkirmishPreservation(snapshot, owner, options)
      .map(command => command.type === 'attackMove' ? { ...command, type: 'move' as const, avoidCombat: true } : command);
  },
  claimsUnits(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
    const continuing = snapshot.units.filter(unit => unit.owner === owner && unit.order.type === 'move'
      && options.memory.unitClaims[unit.id]?.kind === 'retreat').map(unit => unit.id);
    return new Set([...continuing, ...planSkirmishPreservation(snapshot, owner, options)
      .flatMap(command => command.type === 'move' || command.type === 'attack' || command.type === 'attackMove' ? command.unitIds : [])
    ].filter(id => snapshot.units.some(unit => unit.id === id && ['archer', 'horseArcher', 'sparkArcher'].includes(unit.kind))));
  },
};
