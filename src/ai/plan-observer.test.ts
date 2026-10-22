import {describe, it, expect, vi} from 'vitest';
import * as traceModule from './plan-trace';
import * as contextModule from './death-ledger-context';
import {AiPlanObserver} from './plan-observer';
import {applyAiPlanDelta, diffAiPlan, type AiPlanPacket} from './plan-stream';
import {createAiRuntime, createInlineAiThinkExecutor, createPresetAiRuntimeFramePlanner} from './runtime';
import {createGame, snapshotGame} from '../shared/sim';
import {CommandFrameRuntime} from '../shared/sim/command-frame-runtime';
import {checksumGame} from '../shared/sim/checksum';
import {LocalGameAdapter} from '../client/net/local-adapter';
import {replaySnapshotToTick} from '../shared/replay';
import {createRoomLifecycleHost} from '../shared/room-lifecycle';
import {strategyFixture} from '../client/ai-plan-strategy.test-fixture';
import type {AiThinkObservation} from './runtime';

it('constructs no trace, context or ledger while both switches are off; observation does not change a single command or tick hash', () => {
  const project = vi.spyOn(traceModule,'buildAiPlanTrace'), context = vi.spyOn(contextModule,'projectDeathThinkContext');
  function run(observed: boolean) {
    const game=createGame('bareDuel',{aiPlayers:['player','enemy']}), ai=createAiRuntime(['player','enemy']);
    const executor=createInlineAiThinkExecutor(ai), observer=new AiPlanObserver(game,ai.controlledPlayers,executor);
    const packets: AiPlanPacket[]=[];
    const stop=observed ? observer.subscribe(p=>packets.push(p)) : undefined;
    const runtime=new CommandFrameRuntime({game,roomId:'proof',rejectionLabel:'test',aiPlanner:createPresetAiRuntimeFramePlanner(game,ai,{executor})});
    const hashes:string[]=[], commands:string[]=[];
    for(let tick=0;tick<120;tick++) {
      runtime.tick([],{everyTick:true,onFrame:frame=>commands.push(JSON.stringify(frame.commands))});
      observer.step(); hashes.push(checksumGame(game));
    }
    expect(observer.active).toBe(observed);
    stop?.(); expect(observer.active).toBe(false);
    return {hashes,commands,packets};
  }
  const closed=run(false);
  expect(project).not.toHaveBeenCalled(); expect(context).not.toHaveBeenCalled();
  expect(closed.packets).toEqual([]);
  const opened=run(true);
  expect(opened.commands).toEqual(closed.commands); expect(opened.hashes).toEqual(closed.hashes);
  expect(opened.packets.some(p=>p.type==='trace' && p.baseTick!==null)).toBe(true);
  project.mockRestore();context.mockRestore();
});

it('sends only changed nodes, rejects missing baselines, and starts a new baseline after a gap', () => {
  const snapshot=snapshotGame(createGame('bareDuel'));
  const first=traceModule.buildAiPlanTrace(snapshot,'player',{jobs:[],unitClaims:{}},'v9_archer');
  const second={...first,tick:15,previousTick:0};
  const initial=diffAiPlan(undefined,first,1), delta=diffAiPlan(first,second,1);
  expect(delta.upsert).toEqual([]);
  expect(applyAiPlanDelta(undefined,delta)).toBeUndefined();
  expect(applyAiPlanDelta(applyAiPlanDelta(undefined,initial),delta)).toEqual(second);
  expect(applyAiPlanDelta(undefined,diffAiPlan(undefined,second,2))).toEqual(second);
});

it('keeps recording after the view closes, replays the same world, and does not record earlier time', async () => {
  const lifecycle=createRoomLifecycleHost(); lifecycle.createRoom({id:'local',host:{id:'owner',name:'Owner'},mapId:'bareDuel'});
  const setup=lifecycle.prepareStartRoom('local'), {room}=lifecycle.startRoom('local');
  const game=createGame(setup.mapId,setup.options);let now=0;
  const adapter=new LocalGameAdapter(game,'player',{room,aiRuntime:createAiRuntime(['enemy']),now:()=>now});
  for(let i=0;i<20;i++){now+=50;adapter.updateToRenderTime();}
  const start=game.tick;
  await adapter.startRecording(); const stop=adapter.subscribePlans(()=>{});stop();
  for(let i=0;i<40;i++){now+=50;adapter.updateToRenderTime();}
  const trace=await adapter.recordedReplay();
  expect(trace.initialSave.snapshot.tick).toBe(start);
  expect(trace.aiPlans?.packets.some(p=>p.type==='trace')).toBe(true);
  expect(trace.aiPlans?.packets.filter(p=>p.type==='coverage')).toContainEqual(expect.objectContaining({from:start}));
  expect(replaySnapshotToTick(trace,game.tick)).toEqual(snapshotGame(game));
  adapter.close();
});

it('stops all projection work when recording and viewing both stop, and resumes with a fresh baseline',()=>{
 const game=createGame('bareDuel',{aiPlayers:['enemy']}),ai=createAiRuntime(['enemy']),executor=createInlineAiThinkExecutor(ai);
 const observer=new AiPlanObserver(game,['enemy'],executor),packets:AiPlanPacket[]=[];
 const runtime=new CommandFrameRuntime({game,roomId:'switches',rejectionLabel:'test',aiPlanner:createPresetAiRuntimeFramePlanner(game,ai,{executor})});
 const advance=()=>{for(let i=0;i<30;i++){runtime.tick([]);observer.step();}};
 observer.record(true);advance();const stop=observer.subscribe(p=>packets.push(p));stop();
 expect(observer.active).toBe(true);observer.record(false);expect(observer.active).toBe(false);
 const before=observer.recordingData(),spy=vi.spyOn(traceModule,'buildAiPlanTrace');advance();
 expect(spy).not.toHaveBeenCalled();expect(observer.recordingData()).toEqual(before);
 const close=observer.subscribe(p=>packets.push(p));advance();
 expect(packets.filter(p=>p.type==='trace')[0]).toMatchObject({baseTick:null});close();spy.mockRestore();
});

it('does not let an observation consumer discard an already planned command',()=>{
 const game=createGame('bareDuel',{aiPlayers:['enemy']}),runtime=createAiRuntime(['enemy']);
 const executor=createInlineAiThinkExecutor(runtime);const log=vi.spyOn(console,'error').mockImplementation(()=>{});
 executor.observe!(()=>{throw new Error('diagnostic consumer');});
 const commands:any[]=[];
 expect(()=>executor.submit(game,{tick:0,deliveryTick:0,requests:[{playerId:'enemy',memory:runtime.memories.enemy!}]},frame=>commands.push(...frame))).not.toThrow();
 expect(commands.some(c=>c.command.type==='mine')).toBe(true);expect(log).toHaveBeenCalled();log.mockRestore();
});

it('samples formal assignees outside old module claims, excluding observed proposal memberships', () => {
  const { game, snapshot, trace, first, second } = strategyFixture();
  const ai = createAiRuntime(['player']), executor = createInlineAiThinkExecutor(ai);
  let consume: ((observation: AiThinkObservation) => void) | undefined;
  executor.observe = listener => { consume = listener; };
  const before = checksumGame(game), observer = new AiPlanObserver(game, ['player'], executor), packets: AiPlanPacket[] = [];
  const close = observer.subscribe(packet => packets.push(packet));
  consume!({ trace, context: contextModule.projectDeathThinkContext(snapshot, 'player', { jobs: [], unitClaims: {} }) });
  const packet = packets.find(packet => packet.type === 'trace');
  expect(packet?.type === 'trace' ? packet.positions?.map(position => position.id) : []).toEqual([first.id]);
  expect(packet?.type === 'trace' ? packet.positions?.map(position => position.id) : []).not.toContain(second.id);
  expect(checksumGame(game)).toBe(before);
  close();
  expect(observer.active).toBe(false);
});
