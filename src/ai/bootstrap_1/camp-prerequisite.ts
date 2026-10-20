import { sameGround } from '../../shared/terrain';
import { unitMover } from '../../shared/catalog';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { activeUnitClaim, clearUnitClaim, isDefenseTaskClaim, recordUnitTaskClaim } from '../policy/claims';
import { averagePoint, distance } from '../policy/spatial';
import type { AiScript, AiPolicyContext } from '../policy/types';
import type { AiPolicyUnitClaim } from '../memory';
import { continueV7Creep, creepForce, forceFor } from '../policy/v7/creep';
import { readV6Intel, readV6IntelAt } from '../policy/v6/intel';
import { deathTaskIndex } from '../death-ledger-context';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import { bootstrapCampApproach } from './camp-geometry';
import { planCampTravel } from './camp-travel';
import { threatRoadCommands } from './threat-roads';

type Travel = NonNullable<AiPolicyUnitClaim['campTravel']>;
type Group = { travel: Travel; members: Unit[]; recruits: Unit[]; commands: GameCommand[]; next: Travel | null };
const selections = new WeakMap<AiPolicyContext, Group[]>();
const actors = (command: GameCommand) => 'unitIds' in command ? command.unitIds : 'unitId' in command ? [command.unitId] : [];

function plans(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): Group[] {
  const groups = new Map<string, Group>(), facts = neutralCampExposure(snapshot);
  for (const unit of snapshot.units) {
    const claim = options.memory.unitClaims[unit.id], travel = claim?.campTravel;
    if (unit.owner !== owner || unit.hp <= 0 || !travel?.clearingIds?.length || isDefenseTaskClaim(claim)) continue;
    const key = travel.clearingIds.join(','), group = groups.get(key)
      ?? { travel, members: [], recruits: [], commands: [], next: travel };
    group.members.push(unit); groups.set(key, group);
  }
  const tasks = deathTaskIndex(snapshot, owner, options.memory), borrowed = new Set<string>();
  if (readV6Intel(snapshot, owner, options).intrusion) {
    for (const group of groups.values()) {
      group.commands = [{ type: 'stop', unitIds: group.members.filter(unit => unit.kind !== 'worker').map(unit => unit.id) }];
      group.next = null;
    }
    return [...groups.values()];
  }
  for (const group of groups.values()) {
    const camp = facts.camps.find(camp => camp.memberIds.some(id => group.travel.clearingIds!.includes(id)));
    if (!camp) continue;
    const fighters = group.members.filter(unit => unit.kind !== 'worker' && unit.attackDamage > 0);
    const parentMines = new Set(group.members.flatMap(unit => options.memory.unitClaims[unit.id]?.expansionMineId ?? []));
    const candidates = snapshot.units.filter(unit => {
      const claim = activeUnitClaim(snapshot, owner, unit, options), membership = options.memory.unitClaims[unit.id]?.expansionMineId;
      const sameParent = !!membership && parentMines.has(membership);
      return unit.owner === owner && unit.kind !== 'worker' && unit.attackDamage > 0 && !group.members.includes(unit)
        && !unit.deck && !unit.garrison && unitMover(unit.kind) === 'land' && unit.hp >= unit.maxHp * .75
        && sameGround(snapshot.map, unit, camp.camp.center) && !borrowed.has(unit.id) && !isDefenseTaskClaim(claim)
        && (sameParent || !claim && !tasks.byUnit.has(unit.id) && ['idle', 'hold'].includes(unit.order.type));
    }).sort((a, b) => distance(a, camp.camp.center) - distance(b, camp.camp.center));
    for (const unit of candidates) {
      if (creepForce(fighters, camp.camp) >= forceFor(camp.camp)) break;
      fighters.push(unit); group.recruits.push(unit); borrowed.add(unit.id);
    }
    if (!fighters.length) continue;
    const home = snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall'
      && sameGround(snapshot.map, building, camp.camp.center)) ?? fighters[0]!;
    const staging = group.travel.clearingStage ? group.travel.stop
      : bootstrapCampApproach(snapshot, home, fighters, camp.camp, averagePoint(fighters), facts.camps.map(camp => camp.camp))?.staging;
    if (!staging) continue;
    const state = { ...(options.memory.v6 ?? {}), creep: { center: camp.camp.center, reach: camp.camp.reach, staging,
      stage: group.travel.clearingStage ?? 'gather' as const, since: group.travel.sinceTick, group: fighters.map(unit => unit.id) } };
    const mission = { ...options, memory: { ...options.memory, v6: state } };
    const intel = readV6IntelAt(snapshot, owner, options, camp.camp.center);
    const under = continueV7Creep(snapshot, owner, fighters, facts.camps.map(camp => camp.camp), intel, mission);
    if (!under) {
      group.commands = [{ type: 'stop', unitIds: fighters.map(unit => unit.id) }];
      group.next = null;
      continue;
    }
    const stage = state.creep?.stage ?? 'gather';
    group.next = { ...group.travel, stop: { ...staging }, clearingStage: stage,
      ...(group.travel.subgoal ? { subgoal: { ...group.travel.subgoal,
        status: stage === 'engage' ? 'active' : creepForce(fighters, camp.camp) < forceFor(camp.camp) ? 'blocked' : 'proposed' } } : {}) };
    group.commands = under.commands.flatMap(command => {
      if (command.type !== 'move' || command.avoidCombat) return [command];
      return command.unitIds.flatMap(id => {
        const unit = fighters.find(unit => unit.id === id);
        if (!unit) return [];
        const plan = planCampTravel(snapshot, unit, command, { parentId: group.travel.subgoal?.id ?? 'clear-camp:gather',
          party: fighters, facts, movingMode: 'move', arrivalMode: 'idle' });
        if (plan.kind === 'direct' || plan.kind === 'exposed') return [{ ...command, unitIds: [id] }];
        return plan.kind === 'detour' || plan.kind === 'relocate'
          ? threatRoadCommands(unit, { ...plan.road!, points: plan.road!.points as [Unit, ...Unit[]] })
          : [{ type: 'holdPosition' as const, unitIds: [id] }];
      });
    });
  }
  return [...groups.values()];
}

/** The existing clearing action owns assembly, contested-camp rejection and
 * wounded recovery. Persistent membership stays in accepted unitClaims. */
export const campPrerequisite: AiScript = {
  id: 'campPrerequisite', phase: 'tactics', redirects: 'strategic',
  claimsUnits(snapshot, owner, options) {
    const groups = plans(snapshot, owner, options); selections.set(options, groups);
    return new Set(groups.flatMap(group => group.next ? [...group.members, ...group.recruits].filter(unit => unit.kind !== 'worker').map(unit => unit.id)
      : group.commands.flatMap(actors)));
  },
  run: (snapshot, owner, options) => (selections.get(options) ?? plans(snapshot, owner, options)).flatMap(group => group.commands),
  afterPlan(snapshot, _owner, options, entries) {
    for (const group of selections.get(options) ?? []) for (const entry of entries) {
      if (entry.scriptId !== 'campPrerequisite') continue;
      for (const id of actors(entry.command)) {
        if (![...group.members, ...group.recruits].some(unit => unit.id === id)) continue;
        if (!group.next) { clearUnitClaim(options.memory, id); continue; }
        if (!options.memory.unitClaims[id]) recordUnitTaskClaim(snapshot, options.memory, id,
          { kind: 'campTravel', targetId: group.travel.subgoal?.parentMethodId ?? 'clear-camp', x: group.next.stop.x, y: group.next.stop.y });
        const previous = options.memory.unitClaims[id]!.campTravel?.execution;
        const execution = 'queued' in entry.command && entry.command.queued && previous?.scriptId === entry.scriptId
          ? previous : { scriptId: entry.scriptId, command: entry.command };
        options.memory.unitClaims[id]!.campTravel = { ...group.next, execution };
      }
    }
  },
};
