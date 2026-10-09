import type { GameSnapshot, PlayerId } from '../../shared/types';
import { planSkirmishPreservation } from '../policy/skirmish-tactics';
import type { AiPolicyContext, AiScript } from '../policy/types';

export const archerMicro: AiScript = {
  id: 'skirmishPreservation',
  phase: 'tactics',
  run(snapshot, owner, options) {
    return options.memory.v6?.general?.mode === 'creep' ? [] : planSkirmishPreservation(snapshot, owner, options);
  },
  claimsUnits(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
    if (options.memory.v6?.general?.mode === 'creep') return new Set();
    const continuing = snapshot.units.filter(unit => unit.owner === owner && unit.order.type === 'move'
      && options.memory.unitClaims[unit.id]?.kind === 'retreat').map(unit => unit.id);
    return new Set([...continuing, ...planSkirmishPreservation(snapshot, owner, options)
      .flatMap(command => command.type === 'move' || command.type === 'attack' || command.type === 'attackMove' ? command.unitIds : [])
    ].filter(id => snapshot.units.some(unit => unit.id === id && ['archer', 'horseArcher', 'sparkArcher'].includes(unit.kind))));
  },
};
