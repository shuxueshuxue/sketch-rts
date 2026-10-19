import { GOLD_MINE_RULES } from '../../shared/mining';
import { nearestByRoute } from '../../shared/route-selection';
import type { GameCommand, GameSnapshot, PlayerId } from '../../shared/types';
import { averagePoint, distance } from '../policy/spatial';
import type { AiCommandEntry, AiPolicyContext } from '../policy/types';
import type { AiPolicyMemory } from '../memory';
import { availableV6Army, V7_WOUNDED_SHARE } from '../policy/v6/general';
import { isBacklineKind } from '../policy/v6/backline';
import type { V6Intel } from '../policy/v6/intel';
import { isEnemyOwner } from '../policy/ownership';
import { coveredDefenseTarget } from './covered-defense';

export const MINING_RALLY_RADIUS = 240;
const proposals = new WeakMap<AiPolicyMemory, { tick: number; owner: PlayerId;
  assignment: NonNullable<ReturnType<typeof miningRallyAssignment>> }>();

export function miningRallyAssignment(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel) {
  const known = options.memory.miningDefense;
  const intrusion = intel.intrusion;
  const hall = known ? intel.ownHalls.find(hall => hall.id === known.hallId)
    : intrusion && nearestByRoute(snapshot.map, intel.ownHalls.filter(hall => hall.complete), intrusion.building, 'land');
  if (!hall || !known && (!intrusion || distance(intrusion.building, hall) > GOLD_MINE_RULES.baseRange
    || !snapshot.resources.some(mine => mine.amount > 0 && distance(mine, hall) <= GOLD_MINE_RULES.baseRange)
      && !snapshot.units.some(unit => unit.owner === owner && unit.kind === 'worker' && distance(unit, hall) <= GOLD_MINE_RULES.baseRange))) return undefined;
  const available = known ? snapshot.units.filter(unit => unit.owner === owner && known.unitIds.includes(unit.id) && !unit.deck)
    : availableV6Army(snapshot, options, intel).filter(unit => !isBacklineKind(unit) && unit.attackDamage > 0
      && unit.hp >= unit.maxHp * V7_WOUNDED_SHARE);
  if (available.length === 0) return undefined;
  const field = intrusion ? averagePoint(intrusion.attackers) : hall;
  const gap = distance(hall, field);
  const point = known?.point ?? { x: hall.x + (field.x - hall.x) * Math.min(1, 200 / Math.max(1, gap)),
    y: hall.y + (field.y - hall.y) * Math.min(1, 200 / Math.max(1, gap)) };
  const attackers = snapshot.units.filter(unit => unit.attackDamage > 0 && isEnemyOwner(snapshot, owner, unit.owner, options)
    && (distance(unit, hall) <= 1000 || known?.attackerIds.includes(unit.id) && distance(unit, hall) <= 1400));
  const gathered = available.every(unit => distance(unit, point) <= MINING_RALLY_RADIUS);
  if (known && gathered && attackers.length === 0) return undefined;
  return { hall, units: available, state: { hallId: hall.id, point,
    unitIds: available.map(unit => unit.id), attackerIds: [...new Set([...(known?.attackerIds ?? intrusion!.attackers.map(unit => unit.id)), ...attackers.map(unit => unit.id)])],
    phase: known?.phase === 'fight' || gathered ? 'fight' as const : 'gather' as const } };
}

export function planMiningRally(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel): GameCommand[] {
  const assignment = miningRallyAssignment(snapshot, owner, options, intel);
  if (!assignment) { delete options.memory.miningDefense; proposals.delete(options.memory); return []; }
  const { state, units } = assignment;
  const owns = (id: string) => options.memory.miningDefense?.unitIds.includes(id);
  proposals.set(options.memory, { tick: snapshot.tick, owner, assignment });
  if (state.phase !== 'gather') return options.memory.miningDefense ? []
    : [{ type: 'holdPosition', unitIds: units.map(unit => unit.id) }];
  const arriving = units.filter(unit => distance(unit, state.point) > MINING_RALLY_RADIUS
    && !['cast', 'charge'].includes(unit.order.type));
  const foes = snapshot.units.filter(unit => unit.attackDamage > 0 && !unit.deck
    && isEnemyOwner(snapshot, owner, unit.owner, options));
  const firing: GameCommand[] = [];
  const walking = arriving.filter(unit => {
    const target = unit.cooldown <= 0 && foes.filter(foe => distance(unit, foe) <= unit.attackRange + unit.radius + foe.radius)
      .sort((a, b) => distance(unit, a) - distance(unit, b))[0];
    if (!target) return !owns(unit.id) || !(unit.order.type === 'move' && distance(unit.order, state.point) < 40);
    if (!owns(unit.id) || unit.order.type !== 'attack' || unit.order.targetId !== target.id) firing.push({ type: 'attack', unitIds: [unit.id], targetId: target.id });
    return false;
  });
  const waiting = units.filter(unit => distance(unit, state.point) <= MINING_RALLY_RADIUS && (!owns(unit.id) || unit.order.type !== 'hold'));
  return [
    ...firing,
    ...(walking.length ? [{ type: 'move' as const, unitIds: walking.map(unit => unit.id), ...state.point, avoidCombat: true }] : []),
    ...(waiting.length ? [{ type: 'holdPosition' as const, unitIds: waiting.map(unit => unit.id) }] : []),
  ];
}

/** Confirm assignment only after claim and command-conflict filtering, from commands actually returned by the planner. */
export function recordMiningRallyCommands(snapshot: GameSnapshot, owner: PlayerId, memory: AiPolicyMemory, entries: readonly AiCommandEntry[]) {
  const proposal = proposals.get(memory);
  proposals.delete(memory);
  if (!proposal || proposal.tick !== snapshot.tick || proposal.owner !== owner) return;
  const assigned = new Set(entries.filter(entry => entry.scriptId === 'miningRally')
    .flatMap(entry => 'unitIds' in entry.command ? entry.command.unitIds : []));
  const strategic = new Set(['naval', 'mobileCare', 'frontRecovery', 'campRecovery', 'shopping', 'lootRecovery',
    'mercenaryControl', 'allySupport', 'v6Raid', 'v6Closeout', 'mountedField', 'mountedTasks']);
  const redirected = new Set(entries.filter(entry => entry.scriptId !== 'miningRally' && entry.scriptId !== 'v6General'
    && (proposal.assignment.state.phase === 'gather' || strategic.has(entry.scriptId)))
    .flatMap(entry => !(['move', 'attackMove', 'aim'].includes(entry.command.type) && 'x' in entry.command
      && distance(entry.command as { x: number; y: number }, proposal.assignment.state.point) <= MINING_RALLY_RADIUS)
      && ['move', 'attackMove', 'attack', 'holdPosition', 'follow', 'aim', 'board', 'garrison'].includes(entry.command.type)
      && 'unitIds' in entry.command ? entry.command.unitIds.filter(id => !(['frontRecovery', 'campRecovery'].includes(entry.scriptId)
        && entry.command.type === 'holdPosition' && snapshot.units.some(unit => unit.id === id
          && distance(unit, proposal.assignment.state.point) <= MINING_RALLY_RADIUS + 160))) : []));
  const confirmed = proposal.assignment.state.unitIds.filter(id => assigned.has(id)
    || memory.miningDefense?.unitIds.includes(id) && !redirected.has(id));
  if (confirmed.length === 0) { delete memory.miningDefense; return; }
  memory.miningDefense = { ...proposal.assignment.state, unitIds: confirmed };
  if (memory.miningDefense.phase === 'gather' && memory.v6) {
    delete memory.v6.creep;
    memory.v6.general = { mode: 'defend', target: memory.miningDefense.point };
  }
}

/** The defended hall stays fixed even while raiders cross the line between two mines. */
export function anchoredMiningDefense(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, intel: V6Intel) {
  const known = options.memory.miningDefense;
  if (!known) return undefined;
  const assignment = miningRallyAssignment(snapshot, owner, options, intel);
  if (!assignment) return undefined;
  const attackers = snapshot.units.filter(unit => assignment.state.attackerIds.includes(unit.id));
  if (attackers.length === 0) return undefined;
  const defended = coveredDefenseTarget(snapshot, { ...intel, ownHalls: [assignment.hall],
    intrusion: { building: assignment.hall, attackers, threat: intel.intrusion?.threat ?? 0 } });
  return defended && { ...defended, point: known.point };
}
