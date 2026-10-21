import type { CommandFrameEntry } from '../../../sdk/commands/frame';
import type { GameCommand, GameSnapshot } from '../../../shared/types';
import type { Observed } from '../../../shared/sim/observation';
import { readGoalIntent } from '../goal-authority-references';
import { landIdAt } from '../regions';
import type { PuzzleExecutionObservation } from './planner-binding';

export const SHIP_GOAL_STEPS = ['position-transport', 'transport-force', 'clear-camp', 'transport-worker', 'build'] as const;
type Step = typeof SHIP_GOAL_STEPS[number];
type RecordValue = Readonly<Record<string, unknown>>;
type Returned = { tick: number; owner: string; scriptId: string; command: CommandFrameEntry['command']; group?: string };
type Group = { key: string; step: Step; goal: string; parameters: RecordValue; commands: Returned[];
  loaded: Set<string>; dead: Set<string>; proofTicks: number[]; proofEntities: string[]; initiallyComplete: boolean };
export type ShipOwnershipScope = { targetLandId: string; targetMine: { x: number; y: number }; campMemberIds: readonly string[] };
export type PuzzleStepOwnership = { passed: boolean; nativeApplications: readonly AppliedPuzzleCommand[]; steps: { step: Step;
  status: 'goal-confirmed' | 'older-code-completed' | 'unconfirmed';
  goalCommandCount: number; sdkAppliedCount: number; effectTick: number | null;
  scriptIds: string[]; entityIds: string[] }[] };
export type AppliedPuzzleCommand = { tick: number; owner: string; scriptId: string; command: GameCommand };
const record = (v: unknown): RecordValue | undefined => v && typeof v === 'object' && !Array.isArray(v) ? v as RecordValue : undefined;
const point = (v: unknown) => { const p = record(v); return typeof p?.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : undefined; };
const ref = (v: unknown) => { const p = record(v); return p?.kind === 'existing' && typeof p.entityId === 'string' ? p.entityId : undefined; };
const refs = (v: unknown) => Array.isArray(v) ? v.map(ref).filter((id): id is string => id !== undefined).sort() : [];
const strings = (v: unknown) => Array.isArray(v) && v.every(id => typeof id === 'string') ? [...v].sort() as string[] : [];
const canonical = (v: unknown): string => JSON.stringify(v, (_, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);

/** Test-only receipt collector. It reads real owner traces and SDK snapshots;
 * it cannot select a goal, supply a fact, grant a unit or issue a command. */
export function createExecutionOwnership(scope: ShipOwnershipScope) {
  const returned: Returned[] = [], groups = new Map<string, Group>();
  const sdkApplications: AppliedPuzzleCommand[] = [];
  const otherBuilds: { row: Returned; proofTicks: number[]; entityIds: string[]; initiallyComplete: boolean }[] = [];
  function observe(snapshot: GameSnapshot, observation: Pick<PuzzleExecutionObservation, 'owner' | 'allocation' | 'commands'>) {
    const { allocation } = observation;
    for (const entry of observation.commands) {
      const row: Returned = { tick: snapshot.tick, owner: entry.playerId, scriptId: entry.scriptId, command: structuredClone(entry.command) };
      returned.push(row);
      const admission = allocation.commandAdmissions?.find(a => a.status === 'accepted' && a.source === 'executor'
        && a.executor === entry.scriptId && a.action && canonical(a.command) === canonical(entry.command));
      const execution = admission?.action && allocation.executions.find(e => e.token.actionId === admission.action!.actionId
        && e.token.generation === admission.action!.generation && e.executor === entry.scriptId);
      if (execution?.intent.kind === 'goal-action' && SHIP_GOAL_STEPS.some(step => entry.scriptId === `goal.${step}`)) {
        const intent = readGoalIntent(allocation, execution.intent), step = intent.actionKind as Step, p = intent.parameters;
        const at = record(p.at), atPoint = point(at?.point);
        if ((step === 'transport-force' || step === 'transport-worker') && at?.landId !== scope.targetLandId) continue;
        if (step === 'clear-camp' && canonical(strings(p.memberIds)) !== canonical([...scope.campMemberIds].sort())) continue;
        if (step === 'build' && (p.buildingKind !== 'townHall' || !atPoint || landIdAt(snapshot.map, atPoint) !== scope.targetLandId
          || Math.hypot(atPoint.x-scope.targetMine.x, atPoint.y-scope.targetMine.y) > 300)) continue;
        // Continuations can have new tokens and origin=aboard. Their real hull,
        // cohort and destination still identify the same transport obligation.
        const key = canonical({ goal: intent.goalId, step, transport: ref(p.transport), cohort: refs(p.cohort),
          camp: strings(p.memberIds), at: step === 'position-transport' || step === 'build' ? p.at : record(p.at)?.landId,
          buildingKind: p.buildingKind });
        row.group = key;
        let group = groups.get(key);
        if (!group) { group = { key, step, goal: intent.goalId, parameters: p, commands: [], loaded: new Set(), dead: new Set(), proofTicks: [], proofEntities: [],
          initiallyComplete: step === 'build' && snapshot.buildings.some(b => b.kind === p.buildingKind && b.complete && b.x === atPoint?.x && b.y === atPoint.y) }; groups.set(key, group); }
        group.commands.push(row);
      } else if (entry.command.type === 'build' && entry.command.buildingKind === 'townHall') {
        const command = entry.command;
        if (landIdAt(snapshot.map, command) !== scope.targetLandId || Math.hypot(command.x-scope.targetMine.x, command.y-scope.targetMine.y) > 300) continue;
        otherBuilds.push({ row, proofTicks: [], entityIds: [], initiallyComplete: snapshot.buildings.some(b => b.owner === observation.owner
          && b.kind === command.buildingKind && b.x === command.x && b.y === command.y && b.complete) });
      }
    }
    for (const group of groups.values()) {
      const p = group.parameters, at = record(p.at), atPoint = point(at?.point), cohort = refs(p.cohort);
      let proven = false; let entityIds: string[] = [];
      if (group.step === 'position-transport') {
        const hull = snapshot.units.find(u => u.id === ref(p.transport));
        proven = !!hull && !!atPoint && typeof p.tolerance === 'number' && Math.hypot(hull.x-atPoint.x, hull.y-atPoint.y) <= p.tolerance;
        if (hull) entityIds = [hull.id];
      } else if (group.step === 'transport-force' || group.step === 'transport-worker') {
        const hullId = ref(p.transport), targetLand = at?.landId;
        for (const id of cohort) {
          const unit = snapshot.units.find(u => u.id === id);
          if (unit?.deck?.shipId === hullId || unit?.cabin?.shipId === hullId) group.loaded.add(id);
        }
        proven = cohort.length > 0 && cohort.every(id => {
          const u = snapshot.units.find(unit => unit.id === id);
          return group.loaded.has(id) && !!u && u.hp > 0 && !u.deck && !u.cabin && landIdAt(snapshot.map, u) === targetLand;
        });
        entityIds = cohort;
      } else if (group.step === 'clear-camp') {
        const members = strings(p.memberIds), firstTick = group.commands[0]!.tick;
        for (const corpse of snapshot.corpses ?? []) if (members.includes(corpse.unitId) && corpse.diedAtTick >= firstTick) group.dead.add(corpse.unitId);
        proven = members.length > 0 && members.every(id => group.dead.has(id)); entityIds = members;
      } else if (group.step === 'build' && atPoint) {
        const hall = snapshot.buildings.find(b => b.owner === observation.owner && b.kind === p.buildingKind
          && b.x === atPoint.x && b.y === atPoint.y && b.hp > 0 && b.complete);
        // A goal repair may finish an explicitly adopted foundation. A repair
        // of an already complete unrelated hall is not a construction proof.
        proven = !!hall && !group.initiallyComplete && group.commands.some(r => r.command.type === 'build' || r.command.type === 'repair' && p.foundationId === hall.id);
        if (hall) entityIds = [hall.id];
      }
      if (proven) { group.proofTicks.push(snapshot.tick); group.proofEntities = entityIds; }
    }
    for (const other of otherBuilds) {
      const c = other.row.command;
      if (c.type !== 'build' || other.initiallyComplete) continue;
      const hall = snapshot.buildings.find(b => b.owner === observation.owner && b.kind === c.buildingKind && b.x === c.x && b.y === c.y && b.complete && b.hp > 0);
      if (hall) { other.proofTicks.push(snapshot.tick); other.entityIds = [hall.id]; }
    }
  }
  function finish(initialTick: number, nativeCommands: readonly { tick: number; command: Observed<GameCommand> }[],
    required: readonly Step[] = SHIP_GOAL_STEPS): PuzzleStepOwnership {
    // Match each actual native application once, to its literal returned SDK
    // entry. A queued/accepted command alone cannot satisfy this condition.
    const unused = new Set(returned), applied = new Map<Returned, number>();
    for (const native of sdkApplications) {
      // The SDK hook carries the executor label after frame application. A
      // later identical command from an old producer cannot credit a goal.
      const row = returned.find(r => unused.has(r) && r.owner === native.owner && r.scriptId === native.scriptId && r.tick <= native.tick
        && canonical(r.command) === canonical(native.command));
      if (row && nativeCommands.some(c => c.tick+initialTick >= row.tick && canonical(c.command) === canonical(native.command))) {
        unused.delete(row); applied.set(row, native.tick);
      }
    }
    const steps = required.map(step => {
      const candidates = [...groups.values()].filter(g => g.step === step);
      const confirmed = candidates.find(g => {
        const rows = g.commands.filter(r => applied.has(r));
        const transport = step === 'transport-force' || step === 'transport-worker';
        if (transport && (!rows.some(r => r.command.type === 'board') || !rows.some(r => r.command.type === 'unload'))) return false;
        return rows.some(r => g.proofTicks.some(t => t >= applied.get(r)!));
      });
      const others = step === 'build' ? otherBuilds.filter(b => applied.has(b.row) && b.proofTicks.some(t => t >= applied.get(b.row)!)) : [];
      const appliedRows = candidates.flatMap(g => g.commands).filter(r => applied.has(r));
      return { step, status: confirmed ? 'goal-confirmed' as const : others.length ? 'older-code-completed' as const : 'unconfirmed' as const,
        goalCommandCount: candidates.reduce((n,g) => n+g.commands.length,0), sdkAppliedCount: appliedRows.length,
        effectTick: confirmed ? confirmed.proofTicks.find(t => appliedRows.some(r => t >= applied.get(r)!)) ?? null : others[0]?.proofTicks[0] ?? null,
        scriptIds: confirmed ? [...new Set(confirmed.commands.map(r => r.scriptId))] : [...new Set(others.map(b => b.row.scriptId))],
        entityIds: confirmed?.proofEntities ?? others[0]?.entityIds ?? [] };
    });
    return { passed: steps.every(s => s.status === 'goal-confirmed'), nativeApplications: structuredClone(sdkApplications), steps };
  }
  return { observe, applied(event: AppliedPuzzleCommand) {
    // The real SDK event also contains the live Game and its methods. Retain
    // only the receipt fields; never clone or save the SDK context object.
    sdkApplications.push({ tick:event.tick, owner:event.owner, scriptId:event.scriptId, command:structuredClone(event.command) });
  }, finish };
}
