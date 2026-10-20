import { unitMover } from '../../shared/catalog';
import { sameGround } from '../../shared/terrain';
import type { GameCommand, GameSnapshot, PlayerId, Unit } from '../../shared/types';
import type { AiPolicyMemory, AiPolicyUnitClaim } from '../memory';
import { deathTaskIndex } from '../death-ledger-context';
import { isDefenseTaskClaim, recordUnitTaskClaim } from '../policy/claims';
import type { AiCommandEntry, AiPolicyContext } from '../policy/types';
import { creepForce, forceFor } from '../policy/v7/creep';
import { neutralCampExposure } from '../situation/neutral-camp-exposure';
import { neutralCampPointContacts } from '../situation/neutral-camp-contact';
import { planCampTravel } from './camp-travel';
import { threatRoadCommands } from './threat-roads';

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
  return (unit.order.type === 'move' || unit.order.type === 'attackMove')
    && ([unit.order, ...(unit.orderQueue ?? [])].some(order => (order.type === 'move' || order.type === 'attackMove') && gap(order, transit.stop) < 30));
}

/** Shared execution boundary for land travel and stations, regardless of executor.
 * Every admitted detour is issued as native queued waypoints. The original action
 * remains a continuation; an impassable camp creates an explicit force prerequisite.
 * This runs on the runner's accepted entries, so rejected intent never binds a unit.
 */
export function routeCampNavigation(snapshot: GameSnapshot, owner: PlayerId, options: AiPolicyContext, entries: readonly AiCommandEntry[], previous: ReadonlyMap<string, Transit>): AiCommandEntry[] {
  previous = new Map([...previous, ...campNavigationContinuations(options.memory)]);
  const facts = neutralCampExposure(snapshot);
  if (!facts.camps.length) return [...entries];
  const byId = new Map(snapshot.units.map(unit => [unit.id, unit])), input = [...entries];
  const commanded = new Set(input.flatMap(entry => actors(entry.command)));
  // Resume non-queueable construction only after the actual admitted walk arrives.
  // Clearing continuations are retried when their explicit members are gone.
  for (const [id, transit] of previous) {
    const unit = byId.get(id);
    if (!unit || !aliveLand(unit, owner) || commanded.has(id)) continue;
    const blocked = transit.clearingIds?.some(member => byId.get(member)?.hp! > 0);
    if (blocked && !ongoing(unit, transit)) input.push({ scriptId: transit.scriptId, command: solo(transit.command, id) });
    else if (!blocked && !ongoing(unit, transit) && (transit.command.type === 'build' || transit.clearingIds))
      input.push({ scriptId: transit.scriptId, command: solo(transit.command, id) });
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
    if (!auto || !neutralCampPointContacts(snapshot, unit, unit, { facts }).length) continue;
    input.push({ scriptId: 'campNavigation', command: { type: 'move', unitIds: [unit.id], x: unit.x, y: unit.y } });
  }
  const output: AiCommandEntry[] = [];
  for (const entry of input) {
    const command = entry.command, ids = actors(command);
    if (!['move', 'attackMove', 'build', 'board', 'mine', 'repair', 'repairUnit', 'repairShip', 'holdPosition'].includes(command.type)) {
      output.push(entry); continue;
    }
    const begin = output.length; let rewritten = false;
    if (command.type === 'move' && command.avoidCombat || 'queued' in command && command.queued || !ids.length) { output.push(entry); continue; }
    const linked = [...previous].filter(([, transit]) => transit.scriptId === entry.scriptId && key(transit.command) === key(command)
      || transit.clearingIds?.some(id => ids.some(actor => previous.get(actor)?.clearingIds?.includes(id)))).map(([id]) => id);
    const party = [...new Set([...ids, ...linked])].map(id => byId.get(id)).filter((unit): unit is Unit => !!unit && aliveLand(unit, owner));
    for (const id of ids) {
      const unit = byId.get(id), destination = unit && commandGoal(snapshot, unit, command);
      if (!unit || !aliveLand(unit, owner) || !destination || !sameGround(snapshot.map, unit, destination)) {
        if (ids.length === 1) output.push(entry); else output.push({ ...entry, command: solo(command, id) });
        continue;
      }
      const old = previous.get(id), ownCommand = solo(command, id);
      if (old && entry.scriptId === old.scriptId && key(old.command) === key(command) && ongoing(unit, old)) {
        const claim = options.memory.unitClaims[id]; if (claim) claim.campTravel = old;
        rewritten = true; continue;
      }
      const clearing = old?.clearingIds?.map(id => byId.get(id)).filter((unit): unit is Unit => !!unit && unit.hp > 0);
      if (old && old.scriptId === entry.scriptId && key(old.command) === key(command) && clearing?.length) {
        const camp = facts.camps.find(camp => camp.memberIds.includes(clearing[0]!.id));
        if (camp && unit.kind !== 'worker' && creepForce(party, camp.camp) >= forceFor(camp.camp)) {
          rewritten = true;
          output.push({ scriptId: entry.scriptId, command: { type: 'attack', unitIds: [id], targetId: clearing[0]!.id } });
          if (!isDefenseTaskClaim(options.memory.unitClaims[id])) recordUnitTaskClaim(snapshot, options.memory, id, { kind: 'creep', targetId: clearing[0]!.id, ...camp.camp.center });
          options.memory.unitClaims[id]!.campTravel = { ...old, ...(old.subgoal ? { subgoal: { ...old.subgoal, status: 'active' } } : {}) };
          continue;
        }
      }
      const sourceGoal = entry.scriptId === 'campNavigation' ? old?.command ?? ownCommand : ownCommand;
      const parentId = `${entry.scriptId}:${key(sourceGoal)}`;
      const arrivalMode = command.type === 'holdPosition' ? 'hold' : command.type === 'attackMove' ? 'attackMove' : 'idle';
      const exempt = exemptions(id);
      // An attack-move aimed at a live guard is an explicit engagement, just as
      // an attack by targetId is. A move/hold staging near it is not.
      if (command.type === 'attackMove') for (const camp of facts.camps)
        if (camp.members.some(member => gap(member.point, command) <= 1)) for (const member of camp.memberIds) exempt.add(member);
      const plan = planCampTravel(snapshot, unit, destination, { parentId, party, facts, exemptMemberIds: exempt,
        arrivalRange: command.type === 'holdPosition' || entry.scriptId === 'campNavigation' ? 160 : 0,
        movingMode: command.type === 'attackMove' ? 'attackMove' : 'move', arrivalMode });
      if (plan.kind === 'direct' || plan.kind === 'exposed' || plan.kind === 'unreachable') {
        output.push({ ...entry, command: ownCommand });
        if (old?.resumeClaim && old.scriptId === entry.scriptId && key(old.command) === key(command)) options.memory.unitClaims[id] = { ...old.resumeClaim };
        const retained = options.memory.unitClaims[id]; if (retained) delete retained.campTravel;
        if (ownCommand.type === 'build') recordUnitTaskClaim(snapshot, options.memory, id,
          { kind: 'build', targetId: `build:${ownCommand.buildingKind}:${Math.round(ownCommand.x)}:${Math.round(ownCommand.y)}`, x: ownCommand.x, y: ownCommand.y });
        continue;
      }
      const transit: Transit = { scriptId: entry.scriptId, command: sourceGoal, stop: { x: plan.goal.x, y: plan.goal.y }, sinceTick: old?.sinceTick ?? snapshot.tick,
        delayGold: plan.delayGold, exposureGold: plan.exposureGold,
        ...(old?.resumeClaim ? { resumeClaim: old.resumeClaim } : options.memory.unitClaims[id] ? { resumeClaim: (({ campTravel: _, ...claim }) => claim)(options.memory.unitClaims[id]!) } : {}),
        ...(plan.subgoal ? { subgoal: plan.subgoal, clearingIds: [...plan.contacts[0]!.camp.memberIds] } : {}) };
      let changed: GameCommand[];
      if (plan.kind === 'clear-camp') {
        const camp = plan.contacts[0]!.camp;
        if (creepForce(party, camp.camp) >= forceFor(camp.camp) && unit.kind !== 'worker') {
          changed = [{ type: 'attack', unitIds: [id], targetId: camp.memberIds[0]! }];
        } else {
          // A prerequisite has a force demand, not an order to drift into the camp.
          // Search around the actual current position; retain the original parent.
          const refuge = planCampTravel(snapshot, unit, unit, { parentId, party, facts, arrivalRange: 480, valueGoldPerTick: 0 });
          if (refuge.kind === 'clear-camp' || !refuge.road) changed = [{ type: 'holdPosition', unitIds: [id] }];
          else {
            transit.stop = { ...refuge.goal };
            changed = threatRoadCommands(unit, { ...refuge.road, points: refuge.road.points as [Point, ...Point[]] });
          }
        }
      } else {
        changed = threatRoadCommands(unit, { ...plan.road!, points: plan.road!.points as [Point, ...Point[]] });
        if (command.type === 'attackMove') changed = changed.map(leg => leg.type === 'move'
          ? { type: 'attackMove', unitIds: leg.unitIds, x: leg.x, y: leg.y, queued: leg.queued ?? false } : leg);
        if (command.type !== 'build' && command.type !== 'move' && command.type !== 'attackMove' && command.type !== 'holdPosition') {
          changed.push({ ...ownCommand, ...(command.type === 'attackMove' ? plan.goal : {}), queued: true } as GameCommand);
        }
      }
      if (!changed.length) { output.push({ ...entry, command: ownCommand }); continue; }
      rewritten = true;
      output.push(...changed.map(next => ({ scriptId: entry.scriptId, command: next })));
      const claim = options.memory.unitClaims[id];
      if (!claim) recordUnitTaskClaim(snapshot, options.memory, id, { kind: 'campTravel', targetId: parentId, x: destination.x, y: destination.y });
      // A deliberate clearing action is visible as such to the death ledger.
      if (changed[0]?.type === 'attack' && !isDefenseTaskClaim(options.memory.unitClaims[id])) recordUnitTaskClaim(snapshot, options.memory, id,
        { kind: 'creep', targetId: changed[0].targetId, ...plan.contacts[0]!.camp.camp.center });
      if (changed[0]?.type === 'attack' && transit.subgoal) transit.subgoal = { ...transit.subgoal, status: 'active' };
      options.memory.unitClaims[id]!.campTravel = transit;
      options.memory.unitClaims[id]!.expiresTick = Math.max(options.memory.unitClaims[id]!.expiresTick, snapshot.tick + (plan.road?.ticks ?? 0) + 300);
    }
    if (!rewritten) output.splice(begin, output.length - begin, entry);
  }
  return output;
}
