import { unitMover } from '../../shared/catalog';
import { sameGround } from '../../shared/terrain';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyMemory, AiPolicyUnitClaim, LifeSavingInterruption } from '../memory';
import { changesUnitAction, endLifeSavingInterruption, interruptedBuildResource, interruptionEvent } from '../policy/life-saving-interruption';
import { deathTaskIndex } from '../death-ledger-context';
import { clearUnitClaim, isDefenseTaskClaim, recordUnitTaskClaim } from '../policy/claims';
import { readV6Intel } from '../policy/v6/intel';
import type { AiCommandEntry, AiPolicyContext } from '../policy/types';
import { creepForce, forceFor } from '../policy/v7/creep';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import { neutralCampPointContacts } from '../situation/neutral-camp-contact';
import { planCampTravel, workerLandDetour } from './camp-travel';
import { threatRoadCommands } from './threat-roads';
import { neutralCampObjectiveBlockers } from '../situation/neutral-camp-objectives';
import { campObjectivePoints } from './camp-objective-points';
import { workerExposure } from '../situation/worker-exposure';
import { armedFoes } from './safe-land-route';
import { withClearingProgress } from '../policy/unit-action';
import { issuedUnitRoad } from '../policy/unit-action';
import { workerClearanceStage } from './camp-worker-stage';

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
  if (options.memory.navigationEvents?.some(event => event.tick !== snapshot.tick)) options.memory.navigationEvents = [];
  previous = new Map([...previous, ...campNavigationContinuations(options.memory)]);
  const facts = neutralCampExposure(snapshot);
  if (!facts.camps.length && !previous.size && !Object.values(options.memory.unitClaims).some(claim => claim.interruption)) return [...entries];
  const byId = new Map(snapshot.units.map(unit => [unit.id, unit])), input = [...entries];
  const resumed = new Map<string, { plan: ReturnType<typeof planCampTravel>; state: LifeSavingInterruption }>();
  const staged = new Map<string, { state: LifeSavingInterruption; commands: GameCommand[] }>();
  const foes = armedFoes(snapshot, owner, options);
  for (let index = 0; index < input.length; index++) {
    const entry = input[index]!, escape = entry.command;
    if (escape.type !== 'move' || !escape.avoidCombat || escape.queued) continue;
    for (const id of escape.unitIds) {
      const unit = byId.get(id), retained = previous.get(id);
      if (!unit || unit.owner !== owner || unit.kind !== 'worker' || options.memory.unitClaims[id]?.interruption) continue;
      // The snapshot, not a remembered wish, must prove the parent is active.
      const action = unit.order.type === 'build' ? unit.order
        : retained?.command.type === 'build' && ongoing(unit, retained) ? retained.command : undefined;
      if (!action) continue;
      const parent: Extract<GameCommand, { type: 'build' }> = { type: 'build', unitId: id,
        buildingKind: action.buildingKind, x: action.x, y: action.y };
      const superseded = input.some((other, at) => {
        if (at === index || !actors(other.command).includes(id)) return false;
        if ('queued' in other.command && other.command.queued) return other.scriptId !== entry.scriptId;
        if (!['move', 'attackMove', 'attack', 'holdPosition', 'stop', 'follow', 'build', 'board', 'mine', 'repair', 'repairUnit', 'repairShip', 'garrison', 'cast', 'pickupItem'].includes(other.command.type)) return false;
        return at > index || key(other.command) !== key(parent);
      });
      if (superseded) continue;
      const exposure = workerExposure(snapshot, unit, unit, { foes });
      if (!exposure.length) continue;
      const resourceId = interruptedBuildResource(snapshot, parent);
      const state: LifeSavingInterruption = { phase: 'life-saving-interruption', parent,
        scriptId: retained?.scriptId ?? 'native-build', sinceTick: snapshot.tick, interruptedBy: entry.scriptId,
        threatIds: [...new Set(exposure.map(item => item.foe.id))], ...(resourceId ? { resourceId } : {}),
        binding: [parent, ...input.filter(other => other.scriptId === entry.scriptId && actors(other.command).includes(id)).map(other => solo(other.command, id))] };
      if (!options.memory.unitClaims[id]) recordUnitTaskClaim(snapshot, options.memory, id,
        { kind: 'build', targetId: `build:${parent.buildingKind}:${parent.x}:${parent.y}`, x: parent.x, y: parent.y });
      options.memory.unitClaims[id]!.interruption = state;
      delete options.memory.unitClaims[id]!.campTravel;
      previous = new Map([...previous].filter(([actor]) => actor !== id));
      interruptionEvent(snapshot, options.memory, id, state, 'avoidance-retain', 'actual-parent-interrupted');
    }
  }
  const targets = campObjectivePoints(snapshot, owner, options, entries, stationRanges);
  const safetyPatient = snapshot.units.find(unit => unit.owner === owner && unit.kind === 'worker');
  const blockers = (points: typeof targets) => safetyPatient ? neutralCampObjectiveBlockers(facts, points,
    (guard, point) => workerExposure(snapshot, safetyPatient, point, { foes: [guard] }).length > 0) : new Map();
  let blockingCamps = blockers(targets);
  const workerBlockingCamps = blockers(targets.filter(target => target.kind !== 'clearance'));
  const removeRescue = (id: string, source: string) => {
    for (let index = 0; index < input.length; index++) {
      const entry = input[index]!, command = entry.command;
      if (entry.scriptId === source && 'unitIds' in command && command.unitIds.includes(id))
        input[index] = { ...entry, command: { ...command, unitIds: command.unitIds.filter(actor => actor !== id) } };
    }
  };
  const advanceToStage = (unit: Unit, state: LifeSavingInterruption) => {
    const road = workerClearanceStage(snapshot, unit, options.memory, foes);
    if (!road) return;
    const goal = road.points.at(-1)!;
    if ([unit.order, ...(unit.orderQueue ?? [])].some(order => order.type === 'move' && gap(order, goal) < 30)
      && !workerExposure(snapshot, unit, issuedUnitRoad(snapshot, unit), { foes, allowDeparture: true }).length) return;
    const commands = threatRoadCommands(unit, { ...road, points: road.points as [Point, ...Point[]] });
    if (!commands.length) return;
    removeRescue(unit.id, state.interruptedBy);
    input.push(...commands.map(command => ({ scriptId: 'campNavigation', command })));
    staged.set(unit.id, { state, commands });
  };
  const retainClearing = (id: string, state: LifeSavingInterruption, alternative: NonNullable<ReturnType<typeof planCampTravel>['clearingAlternative']>) => {
    const claim = options.memory.unitClaims[id]!, camp = alternative.contacts[0]?.camp;
    if (!camp) return;
    const committed = Object.entries(options.memory.unitClaims)
      .flatMap(([actor, other]) => other.campTravel?.execution && !isDefenseTaskClaim(other) && byId.get(actor)?.hp! > 0 ? [other.campTravel] : [])
      .filter(travel => travel.clearingIds?.some(member => camp.memberIds.includes(member)))
      .sort((a, b) => (b.clearingSinceTick ?? -1) - (a.clearingSinceTick ?? -1))[0];
    if (claim.campTravel?.clearingIds?.join(',') !== camp.memberIds.join(',')) claim.campTravel = {
      scriptId: 'campNavigation', command: state.parent, stop: { x: claim.x, y: claim.y }, sinceTick: state.sinceTick,
      delayGold: alternative.delayGold, exposureGold: alternative.exposureGold,
      subgoal: alternative.subgoal, clearingIds: [...camp.memberIds] };
    if (committed?.clearingStage) claim.campTravel = withClearingProgress(claim.campTravel!, committed);
    else if (claim.campTravel) {
      delete claim.campTravel.clearingStage; delete claim.campTravel.clearingSinceTick;
      if (claim.campTravel.subgoal) claim.campTravel.subgoal = { ...claim.campTravel.subgoal, status: 'blocked' };
    }
    previous = new Map([...previous].filter(([actor]) => actor !== id));
  };
  for (const [id, claim] of Object.entries(options.memory.unitClaims)) {
    const state = claim.interruption, unit = byId.get(id);
    if (!state || !unit) continue;
    const rescue = input.filter(entry => entry.scriptId === state.interruptedBy && actors(entry.command).includes(id));
    if (input.some(entry => entry.scriptId !== state.interruptedBy && changesUnitAction(entry.command) && actors(entry.command).includes(id))) {
      endLifeSavingInterruption(snapshot, options.memory, id, 'accepted-new-order');
      previous = new Map([...previous].filter(([actor]) => actor !== id));
      continue;
    }
    if (!rescue.length && state.phase === 'resuming' && (unit.order.type === 'build' || claim.campTravel && ongoing(unit, claim.campTravel))) continue;
    const parentId = `${state.scriptId}:build:${id}:${state.parent.buildingKind}:${state.parent.x}:${state.parent.y}`;
    let plan = planCampTravel(snapshot, unit, state.parent, { parentId, facts, blockingCamps: workerBlockingCamps, workerFoes: foes });
    if (plan.kind === 'clear-camp' && plan.subgoal && plan.contacts[0]) {
      retainClearing(id, state, { contacts: plan.contacts, subgoal: plan.subgoal, delayGold: plan.delayGold, exposureGold: plan.exposureGold });
      advanceToStage(unit, state);
      continue;
    }
    if (!plan.road || !['direct', 'exposed', 'detour', 'relocate'].includes(plan.kind)) continue;
    if (workerExposure(snapshot, unit, plan.road.points, { foes, allowDeparture: true }).length) {
      const road = workerLandDetour(snapshot, unit, state.parent, foes);
      if (!road) {
        if (plan.clearingAlternative) retainClearing(id, state, plan.clearingAlternative);
        advanceToStage(unit, state);
        continue;
      }
      plan = { ...plan, kind: 'detour', road };
    }
    // Admission succeeds before removing an evacuation. A failed alternative
    // leaves the actual rescue and the parent's vacant assignment intact.
    removeRescue(id, state.interruptedBy);
    input.push({ scriptId: 'campNavigation', command: state.parent });
    resumed.set(id, { plan, state });
    delete claim.campTravel;
    previous = new Map([...previous].filter(([actor]) => actor !== id));
  }
  for (let index = input.length - 1; index >= 0; index--) {
    const command = input[index]!.command;
    if ('unitIds' in command && !command.unitIds.length) input.splice(index, 1);
  }
  if (resumed.size) blockingCamps = blockers(campObjectivePoints(snapshot, owner, options, input, stationRanges));
  const commanded = new Set(input.flatMap(entry => actors(entry.command)));
  // Resume non-queueable construction only after the actual admitted walk arrives.
  // Clearing continuations are retried when their explicit members are gone.
  for (const [id, transit] of previous) {
    const unit = byId.get(id);
    if (!unit || !aliveLand(unit, owner) || commanded.has(id) || options.memory.unitClaims[id]?.interruption) continue;
    const blocked = transit.clearingIds?.some(member => byId.get(member)?.hp! > 0);
    if (transit.incidentalClear && !blocked) {
      const claim = options.memory.unitClaims[id];
      if (claim?.kind === 'campTravel') clearUnitClaim(options.memory, id); else if (claim) delete claim.campTravel;
      continue;
    }
    if (transit.childOnly && !blocked) { clearUnitClaim(options.memory, id); continue; }
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
  const exemptions = (id: string) => {
    const march = options.memory.unitClaims[id]?.campTravel;
    return new Set((tasks.byUnit.get(id) ?? []).filter(task => task.clearing && task.stage !== 'gather'
      && !(march?.incidentalClear && task.id === march.subgoal?.id)).flatMap(task => task.clearingTargetIds ?? []));
  };
  // A stationary automatic acquisition is still a station choice. Do not rewrite
  // an explicit clear or an ongoing fight against an opposing player.
  for (const unit of snapshot.units) {
    if (!aliveLand(unit, owner) || scheduled.has(unit.id) || exemptions(unit.id).size) continue;
    const auto = unit.order.type === 'idle' || unit.order.type === 'hold';
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
  const finalRoots = new Map<string, AiCommandEntry>();
  for (const entry of input) if (changesUnitAction(entry.command) && entry.command.type !== 'cast'
    && !('queued' in entry.command && entry.command.queued)) for (const id of actors(entry.command)) finalRoots.set(id, entry);
  const authored = new Map([...staged].map(([id, item]) => [id, new Set(item.commands)]));
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
      && ((friend.order.type === 'move' || friend.order.type === 'attackMove') && gap(friend.order, goal) < Math.max(30, entry.navigation?.arrivalRange ?? stationRanges.get(entry.scriptId) ?? 0)
        || ['idle', 'hold'].includes(friend.order.type) && friend.arrivedAt && gap(friend.arrivedAt, goal) < 30 && gap(friend, goal) < 240)) : [];
    const party = [...new Map([...ids, ...linked].map(id => byId.get(id)).filter((unit): unit is Unit => !!unit && aliveLand(unit, owner))
      .concat(alreadyCommitted).map(unit => [unit.id, unit])).values()];
    for (const id of ids) {
      const unit = byId.get(id), destination = unit && commandGoal(snapshot, unit, command);
      if (finalRoots.has(id) && finalRoots.get(id) !== entry) {
        output.push({ ...entry, command: solo(command, id) }); continue;
      }
      if (!unit || !aliveLand(unit, owner) || !destination || !sameGround(snapshot.map, unit, destination)) {
        if (ids.length === 1) output.push(entry); else output.push({ ...entry, command: solo(command, id) });
        continue;
      }
      const old = previous.get(id), ownCommand = solo(command, id);
      if (entry.navigation?.purpose === 'defense'
        || isDefenseTaskClaim(options.memory.unitClaims[id]) && !resumed.has(id) && readV6Intel(snapshot, owner, options).intrusion) {
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
      const resumption = entry.scriptId === 'campNavigation' && command.type === 'build' ? resumed.get(id) : undefined;
      const sourceGoal = resumption ? ownCommand : entry.scriptId === 'campNavigation' ? old?.command ?? ownCommand : ownCommand;
      const parentId = entry.navigation?.parentMethodId ?? `${entry.scriptId}:${key(sourceGoal)}`;
      const stationRadius = entry.navigation?.arrivalRange ?? stationRanges.get(entry.scriptId) ?? 0;
      const arrivalMode = command.type === 'holdPosition' ? 'hold' : command.type === 'attackMove' ? 'attackMove' : 'idle';
      const exempt = exemptions(id);
      // An attack-move aimed at a live guard is an explicit engagement, just as
      // an attack by targetId is. A move/hold staging near it is not.
      if (command.type === 'attackMove') for (const camp of facts.camps)
        if (camp.members.some(member => gap(member.point, command) <= 1)) for (const member of camp.memberIds) exempt.add(member);
      const plan = resumption?.plan ?? planCampTravel(snapshot, unit, destination, { parentId, party, facts, exemptMemberIds: exempt,
        blockingCamps: unit.kind === 'worker' ? workerBlockingCamps : blockingCamps,
        workerFoes: foes,
        waypoint: entry.navigation?.station === false,
        arrivalRange: entry.scriptId === 'campNavigation' && command.type === 'move' && gap(unit, command) < 1 ? 160 : command.type === 'holdPosition' ? stationRadius
          : command.type === 'move' || command.type === 'attackMove' ? stationRadius : 0,
        movingMode: command.type === 'attackMove' ? 'attackMove' : 'move', arrivalMode });
      if (plan.kind === 'clear-on-route') {
        output.push({ ...entry, command: ownCommand }); authored.set(id, new Set([command, ownCommand]));
        if (!options.memory.unitClaims[id]) recordUnitTaskClaim(snapshot, options.memory, id,
          { kind: 'campTravel', targetId: parentId, x: destination.x, y: destination.y });
        options.memory.unitClaims[id]!.campTravel = { scriptId: entry.scriptId, command: ownCommand,
          stop: { x: destination.x, y: destination.y }, sinceTick: old?.sinceTick ?? snapshot.tick,
          incidentalClear: true, clearingStage: 'engage', clearingSinceTick: snapshot.tick,
          delayGold: plan.delayGold, exposureGold: plan.exposureGold, subgoal: plan.subgoal!,
          clearingIds: [...plan.contacts[0]!.camp.memberIds], execution: { scriptId: entry.scriptId, command: ownCommand },
          ...(entry.navigation ? { navigation: entry.navigation } : {}) };
        continue;
      }
      if (plan.kind === 'direct' || plan.kind === 'exposed' || plan.kind === 'unreachable') {
        if (entry.scriptId === 'campNavigation' && command.type === 'move' && gap(unit, command) < 1) { rewritten = true; continue; }
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
          const park: GameCommand = unit.kind === 'worker' ? { type: 'move', unitIds: [id], x: unit.x, y: unit.y, avoidCombat: true }
            : { type: 'holdPosition', unitIds: [id] };
          const refuge = planCampTravel(snapshot, unit, unit, { parentId, party, facts, arrivalRange: 480, valueGoldPerTick: 0, workerFoes: foes });
          if (refuge.kind === 'clear-camp' || !refuge.road) changed = [park];
          else {
            transit.stop = { ...refuge.goal };
            changed = threatRoadCommands(unit, { ...refuge.road, points: refuge.road.points as [Point, ...Point[]] });
            if (!changed.length) changed = [park];
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
      if (ownCommand.type === 'build') recordUnitTaskClaim(snapshot, options.memory, id,
        { kind: 'build', targetId: `build:${ownCommand.buildingKind}:${Math.round(ownCommand.x)}:${Math.round(ownCommand.y)}`, x: ownCommand.x, y: ownCommand.y });
      else if (!claim) recordUnitTaskClaim(snapshot, options.memory, id, { kind: 'campTravel', targetId: parentId, x: destination.x, y: destination.y });
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
  const lastExecutor = new Map<string, string>();
  for (const { command, scriptId } of output) {
    if ('queued' in command && command.queued) continue;
    if (!['move', 'attackMove', 'attack', 'holdPosition', 'stop', 'follow', 'build', 'board', 'mine', 'repair', 'repairUnit', 'repairShip', 'garrison', 'cast', 'pickupItem'].includes(command.type)) continue;
    for (const id of actors(command)) { lastOrder.set(id, command); lastExecutor.set(id, scriptId); }
  }
  for (const [id, command] of lastOrder) {
    const claim = options.memory.unitClaims[id];
    if (!claim?.campTravel || authored.get(id)?.has(command)) continue;
    if (claim.interruption && lastExecutor.get(id) === claim.interruption.interruptedBy) continue;
    if (claim.kind === 'campTravel') clearUnitClaim(options.memory, id); else delete claim.campTravel;
  }
  for (const [id, { state }] of resumed) {
    const final = lastOrder.get(id);
    if (!final || !authored.get(id)?.has(final) && key(final) !== key(state.parent)) continue;
    const waypointCount = output.filter(entry => entry.scriptId === 'campNavigation'
      && (entry.command.type === 'move' || entry.command.type === 'attackMove') && actors(entry.command).includes(id)).length;
    const bound = output.filter(entry => actors(entry.command).includes(id)).map(entry => solo(entry.command, id));
    const binding = bound;
    const changed = JSON.stringify(state.pendingBinding) !== JSON.stringify(binding);
    state.pendingBinding = binding; state.phase = 'resuming';
    options.memory.unitClaims[id]!.interruption = state;
    if (changed) interruptionEvent(snapshot, options.memory, id, state, 'avoidance-admit', 'same-role-safe-route', waypointCount);
  }
  for (const [id, { state, commands }] of staged) {
    if (!authored.get(id)?.has(lastOrder.get(id)!)) continue;
    const changed = JSON.stringify(state.pendingBinding) !== JSON.stringify(commands);
    state.pendingBinding = commands; state.phase = 'life-saving-interruption';
    options.memory.unitClaims[id]!.interruption = state;
    if (changed) interruptionEvent(snapshot, options.memory, id, state, 'avoidance-admit', 'safe-clearance-staging', commands.length);
  }
  for (const [id, claim] of Object.entries(options.memory.unitClaims)) if (claim.interruption && !resumed.has(id)) {
    const bound = output.filter(entry => entry.scriptId === claim.interruption!.interruptedBy && actors(entry.command).includes(id)).map(entry => solo(entry.command, id));
    if (bound.length) {
      claim.interruption.binding = [claim.interruption.parent, ...bound];
      claim.interruption.phase = 'life-saving-interruption'; delete claim.interruption.pendingBinding;
    }
  }
  return output;
}
