import { combatTargetScore, shouldSwitchCombatTarget } from '../../shared/combat-target';
import type { Building, GameCommand, Unit } from '../../shared/types';
import type { NavalPlanMemory } from '../memory';
import { distance } from './spatial';

type Target = Unit | Building;
/** Keep one useful engagement through small changes in distance. Mechanical
 * attack-move still handles immediate threats between the planner's frames. */
export function fleetTarget(ship: Unit, candidates: Target[], memory: NavalPlanMemory): Target | undefined {
  const orders = memory.combat ??= {};
  const saved = orders[ship.id];
  const current = candidates.find(target => target.id === saved?.targetId);
  let best: Target | undefined, bestScore = -Infinity;
  for (const candidate of candidates) {
    const score = combatTargetScore(candidate, distance(ship, candidate));
    if (score > bestScore || score === bestScore && candidate.id < (best?.id ?? '\uffff')) { best = candidate; bestScore = score; }
  }
  if (current && best && !shouldSwitchCombatTarget(combatTargetScore(current, distance(ship, current)), bestScore)) best = current;
  if (!best) { delete orders[ship.id]; return; }
  if (!saved) orders[ship.id] = { targetId: best.id };
  else saved.targetId = best.id;
  return best;
}

/** Moving quarry coordinates do not replace an unchanged attack-move voyage:
 * the simulation already follows its acquired target and retains the route. */
export function fleetAttackCommand(ship: Unit, target: Target, memory: NavalPlanMemory): GameCommand | undefined {
  const state = memory.combat![ship.id]!;
  if ((ship.order.type === 'attack' || ship.order.type === 'attackMove') && ship.order.targetId === target.id
    || ship.order.type === 'attackMove' && state.commandTargetId === target.id) return;
  state.commandTargetId = target.id;
  return { type: 'attackMove', unitIds: [ship.id], x: target.x, y: target.y };
}
