import { resolveUnitDamage, unitAttackDamageProfile } from '../../shared/damage';
import { GOLD_MINE_RULES } from '../../shared/mining';
import { routeArrivals } from '../../shared/route-selection';
import { sameGround } from '../../shared/terrain';
import type { Building, GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyMemory } from '../memory';
import { activeUnitClaim, clearUnitClaim, recordUnitTaskClaim } from '../policy/claims';
import { distance } from '../policy/spatial';
import type { AiPolicyContext } from '../policy/types';
import { availableV6Army } from '../policy/v6/general';
import { isBacklineKind } from '../policy/v6/backline';
import type { V6Intel } from '../policy/v6/intel';
import { strengthOf } from '../policy/v6/strength';
import { expansionOwnsDefender, MINING_PURSUIT_RADIUS } from './mining-leash';

// A rider can circle just outside the pursuit boundary without ending the assignment.
export const HARASS_DEPARTURE_RADIUS = 1000;
const RETURN_RADIUS = 240;
type Task = NonNullable<AiPolicyMemory['harassDefense']>;
type Assignment = { hall: Building; target: Unit; crew: Unit[]; task: Task };
const proposals = new WeakMap<AiPolicyMemory, { tick: number; assignment: Assignment; returning: Set<string> }>();

export function mountedHarassment(snapshot: GameSnapshot, intel: V6Intel, attackers: readonly Unit[]) {
  // A genuine mounted army still triggers ordinary mine defense, regardless of its headcount.
  if (!attackers.length || attackers.some(unit => unit.kind !== 'horseArcher') || strengthOf(attackers) > intel.power * .3) return false;
  return intel.ownHalls.some(hall => snapshot.resources.some(mine => mine.amount > 0
    && distance(mine, hall) <= GOLD_MINE_RULES.baseRange)
    && attackers.every(unit => sameGround(snapshot.map, unit, hall) && distance(unit, hall) <= HARASS_DEPARTURE_RADIUS));
}

function knownAssignment(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel): Assignment | undefined {
  const task = options.memory.harassDefense;
  if (!task) return undefined;
  const hall = intel.ownHalls.find(hall => hall.id === task.hallId);
  const target = intel.enemies.flatMap(enemy => enemy.army).find(unit => unit.id === task.targetId && !unit.deck);
  if (!hall || !target || distance(target, hall) > HARASS_DEPARTURE_RADIUS || !sameGround(snapshot.map, target, hall)) return undefined;
  const crew = snapshot.units.filter(unit => {
    const claim = activeUnitClaim(snapshot, owner, unit, options);
    return claim?.kind === 'harassSquad' && claim.targetId === target.id && !unit.deck;
  });
  return { hall, target, crew, task };
}

/** An outranging shooter first; otherwise cavalry which can actually catch this live rider. */
export function harassSquadAssignment(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel): Assignment | undefined {
  if (options.memory.harassDefense) return knownAssignment(snapshot, owner, options, intel);
  const foes = intel.enemies.flatMap(enemy => enemy.army);
  const halls = intel.ownHalls.slice().sort((a, b) => Math.min(...foes.map(unit => distance(unit, a)))
    - Math.min(...foes.map(unit => distance(unit, b))));
  for (const hall of halls) {
    if (!snapshot.resources.some(mine => mine.amount > 0 && distance(mine, hall) <= GOLD_MINE_RULES.baseRange)) continue;
    const nearby = foes.filter(unit => !unit.deck && sameGround(snapshot.map, unit, hall)
      && distance(unit, hall) <= HARASS_DEPARTURE_RADIUS);
    if (!mountedHarassment(snapshot, intel, nearby)) continue;
    const target = nearby.slice().sort((a, b) => distance(a, hall) - distance(b, hall))[0]!;
    const pool = availableV6Army(snapshot, options, intel).filter(unit => {
      const claim = activeUnitClaim(snapshot, owner, unit, options);
      return !unit.deck && !unit.garrison && !isBacklineKind(unit) && unit.attackDamage > 0 && unit.hp >= unit.maxHp * .6
        && !['board', 'cast', 'charge'].includes(unit.order.type)
        && (!claim || claim.kind === 'mineGuard') && !expansionOwnsDefender(snapshot, owner, options, unit)
        && (unit.attackRange > target.attackRange || ['horseArcher', 'raider', 'knight'].includes(unit.kind) && unit.speed >= target.speed)
        && !(options.memory.v6?.general?.mode === 'attack' && options.memory.v6.general.group?.includes(unit.id));
    });
    const candidates = routeArrivals(snapshot.map, pool, hall, 'land').filter(({ unit, ticks }) =>
      ticks * unit.speed / 20 <= 1300 && (unit.expiresTick === undefined || unit.expiresTick > snapshot.tick + ticks))
      .sort((a, b) => Number(b.unit.attackRange > target.attackRange) - Number(a.unit.attackRange > target.attackRange) || a.ticks - b.ticks);
    const crew: Unit[] = [];
    let volley = 0;
    for (const { unit } of candidates) {
      crew.push(unit);
      volley += resolveUnitDamage(snapshot, target, unit.attackDamage, unitAttackDamageProfile(snapshot, unit)).damage;
      // A short exposure must deliver enough firepower in two volleys, with the ordinary field-strength margin.
      if (volley * 2 >= target.hp && strengthOf(crew) >= strengthOf(nearby) * 1.25) break;
    }
    if (!crew.length || volley * 2 < target.hp || strengthOf(crew) < strengthOf(nearby) * 1.25
      || strengthOf(crew) > intel.power * .55) continue;
    const gap = distance(hall, target), step = Math.min(1, 200 / Math.max(1, gap));
    return { hall, target, crew, task: { hallId: hall.id, targetId: target.id,
      point: { x: hall.x + (target.x - hall.x) * step, y: hall.y + (target.y - hall.y) * step } } };
  }
  return undefined;
}

/** Coverage reads only a squad whose commands have actually been accepted. */
export function harassSquadGuard(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel) {
  const assignment = knownAssignment(snapshot, owner, options, intel);
  if (!assignment) return undefined;
  return { hall: assignment.hall, crew: assignment.crew, attackers: [assignment.target] };
}

export function planHarassSquad(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel): GameCommand[] | undefined {
  const known = options.memory.harassDefense;
  if (known && !knownAssignment(snapshot, owner, options, intel)) {
    for (const [id, claim] of Object.entries(options.memory.unitClaims)) if (claim.kind === 'harassSquad' && claim.targetId === known.targetId) clearUnitClaim(options.memory, id);
    delete options.memory.harassDefense;
  }
  const assignment = harassSquadAssignment(snapshot, owner, options, intel);
  if (!assignment) { proposals.delete(options.memory); return undefined; }
  const returning = new Set<string>(), commands: GameCommand[] = [];
  for (const unit of assignment.crew) {
    // Medical micro can recover a critical original member; a replacement is never recruited.
    if (unit.hp < unit.maxHp * .35 || ['board', 'cast', 'charge'].includes(unit.order.type)) continue;
    const claim = activeUnitClaim(snapshot, owner, unit, options);
    const renew = !claim || claim.kind !== 'harassSquad' || claim.expiresTick - snapshot.tick <= 60;
    const goHome = distance(unit, assignment.hall) > MINING_PURSUIT_RADIUS
      || claim?.returning && distance(unit, assignment.task.point) > RETURN_RADIUS
      || distance(assignment.target, assignment.hall) > MINING_PURSUIT_RADIUS;
    if (goHome) {
      returning.add(unit.id);
      if (distance(unit, assignment.task.point) > 80) {
        if (renew || unit.order.type !== 'move' || !unit.order.avoidCombat || distance(unit.order, assignment.task.point) > 40) {
          commands.push({ type: 'move', unitIds: [unit.id], ...assignment.task.point, avoidCombat: true });
        }
      } else if (renew || unit.order.type !== 'hold') commands.push({ type: 'holdPosition', unitIds: [unit.id] });
    } else if (renew || unit.order.type !== 'attack' || unit.order.targetId !== assignment.target.id) {
      commands.push({ type: 'attack', unitIds: [unit.id], targetId: assignment.target.id });
    }
  }
  proposals.set(options.memory, { tick: snapshot.tick, assignment, returning });
  return commands;
}

export function recordHarassSquadCommands(snapshot: GameSnapshot, _owner: PlayerId, options: AiPolicyContext, commands: readonly GameCommand[]) {
  const proposal = proposals.get(options.memory); proposals.delete(options.memory);
  if (!proposal || proposal.tick !== snapshot.tick) return;
  const ids = new Set(proposal.assignment.crew.map(unit => unit.id));
  for (const command of commands) if ('unitIds' in command) for (const id of command.unitIds) if (ids.has(id)) {
    const { task } = proposal.assignment;
    options.memory.harassDefense = task;
    recordUnitTaskClaim(snapshot, options.memory, id, { kind: 'harassSquad', targetId: task.targetId,
      x: task.point.x, y: task.point.y, returning: proposal.returning.has(id) });
  }
}
