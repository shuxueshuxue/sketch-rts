import { describe, expect, it } from 'vitest';
import { sketchScene } from '../../../sdk/scene';
import { issueCommandFrame } from '../../../sdk/commands/frame';
import { observeSimulation, snapshotGame, stepGame, type Game } from '../../../shared/sim';
import type { GameCommand } from '../../../shared/types';
import type { Observed } from '../../../shared/sim/observation';
import type { StrategyAllocationTrace } from '../allocation-types';
import { landIdAt } from '../regions';
import type { GoalExecutableIntent } from '../goal-execution-types';
import { createExecutionOwnership } from './execution-ownership';
import { legalBuildingSite } from './world';

// Receipt matcher contracts use real SDK construction and snapshots. The
// allocation envelopes below exercise attribution only, not planner success.
function fixture() {
  const game = sketchScene('ownership-contract').map('bareDuel').replaceDefaults()
    .player('us', { race: 'grove' }).playerState('us', { gold: 3000 }).worker('us', 800, 1000).build().createGame();
  game.scriptedVictory = true;
  const at = legalBuildingSite(game, 'townHall', { x: 1000, y: 1000 });
  const worker = game.units.find(u => u.owner === 'us' && u.kind === 'worker')!;
  const tracker = createExecutionOwnership({ targetMine: at, targetLandId: landIdAt(game.map, at)!, campMemberIds: [] });
  const commands: { tick: number; command: Observed<GameCommand> }[] = [];
  const start = game.tick, stop = observeSimulation(game, { command(e) { commands.push({ tick: e.tick-start, command: e.command }); } });
  const command: GameCommand = { type: 'build', unitId: worker.id, buildingKind: 'townHall', ...at };
  return { game, at, worker, tracker, commands, start, stop, command };
}
function observe(f: ReturnType<typeof fixture>, command?: GameCommand, scriptId = 'goal.build', parameters?: GoalExecutableIntent['parameters']) {
  const token = { actionId: 'receipt', generation: 1 };
  const allocation: StrategyAllocationTrace = { revision: 1, objectives: [], assignments: [], budget: [], voyages: [], vacancies: [], blocked: [], unmet: [], events: [], budgetProjection: [],
    executions: command && scriptId.startsWith('goal.') ? [{ token, objectiveId: 'goal', methodId: 'method', executor: scriptId,
      intent: { kind: 'goal-action', goalId: 'goal', declarationId: 'decl', actionKind: scriptId === 'goal.clear-camp' ? 'clear-camp' : 'build',
        parameters: parameters ?? { buildingKind: 'townHall', at: { point: f.at }, worker: { kind: 'existing', entityId: f.worker.id }, foundationId: null }, outputs: [] },
      target: { point: f.at }, dependsOn: [], completionEffects: [], status: 'active', phase: 'build', sinceTick: f.game.tick, lastProgressTick: f.game.tick, state: {} }] : [],
    commandAdmissions: command && scriptId.startsWith('goal.') ? [{ commandId: 'sdk-receipt', source: 'executor', executor: scriptId, action: token,
      allocationRevision: 1, purpose: 'task', command, status: 'accepted', admittedTick: f.game.tick, queuedTick: null }] : [] };
  f.tracker.observe(snapshotGame(f.game), { owner: 'us', allocation, commands: command ? [{ playerId: 'us', scriptId, command }] : [] });
}
function complete(f: ReturnType<typeof fixture>) {
  for (let i=0; i<1200 && !f.game.buildings.some(b => b.kind === 'townHall' && b.complete); i++) { stepGame(f.game); observe(f); }
  expect(f.game.buildings.some(b => b.kind === 'townHall' && b.complete)).toBe(true);
}
function issue(f: ReturnType<typeof fixture>, scriptId = 'goal.build') {
  observe(f, f.command, scriptId);
  issueCommandFrame(f.game, [{ playerId: 'us', scriptId, command: f.command }], {
    afterIssue(e) { f.tracker.applied({tick:f.game.tick,owner:e.playerId,scriptId:e.scriptId,command:e.command}); } });
}

describe('per-step native SDK ownership', () => {
  it('projects a real SDK context without cloning or retaining its live game', () => {
    const f=fixture();try{
      const before=JSON.stringify(snapshotGame(f.game));
      const sdkEvent={tick:f.game.tick,owner:'us',scriptId:'goal.build',command:f.command,game:f.game};
      expect(()=>f.tracker.applied(sdkEvent)).not.toThrow();
      expect(f.tracker.finish(f.start,[],['build']).nativeApplications[0]).not.toHaveProperty('game');
      expect(JSON.stringify(snapshotGame(f.game))).toBe(before);
    }finally{f.stop();}
  });
  it('does not credit a physically complete old-script hall to the planner', () => {
    const f=fixture(); try {
      issue(f, 'v6Economy'); complete(f);
      expect(f.tracker.finish(f.start, f.commands, ['build'])).toMatchObject({ passed: false,
        steps: [{ step: 'build', status: 'older-code-completed', goalCommandCount: 0, scriptIds: ['v6Economy'] }] });
    } finally { f.stop(); }
  });
  it('requires native application, not only a gateway acceptance envelope', () => {
    const f=fixture(); try {
      observe(f, f.command);
      expect(f.tracker.finish(f.start, [], ['build'])).toMatchObject({ passed: false,
        steps: [{ status: 'unconfirmed', goalCommandCount: 1, sdkAppliedCount: 0 }] });
    } finally { f.stop(); }
  });
  it('requires the actual building effect after native application', () => {
    const f=fixture(); try {
      issue(f);
      expect(f.tracker.finish(f.start, f.commands, ['build']).passed).toBe(false);
      complete(f);
      expect(f.tracker.finish(f.start, f.commands, ['build'])).toMatchObject({ passed: true,
        steps: [{ status: 'goal-confirmed', goalCommandCount: 1, sdkAppliedCount: 1, scriptIds: ['goal.build'] }] });
      expect(f.tracker.finish(f.start, f.commands).passed, 'one successful step cannot stand in for every required step').toBe(false);
    } finally { f.stop(); }
  });
  it('cannot attach a later goal receipt to an earlier old-script application', () => {
    const f=fixture(); try {
      issue(f, 'v6Economy'); complete(f); stepGame(f.game);
      observe(f, f.command);
      expect(f.tracker.finish(f.start, f.commands, ['build'])).toMatchObject({ passed: false,
        steps: [{ status: 'older-code-completed', goalCommandCount: 1, sdkAppliedCount: 0 }] });
    } finally { f.stop(); }
  });
  it('keeps an identical old-producer SDK application from crediting an unissued goal receipt', () => {
    const f=fixture(); try {
      observe(f,f.command);
      issue(f,'v6Economy');complete(f);
      expect(f.tracker.finish(f.start,f.commands,['build'])).toMatchObject({passed:false,
        steps:[{status:'older-code-completed',goalCommandCount:1,sdkAppliedCount:0}]});
    } finally {f.stop();}
  });
  it('requires the specified native corpse after a clear command, not merely a missing live unit', () => {
    const f=fixture(); try {
      const guard=f.game.spawnUnit('neutral','murlocPeon',f.at.x+20,f.at.y);
      const crew=Array.from({length:4},(_,i)=>f.game.spawnUnit('us','footman',f.at.x-30,f.at.y+i*10));
      f.tracker=createExecutionOwnership({targetMine:f.at,targetLandId:landIdAt(f.game.map,f.at)!,campMemberIds:[guard.id]});
      const command:GameCommand={type:'attack',unitIds:crew.map(u=>u.id),targetId:guard.id};
      observe(f,command,'goal.clear-camp',{memberIds:[guard.id],cohort:crew.map(u=>({kind:'existing',entityId:u.id}))});
      issueCommandFrame(f.game,[{playerId:'us',scriptId:'goal.clear-camp',command}],{
        afterIssue(e){f.tracker.applied({tick:f.game.tick,owner:e.playerId,scriptId:e.scriptId,command:e.command});}});
      const without= snapshotGame(f.game);without.units=without.units.filter(u=>u.id!==guard.id);
      f.tracker.observe(without,{owner:'us',allocation:{revision:1,objectives:[],assignments:[],executions:[],budget:[],voyages:[],vacancies:[],blocked:[],unmet:[],events:[],budgetProjection:[]},commands:[]});
      expect(f.tracker.finish(f.start,f.commands,['clear-camp']).passed).toBe(false);
      for(let i=0;i<1000&&f.game.units.includes(guard);i++){stepGame(f.game);observe(f);}
      expect(f.game.corpses?.some(c=>c.unitId===guard.id)).toBe(true);
      expect(f.tracker.finish(f.start,f.commands,['clear-camp'])).toMatchObject({passed:true,steps:[{status:'goal-confirmed',entityIds:[guard.id]}]});
    } finally {f.stop();}
  });
});
