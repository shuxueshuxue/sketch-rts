import { unitMover } from '../../shared/catalog';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { capsuleClearsBodies } from '../../shared/navigation-math';
import { groundSteeringRoute, routeClearsDisks } from '../../shared/route-selection';
import { constrainGroundShipStep } from '../../shared/ship-collisions';
import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import { isEnemyOwner } from '../policy/ownership';
import { distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { isBacklineKind } from '../policy/v6/backline';
import { medicalEscapeRoadAllows } from './medical-task-safety';
import { mountedEscape, THINK_TICKS } from './mounted-micro';
import { recoveryArrivalFilter } from './recovery-arrival';
import { armedFoes } from './safe-land-route';
import { threatLandDisks } from './threat-roads';
import { groundScreenBodies, groundScreenGoal } from './ground-screen-goal';

/** Admit this backline owner's chosen moves against fixed fire on their actual
 * native roads. A moving screen does not make an enemy tower stop shooting.
 * Unchanged roads keep their original commands; a rejected road gets only one
 * short action toward the same preference, reconsidered on the next think.
 * This does not take ownership of absent orders or certify future crowd motion. */
export function casterScreenOutsideFixedFire(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext,
  commands: GameCommand[], unavailable: ReadonlySet<string> = new Set()): GameCommand[] {
  const fixed = snapshot.buildings.filter(building => building.hp > 0 && building.complete && building.attackDamage > 0
    && isEnemyOwner(snapshot, owner, building.owner, options));
  if (!fixed.length || !commands.some(command => command.type === 'move' && !command.queued)) return commands;
  const byId = new Map(snapshot.units.filter(unit => unit.owner === owner).map(unit => [unit.id, unit]));
  const ferryCrew = new Set(Object.values(options.memory.naval?.ferries ?? {}).flatMap(ferry => ferry.crewIds));
  let foes: ReturnType<typeof armedFoes> | undefined, changed = false;
  const result = commands.flatMap((command): GameCommand[] => {
    if (command.type !== 'move' || command.queued) return [command];
    const replacements = command.unitIds.map(id => {
      const caster = byId.get(id);
      if (!caster || !isBacklineKind(caster) || caster.deck || caster.order.type === 'board'
        || caster.order.type === 'boardShip' || caster.order.type === 'enterCabin' || caster.orderQueue?.length
        || unitMover(caster.kind) !== 'land' || unavailable.has(id) || ferryCrew.has(id)) return undefined;
      const disks = threatLandDisks(snapshot, caster, fixed);
      const road = groundSteeringRoute(snapshot.map, caster, command);
      if (disks.every(disk => distance(caster, disk) > disk.radius) && routeClearsDisks(road, disks)) return undefined;
      foes ??= armedFoes(snapshot, owner, options).filter(foe => 'order' in foe || foe.complete);
      const roadAllows = medicalEscapeRoadAllows(snapshot, caster, foes);
      // A nearby mobile attacker must not grant permission to enter a tower's
      // previously clear coverage. Preserve each fixed source's own margin.
      const fixedRoads = fixed.map(tower => medicalEscapeRoadAllows(snapshot, caster, [tower]));
      const bodies = groundScreenBodies(snapshot, caster);
      const arrivalAllows = recoveryArrivalFilter(snapshot, caster, THINK_TICKS);
      const escape = mountedEscape(snapshot, caster, foes, 0, command, true,
        point => {
          const ground = groundScreenGoal(snapshot, caster, point, false);
          if (!ground || ground.x !== point.x || ground.y !== point.y) return false;
          const approach = groundSteeringRoute(snapshot.map, caster, point);
          if (distance(approach.at(-1)!, point) > MOVE_ORDER_ARRIVAL_RANGE
            || approach.slice(1).some((end, index) => {
              const step = constrainGroundShipStep(snapshot.map, caster, approach[index]!, end, snapshot.units);
              return !capsuleClearsBodies(approach[index]!, end, caster.radius, bodies)
                || step.x !== end.x || step.y !== end.y;
            })) return false;
          return fixedRoads.every(allows => allows(point)) && roadAllows(point) && arrivalAllows(point);
        });
      changed = true;
      // A completed short move would idle and can immediately pursue again.
      // Hold only when the bounded escape has no usable movement to publish.
      return escape.type === 'move' && distance(caster, escape) <= MOVE_ORDER_ARRIVAL_RANGE
        ? { type: 'holdPosition' as const, unitIds: [id] } : escape;
    });
    if (replacements.every(replacement => replacement === undefined)) return [command];
    return command.unitIds.map((id, index) => replacements[index] ?? { ...command, unitIds: [id] });
  });
  return changed ? result : commands;
}
