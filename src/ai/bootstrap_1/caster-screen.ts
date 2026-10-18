import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { distance } from '../policy/spatial';
import { units } from '../policy/snapshot';
import type { AiPolicyContext } from '../policy/types';
import { isBacklineKind, planCasterScreen, v6CasterPost } from '../policy/v6/backline';
import { v6Memory } from '../policy/v6/memory';
import { isV8Policy, isV9Policy } from '../policy/versions';
import { mainBase } from '../policy/world-model';
import { armedFoes } from './safe-land-route';
import { mountedMicro, mountedTargetOrder, mountedThreatReach, THINK_TICKS } from './mounted-micro';
import { casterAnchorPlanner } from './caster-anchor';

/** A ranged caster can outmaneuver slower melee pursuers while its screen is absent. */
export function casterMeleeMicro(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const threats = armedFoes(snapshot, owner, options);
  return (caster: Unit, foes: Unit[]): GameCommand | undefined => {
    if (caster.attackRange <= 100 || caster.attackDamage <= 0 || caster.order.type === 'cast'
      || foes.some(foe => foe.speed >= caster.speed)) return undefined;
    const local = threats.filter(foe => distance(caster, foe) <= Math.max(caster.attackRange,
      mountedThreatReach(snapshot, foe, caster, THINK_TICKS + caster.cooldown))
      + (caster.speed + ('speed' in foe ? foe.speed : 0)) * THINK_TICKS / SIM_TICKS_PER_SECOND);
    const target = [...foes].sort(mountedTargetOrder)[0]!;
    return mountedMicro(snapshot, caster, target, local, { kind: 'camp' });
  };
}

export function planBootstrapCasterScreen(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const home = mainBase(snapshot, owner), front = units(snapshot, owner).filter(unit => unit.kind !== 'worker' && !isBacklineKind(unit));
  return planCasterScreen(snapshot, owner, options, home, v6CasterPost(v6Memory(options).general, home), front,
    units(snapshot, owner).filter(isBacklineKind), isV8Policy(options), isV9Policy(options), casterMeleeMicro(snapshot, owner, options), casterAnchorPlanner(snapshot, owner, options, home));
}
