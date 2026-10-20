import { unitMover } from '../../shared/catalog';
import { sameGround } from '../../shared/terrain';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyMemory, AiPolicyUnitClaim } from '../memory';
import { deathTaskIndex } from '../death-ledger-context';
import { clearUnitClaim, isDefenseTaskClaim, recordUnitTaskClaim } from '../policy/claims';
import { readV6Intel } from '../policy/v6/intel';
import type { AiCommandEntry, AiPolicyContext } from '../policy/types';
import { creepForce, forceFor } from '../policy/v7/creep';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import { neutralCampPointContacts } from '../situation/neutral-camp-contact';
import { planCampTravel } from './camp-travel';
import { threatRoadCommands } from './threat-roads';
import { neutralCampObjectiveBlockers } from '../situation/neutral-camp-objectives';
import { campObjectivePoints } from './camp-objective-points';
import { workerExposure } from '../situation/worker-exposure';

type Point = { x: number; y: number };
type Transit = NonNullable<AiPolicyUnitClaim['campTravel']>;
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const actors = (command: GameCommand) => 'unitIds' in command ? command.unitIds : 'unitId' in command ? [command.unitId] : [];
const key = (command: GameCommand) => JSON.stringify('unitIds' in command ? { ...command, unitIds: [], queued: false } : 'unitId' in command ? { ...command, unitId: '' } : command);
const aliveLand = (unit: Unit, owner: PlayerId) => unit.owner === owner && unit.hp > 0 && !unit.deck && !unit.garrison && unitMover(unit.kind) === 'land';

/** Capture only retained task data; normal scripts may legitimately transfer a unit during this think. */
export function campNavigationContinuations(memory: AiPolicyMemory) {
  return new Map(Object.entries(memory.unitClaims).flatMap(([id, claim]) => claim.campTravel ? [[id, claim.campTravel] as const] : []));
}

function commandGoal(snapshot: GameSnapshot, unit: Unit, command: GameCommand): Point | undefined {
  if (command.type === 'move' || command.type === 'attackMove' || command.type === 'build') return command;
  if (command.type === 'holdPosition') return unit;
  if (command.type === 'board') return snapshot.units.find(other => other.id === command.transportId);
  if (command.type === 'repair') return snapshot.buildings.find(other => other.id === command.buildingId);
  if (command.type === 'repairUnit' || command.type === 'repairShip') return snapshot.units.find(other => other.id === command.targetId);
  if (command.type === 'mine') return snapshot.resources.find(other => other.id === command.resourceId);
  return undefined;
}
function solo(command: GameCommand, id: string): GameCommand {
  return 'unitIds' in command ? { ...command, unitIds: [id] } : command;
}
function ongoing(unit: Unit, transit: Transit) {
  // Native movement spends one tick idle between dequeuing legs. A queued final
  // leg is still in flight during that tick, or while attack-move is fighting.
  return [unit.order, ...(unit.orderQueue ?? [])].some(order => (order.type === 'move' || order.type === 'attackMove') && gap(order, transit.stop) < 30);
}

/** Shared execution boundary for land travel and stations, regardless of executor.
 * Every admitted detour is issued as native queued waypoints. The original action
 * remains a continuation; an impassable camp creates an explicit force prerequisite.
 * This runs on the runner's accepted entries, so rejected intent never binds a unit.
 */
export function routeCampNavigation(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, entries: readonly AiCommandEntry[], previous: ReadonlyMap<string, Transit>, stationRanges: ReadonlyMap<string, number> = new Map()): AiCommandEntry[] {
  previous = new Map([...previous, ...campNavigationContinuations(options.memory)]);
  const facts = neutralCampExposure(snapshot);
  if (!facts.camps.length && !previous.size) return [...entries];
  const byId = new Map(snapshot.units.map(unit => [unit.id, unit])), input = [...entries];
  const targets = campObjectivePoints(snapshot, owner, options, entries, stationRanges);
  const safetyPatient = snapshot.units.find(unit => unit.owner === owner && unit.kind === 'worker');
  const blockingCamps = safetyPatient ? neutralCampObjectiveBlockers(facts, targets,
    (guard, point) => workerExposure(snapshot, safetyPatient, point, { foes: [guard] }).length > 0) : new Map();
  const commanded = new Set(input.flatMap(entry => actors(entry.command)));
  // Resume non-queueable construction only after the actual admitted walk arrives.
  // Clearing continuations are retried when their explicit members are gone.
  for (const [id, transit] of previous) {
    const unit = byId.get(id);
    if (!unit || !aliveLand(unit, owner) || commanded.has(id)) continue;
    const blocked = transit.clearingIds?.some(member => byId.get(member)?.hp! > 0);
    const deferred = transit.command.type === 'build' || transit.command.type === 'holdPosition';
    if (!blocked && !transit.clearingIds && !deferred && !ongoing(unit, transit) && gap(unit, transit.stop) <= 30) {
      const claim = options.memory.unitClaims[id];
      if (claim?.kind === 'campTravel') clearUnitClaim(options.memory, id); else if (claim) delete claim.campTravel;
      continue;
    }
    // An active clearing child is executed by the clearing action, which owns
    // its actual assembly and fight. Navigation resumes only after it finishes.
    if (!blocked && !ongoing(unit, transit) && (deferred || transit.clearingIds))
      input.push({ scriptId: transit.scriptId, command: solo(transit.command, id), ...(transit.navigation ? { navigation: transit.navigation } : {}) });
  }
  const scheduled = new Set(input.flatMap(entry => actors(entry.command)));
  const tasks = deathTaskIndex(snapshot, owner, options.memory);
  const exemptions = (id: string) => new Set((tasks.byUnit.get(id) ?? [])
    .filter(task => task.clearing && task.stage !== 'gather').flatMap(task => task.clearingTargetIds ?? []));
  // A stationary automatic acquisition is still a station choice. Do not rewrite
  // an explicit clear or an ongoing fight against an opposing player.
  for (const unit of snapshot.units) {
    if (!aliveLand(unit, owner) || scheduled.has(unit.id) || exemptions(unit.id).size) continue;
    const auto = unit.order.type === 'idle' || unit.order.type === 'hold'
      || unit.order.type === 'attack' && unit.order.leashX !== undefined && byId.get(unit.order.targetId)?.owner === 'neutral';
    if (!auto) continue;
    const contacts = neutralCampPointContacts(snapshot, unit, unit, { facts, arrivalMode: unit.order.type === 'hold' ? 'hold' : 'idle' });
    if (!contacts.length) continue;
    const cover = snapshot.units.filter(friend => aliveLand(friend, owner) && friend.kind !== 'worker' && friend.attackDamage > 0
      && friend.hp >= friend.maxHp * .6 && gap(friend, unit) <= 300
      && ['idle', 'hold', 'attack', 'attackMove'].includes(friend.order.type)
      && !(friend.order.type === 'attack' && byId.get(friend.order.targetId)?.owner !== 'neutral'));
    // An assembled force can take an incidental camp in place. Evacuating each
    // of its idle members independently would dismantle a valid attack assembly.
    if (contacts.every(contact => creepForce(cover, contact.camp.camp) >= forceFor(contact.camp.camp))) continue;
    input.push({ scriptId: 'campNavigation', command: { type: 'move', unitIds: [unit.id], x: unit.x, y: unit.y } });
  }
  const output: AiCommandEntry[] = [];
  const authored = new Map<string, Set<GameCommand>>();
  const childExecution = (id: string, entry: AiCommandEntry) => {
    const execution = options.memory.unitClaims[id]?.campTravel?.execution;
    return execution?.scriptId === entry.scriptId && key(execution.command) === key(entry.command);
  };
  for (const entry of input) {
    const command = entry.command, ids = actors(command);
    if (!['move', 'attackMove', 'build', 'board', 'mine', 'repair', 'repairUnit', 'repairShip', 'holdPosition'].includes(command.type)) {
      for (const id of ids) if (childExecution(id, entry)) authored.set(id, new Set([command]));
      output.push(entry); continue;
    }
    const begin = output.length; let rewritten = false;
    if (command.type === 'move' && command.avoidCombat || 'queued' in command && command.queued || !ids.length) { output.push(entry); continue; }
    const linked = [...previous].filter(([, transit]) => transit.scriptId === entry.scriptId && key(transit.command) === key(command)
      || transit.clearingIds?.some(id => ids.some(actor => previous.get(actor)?.clearingIds?.includes(id)))).map(([id]) => id);
    const goal = ids[0] && byId.get(ids[0]) ? commandGoal(snapshot, byId.get(ids[0])!, command) : undefined;
    const alreadyCommitted = goal ? snapshot.units.filter(friend => aliveLand(friend, owner) && friend.kind !== 'worker'
      && ((friend.order.type === 'move' || friend.order.type === 'attackMove') && gap(friend.order, goal) < Math.max(30, stationRanges.get(entry.scriptId) ?? 0)
        || ['idle', 'hold'].includes(friend.order.type) && friend.arrivedAt && gap(friend.arrivedAt, goal) < 30 && gap(friend, goal) < 240)) : [];
    const party = [...new Map([...ids, ...linked].map(id => byId.get(id)).filter((unit): unit is Unit => !!unit && aliveLand(unit, owner))
      .concat(alreadyCommitted).map(unit => [unit.id, unit])).values()];
    for (const id of ids) {
      const unit = byId.get(id), destination = unit && commandGoal(snapshot, unit, command);
      if (!unit || !aliveLand(unit, owner) || !destination || !sameGround(snapshot.map, unit, destination)) {
        if (ids.length === 1) output.push(entry); else output.push({ ...entry, command: solo(command, id) });
        continue;
      }
      const old = previous.get(id), ownCommand = solo(command, id);
      if (isDefenseTaskClaim(options.memory.unitClaims[id]) && readV6Intel(snapshot, owner, options).intrusion) {
        output.push({ ...entry, command: ownCommand }); continue;
      }
      if (childExecution(id, entry)) {
        output.push({ ...entry, command: ownCommand }); authored.set(id, new Set([ownCommand])); rewritten = true; continue;
      }
      // Moving escorts emit successive waypoints for one parent. Finish the
      // admitted native road before following the parent's newer waypoint;
      // emergency/local orders and a changed task still replace it normally.
      if (old?.navigation?.parentMethodId && entry.navigation?.parentMethodId === old.navigation.parentMethodId
        && !entry.navigation.station && !old.clearingIds && entry.scriptId === old.scriptId
        && old.command.type === command.type && ongoing(unit, old)) {
        const claim = options.memory.unitClaims[id]; if (claim) claim.campTravel = old;
        rewritten = true; continue;
      }
      if (old && entry.scriptId === old.scriptId && key(old.command) === key(command) && ongoing(unit, old)) {
        const claim = options.memory.unitClaims[id]; if (claim) claim.campTravel = old;
        rewritten = true; continue;
      }
      const sourceGoal = entry.scriptId === 'campNavigation' ? old?.command ?? ownCommand : ownCommand;
      const parentId = entry.navigation?.parentMethodId ?? `${entry.scriptId}:${key(sourceGoal)}`;
      const stationRadius = entry.navigation?.arrivalRange ?? stationRanges.get(entry.scriptId) ?? 0;
      const arrivalMode = command.type === 'holdPosition' ? 'hold' : command.type === 'attackMove' ? 'attackMove' : 'idle';
      const exempt = exemptions(id);
      // An attack-move aimed at a live guard is an explicit engagement, just as
      // an attack by targetId is. A move/hold staging near it is not.
      if (command.type === 'attackMove') for (const camp of facts.camps)
        if (camp.members.some(member => gap(member.point, command) <= 1)) for (const member of camp.memberIds) exempt.add(member);
      const plan = planCampTravel(snapshot, unit, destination, { parentId, party, facts, exemptMemberIds: exempt, blockingCamps,
        waypoint: entry.navigation?.station === false,
        arrivalRange: entry.scriptId === 'campNavigation' && command.type === 'move' && gap(unit, command) < 1 ? 160 : command.type === 'holdPosition' ? stationRadius
          : command.type === 'move' || command.type === 'attackMove' ? stationRadius : 0,
        movingMode: command.type === 'attackMove' ? 'attackMove' : 'move', arrivalMode });
      if (plan.kind === 'direct' || plan.kind === 'exposed' || plan.kind === 'unreachable') {
        if (entry.scriptId === 'campNavigation') { rewritten = true; continue; }
        output.push({ ...entry, command: ownCommand });
        const retained = options.memory.unitClaims[id];
        if (retained?.kind === 'campTravel') clearUnitClaim(options.memory, id);
        else if (retained) delete retained.campTravel;
        if (ownCommand.type === 'build') recordUnitTaskClaim(snapshot, options.memory, id,
          { kind: 'build', targetId: `build:${ownCommand.buildingKind}:${Math.round(ownCommand.x)}:${Math.round(ownCommand.y)}`, x: ownCommand.x, y: ownCommand.y });
        continue;
      }
      const transit: Transit = { scriptId: entry.scriptId, command: sourceGoal, stop: { x: plan.goal.x, y: plan.goal.y }, sinceTick: old?.sinceTick ?? snapshot.tick,
        ...(entry.navigation ? { navigation: entry.navigation } : {}),
        delayGold: plan.delayGold, exposureGold: plan.exposureGold,
        ...(plan.subgoal ? { subgoal: plan.subgoal, clearingIds: [...plan.contacts[0]!.camp.memberIds] } : {}) };
      let changed: GameCommand[];
      if (plan.kind === 'clear-camp') {
          const refuge = planCampTravel(snapshot, unit, unit, { parentId, party, facts, arrivalRange: 480, valueGoldPerTick: 0 });
          if (refuge.kind === 'clear-camp' || !refuge.road) changed = [{ type: 'holdPosition', unitIds: [id] }];
          else {
            transit.stop = { ...refuge.goal };
            changed = threatRoadCommands(unit, { ...refuge.road, points: refuge.road.points as [Point, ...Point[]] });
            if (!changed.length) changed = [{ type: 'holdPosition', unitIds: [id] }];
          }
      } else {
        changed = threatRoadCommands(unit, { ...plan.road!, points: plan.road!.points as [Point, ...Point[]] });
        if (command.type === 'attackMove') changed = changed.map(leg => leg.type === 'move'
          ? { type: 'attackMove', unitIds: leg.unitIds, x: leg.x, y: leg.y, queued: leg.queued ?? false } : leg);
        // A native queued hold captures today's position. Issue it after arrival
        // instead, so its guard point is the station we actually admitted.
        if (command.type !== 'build' && command.type !== 'holdPosition' && command.type !== 'move' && command.type !== 'attackMove') {
          changed.push({ ...ownCommand, queued: true } as GameCommand);
        }
      }
      if (!changed.length) { output.push({ ...entry, command: ownCommand }); continue; }
      rewritten = true;
      authored.set(id, new Set(changed));
      output.push(...changed.map(next => ({ scriptId: entry.scriptId, command: next })));
      const claim = options.memory.unitClaims[id];
      if (!claim) recordUnitTaskClaim(snapshot, options.memory, id, { kind: 'campTravel', targetId: parentId, x: destination.x, y: destination.y });
      if ((changed[0]?.type === 'attack' || changed[0]?.type === 'attackMove') && transit.subgoal) transit.subgoal = { ...transit.subgoal, status: 'active' };
      options.memory.unitClaims[id]!.campTravel = transit;
      options.memory.unitClaims[id]!.expiresTick = Math.max(options.memory.unitClaims[id]!.expiresTick, snapshot.tick + (plan.road?.ticks ?? 0) + 300);
    }
    if (!rewritten) output.splice(begin, output.length - begin, entry);
  }
  // Local recovery is allowed to override an earlier strategic command in the
  // same plan. Bind navigation only to the final effective order, never to an
  // earlier proposal which the actual command stream has already superseded.
  const lastOrder = new Map<string, GameCommand>();
  for (const { command } of output) {
    if ('queued' in command && command.queued) continue;
    if (!['move', 'attackMove', 'attack', 'holdPosition', 'stop', 'follow', 'build', 'board', 'mine', 'repair', 'repairUnit', 'repairShip', 'garrison', 'cast', 'pickupItem'].includes(command.type)) continue;
    for (const id of actors(command)) lastOrder.set(id, command);
  }
  for (const [id, command] of lastOrder) {
    const claim = options.memory.unitClaims[id];
    if (!claim?.campTravel || authored.get(id)?.has(command)) continue;
    if (claim.kind === 'campTravel') clearUnitClaim(options.memory, id); else delete claim.campTravel;
  }
  return output;
}
