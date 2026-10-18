import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { SIM_TICKS_PER_SECOND } from '../../shared/time';
import { distance } from '../policy/spatial';
import { units } from '../policy/snapshot';
import type { AiPolicyContext } from '../policy/types';
import { isBacklineKind, planCasterScreen, v6CasterPost } from '../policy/v6/backline';
import { v6Memory } from '../policy/v6/memory';
import { isV8Policy, isV9Policy } from '../policy/versions';
import { mainBase } from '../policy/world-model';
import { armedFoes } from './safe-land-route';
import { medicalRecoveryReleasedUnitIds } from './medical-recovery';
import { recoveryArrivalFilter } from './recovery-arrival';
import { medicalEscapeRoadAllows, medicalRoadIsSafe } from './medical-task-safety';
import { mountedEscape, mountedMicro, mountedTargetOrder, mountedThreatReach, THINK_TICKS } from './mounted-micro';
import { groundScreenMoves } from './ground-screen-goal';
import { casterScreenOutsideFixedFire } from './caster-fixed-fire';

/** A ranged caster can outmaneuver slower melee pursuers while its screen is absent. */
export function casterMeleeMicro(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext) {
  const threats = armedFoes(snapshot, owner, options);
  return (caster: Unit, foes: Unit[]): GameCommand | undefined => {
    if (caster.deck || caster.attackRange <= 100 || caster.attackDamage <= 0 || caster.order.type === 'cast'
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
  const commands = planCasterScreen(snapshot, owner, options, home, v6CasterPost(v6Memory(options).general, home), front,
    units(snapshot, owner).filter(isBacklineKind), isV8Policy(options), isV9Policy(options), casterMeleeMicro(snapshot, owner, options));
  const released = medicalRecoveryReleasedUnitIds(snapshot, owner, options);
  return casterScreenOutsideFixedFire(snapshot, owner, options,
    groundScreenMoves(snapshot, owner, options, released.size === 0 ? commands
    : releaseMedicalBackline(snapshot, owner, options, home,
      units(snapshot, owner).filter(unit => released.has(unit.id)), commands)), released);
}

/** The current mainland/naval backline owner replaces rejected medical work. */
export function releaseMedicalBackline(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext,
  post: { x: number; y: number }, casters: Unit[], commands: GameCommand[]) {
  if (!casters.length) return commands;
  const foes = armedFoes(snapshot, owner, options);
  // Rejected care returns to the existing backline. Its original screen/home
  // destination stays the preference; a dangerous road uses the same short
  // escape micro as other backline combat, rather than reviving the old cast.
  for (const caster of casters) {
    const index = commands.findIndex(command => 'unitIds' in command && command.unitIds.includes(caster.id));
    const command = index < 0 ? undefined : commands[index];
    if (command?.type === 'move' && medicalRoadIsSafe(snapshot, caster, command, 0, foes)) continue;
    const arrivalAllows = recoveryArrivalFilter(snapshot, caster, THINK_TICKS);
    const roadAllows = medicalEscapeRoadAllows(snapshot, caster, foes);
    const escape = mountedEscape(snapshot, caster, foes, 0,
      command?.type === 'move' ? command : post, true, goal => arrivalAllows(goal) && roadAllows(goal));
    // If every usable road is worse, explicitly cancel pursuit while the
    // backline reassesses next think; a completed zero-length move would idle.
    const replacement: GameCommand = escape.type === 'move' && distance(caster, escape) <= MOVE_ORDER_ARRIVAL_RANGE
      ? { type: 'holdPosition', unitIds: [caster.id] } : escape;
    if (index < 0) commands.push(replacement); else commands[index] = replacement;
  }
  return commands;
}
