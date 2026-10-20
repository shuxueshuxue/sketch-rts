import { sameGround } from '../../shared/terrain';
import { unitMover } from '../../shared/catalog';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import { activeUnitClaim, clearUnitClaim, isDefenseTaskClaim, recordUnitTaskClaim } from '../policy/claims';
import { averagePoint, distance } from '../policy/spatial';
import type { AiScript, AiPolicyContext } from '../policy/types';
import type { AiPolicyUnitClaim } from '../memory';
import { continueV7Creep, creepForce, forceFor, V7_GATHERED_RANGE } from '../policy/v7/creep';
import { readV6IntelAt } from '../policy/v6/intel';
import { deathTaskIndex } from '../death-ledger-context';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import { bootstrapCampApproach } from './camp-geometry';
import { campClearanceTicks, planCampTravel } from './camp-travel';
import { threatRoadCommands } from './threat-roads';
import { withClearingProgress } from '../policy/unit-action';
import { navigationIntent, withNavigationIntent } from '../policy/navigation-intent';
import { isBacklineKind } from '../policy/v6/backline';

type Travel = NonNullable<AiPolicyUnitClaim['campTravel']>;
type Group = { travel: Travel; parents: Map<string, Travel>; members: Unit[]; recruits: Unit[]; commands: GameCommand[]; next: Travel | null };
const selections = new WeakMap<AiPolicyContext, Group[]>();
const actors = (command: GameCommand) => 'unitIds' in command ? command.unitIds : 'unitId' in command ? [command.unitId] : [];
const fighter = (unit: Unit) => unit.kind !== 'worker' && unit.attackDamage > 0 && !isBacklineKind(unit);

function plans(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext): Group[] {
  const groups = new Map<string, Group>(), facts = neutralCampExposure(snapshot);
  for (const unit of snapshot.units) {
    const claim = options.memory.unitClaims[unit.id], travel = claim?.campTravel;
    if (unit.owner !== owner || unit.hp <= 0 || !travel?.clearingIds?.length || travel.incidentalClear || isDefenseTaskClaim(claim) && !claim?.interruption) continue;
    const camp = facts.camps.find(camp => camp.memberIds.some(id => travel.clearingIds!.includes(id)));
    const key = camp?.memberIds.join(',') ?? travel.clearingIds.join(',');
    const group: Group = groups.get(key)
      ?? { travel, parents: new Map(), members: [], recruits: [], commands: [], next: travel };
    if ((travel.clearingSinceTick ?? -1) > (group.travel.clearingSinceTick ?? -1)) group.travel = travel;
    group.parents.set(unit.id, travel);
    group.members.push(unit); groups.set(key, group);
  }
  const tasks = deathTaskIndex(snapshot, owner, options.memory), borrowed = new Set([...groups.values()].flatMap(group => group.members.map(unit => unit.id)));
  // Rescue/rally scripts precede this action in the runner and own the units
  // they actually recall. An intrusion alone does not abandon every independent
  // clearing prerequisite elsewhere; unclaimed escorts can finish their work.
  for (const group of groups.values()) {
    if (group.members.every(unit => group.parents.get(unit.id)?.childOnly)) {
      group.commands = [{ type: 'stop', unitIds: group.members.map(unit => unit.id) }]; group.next = null; continue;
    }
    const camp = facts.camps.find(camp => camp.memberIds.some(id => group.travel.clearingIds!.includes(id)));
    if (!camp) { group.commands = [{ type: 'stop', unitIds: group.members.filter(unit => unit.kind !== 'worker').map(unit => unit.id) }]; group.next = null; continue; }
    const passing = snapshot.units.filter(unit => {
      const travel = options.memory.unitClaims[unit.id]?.campTravel, command = travel?.execution?.command;
      return unit.owner === owner && unit.hp > 0 && travel?.incidentalClear && command?.type === 'attackMove'
        && travel.clearingIds?.some(id => camp.memberIds.includes(id))
        && (unit.order.type === 'attackMove' && distance(unit.order, command) < 30
          || unit.order.type === 'attack' && camp.memberIds.includes(unit.order.targetId));
    });
    // This is a committed, observed method for the same effect. Do not pull
    // that host out of its march to run another gathering action over it.
    if (creepForce(passing, camp.camp) >= forceFor(camp.camp)) continue;
    const fighters = group.members.filter(fighter);
    const parentMines = new Set(group.members.flatMap(unit => {
      const claim = options.memory.unitClaims[unit.id]; return claim?.expansionMineId ?? claim?.interruption?.resourceId ?? [];
    }));
    const candidates = snapshot.units.filter(unit => {
      const claim = activeUnitClaim(snapshot, owner, unit, options), membership = options.memory.unitClaims[unit.id]?.expansionMineId;
      const sameParent = !!membership && parentMines.has(membership);
      return unit.owner === owner && fighter(unit) && !group.members.includes(unit)
        && !unit.deck && !unit.garrison && unitMover(unit.kind) === 'land' && unit.hp >= unit.maxHp * .75
        && sameGround(snapshot.map, unit, camp.camp.center) && !borrowed.has(unit.id) && !isDefenseTaskClaim(claim)
        && (sameParent || !claim && !tasks.byUnit.has(unit.id) && ['idle', 'hold'].includes(unit.order.type));
    }).sort((a, b) => distance(a, camp.camp.center) - distance(b, camp.camp.center));
    for (const unit of candidates) {
      if (creepForce(fighters, camp.camp) >= forceFor(camp.camp)) break;
      fighters.push(unit); group.recruits.push(unit);
    }
    if (!fighters.length) continue;
    const home = snapshot.buildings.find(building => building.owner === owner && building.kind === 'townHall'
      && sameGround(snapshot.map, building, camp.camp.center)) ?? fighters[0]!;
    const staging = group.travel.clearingStaging ?? (group.travel.clearingStage ? group.travel.stop
      : bootstrapCampApproach(snapshot, home, fighters, camp.camp, averagePoint(fighters), facts.camps.map(camp => camp.camp))?.staging);
    if (!staging) continue;
    // An unavailable method is a force demand, not ownership of every future
    // recruit one at a time. Admit a borrowed cohort only when it can arrive
    // and perform the clearing together; keep existing parent actors intact.
    if (campClearanceTicks(snapshot, fighters, camp.camp, staging) === null) {
      group.recruits = [];
      fighters.splice(0, fighters.length, ...group.members.filter(fighter));
      if (!fighters.length) continue;
    }
    for (const unit of group.recruits) borrowed.add(unit.id);
    const engaging = (unit: Unit) => unit.order.type === 'attack' && camp.memberIds.includes(unit.order.targetId)
      || unit.order.type === 'attackMove' && distance(unit.order, camp.camp.center) < 30;
    const ready = fighters.filter(unit => engaging(unit) || distance(unit, staging) <= V7_GATHERED_RANGE);
    const stage: 'engage' | 'gather' = ready.some(engaging) || creepForce(ready, camp.camp) >= forceFor(camp.camp) ? 'engage' : 'gather';
    const since = group.travel.clearingStage === stage ? group.travel.clearingSinceTick ?? snapshot.tick : snapshot.tick;
    const gathering: GameCommand[] = fighters.filter(unit => !ready.includes(unit)
      && !((unit.order.type === 'move' || unit.order.type === 'attackMove') && distance(unit.order, staging) < 30))
      .map(unit => ({ type: 'move', unitIds: [unit.id], x: staging.x, y: staging.y }));
    if (stage === 'gather') for (const unit of group.recruits.filter(unit => ready.includes(unit)))
      gathering.push({ type: 'holdPosition', unitIds: [unit.id] });
    let commands = gathering;
    const state = { ...(options.memory.v6 ?? {}), creep: { center: camp.camp.center, reach: camp.camp.reach, staging,
      stage, since, group: ready.map(unit => unit.id) } };
    const mission = { ...options, memory: { ...options.memory, v6: state } };
    const intel = readV6IntelAt(snapshot, owner, options, camp.camp.center);
    if (stage === 'engage') {
      const under = continueV7Creep(snapshot, owner, ready, facts.camps.map(camp => camp.camp), intel, mission);
      if (!under) {
        group.commands = [{ type: 'stop', unitIds: fighters.map(unit => unit.id) }]; group.next = null; continue;
      }
      commands = [...under.commands, ...gathering];
      for (const unit of group.recruits.filter(unit => ready.includes(unit))) if (!commands.some(command => actors(command).includes(unit.id)))
        commands.push({ type: 'attackMove', unitIds: [unit.id], x: camp.camp.center.x, y: camp.camp.center.y });
    }
    group.next = { ...group.travel, stop: { ...staging }, clearingStage: stage,
      clearingSinceTick: state.creep?.since ?? snapshot.tick, clearingStaging: staging,
      ...(group.travel.subgoal ? { subgoal: { ...group.travel.subgoal,
        status: stage === 'engage' ? 'active' : creepForce(fighters, camp.camp) < forceFor(camp.camp) ? 'blocked' : 'proposed' } } : {}) };
    group.commands = commands.flatMap(command => {
      if (command.type !== 'move' || command.avoidCombat) return [command];
      return command.unitIds.flatMap(id => {
        const unit = fighters.find(unit => unit.id === id);
        if (!unit) return [];
        const plan = planCampTravel(snapshot, unit, command, { parentId: group.travel.subgoal?.id ?? 'clear-camp:gather',
          party: fighters, facts, exemptMemberIds: new Set(camp.memberIds), movingMode: 'move', arrivalMode: 'idle' });
        if (plan.kind === 'direct' || plan.kind === 'exposed') return [{ ...command, unitIds: [id] }];
        return plan.kind === 'detour' || plan.kind === 'relocate'
          ? threatRoadCommands(unit, { ...plan.road!, points: plan.road!.points as [Unit, ...Unit[]] })
          : [];
      });
    });
    // The chosen camp is the intended engagement, not a worker exclusion zone.
    // If a gather leg needs another prerequisite, release the entire method
    // back to its parent instead of parking a partial group indefinitely.
    const unresolved = gathering.some(command => actors(command).some(id => !group.commands.some(issued => actors(issued).includes(id))));
    if (unresolved) {
      group.next = null;
      group.commands = [{ type: 'stop', unitIds: group.members.filter(fighter).map(unit => unit.id) }];
      // Recruits received no order from this unavailable method and stay free.
      group.recruits = [];
    }
  }
  return [...groups.values()].map(group => ({ ...group, commands: group.commands.map(command => withNavigationIntent(command,
    { arrivalRange: V7_GATHERED_RANGE, station: true, ...navigationIntent(command),
      parentMethodId: group.travel.subgoal?.id ?? `clear:${group.travel.clearingIds!.join(',')}` })) }));
}

/** The existing clearing action owns assembly, contested-camp rejection and
 * wounded recovery. Persistent membership stays in accepted unitClaims. */
export const campPrerequisite: AiScript = {
  id: 'campPrerequisite', phase: 'tactics', redirects: 'strategic', interruptibleBy: ['defense'],
  claimsUnits(snapshot, owner, options) {
    const groups = plans(snapshot, owner, options); selections.set(options, groups);
    return new Set(groups.flatMap(group => group.next ? [...group.members, ...group.recruits].filter(fighter).map(unit => unit.id)
      : group.commands.flatMap(actors)));
  },
  run: (snapshot, owner, options) => (selections.get(options) ?? plans(snapshot, owner, options)).flatMap(group => group.commands),
  afterCommands(snapshot, _owner, options, commands) {
    // Task progress is shared with the parent's vacant assignment, but units
    // only acquire membership below when one of their commands was accepted.
    for (const group of selections.get(options) ?? []) {
      const method = group.travel.subgoal?.id ?? `clear:${group.travel.clearingIds!.join(',')}`;
      if (!commands.some(command => navigationIntent(command)?.parentMethodId === method
        && actors(command).some(id => [...group.members, ...group.recruits].some(unit => unit.id === id)))) continue;
      for (const unit of group.members) {
        const claim = options.memory.unitClaims[unit.id], current = claim?.campTravel;
        if (!claim || !current) continue;
        if (group.next) claim.campTravel = withClearingProgress(current, group.next);
        else {
          delete current.clearingStage; delete current.clearingSinceTick;
          if (current.subgoal) current.subgoal = { ...current.subgoal, status: 'blocked' };
        }
      }
    }
    for (const group of selections.get(options) ?? []) for (const command of commands) {
      if (navigationIntent(command)?.parentMethodId !== (group.travel.subgoal?.id ?? `clear:${group.travel.clearingIds!.join(',')}`)) continue;
      for (const id of actors(command)) {
        if (![...group.members, ...group.recruits].some(unit => unit.id === id)) continue;
        if (!group.next) { clearUnitClaim(options.memory, id); continue; }
        if (!options.memory.unitClaims[id]) recordUnitTaskClaim(snapshot, options.memory, id,
          { kind: 'campTravel', targetId: group.travel.subgoal?.parentMethodId ?? 'clear-camp', x: group.next.stop.x, y: group.next.stop.y });
        const previous = options.memory.unitClaims[id]!.campTravel?.execution;
        const execution = 'queued' in command && command.queued && previous?.scriptId === 'campPrerequisite'
          ? previous : { scriptId: 'campPrerequisite', command };
        const parent = group.parents.get(id);
        const ownParent = parent && !parent.childOnly && actors(parent.command).includes(id) ? parent : undefined;
        options.memory.unitClaims[id]!.campTravel = { ...group.next,
          command: ownParent?.command ?? { type: 'holdPosition', unitIds: [id] },
          scriptId: ownParent?.scriptId ?? 'campPrerequisite', ...(ownParent ? {} : { childOnly: true }), execution };
      }
    }
  },
  afterPlan(snapshot, _owner, options) {
    for (const group of selections.get(options) ?? []) {
      if (!group.next || group.next.clearingStage !== 'engage') continue;
      const observed = group.members.some(unit => {
        const current = options.memory.unitClaims[unit.id]?.campTravel;
        return !!current?.execution && current.clearingIds?.some(id => group.next!.clearingIds!.includes(id))
          && (unit.order.type === 'attack' && group.next!.clearingIds!.includes(unit.order.targetId)
            || unit.order.type === 'attackMove' && group.next!.subgoal?.target.point && distance(unit.order, group.next!.subgoal.target.point) < 30);
      });
      if (!observed) continue;
      for (const unit of group.members) {
        const claim = options.memory.unitClaims[unit.id], current = claim?.campTravel;
        if (claim && current && current.clearingIds?.some(id => group.next!.clearingIds!.includes(id)))
          claim.campTravel = withClearingProgress(current, group.next);
      }
    }
  },
};
