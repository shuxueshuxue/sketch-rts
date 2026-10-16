import { ABILITY_DEFS, UNIT_DEFS } from '../../shared/catalog';
import { followStopDistance } from '../../shared/follow-distance';
import { canReceiveHealing } from '../../shared/healing';
import { MOVE_ORDER_ARRIVAL_RANGE } from '../../shared/movement-rules';
import { sameGround, walkingDistance } from '../../shared/terrain';
import { isStunned } from '../../shared/unit-abilities';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';

/** Only a previously published medical task can outlive its critical entry.
 * Actual order/arrival reconcile the task; ordinary follow/move orders do not
 * establish a medical assignment and no duration extends a completed task. */
export function continuingPatientRendezvous(snapshot: GameSnapshot, owner: PlayerId, landed: Unit[], options: AiPolicyContext) {
  const tasks = options.memory.naval?.medicalRendezvous, active: { patient: Unit; healer: Unit; task: NonNullable<NonNullable<AiPolicyContext['memory']['naval']>['medicalRendezvous']>[string] }[] = [];
  if (!tasks) return active;
  for (const [id, task] of Object.entries(tasks)) {
    const patient = landed.find(unit => unit.id === id), healer = landed.find(unit => unit.id === task.healerId);
    const order = patient?.order;
    const valid = patient && healer && patient.owner === owner && healer.owner === owner && patient.hp > 0 && patient.hp < patient.maxHp
      && patient.expiresTick === undefined && !patient.deck && !healer.deck && healer.hp > 0 && healer.order.type !== 'board'
      && !patient.orderQueue?.length && !isStunned(healer) && canReceiveHealing(patient, snapshot)
      && UNIT_DEFS[healer.kind].abilities.some(ability => ABILITY_DEFS[ability].behavior === 'heal')
      && sameGround(snapshot.map, patient, healer) && walkingDistance(snapshot.map, patient, healer, 'land') !== undefined;
    const unfinished = valid && (task.order.type === 'move'
      ? order?.type === 'move' && order.x === task.order.x && order.y === task.order.y && order.avoidCombat === task.order.avoidCombat
        && distance(patient, order) > MOVE_ORDER_ARRIVAL_RANGE
      : order?.type === 'follow' && order.targetId === task.order.targetId && task.order.targetId === healer.id
        && distance(patient, healer) > followStopDistance(patient, healer));
    if (unfinished) active.push({ patient, healer, task }); else delete tasks[id];
  }
  if (!Object.keys(tasks).length) delete options.memory.naval!.medicalRendezvous;
  return active;
}

/** Record the patient's final published order, never a conceptual assignment
 * or a rendezvous displaced by a later boarding/transport task. Native order
 * agreement is checked again next think, including public-command rejection. */
export function rememberPatientRendezvous(options: AiPolicyContext, pairs: readonly { patient: Unit; healer: Unit }[],
  retreat: readonly GameCommand[], published: readonly GameCommand[], continuing: ReturnType<typeof continuingPatientRendezvous> = []) {
  const last = new Map<string, GameCommand>();
  for (const command of published) {
    if ('unitIds' in command) for (const id of command.unitIds) last.set(id, command);
    else if ('unitId' in command) last.set(command.unitId, command);
  }
  const tasks: NonNullable<NonNullable<AiPolicyContext['memory']['naval']>['medicalRendezvous']> = {};
  // A completed spell does not create another recovery assignment. Let the
  // already accepted native order finish without reissuing or changing it.
  for (const { patient, task } of continuing) if (!last.has(patient.id)) tasks[patient.id] = task;
  for (const command of retreat) {
    if (command.type !== 'move' && command.type !== 'follow') continue;
    for (const id of command.unitIds) {
      const pair = pairs.find(({ patient }) => patient.id === id);
      if (!pair || last.get(id) !== command) continue;
      tasks[id] = { healerId: pair.healer.id, order: command.type === 'move'
        ? { type: 'move', x: command.x, y: command.y, ...(command.avoidCombat ? { avoidCombat: true } : {}) }
        : { type: 'follow', targetId: command.targetId } };
    }
  }
  if (Object.keys(tasks).length) (options.memory.naval ??= {}).medicalRendezvous = tasks;
  else if (options.memory.naval) delete options.memory.naval.medicalRendezvous;
}
