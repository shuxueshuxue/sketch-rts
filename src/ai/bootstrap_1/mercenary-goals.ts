import { SHOP_PRIORITY } from '../policy/v9/shop';
import { mercenaryAssignment } from './mercenary-control';
import type { GameSnapshot, PlayerId } from '../../shared/types';
import { resolveAiCommandIntent } from '../policy/commands';
import { friendlyUnitsAtMercenaryCamp, hiredMercenaryCount, mercenaryRoleLimit } from '../policy/mercenary-model';
import { canSupply } from '../policy/world-model';
import { neutralUnitsNear } from '../policy/snapshot';
import type { AiPolicyContext } from '../policy/types';

/** A controlled camp is a purchase, not an army movement order. */
export function controlledMercenaryGoals(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const controlled = snapshot.mercenaryCamps.filter(camp => camp.stock > 0 && camp.cooldownRemaining === 0
    && neutralUnitsNear(snapshot, camp, 260).length === 0
    && friendlyUnitsAtMercenaryCamp(snapshot, owner, camp).length > 0
    && hiredMercenaryCount(snapshot, owner, camp.hireKind) < mercenaryRoleLimit(camp.hireKind, options)
    && canSupply(snapshot, owner, camp.hireKind)).map(camp => ({
    id: `hire:${camp.hireKind}`, priority: 64, cost: camp.cost, save: true,
    issue: () => resolveAiCommandIntent(snapshot, owner, { type: 'hire', campId: camp.id }, options),
  }));
  const traveling = mercenaryAssignment(snapshot, owner, options).map(({ camp }) => ({
    id: `hire:${camp.hireKind}`, priority: SHOP_PRIORITY, cost: camp.cost, save: true, hold: true as const, issue: () => undefined,
  }));
  return [...controlled, ...traveling];
}
