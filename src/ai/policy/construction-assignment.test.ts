import {expect,it} from 'vitest';
import {sketchScene} from '../../sdk/scene';
import {issuePlayerCommand,snapshotGame} from '../../shared/sim';
import {createAiPolicyMemory,type WorkerContinuation} from '../memory';
import {assignedConstruction,hasAssignedConstruction} from './construction-assignment';
import {recordWorkerCommandOverrides} from './worker-continuation';
import {bootstrapPolicyContext} from '../bootstrap_1/policy';
import {bootstrapEconomy,planBootstrapEconomy} from '../bootstrap_1/economy';
import {miningJobSafety} from '../bootstrap_1/mining-job-defense';
import {planAiOwnerCommandEntries} from '../planner-context';

it('recognizes native and valid retained responsibility without keeping an invalid site occupied',()=>{
  const game=sketchScene('construction-responsibility').map('bareDuel').replaceDefaults().player('us')
    .unit('us','worker',400,500,{id:'builder'}).build().createGame(),memory=createAiPolicyMemory();
  const worker=game.units[0]!,parent={type:'build' as const,unitId:worker.id,buildingKind:'farm' as const,x:900,y:900};
  worker.order=parent;
  expect(assignedConstruction(snapshotGame(game),worker,memory)).toBe(parent);
  worker.order={type:'idle'};
  const continuation:WorkerContinuation={parent,phase:'life-saving-interruption',sinceTick:0,threatIds:[],binding:[]};
  memory.unitClaims[worker.id]={kind:'workerSafety',targetId:worker.id,x:400,y:500,sinceTick:0,expiresTick:1,
    evacuation:{origin:{x:400,y:500},shelter:{x:400,y:500},continuation}};
  game.tick=5000;
  const before=structuredClone(memory);
  expect(hasAssignedConstruction(snapshotGame(game),[worker],memory,site=>site.x===900)).toBe(true);
  expect(memory).toEqual(before);
  worker.order={type:'move',x:1200,y:1200};
  expect(hasAssignedConstruction(snapshotGame(game),[worker],memory)).toBe(false);
  // The query need not wait for the script runner's pruning pass.
  expect(memory).toEqual(before);
});

it('allows the normal economy to dispatch to the same point on the next think after the parent ends',()=>{
  const game=sketchScene('construction-parent-ended').map('bareDuel').replaceDefaults()
    .player('us',{team:'a'}).player('foe',{team:'b'}).townHall('us',500,500).townHall('foe',3500,3500)
    .unit('us','worker',1100,1000,{id:'builder'}).unit('foe','horseArcher',1450,1000,{id:'raider'}).build().createGame();
  Object.assign(game.players.us!,{gold:2000,supplyCap:1,supplyUsed:1});
  const memory=createAiPolicyMemory(),frame=snapshotGame(game);
  const ordinary=planBootstrapEconomy(frame,'us',bootstrapPolicyContext(frame,'us','v9_archer',{memory,teams:game.teams}));
  const farm=ordinary.find(command=>command.type==='build'&&command.buildingKind==='farm')!;
  expect(farm).toBeDefined();issuePlayerCommand(game,'us',farm);
  for(const entry of planAiOwnerCommandEntries(snapshotGame(game),{playerId:'us',version:'v9_archer',memory,scripts:[miningJobSafety]},{teams:game.teams}))
    issuePlayerCommand(game,'us',entry.command);
  expect(memory.unitClaims.builder?.evacuation?.continuation).toBeDefined();
  const economicThink=()=>planAiOwnerCommandEntries(snapshotGame(game),{playerId:'us',version:'v9_archer',memory,scripts:[bootstrapEconomy,miningJobSafety]},{teams:game.teams});
  game.tick=15;
  expect(economicThink().some(entry=>entry.command.type==='build'&&entry.command.buildingKind==='farm')).toBe(false);
  const replacement={type:'move' as const,unitIds:['builder'],x:600,y:600};
  issuePlayerCommand(game,'us',replacement);recordWorkerCommandOverrides(snapshotGame(game),memory,[replacement]);
  game.units=game.units.filter(unit=>unit.id!=='raider');game.tick=30;
  expect(economicThink().map(entry=>entry.command)).toContainEqual(farm);
  expect(memory.unitClaims.builder?.evacuation?.continuation).toBeUndefined();
});

it('keeps the same unpaid construction budget for native and retained responsibility, and releases it on cancellation',async()=>{
  const {runAiCommandEntriesFromScripts}=await import('./script-runner');
  const game=sketchScene('construction-budget').map('bareDuel').replaceDefaults().player('us')
    .townHall('us',500,500).unit('us','worker',600,500,{id:'builder'}).build().createGame();
  game.players.us!.gold=500;
  const worker=game.units.find(unit=>unit.id==='builder')!,memory=createAiPolicyMemory();
  const parent={type:'build' as const,unitId:worker.id,buildingKind:'townHall' as const,x:1500,y:1500};
  const received:number[]=[];
  const scripts=[{id:'budget-consumer',phase:'economy' as const,run(snapshot:ReturnType<typeof snapshotGame>){received.push(snapshot.players.us!.gold);return [];}}];
  worker.order=parent;
  runAiCommandEntriesFromScripts(snapshotGame(game),'us',scripts,{memory});
  worker.order={type:'idle'};
  memory.unitClaims[worker.id]={kind:'workerSafety',targetId:worker.id,x:600,y:500,sinceTick:0,expiresTick:1,
    evacuation:{origin:{x:600,y:500},shelter:{x:600,y:500},continuation:{parent,phase:'life-saving-interruption',sinceTick:0,threatIds:[],binding:[]}}};
  runAiCommandEntriesFromScripts(snapshotGame(game),'us',scripts,{memory});
  recordWorkerCommandOverrides(snapshotGame(game),memory,[{type:'move',unitIds:[worker.id],x:700,y:500}]);
  runAiCommandEntriesFromScripts(snapshotGame(game),'us',scripts,{memory});
  expect(received).toEqual([100,100,500]);
  expect(game.players.us!.gold).toBe(500);
});
