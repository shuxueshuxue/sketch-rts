import { expect, it } from 'vitest';
import { sketchScene } from '../sdk/scene';
import { issuePlayerCommand, restoreSnapshotIntoGame, snapshotGame } from '../shared/sim';
import { CommandFrameRuntime } from '../shared/sim/command-frame-runtime';
import { createAiRuntime, createPresetAiRuntimeFramePlanner } from './runtime';
import { planAiOwnerCommandEntries } from './planner-context';
import { miningJobSafety } from './bootstrap_1/mining-job-defense';
import { createAiThinkHost } from './think-worker/host';
import type { AiThinkMessage, AiThinkReply } from './think-worker/protocol';

function start() {
  const game=sketchScene('external-rescue-override').map('bareDuel').replaceDefaults()
    .player('us',{team:'a'}).player('foe',{team:'b'})
    .townHall('us',500,500).townHall('foe',3500,3500)
    .unit('us','worker',1100,1000,{id:'builder'}).unit('foe','horseArcher',1450,1000,{id:'raider'}).build().createGame();
  game.players.us!.gold=2000;
  issuePlayerCommand(game,'us',{type:'build',unitId:'builder',buildingKind:'farm',x:2208,y:1024});
  return game;
}
it('serializes a pending identical outside override before the next think, then forks without reviving the build',()=>{
  const game=start(),ai=createAiRuntime(['us'],{version:'v9_archer',scripts:[miningJobSafety]});
  const entries=planAiOwnerCommandEntries(snapshotGame(game),{playerId:'us',version:'v9_archer',memory:ai.memories.us!,scripts:[miningJobSafety]},{teams:game.teams});
  const move=entries.find(entry=>entry.command.type==='move')!.command;
  for(const entry of entries)issuePlayerCommand(game,'us',entry.command);
  game.units=game.units.filter(unit=>unit.id!=='raider');game.tick=1;
  const planner=createPresetAiRuntimeFramePlanner(game,ai,{commandDelayTicks:0});
  const runtime=new CommandFrameRuntime({game,roomId:'override',rejectionLabel:'test',aiPlanner:planner});
  // Accepted by the public runtime while this owner is not due to think.
  runtime.completeAndApply([{playerId:'us',command:move}],{includeAi:false});
  const saved=JSON.parse(JSON.stringify(planner.checkpoint()));
  const fork=start();restoreSnapshotIntoGame(fork,snapshotGame(game),game.nextId);
  const forkAi=createAiRuntime(['us'],{version:'v9_archer',scripts:[miningJobSafety]});
  forkAi.memories=JSON.parse(JSON.stringify(ai.memories));
  const forkPlanner=createPresetAiRuntimeFramePlanner(fork,forkAi,{commandDelayTicks:0});forkPlanner.restore(saved);
  game.tick=fork.tick=15;
  const original=runtime.completeAndApply([],{});
  const forkRuntime=new CommandFrameRuntime({game:fork,roomId:'override',rejectionLabel:'test',aiPlanner:forkPlanner});
  expect(forkRuntime.completeAndApply([],{})).toEqual(original);
  expect(ai.memories.us!.unitClaims.builder?.evacuation?.continuation).toBeUndefined();
  expect(forkAi.memories).toEqual(ai.memories);
  expect(ai.memories.us!.workerContinuationEvents).toContainEqual(expect.objectContaining({reason:'external-order'}));
});

it('delivers the same override to the thinking thread, without interpreting equality as permission to resume',()=>{
  const game=start(),host=createAiThinkHost(),replies:AiThinkReply[]=[];
  host.open({type:'open',session:'rescue',map:game.map,policyMode:'combat'},reply=>replies.push(reply));
  const request=(tick:number,overridingCommands?:Extract<AiThinkMessage,{type:'think'}>['requests'][number]['overridingCommands'])=>{
    const {terrain:_terrain,landmarks:_landmarks,...map}=snapshotGame(game).map;
    host.think({type:'think',session:'rescue',tick,deliveryTick:tick+3,snapshot:{...snapshotGame(game),map},
      requests:[{playerId:'us',version:'v9_archer',...(overridingCommands?{overridingCommands}:{})}]});
    const reply=replies.at(-1)!;expect('commands'in reply,JSON.stringify(reply)).toBe(true);
    return 'commands'in reply?reply.commands:[];
  };
  const first=request(0),move=first.find(entry=>entry.command.type==='move')!.command;
  for(const entry of first)issuePlayerCommand(game,entry.playerId,entry.command);
  game.units=game.units.filter(unit=>unit.id!=='raider');game.tick=15;
  expect(request(15,[move])).toEqual([]);
});

it('does not deliver an older rescue order after an accepted player override during command delay',()=>{
  const game=start(),ai=createAiRuntime(['us'],{version:'v9_archer',scripts:[miningJobSafety]});
  const planner=createPresetAiRuntimeFramePlanner(game,ai,{commandDelayTicks:5});
  const runtime=new CommandFrameRuntime({game,roomId:'in-flight',rejectionLabel:'test',aiPlanner:planner});
  runtime.completeAndApply([]);
  expect(ai.memories.us!.unitClaims.builder?.evacuation?.continuation).toBeDefined();
  game.tick=1;
  runtime.completeAndApply([{playerId:'us',command:{type:'move',unitIds:['builder'],x:600,y:600}}]);
  game.tick=5;
  const delivery=runtime.completeAndApply([]);
  expect(delivery?.commands??[]).toEqual([]);
  expect(game.units.find(unit=>unit.id==='builder')!.order).toMatchObject({type:'move',x:600,y:600});
});
